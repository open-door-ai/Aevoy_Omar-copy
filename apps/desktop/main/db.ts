/**
 * Local Database — SQLite + Encryption
 *
 * Uses better-sqlite3 for fast local storage.
 * All sensitive data encrypted with AES-256-GCM.
 * Syncs with cloud Supabase when online.
 */

import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import { app } from "electron";

const ALGORITHM = "aes-256-gcm";

export class LocalDatabase {
  private db: Database.Database;
  private encryptionKey: Buffer | null = null;

  constructor() {
    const dbPath = path.join(app.getPath("userData"), "aevoy.db");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        result TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        undo_data TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT UNIQUE NOT NULL,
        encrypted_data TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        importance REAL DEFAULT 0.5,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  // ---- Encryption ----

  setEncryptionKey(key: string): void {
    this.encryptionKey = Buffer.from(key, "hex");
  }

  private encrypt(text: string): string {
    if (!this.encryptionKey) return text;

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, this.encryptionKey, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
  }

  private decrypt(data: string): string {
    if (!this.encryptionKey || !data.includes(":")) return data;

    const [ivHex, authTagHex, encrypted] = data.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }

  // ---- Tasks ----

  createTask(text: string): number {
    const stmt = this.db.prepare("INSERT INTO tasks (text) VALUES (?)");
    const result = stmt.run(text);
    return Number(result.lastInsertRowid);
  }

  updateTaskStatus(id: number, status: string, result?: string): void {
    const stmt = this.db.prepare(
      "UPDATE tasks SET status = ?, result = ?, completed_at = datetime('now') WHERE id = ?"
    );
    stmt.run(status, result || null, id);
  }

  getRecentTasks(limit: number = 20): unknown[] {
    const stmt = this.db.prepare(
      "SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?"
    );
    return stmt.all(limit);
  }

  getActiveTaskCount(): number {
    const stmt = this.db.prepare(
      "SELECT COUNT(*) as count FROM tasks WHERE status IN ('pending', 'processing')"
    );
    const row = stmt.get() as { count: number };
    return row.count;
  }

  // ---- Actions (Undo System) ----

  recordAction(
    type: string,
    data: Record<string, unknown>,
    undoData: Record<string, unknown> | null
  ): void {
    const stmt = this.db.prepare(
      "INSERT INTO actions (type, data, undo_data) VALUES (?, ?, ?)"
    );
    stmt.run(type, JSON.stringify(data), undoData ? JSON.stringify(undoData) : null);
  }

  getRecentActions(limit: number = 5): Array<{
    id: number;
    type: string;
    data: Record<string, unknown>;
    undoData: Record<string, unknown> | null;
    timestamp: string;
  }> {
    const stmt = this.db.prepare(
      "SELECT * FROM actions ORDER BY created_at DESC LIMIT ?"
    );
    const rows = stmt.all(limit) as Array<{
      id: number;
      type: string;
      data: string;
      undo_data: string | null;
      created_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      data: JSON.parse(row.data),
      undoData: row.undo_data ? JSON.parse(row.undo_data) : null,
      timestamp: row.created_at,
    }));
  }

  // ---- Credentials (Encrypted) ----

  saveCredential(domain: string, data: Record<string, string>): void {
    const encrypted = this.encrypt(JSON.stringify(data));
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO credentials (domain, encrypted_data) VALUES (?, ?)"
    );
    stmt.run(domain, encrypted);
  }

  getCredential(domain: string): Record<string, string> | null {
    const stmt = this.db.prepare("SELECT encrypted_data FROM credentials WHERE domain = ?");
    const row = stmt.get(domain) as { encrypted_data: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(this.decrypt(row.encrypted_data));
    } catch {
      return null;
    }
  }

  // ---- Settings ----

  setSetting(key: string, value: string): void {
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"
    );
    stmt.run(key, value);
  }

  getSetting(key: string): string | null {
    const stmt = this.db.prepare("SELECT value FROM settings WHERE key = ?");
    const row = stmt.get(key) as { value: string } | undefined;
    return row?.value || null;
  }

  // ---- Cleanup ----

  close(): void {
    this.db.close();
  }
}
