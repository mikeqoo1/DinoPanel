import { describe, it, expect } from 'vitest';
import { deriveSecretsKey, encryptSecret, decryptSecret } from '../secrets';

const KEY = deriveSecretsKey('a'.repeat(48));
const OTHER = deriveSecretsKey('b'.repeat(48));

describe('deriveSecretsKey', () => {
  it('is deterministic and 32 bytes', () => {
    expect(KEY).toHaveLength(32);
    expect(deriveSecretsKey('a'.repeat(48)).equals(KEY)).toBe(true);
    expect(OTHER.equals(KEY)).toBe(false);
  });
});

describe('encryptSecret / decryptSecret', () => {
  it('round-trips and never stores the plaintext', () => {
    const enc = encryptSecret('110084', KEY);
    expect(enc).not.toContain('110084');
    expect(enc.startsWith('v1:')).toBe(true);
    expect(decryptSecret(enc, KEY)).toBe('110084');
  });

  it('uses a fresh IV so the same plaintext encrypts differently each time', () => {
    expect(encryptSecret('x', KEY)).not.toBe(encryptSecret('x', KEY));
  });

  it('throws with the wrong key', () => {
    const enc = encryptSecret('110084', KEY);
    expect(() => decryptSecret(enc, OTHER)).toThrow();
  });

  it('throws when the ciphertext is tampered with', () => {
    const enc = encryptSecret('110084', KEY);
    const parts = enc.split(':');
    parts[3] = Buffer.from('zzzz').toString('base64');
    expect(() => decryptSecret(parts.join(':'), KEY)).toThrow();
  });

  it('rejects malformed input', () => {
    expect(() => decryptSecret('garbage', KEY)).toThrow();
  });
});
