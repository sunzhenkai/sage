import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  SSH_CUSTOM_CHECK_NAME_PATTERN,
  SSH_TARGET_ALIAS_PATTERN,
  type SshTargetRecord,
  type SshTargetStore
} from '@sage/task-domain';
import type { SecretBackend } from '@sage/secret-vault';

export interface SshTargetsPrincipalAuthenticator {
  authenticateRequest?(request: FastifyRequest): { readonly principalId: string; readonly tenantId: string } | undefined;
}

export interface RegisterSshTargetsRoutesOptions {
  readonly tenantId: string;
  readonly store: SshTargetStore;
  readonly secretBackend?: SecretBackend;
  readonly authenticator: SshTargetsPrincipalAuthenticator;
  readonly now?: () => Date;
}

export interface SshTargetView {
  readonly alias: string;
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly hasKnownHostEntry: boolean;
  readonly customCheckNames: readonly string[];
  readonly enabled: boolean;
  readonly credentialPresent: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly updatedBy?: string;
}

const MAX_CUSTOM_CHECKS = 16;
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;
const ALLOWED_WRITE_FIELDS = new Set(['host', 'port', 'username', 'knownHostEntry', 'customChecks', 'enabled', 'privateKey']);

const sendError = (reply: FastifyReply, status: number, code: string, message: string): FastifyReply =>
  reply.code(status).send({ error: { code, message, retryable: false } });

const viewOf = (record: SshTargetRecord): SshTargetView => ({
  alias: record.alias,
  host: record.host,
  port: record.port,
  username: record.username,
  hasKnownHostEntry: record.knownHostEntry !== undefined && record.knownHostEntry.length > 0,
  customCheckNames: Object.keys(record.customChecks).sort(),
  enabled: record.enabled,
  credentialPresent: record.credentialPresent,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  ...(record.updatedBy === undefined ? {} : { updatedBy: record.updatedBy }),
});

interface ParsedSshTargetWrite {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly knownHostEntry?: string;
  readonly customChecks: Readonly<Record<string, string>>;
  readonly enabled: boolean;
  readonly privateKey?: string;
}

const parseWrite = (body: unknown): { readonly write?: ParsedSshTargetWrite; readonly error?: string } => {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { error: 'body must be an object' };
  const raw = body as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_WRITE_FIELDS.has(key)) return { error: `unsupported field '${key}'` };
  }
  if (typeof raw.host !== 'string' || raw.host.trim().length === 0 || raw.host.length > 255) {
    return { error: 'host must be 1-255 characters' };
  }
  const host = raw.host.trim();
  if (host.startsWith('-') || /\s/.test(host)) {
    return { error: 'host must not start with - or contain whitespace' };
  }
  const port = raw.port === undefined ? 22 : raw.port;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65_535) {
    return { error: 'port must be an integer between 1 and 65535' };
  }
  if (typeof raw.username !== 'string' || !USERNAME_PATTERN.test(raw.username)) {
    return { error: 'username must match ^[a-zA-Z0-9._-]{1,64}$' };
  }
  let knownHostEntry: string | undefined;
  if (raw.knownHostEntry !== undefined) {
    if (typeof raw.knownHostEntry !== 'string' || raw.knownHostEntry.trim().length === 0 || raw.knownHostEntry.length > 2_048 || /[\r\n]/.test(raw.knownHostEntry.trim())) {
      return { error: 'knownHostEntry must be a single non-empty line <= 2048 chars' };
    }
    knownHostEntry = raw.knownHostEntry.trim();
  }
  const customChecks: Record<string, string> = {};
  if (raw.customChecks !== undefined) {
    if (raw.customChecks === null || typeof raw.customChecks !== 'object' || Array.isArray(raw.customChecks)) {
      return { error: 'customChecks must be a string map' };
    }
    const entries = Object.entries(raw.customChecks as Record<string, unknown>);
    if (entries.length > MAX_CUSTOM_CHECKS) {
      return { error: `customChecks supports at most ${MAX_CUSTOM_CHECKS} entries` };
    }
    for (const [name, script] of entries) {
      if (!SSH_CUSTOM_CHECK_NAME_PATTERN.test(name)) {
        return { error: `invalid customCheck name '${name}'` };
      }
      if (typeof script !== 'string' || script.trim().length === 0 || script.length > 1_024) {
        return { error: `customChecks.${name} must be 1-1024 characters` };
      }
      customChecks[name] = script;
    }
  }
  const enabled = raw.enabled === undefined ? true : raw.enabled;
  if (typeof enabled !== 'boolean') return { error: 'enabled must be a boolean' };

  let privateKey: string | undefined;
  if (raw.privateKey !== undefined) {
    if (typeof raw.privateKey !== 'string' || raw.privateKey.trim().length === 0 || raw.privateKey.length > 16_384 || !raw.privateKey.includes('PRIVATE KEY')) {
      return { error: 'privateKey must be a valid PEM/OpenSSH private key <= 16384 chars' };
    }
    privateKey = raw.privateKey;
  }

  return {
    write: {
      host,
      port,
      username: raw.username,
      ...(knownHostEntry === undefined ? {} : { knownHostEntry }),
      customChecks,
      enabled,
      ...(privateKey === undefined ? {} : { privateKey }),
    },
  };
};

