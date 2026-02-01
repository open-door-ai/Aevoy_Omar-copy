import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import type { Memory } from "../types/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACES_DIR = path.join(__dirname, "../../workspaces");

const ALGORITHM = "aes-256-gcm";

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error("ENCRYPTION_KEY not set");
  }
  return Buffer.from(key, "hex");
}

export function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return iv.toString("hex") + ":" + authTag.toString("hex") + ":" + encrypted;
}

export function decrypt(encryptedData: string): string {
  const key = getEncryptionKey();
  const [ivHex, authTagHex, encrypted] = encryptedData.split(":");

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

export function getWorkspacePath(userId: string): string {
  // Validate userId to prevent path traversal
  if (!userId.match(/^[a-f0-9-]+$/i)) {
    throw new Error("Invalid user ID format");
  }
  return path.join(WORKSPACES_DIR, userId);
}

export async function ensureWorkspace(userId: string): Promise<string> {
  const workspacePath = getWorkspacePath(userId);
  const memoryDir = path.join(workspacePath, "memory");
  const filesDir = path.join(workspacePath, "files");

  await fs.mkdir(workspacePath, { recursive: true });
  await fs.mkdir(memoryDir, { recursive: true });
  await fs.mkdir(filesDir, { recursive: true });

  // Create MEMORY.md if it doesn't exist
  const memoryFilePath = path.join(workspacePath, "MEMORY.md.enc");
  try {
    await fs.access(memoryFilePath);
  } catch {
    const initialMemory = `# About User
- New user, no information yet

# Preferences
- No preferences recorded yet

# Learned
- Nothing learned yet
`;
    await fs.writeFile(memoryFilePath, encrypt(initialMemory));
  }

  return workspacePath;
}

export async function loadMemory(userId: string): Promise<Memory> {
  const workspacePath = await ensureWorkspace(userId);
  
  // Load main memory file
  let facts = "";
  try {
    const memoryFilePath = path.join(workspacePath, "MEMORY.md.enc");
    const encryptedContent = await fs.readFile(memoryFilePath, "utf8");
    facts = decrypt(encryptedContent);
  } catch (error) {
    console.error("Error loading memory:", error);
    facts = "No memory available.";
  }

  // Load recent logs
  const recentLogs = await loadRecentLogs(userId, 3);

  return { facts, recentLogs };
}

export async function saveMemory(userId: string, content: string): Promise<void> {
  const workspacePath = await ensureWorkspace(userId);
  const memoryFilePath = path.join(workspacePath, "MEMORY.md.enc");
  
  await fs.writeFile(memoryFilePath, encrypt(content));
}

export async function appendDailyLog(userId: string, entry: string): Promise<void> {
  const workspacePath = await ensureWorkspace(userId);
  const memoryDir = path.join(workspacePath, "memory");
  
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const logFilePath = path.join(memoryDir, `${today}.md.enc`);

  const timestamp = new Date().toISOString();
  const logEntry = `\n## ${timestamp}\n${entry}\n`;

  try {
    const existingContent = await fs.readFile(logFilePath, "utf8");
    const decrypted = decrypt(existingContent);
    await fs.writeFile(logFilePath, encrypt(decrypted + logEntry));
  } catch {
    // File doesn't exist, create it
    const header = `# Daily Log - ${today}\n`;
    await fs.writeFile(logFilePath, encrypt(header + logEntry));
  }
}

export async function loadRecentLogs(userId: string, days: number): Promise<string> {
  const workspacePath = getWorkspacePath(userId);
  const memoryDir = path.join(workspacePath, "memory");

  const logs: string[] = [];

  for (let i = 0; i < days; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0];
    const logFilePath = path.join(memoryDir, `${dateStr}.md.enc`);

    try {
      const encryptedContent = await fs.readFile(logFilePath, "utf8");
      logs.push(decrypt(encryptedContent));
    } catch {
      // File doesn't exist, skip
    }
  }

  return logs.join("\n\n---\n\n");
}

export async function updateMemoryWithFact(userId: string, fact: string): Promise<void> {
  const memory = await loadMemory(userId);
  
  // Append the new fact to the Learned section
  const updatedMemory = memory.facts.replace(
    /# Learned\n/,
    `# Learned\n- ${fact}\n`
  );
  
  await saveMemory(userId, updatedMemory);
}
