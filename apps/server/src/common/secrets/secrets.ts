import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

// ponytail: key is derived from JWT_SECRET so v0.6.8 needs no new env var / install.sh
// change. Rotating JWT_SECRET therefore invalidates stored node sudo passwords (the
// operator re-enters them). Swap for a dedicated key when the v0.7 SecretsService lands.
const INFO = 'dinopanel/node-sudo/v1';
const SALT = 'dinopanel';

/** 32-byte AES key derived from the app's JWT_SECRET via HKDF-SHA256. */
export function deriveSecretsKey(jwtSecret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', jwtSecret, SALT, INFO, 32));
}

/** AES-256-GCM. Output: `v1:<iv b64>:<tag b64>:<ciphertext b64>` — safe to store in the settings KV. */
export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

/** Inverse of encryptSecret. Throws on wrong key, tampering or malformed input. */
export function decryptSecret(enc: string, key: Buffer): string {
  const parts = enc.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('secrets: malformed ciphertext');
  const [, ivB64, tagB64, ctB64] = parts as [string, string, string, string];
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}