export function registerSshTargetsRoutes(app: FastifyInstance, options: RegisterSshTargetsRoutesOptions): void {
  const now = options.now ?? (() => new Date());

  const principalOf = (request: FastifyRequest, reply: FastifyReply) => {
    const principal = options.authenticator.authenticateRequest?.(request);
    if (!principal || principal.tenantId !== options.tenantId) {
      void sendError(reply, 401, 'SSH_TARGETS_AUTH_REQUIRED', 'Authentication required');
      return undefined;
    }
    return principal;
  };

  app.get('/v1/ssh-targets', async (request, reply) => {
    if (!principalOf(request, reply)) return;
    const records = await options.store.listSshTargets(options.tenantId);
    return reply.code(200).send({ items: records.map(viewOf) });
  });

  app.put<{ Params: { alias: string } }>('/v1/ssh-targets/:alias', async (request, reply) => {
    const principal = principalOf(request, reply);
    if (!principal) return;
    const alias = request.params.alias;
    if (!SSH_TARGET_ALIAS_PATTERN.test(alias)) {
      return sendError(reply, 400, 'SSH_TARGET_INVALID', 'alias must match ^[a-z0-9][a-z0-9-]{0,63}$');
    }
    const parsed = parseWrite(request.body);
    if (parsed.error !== undefined || parsed.write === undefined) {
      return sendError(reply, 400, 'SSH_TARGET_INVALID', parsed.error ?? 'invalid body');
    }
    const write = parsed.write;
    const nowIso = now().toISOString();
    let credential;
    if (write.privateKey !== undefined) {
      if (options.secretBackend === undefined) {
        return sendError(reply, 503, 'SECRET_BACKEND_UNAVAILABLE', 'Secret sealing backend is unavailable');
      }
      const sealed = options.secretBackend.seal(write.privateKey);
      credential = { ciphertext: sealed.ciphertext, keyVersion: sealed.keyVersion, updatedAt: nowIso };
    }
    const saved = await options.store.upsertSshTarget(
      options.tenantId,
      alias,
      {
        host: write.host,
        port: write.port,
        username: write.username,
        ...(write.knownHostEntry === undefined ? {} : { knownHostEntry: write.knownHostEntry }),
        customChecks: write.customChecks,
        enabled: write.enabled,
        updatedBy: principal.principalId,
        ...(credential === undefined ? {} : { credential }),
      },
      nowIso
    );
    return reply.code(200).send(viewOf(saved));
  });

  app.delete<{ Params: { alias: string } }>('/v1/ssh-targets/:alias', async (request, reply) => {
    if (!principalOf(request, reply)) return;
    const alias = request.params.alias;
    if (!SSH_TARGET_ALIAS_PATTERN.test(alias)) {
      return sendError(reply, 400, 'SSH_TARGET_INVALID', 'alias must match ^[a-z0-9][a-z0-9-]{0,63}$');
    }
    const deleted = await options.store.deleteSshTarget(options.tenantId, alias);
    if (!deleted) {
      return sendError(reply, 404, 'SSH_TARGET_NOT_FOUND', `SSH target '${alias}' not found`);
    }
    return reply.code(200).send({ deleted: true, alias });
  });
}
