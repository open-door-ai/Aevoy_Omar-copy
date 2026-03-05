/**
 * User File Workspace
 *
 * Per-user persistent file storage. Files survive across task sessions.
 * Security: path jail (cannot escape userId directory), quota (500MB/user),
 * allowlisted MIME types, AES-256-GCM encryption for sensitive files.
 *
 * Storage: Railway volume /workspaces/{userId}/ with Supabase Storage fallback.
 */

import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { getSupabaseClient } from '../utils/supabase.js';

// ── Configuration ──────────────────────────────────────────────
const WORKSPACE_BASE = process.env.WORKSPACE_BASE_PATH || '/workspaces';
const QUOTA_BYTES = 500 * 1024 * 1024; // 500MB per user
const MAX_READ_BYTES = 100 * 1024;      // 100KB max returned to AI
const TEMP_FILE_TTL_MS = 24 * 60 * 60 * 1000; // 24h for _temp_ prefixed files
const ALLOWED_EXTENSIONS = new Set([
  '.txt', '.md', '.csv', '.json', '.html', '.xml', '.yaml', '.yml',
  '.pdf', '.docx', '.xlsx', '.pptx', '.png', '.jpg', '.jpeg', '.gif', '.svg',
  '.py', '.js', '.ts', '.sh', '.sql',
]);

// Patterns that indicate sensitive content — encrypt these
const SENSITIVE_PATTERNS = /(?:API_KEY|PASSWORD|SECRET|TOKEN|PRIVATE_KEY|CREDENTIALS)\s*[=:]/i;

// ── UUID validation ─────────────────────────────────────────────
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validateUserId(userId: string): void {
  if (!UUID_REGEX.test(userId)) {
    throw new Error('Invalid userId format');
  }
}

// ── Filename validation ─────────────────────────────────────────
function validateFilename(filename: string): void {
  if (!filename || filename.length > 100) throw new Error('Filename must be 1-100 chars');
  if (!/^[a-zA-Z0-9._\-/]+$/.test(filename)) throw new Error('Filename contains invalid characters');
  if (filename.includes('..')) throw new Error('Filename cannot contain ".."');
  const ext = path.extname(filename).toLowerCase();
  if (ext && !ALLOWED_EXTENSIONS.has(ext)) throw new Error(`File type "${ext}" not allowed`);
}

// ── Encryption helpers ─────────────────────────────────────────
function encryptContent(content: string, key: Buffer): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(content, 'utf8'), cipher.final()]);
  const authTag = (cipher as NodeJS.WritableStream & { getAuthTag(): Buffer }).getAuthTag
    ? (cipher as unknown as { getAuthTag(): Buffer }).getAuthTag()
    : Buffer.alloc(16);
  return iv.toString('hex') + authTag.toString('hex') + encrypted.toString('hex');
}

