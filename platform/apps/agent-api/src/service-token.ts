import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedPrincipal } from '@sage/app-contracts';

/**
 * D7：pilot 链路静态 service token 认证。
 * - `Authorization: Bearer <token>`；token 以 sha256 哈希注入（`SAGE_SERVICE_TOKEN_HASHES`，逗号分隔），
 *   常量时间比较，多 key 并存支持轮换；
 * - 配置生效时，packages/apps/runs/schedules/resolutions 五条链路仅认可 service token 主体，
 *   旧明文信任头 `x-authentication-id` 停止提权（与未认证一致）；
 * - 本地开发使用 dev token（见 docs/p8-schedule-plane.md），经 compose env 注入。
 */
export const SERVICE_TOKEN_HASHES_ENV = 'SAGE_SERVICE_TOKEN_HASHES';

export class ServiceTokenAuthenticator {
  readonly #hashes: readonly Buffer[];
  readonly #tenantId: string;
  readonly #roles: readonly string[];

  constructor(input: { readonly hashes: readonly string[]; readonly tenantId: string; readonly roles?: readonly string[] }) {
    if (input.hashes.length === 0) throw new Error('SERVICE_TOKEN_HASHES_EMPTY');
    this.#hashes = input.hashes.map(hash => {
      const normalized = hash.trim().toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error('SERVICE_TOKEN_HASH_INVALID');
      return Buffer.from(normalized, 'hex');
    });
    this.#tenantId = input.tenantId;
    this.#roles = input.roles ?? ['schedule-operator', 'package-registrar', 'task-operator', 'effect-resolver'];
  }

  /** env 注入：逗号分隔 sha256(hex)；未配置返回 undefined（本地 stub 认证保持既有行为）。 */
  static fromEnv(environment: Readonly<Record<string, string | undefined>>, tenantId: string): ServiceTokenAuthenticator | undefined {
    const raw = environment[SERVICE_TOKEN_HASHES_ENV];
    if (raw === undefined || raw.trim() === '') return undefined;
    return new ServiceTokenAuthenticator({ hashes: raw.split(','), tenantId });
  }

  verify(token: string): { readonly principalId: string; readonly fingerprint: string } | undefined {
    const digest = createHash('sha256').update(token, 'utf8').digest();
    for (const candidate of this.#hashes) {
      if (digest.length === candidate.length && timingSafeEqual(digest, candidate)) {
        const fingerprint = candidate.toString('hex').slice(0, 12);
        return { principalId: `service-token://${fingerprint}`, fingerprint };
      }
    }
    return undefined;
  }

  authenticateRequest(request: Pick<FastifyRequest, 'headers'>): AuthenticatedPrincipal | undefined {
    const header = request.headers.authorization;
    const value = Array.isArray(header) ? header[0] : header;
    if (value === undefined || !value.startsWith('Bearer ')) return undefined;
    const verified = this.verify(value.slice('Bearer '.length).trim());
    if (verified === undefined) return undefined;
    return { authenticationId: verified.principalId, principalId: verified.principalId, tenantId: this.#tenantId, roles: [...this.#roles] };
  }
}
