/**
 * User-Derived Encryption
 * 
 * We CANNOT read user data without them being authenticated.
 * Encryption key is derived from user credentials.
 */

import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);
const SERVER_SECRET = process.env.ENCRYPTION_KEY || 'default-dev-secret-change-in-production';

/**
 * Derive a key from user credentials - NEVER stored
 * This means we can only decrypt user data when they're authenticated
 */
export async function deriveUserKey(userId: string, salt?: string): Promise<Buffer> {
  const derivedSalt = salt || `${userId}:${SERVER_SECRET}`;
  return await scryptAsync(SERVER_SECRET, derivedSalt, 32) as Buffer;
}

/**
 * Encrypt data with a user's key
 * Format: iv:authTag:encryptedData (all base64)
 */
export async function encryptForUser(data: string, userKey: Buffer): Promise<string> {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', userKey, iv);
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypt data with a user's key
 */
export async function decryptForUser(encryptedData: string, userKey: Buffer): Promise<string> {
  const [ivB64, authTagB64, dataB64] = encryptedData.split(':');
  
  if (!ivB64 || !authTagB64 || !dataB64) {
    throw new Error('Invalid encrypted data format');
  }
  
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const encrypted = Buffer.from(dataB64, 'base64');
  
  const decipher = createDecipheriv('aes-256-gcm', userKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

/**
 * Encrypt user credentials for storage
 */
export async function encryptCredentials(
  creds: { site: string; username: string; password: string }, 
  userKey: Buffer
): Promise<string> {
  return encryptForUser(JSON.stringify(creds), userKey);
}

/**
 * Decrypt user credentials
 */
export async function decryptCredentials(
  encrypted: string, 
  userKey: Buffer
): Promise<{ site: string; username: string; password: string }> {
  return JSON.parse(await decryptForUser(encrypted, userKey));
}

/**
 * Simple encryption for memory files (without user key - uses server secret)
 */
export async function encryptWithServerKey(data: string): Promise<string> {
  const key = await scryptAsync(SERVER_SECRET, 'memory-salt', 32) as Buffer;
  return encryptForUser(data, key);
}

export async function decryptWithServerKey(encryptedData: string): Promise<string> {
  const key = await scryptAsync(SERVER_SECRET, 'memory-salt', 32) as Buffer;
  return decryptForUser(encryptedData, key);
}
