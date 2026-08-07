import crypto from 'node:crypto';
import { env } from '../config/env';

/**
 * Authenticated symmetric encryption for secrets at rest (session cookies).
 *
 * AES-256-GCM. The key is derived from ENCRYPTION_KEY via SHA-256 so any
 * passphrase length works. Output is base64( iv | authTag | ciphertext ).
 *
 * NOTE: for a real deployment, move key management to a KMS (envelope
 * encryption) instead of a single app-level key. The call sites here don't
 * change if you do.
 */
const KEY = crypto.createHash('sha256').update(env.encryptionKey).digest(); // 32 bytes
const IV_LEN = 12;
const TAG_LEN = 16;

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decryptSecret(payload: string): string {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
