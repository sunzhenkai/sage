import { createHash } from 'node:crypto';
import type { AdapterHealth, IdentityVerificationPort, ReplayGuardPort, TrustedPrincipal, WorkloadIdentityExchangePort } from '@sage/platform-ports';

export interface OidcKey { readonly kid: string; readonly algorithm: string; readonly material: Uint8Array; readonly validUntil: string }
export interface OidcKeySetPort { get(input: { readonly issuer: string; readonly kid: string; readonly forceRefresh: boolean }): Promise<OidcKey | undefined>; health(): Promise<AdapterHealth> }
export interface OidcSignatureVerifierPort { verify(input: { readonly algorithm: string; readonly signingInput: Uint8Array; readonly signature: Uint8Array; readonly key: OidcKey }): Promise<boolean> }
export interface OidcVerifierConfig { readonly issuer: string; readonly audiences: readonly string[]; readonly algorithms: readonly string[]; readonly tenantClaim: string; readonly principalClaim: string; readonly scopeClaim: string; readonly maximumClockSkewSeconds: number }
const decode = (part: string): unknown => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
const text = (value: unknown): string | undefined => typeof value === 'string' && value.length > 0 ? value : undefined;
const strings = (value: unknown): readonly string[] => typeof value === 'string' ? value.split(' ').filter(Boolean) : Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];

export class OidcVerificationError extends Error { readonly retryable: boolean; constructor(readonly code: 'IDENTITY_UNAVAILABLE' | 'IDENTITY_INVALID' | 'IDENTITY_REPLAYED', retryable = false) { super(code); this.retryable = retryable; } }
export class InjectedJwksOidcVerifier implements IdentityVerificationPort {
  constructor(private readonly config: OidcVerifierConfig, private readonly keys: OidcKeySetPort, private readonly signatures: OidcSignatureVerifierPort, private readonly replay: ReplayGuardPort) {}
  async verify(input: { readonly bearerToken: string; readonly expectedAudience: string; readonly expectedNonce?: string; readonly now: string }): Promise<TrustedPrincipal> {
    const parts = input.bearerToken.split('.'); if (parts.length !== 3) throw new OidcVerificationError('IDENTITY_INVALID');
    let header: Record<string, unknown>, claims: Record<string, unknown>;
    try { header = decode(parts[0]!) as Record<string, unknown>; claims = decode(parts[1]!) as Record<string, unknown>; } catch { throw new OidcVerificationError('IDENTITY_INVALID'); }
    const algorithm = text(header.alg), kid = text(header.kid); if (!algorithm || !kid || !this.config.algorithms.includes(algorithm) || algorithm === 'none') throw new OidcVerificationError('IDENTITY_INVALID');
    if (claims.iss !== this.config.issuer || !this.config.audiences.includes(input.expectedAudience) || !strings(claims.aud).includes(input.expectedAudience)) throw new OidcVerificationError('IDENTITY_INVALID');
    const now = Date.parse(input.now); if (!Number.isFinite(now)) throw new OidcVerificationError('IDENTITY_INVALID');
    const skew = this.config.maximumClockSkewSeconds * 1000, exp = Number(claims.exp) * 1000, nbf = claims.nbf === undefined ? undefined : Number(claims.nbf) * 1000, iat = Number(claims.iat) * 1000;
    if (!Number.isFinite(exp) || !Number.isFinite(iat) || exp <= now - skew || iat > now + skew || (nbf !== undefined && (!Number.isFinite(nbf) || nbf > now + skew))) throw new OidcVerificationError('IDENTITY_INVALID');
    if (input.expectedNonce !== undefined && claims.nonce !== input.expectedNonce) throw new OidcVerificationError('IDENTITY_INVALID');
    const tokenId = text(claims.jti); if (!tokenId) throw new OidcVerificationError('IDENTITY_INVALID');
    let key: OidcKey | undefined;
    try { key = await this.keys.get({ issuer: this.config.issuer, kid, forceRefresh: false }) ?? await this.keys.get({ issuer: this.config.issuer, kid, forceRefresh: true }); } catch { throw new OidcVerificationError('IDENTITY_UNAVAILABLE', true); }
    if (!key || key.algorithm !== algorithm || Date.parse(key.validUntil) <= now) throw new OidcVerificationError('IDENTITY_INVALID');
    let valid = false; try { valid = await this.signatures.verify({ algorithm, signingInput: new TextEncoder().encode(`${parts[0]}.${parts[1]}`), signature: Buffer.from(parts[2]!, 'base64url'), key }); } catch { throw new OidcVerificationError('IDENTITY_UNAVAILABLE', true); }
    if (!valid) throw new OidcVerificationError('IDENTITY_INVALID');
    let replay: 'claimed' | 'replayed'; try { replay = await this.replay.claim({ issuer: this.config.issuer, tokenId, expiresAt: new Date(exp).toISOString() }); } catch { throw new OidcVerificationError('IDENTITY_UNAVAILABLE', true); }
    if (replay === 'replayed') throw new OidcVerificationError('IDENTITY_REPLAYED');
    const tenantId = text(claims[this.config.tenantClaim]), principalRef = text(claims[this.config.principalClaim]), subject = text(claims.sub); if (!tenantId || !principalRef || !subject) throw new OidcVerificationError('IDENTITY_INVALID');
    return Object.freeze({ principalRef, tenantId, maximumScopes: Object.freeze([...strings(claims[this.config.scopeClaim])]), subject, issuer: this.config.issuer, authenticatedAt: new Date(iat).toISOString(), expiresAt: new Date(exp).toISOString() });
  }
  async health(): Promise<AdapterHealth> { return this.keys.health(); }
}

export interface WorkloadTokenIssuerPort { issue(input: { readonly subject: string; readonly audience: string; readonly scopes: readonly string[]; readonly expiresAt: string; readonly bindingDigest: string }): Promise<Uint8Array>; health(): Promise<AdapterHealth> }
export class BoundWorkloadIdentityExchange implements WorkloadIdentityExchangePort {
  constructor(private readonly issuer: WorkloadTokenIssuerPort, private readonly now: () => Date = () => new Date()) {}
  async exchange(input: { readonly workloadRef: string; readonly tenantId: string; readonly environment: string; readonly audience: string; readonly scopes: readonly string[]; readonly maximumTtlSeconds: number }) {
    if (input.maximumTtlSeconds < 1 || input.maximumTtlSeconds > 900 || [input.workloadRef, input.tenantId, input.environment, input.audience].some((item) => item.length === 0)) throw new Error('WORKLOAD_IDENTITY_BINDING_INVALID');
    const issuedAt = this.now(), expiresAt = new Date(issuedAt.getTime() + input.maximumTtlSeconds * 1000).toISOString();
    const bindingDigest = `sha256:${createHash('sha256').update(JSON.stringify(['workload-identity.v1', input.workloadRef, input.tenantId, input.environment, input.audience, [...input.scopes].sort(), expiresAt])).digest('hex')}`;
    const accessToken = await this.issuer.issue({ subject: input.workloadRef, audience: input.audience, scopes: [...input.scopes], expiresAt, bindingDigest });
    return { accessToken, expiresAt, audience: input.audience, bindingDigest };
  }
  async health(): Promise<AdapterHealth> { return this.issuer.health(); }
}
