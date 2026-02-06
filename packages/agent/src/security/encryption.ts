/**
 * User-Derived Encryption
 * 
 * We CANNOT read user data without them being authenticated.
 * Encryption key is derived from user credentials.
 */

import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

function getServerSecret(): string {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("FATAL: ENCRYPTION_KEY environment variable is not set.");
  }
  return secret;
}

/**
 * Derive a key from user credentials - NEVER stored
 * This means we can only decrypt user data when they're authenticated
 */
export async function deriveUserKey(userId: string, salt?: string): Promise<Buffer> {
  const secret = getServerSecret();
  const derivedSalt = salt || `${userId}:${secret}`;
  return await scryptAsync(secret, derivedSalt, 32) as Buffer;
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
 * New format: salt:iv:authTag:encryptedData (all base64, random salt per operation)
 */
export async function encryptWithServerKey(data: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(getServerSecret(), salt, 32) as Buffer;
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${salt.toString('base64')}:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

export async function decryptWithServerKey(encryptedData: string): Promise<string> {
  const parts = encryptedData.split(':');

  // Backward compat: old format has 3 parts (iv:authTag:data) with static salt
  if (parts.length === 3) {
    const key = await scryptAsync(getServerSecret(), 'memory-salt', 32) as Buffer;
    return decryptForUser(encryptedData, key);
  }

  // New format: 4 parts (salt:iv:authTag:data)
  const [saltB64, ivB64, authTagB64, dataB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const key = await scryptAsync(getServerSecret(), salt, 32) as Buffer;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const encrypted = Buffer.from(dataB64, 'base64');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

/**
 * Encrypt voice PIN for storage (4-6 digit numeric PIN)
 * Uses user ID as salt for deterministic encryption (allows lookup)
 */
export async function encryptPin(pin: string, userId: string): Promise<string> {
  // Use user ID as part of salt for deterministic encryption
  const salt = Buffer.from(userId.slice(0, 16).padEnd(16, '0'));
  const key = await scryptAsync(getServerSecret(), salt, 32) as Buffer;
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(pin, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypt voice PIN
 */
export async function decryptPin(encryptedPin: string, userId: string): Promise<string> {
  const [ivB64, authTagB64, dataB64] = encryptedPin.split(':');

  if (!ivB64 || !authTagB64 || !dataB64) {
    throw new Error('Invalid encrypted PIN format');
  }

  const salt = Buffer.from(userId.slice(0, 16).padEnd(16, '0'));
  const key = await scryptAsync(getServerSecret(), salt, 32) as Buffer;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const encrypted = Buffer.from(dataB64, 'base64');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

/**
 * Verify an entered PIN against an encrypted PIN
 */
export async function verifyPin(enteredPin: string, encryptedPin: string, userId: string): Promise<boolean> {
  try {
    const decryptedPin = await decryptPin(encryptedPin, userId);
    return decryptedPin === enteredPin;
  } catch {
    return false;
  }
}
