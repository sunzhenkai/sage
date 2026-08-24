import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LocalAesGcmSecretBackend, SecretBackendUnavailableError, createLocalSecretBackendFromEnv } from './index.js';

const key = () => randomBytes(32).toString('base64');

describe('LocalAesGcmSecretBackend', () => {
  it('round-trips plaintext and reports non-sensitive mode', () => {
    const backend = new LocalAesGcmSecretBackend([Buffer.from(key(), 'base64')]);
    const sealed = backend.seal('minimax-secret-key');
    expect(sealed.keyVersion).toBe(0);
    expect(sealed.ciphertext.toString('utf8')).not.toContain('minimax-secret-key');
    expect(backend.open(sealed)).toBe('minimax-secret-key');
    expect(backend.describe()).toEqual({ mode: 'local-aes-gcm' });
  });

  it('produces distinct ciphertexts for the same plaintext (random nonce)', () => {
    const backend = new LocalAesGcmSecretBackend([Buffer.from(key(), 'base64')]);
    const first = backend.seal('same');
    const second = backend.seal('same');
    expect(first.ciphertext.equals(second.ciphertext)).toBe(false);
  });

  it('rejects tampered ciphertext instead of returning wrong plaintext', () => {
    const backend = new LocalAesGcmSecretBackend([Buffer.from(key(), 'base64')]);
    const sealed = backend.seal('secret');
    const tampered = Buffer.from(sealed.ciphertext);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => backend.open({ ciphertext: tampered, keyVersion: sealed.keyVersion })).toThrow(SecretBackendUnavailableError);
  });

  it('fails closed on truncated input and empty keyring', () => {
    const backend = new LocalAesGcmSecretBackend([Buffer.from(key(), 'base64')]);
    expect(() => backend.open({ ciphertext: Buffer.alloc(8), keyVersion: 0 })).toThrow(SecretBackendUnavailableError);
    expect(() => new LocalAesGcmSecretBackend([])).toThrow(SecretBackendUnavailableError);
  });

  it('keeps multi-key keyring working (latest key seals, indexed key opens)', () => {
    const oldKey = Buffer.from(key(), 'base64');
    const newKey = Buffer.from(key(), 'base64');
    const oldBackend = new LocalAesGcmSecretBackend([oldKey]);
    const rotated = new LocalAesGcmSecretBackend([oldKey, newKey]);
    const sealedUnderOld = oldBackend.seal('legacy-secret');
    expect(rotated.open(sealedUnderOld)).toBe('legacy-secret');
    const sealedUnderNew = rotated.seal('fresh-secret');
    expect(sealedUnderNew.keyVersion).toBe(1);
    expect(() => oldBackend.open(sealedUnderNew)).toThrow(SecretBackendUnavailableError);
  });
});

describe('createLocalSecretBackendFromEnv', () => {
  it('returns a backend when the master key is configured', () => {
    const backend = createLocalSecretBackendFromEnv({ SAGE_SECRET_MASTER_KEY: key() });
    expect(backend?.describe()).toEqual({ mode: 'local-aes-gcm' });
  });

  it('returns undefined for missing or malformed master key (fail-closed)', () => {
    expect(createLocalSecretBackendFromEnv({})).toBeUndefined();
    expect(createLocalSecretBackendFromEnv({ SAGE_SECRET_MASTER_KEY: '' })).toBeUndefined();
    expect(createLocalSecretBackendFromEnv({ SAGE_SECRET_MASTER_KEY: 'not-base64-32-bytes!!' })).toBeUndefined();
  });
});
