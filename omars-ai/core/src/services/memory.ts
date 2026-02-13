import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const MEMORY_DIR = process.env.MEMORY_DIR || '/home/omars-ai/assistant/memory';
const VAULT_DIR = process.env.VAULT_DIR || '/home/omars-ai/assistant/memory/encrypted';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';

interface MemoryEntry {
  key: string;
  value: string;
  updatedAt: string;
  importance: number; // 0.0 to 1.0
  accessCount: number;
  lastAccessedAt: string;
}

const DECAY_RATE = 0.1; // Reduce importance by 0.1 for memories >30 days old
const DECAY_THRESHOLD_DAYS = 30;

// Simple file-based memory with decay (OpenClaw feature)
export async function getMemory(userId: string): Promise<MemoryEntry[]> {
  try {
    const memoryFile = path.join(MEMORY_DIR, `${userId}.json`);
    const data = await fs.readFile(memoryFile, 'utf-8');
    let memories: MemoryEntry[] = JSON.parse(data);

    // Apply decay to old memories
    const now = Date.now();
    memories = memories.map(m => {
      const lastAccessed = new Date(m.lastAccessedAt || m.updatedAt).getTime();
      const daysSinceAccess = (now - lastAccessed) / (1000 * 60 * 60 * 24);

      if (daysSinceAccess > DECAY_THRESHOLD_DAYS) {
        const decayedImportance = Math.max(0, (m.importance || 1.0) - DECAY_RATE);
        console.log(`[MEMORY] Decaying memory "${m.key}" from ${m.importance} to ${decayedImportance}`);
        return { ...m, importance: decayedImportance };
      }

      return m;
    });

    // Filter out completely decayed memories (importance = 0)
    memories = memories.filter(m => (m.importance || 1.0) > 0);

    // Save decayed state
    await fs.writeFile(memoryFile, JSON.stringify(memories, null, 2), 'utf-8');

    return memories;
  } catch {
    return [];
  }
}

export async function saveMemory(userId: string, key: string, value: string, importance: number = 1.0): Promise<void> {
  const memoryFile = path.join(MEMORY_DIR, `${userId}.json`);

  let memories: MemoryEntry[] = [];
  try {
    const data = await fs.readFile(memoryFile, 'utf-8');
    memories = JSON.parse(data);
  } catch {
    // New file
  }

  // Update or add
  const existing = memories.findIndex(m => m.key === key);
  const now = new Date().toISOString();
  const entry: MemoryEntry = {
    key,
    value,
    updatedAt: now,
    importance,
    accessCount: existing >= 0 ? (memories[existing].accessCount || 0) + 1 : 1,
    lastAccessedAt: now,
  };

  if (existing >= 0) {
    memories[existing] = entry;
  } else {
    memories.push(entry);
  }

  await fs.writeFile(memoryFile, JSON.stringify(memories, null, 2), 'utf-8');
}

// Encrypted vault for credentials
export function encrypt(text: string): string {
  if (!ENCRYPTION_KEY) return text;

  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(ENCRYPTION_KEY, salt, 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();

  return `${salt.toString('base64')}:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

export function decrypt(encryptedText: string): string {
  if (!ENCRYPTION_KEY) return encryptedText;

  const [saltB64, ivB64, authTagB64, data] = encryptedText.split(':');
  const salt = Buffer.from(saltB64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const key = crypto.scryptSync(ENCRYPTION_KEY, salt, 32);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(data, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export async function storeCredential(userId: string, site: string, username: string, password: string): Promise<void> {
  await fs.mkdir(VAULT_DIR, { recursive: true });
  const vaultFile = path.join(VAULT_DIR, `${userId}_creds.json`);

  let creds: Record<string, any> = {};
  try {
    const data = await fs.readFile(vaultFile, 'utf-8');
    creds = JSON.parse(data);
  } catch {
    // New file
  }

  creds[site] = {
    username: encrypt(username),
    password: encrypt(password),
    updatedAt: new Date().toISOString(),
  };

  await fs.writeFile(vaultFile, JSON.stringify(creds, null, 2), 'utf-8');
}

export async function getCredential(userId: string, site: string): Promise<{ username: string; password: string } | null> {
  try {
    const vaultFile = path.join(VAULT_DIR, `${userId}_creds.json`);
    const data = await fs.readFile(vaultFile, 'utf-8');
    const creds = JSON.parse(data);

    if (creds[site]) {
      return {
        username: decrypt(creds[site].username),
        password: decrypt(creds[site].password),
      };
    }
  } catch {
    // Not found
  }

  return null;
}