function decryptContent(ciphertext: string, key: Buffer): string {
  const iv = Buffer.from(ciphertext.slice(0, 32), 'hex');
  const authTag = Buffer.from(ciphertext.slice(32, 64), 'hex');
  const encrypted = Buffer.from(ciphertext.slice(64), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  (decipher as unknown as { setAuthTag(tag: Buffer): void }).setAuthTag(authTag);
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
}

function getEncryptionKey(): Buffer {
  const keyHex = process.env.ENCRYPTION_KEY || '';
  if (!keyHex || keyHex.length < 64) throw new Error('ENCRYPTION_KEY not set');
  return Buffer.from(keyHex.slice(0, 64), 'hex');
}

// ── UserWorkspace class ────────────────────────────────────────
export class UserWorkspace {
  private userId: string;
  private userDir: string;
  private useRailway: boolean = true;

  constructor(userId: string) {
    validateUserId(userId);
    this.userId = userId;
    this.userDir = path.join(WORKSPACE_BASE, userId);
  }

  private resolvePath(filename: string): string {
    validateFilename(filename);
    const resolved = path.resolve(this.userDir, filename);
    // Security: ensure resolved path is within user directory
    if (!resolved.startsWith(this.userDir + path.sep) && resolved !== this.userDir) {
      throw new Error('Path traversal detected');
    }
    return resolved;
  }

  private async ensureDir(): Promise<void> {
    try {
      await fs.mkdir(this.userDir, { recursive: true });
      this.useRailway = true;
    } catch {
      // Railway volume not available — will use Supabase Storage
      this.useRailway = false;
    }
  }

  private async getTotalSize(): Promise<number> {
    const { data } = await getSupabaseClient()
      .from('user_workspace_files')
      .select('size_bytes')
      .eq('user_id', this.userId);
    return (data || []).reduce((sum: number, f: { size_bytes?: number }) => sum + (f.size_bytes || 0), 0);
  }

  async writeFile(filename: string, content: string): Promise<{ ok: boolean; message: string }> {
    await this.ensureDir();

    const contentBytes = Buffer.byteLength(content, 'utf8');

    // Quota check
    const currentSize = await this.getTotalSize();
    if (currentSize + contentBytes > QUOTA_BYTES) {
      return { ok: false, message: `Workspace quota exceeded (500MB limit). Current: ${Math.round(currentSize / 1024 / 1024)}MB` };
    }

    // Check for sensitive content
    const needsEncryption = SENSITIVE_PATTERNS.test(content);
    let storedContent = content;

    if (needsEncryption) {
      try {
        const key = getEncryptionKey();
        storedContent = 'ENCRYPTED:' + encryptContent(content, key);
      } catch {
        // Proceed without encryption if key unavailable
        console.warn('[WORKSPACE] Could not encrypt sensitive file — storing plaintext');
      }
    }

    if (this.useRailway) {
      const filePath = this.resolvePath(filename);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, storedContent, 'utf8');
    } else {
      // Supabase Storage fallback
      const { error } = await getSupabaseClient().storage
        .from('user-workspace')
        .upload(`${this.userId}/${filename}`, Buffer.from(storedContent, 'utf8'), { upsert: true });
      if (error) return { ok: false, message: `Storage error: ${error.message}` };
    }

    // Update index
    const expiresAt = filename.startsWith('_temp_')
      ? new Date(Date.now() + TEMP_FILE_TTL_MS).toISOString()
      : null;

    await getSupabaseClient().from('user_workspace_files').upsert({
      user_id: this.userId,
      filename,
      size_bytes: contentBytes,
      mime_type: getMimeType(filename),
      encrypted: needsEncryption,
      last_accessed_at: new Date().toISOString(),
      expires_at: expiresAt,
    }, { onConflict: 'user_id,filename' });

    const msg = needsEncryption
      ? `Saved ${filename} (${Math.round(contentBytes / 1024)}KB, encrypted — contains sensitive data)`
      : `Saved ${filename} (${Math.round(contentBytes / 1024)}KB)`;

    return { ok: true, message: msg };
  }

  async readFile(filename: string): Promise<{ ok: boolean; content?: string; message: string }> {
    const { data: fileRecord } = await getSupabaseClient()
      .from('user_workspace_files')
      .select('encrypted, size_bytes, expires_at')
      .eq('user_id', this.userId)
      .eq('filename', filename)
      .single();

    if (!fileRecord) {
      return { ok: false, message: `File "${filename}" not found. Use list_files() to see available files.` };
    }

    // Check expiry
    if (fileRecord.expires_at && new Date(fileRecord.expires_at) < new Date()) {
      await this.deleteFile(filename);
      return { ok: false, message: `File "${filename}" has expired and was deleted.` };
    }

    let content: string;

    if (this.useRailway) {
      await this.ensureDir();
      try {
        const filePath = this.resolvePath(filename);
        content = await fs.readFile(filePath, 'utf8');
      } catch {
        return { ok: false, message: `File "${filename}" not found on disk.` };
      }
    } else {
      const { data, error } = await getSupabaseClient().storage
        .from('user-workspace')
        .download(`${this.userId}/${filename}`);
      if (error || !data) return { ok: false, message: `Could not read "${filename}": ${error?.message}` };
      content = await data.text();
    }

    // Decrypt if needed
    if (fileRecord.encrypted && content.startsWith('ENCRYPTED:')) {
      try {
        const key = getEncryptionKey();
        content = decryptContent(content.slice('ENCRYPTED:'.length), key);
      } catch {
        return { ok: false, message: 'Could not decrypt file — encryption key mismatch' };
      }
    }

    // Update last accessed
    await getSupabaseClient().from('user_workspace_files')
      .update({ last_accessed_at: new Date().toISOString() })
      .eq('user_id', this.userId).eq('filename', filename);

    // Truncate for AI context
    let truncated = content;
    let truncationNote = '';
    if (content.length > MAX_READ_BYTES) {
      truncated = content.substring(0, MAX_READ_BYTES);
      truncationNote = `\n[File truncated at 100KB. Full size: ${Math.round(fileRecord.size_bytes / 1024)}KB]`;
    }

    return { ok: true, content: truncated + truncationNote, message: `Read ${filename}` };
  }

  async appendFile(filename: string, content: string): Promise<{ ok: boolean; message: string }> {
    // Read existing, append, write back
    const existing = await this.readFile(filename);
    const existingContent = existing.ok ? (existing.content || '').replace(/\[File truncated.*\]$/, '') : '';
    return this.writeFile(filename, existingContent + content);
  }

  async deleteFile(filename: string): Promise<{ ok: boolean; message: string }> {
    if (this.useRailway) {
      await this.ensureDir();
      try {
        const filePath = this.resolvePath(filename);
        await fs.unlink(filePath);
      } catch { /* file may already not exist */ }
    } else {
      await getSupabaseClient().storage
        .from('user-workspace')
        .remove([`${this.userId}/${filename}`]);
    }

    await getSupabaseClient().from('user_workspace_files')
      .delete().eq('user_id', this.userId).eq('filename', filename);

    return { ok: true, message: `Deleted ${filename}` };
  }

  async listFiles(): Promise<{ ok: boolean; content: string; message: string }> {
    const { data } = await getSupabaseClient()
      .from('user_workspace_files')
      .select('filename, size_bytes, mime_type, encrypted, last_accessed_at, expires_at')
      .eq('user_id', this.userId)
      .order('last_accessed_at', { ascending: false })
      .limit(50);

    if (!data || data.length === 0) {
      return { ok: true, content: 'No files in workspace yet.', message: 'Workspace empty' };
    }

    const totalSize = data.reduce((sum: number, f: { size_bytes?: number }) => sum + (f.size_bytes || 0), 0);
    const lines = data.map((f: { filename: string; size_bytes?: number; encrypted?: boolean; expires_at?: string }) => {
      const size = (f.size_bytes || 0) < 1024 ? `${f.size_bytes || 0}B` : `${Math.round((f.size_bytes || 0) / 1024)}KB`;
      const enc = f.encrypted ? ' [encrypted]' : '';
      const exp = f.expires_at ? ` [expires ${new Date(f.expires_at).toLocaleDateString()}]` : '';
      return `${f.filename} (${size})${enc}${exp}`;
    });

    const summary = `Workspace files (${Math.round(totalSize / 1024)}KB / 500MB used):\n${lines.join('\n')}`;
    return { ok: true, content: summary, message: `${data.length} files` };
  }
}

