/**
 * Web-side AES-256-GCM encryption for OAuth tokens.
 * Uses the same ENCRYPTION_KEY as the agent server.
 */

import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

function getEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error("ENCRYPTION_KEY environment variable is not set");
  }
  return key;
}

/**
 * Encrypt plaintext using AES-256-GCM with a random salt.
 * Format: salt:iv:authTag:encryptedData (all base64)
 */
export async function encrypt(plaintext: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(getEncryptionKey(), salt, 32) as Buffer;
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${salt.toString('base64')}:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypt ciphertext encrypted with encrypt().
 * Supports both 4-part (new, random salt) and 3-part (old, static salt) formats.
 */
export async function decrypt(encryptedData: string): Promise<string> {
  const parts = encryptedData.split(':');

  let salt: Buffer;
  let ivB64: string;
  let authTagB64: string;
  let dataB64: string;

  if (parts.length === 4) {
    salt = Buffer.from(parts[0], 'base64');
    ivB64 = parts[1];
    authTagB64 = parts[2];
    dataB64 = parts[3];
  } else if (parts.length === 3) {
    // Backward compat: static salt
    salt = Buffer.from('memory-salt');
    ivB64 = parts[0];
    authTagB64 = parts[1];
    dataB64 = parts[2];
  } else {
    throw new Error('Invalid encrypted data format');
  }

  const key = await scryptAsync(getEncryptionKey(), salt, 32) as Buffer;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const encrypted = Buffer.from(dataB64, 'base64');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
