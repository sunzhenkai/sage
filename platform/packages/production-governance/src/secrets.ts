import type { KmsPort, SecretLease, SecretManagerPort } from '@sage/platform-ports';

export class ZeroizableSecretLease implements SecretLease {
  #destroyed = false;
  constructor(readonly secretRef: string, readonly version: string, readonly value: Uint8Array, readonly expiresAt: string) {}
  destroy(): void { if (!this.#destroyed) { this.value.fill(0); this.#destroyed = true; } }
  assertUsable(now = new Date()): void { if (this.#destroyed || Date.parse(this.expiresAt) <= now.getTime()) throw new Error('SECRET_LEASE_EXPIRED'); }
}

export async function withSecretLease<T>(manager: SecretManagerPort, input: Parameters<SecretManagerPort['lease']>[0], use: (value: Uint8Array, version: string) => Promise<T>, now: () => Date = () => new Date()): Promise<T> {
  const lease = await manager.lease(input);
  try {
    if (Date.parse(lease.expiresAt) <= now().getTime()) throw new Error('SECRET_LEASE_STALE');
    if (input.minimumVersion !== undefined && lease.version.localeCompare(input.minimumVersion, undefined, { numeric: true }) < 0) throw new Error('SECRET_VERSION_STALE');
    return await use(lease.value, lease.version);
  } finally { lease.destroy(); lease.value.fill(0); }
}

export async function withDecryptedEnvelope<T>(kms: KmsPort, input: Parameters<KmsPort['decrypt']>[0], use: (plaintext: Uint8Array, keyVersion: string) => Promise<T>): Promise<T> {
  const decrypted = await kms.decrypt(input);
  try { return await use(decrypted.plaintext, decrypted.keyVersion); }
  finally { decrypted.plaintext.fill(0); }
}

export function rejectStaticProductionCredentials(environment: Readonly<Record<string, string | undefined>>): void {
  const forbidden = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'AZURE_CLIENT_SECRET', 'SAGE_SHARED_SERVICE_TOKEN', 'SAGE_STATIC_CREDENTIAL'];
  const present = forbidden.filter((name) => (environment[name] ?? '').trim().length > 0);
  if (present.length > 0) throw new Error(`PRODUCTION_STATIC_CREDENTIAL_FORBIDDEN:${present.join(',')}`);
}