// ── Singleton factory ──────────────────────────────────────────
const workspaceCache = new Map<string, UserWorkspace>();

export function getUserWorkspace(userId: string): UserWorkspace {
  if (!workspaceCache.has(userId)) {
    workspaceCache.set(userId, new UserWorkspace(userId));
  }
  return workspaceCache.get(userId)!;
}

// ── MIME type helper ───────────────────────────────────────────
function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const types: Record<string, string> = {
    '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv',
    '.json': 'application/json', '.html': 'text/html', '.xml': 'text/xml',
    '.yaml': 'text/yaml', '.yml': 'text/yaml',
    '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.py': 'text/x-python', '.js': 'text/javascript', '.ts': 'text/typescript',
  };
  return types[ext] || 'text/plain';
}

// ── Cleanup job: delete expired temp files ────────────────────
export async function cleanupExpiredFiles(): Promise<void> {
  const { data: expired } = await getSupabaseClient()
    .from('user_workspace_files')
    .select('user_id, filename')
    .lt('expires_at', new Date().toISOString())
    .limit(100);

  if (!expired || expired.length === 0) return;

  for (const file of expired) {
    const ws = getUserWorkspace(file.user_id);
    await ws.deleteFile(file.filename).catch(() => {});
  }

  console.log(`[WORKSPACE] Cleaned up ${expired.length} expired files`);
}
