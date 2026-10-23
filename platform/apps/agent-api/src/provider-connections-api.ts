import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  DEPLOYMENT_ENV_CONNECTION_ID, PROVIDER_CONNECTION_MAX_MODELS, PROVIDER_CONNECTION_MODEL_ID_MAX_LENGTH, connectionModels, normalizeConnectionModels,
  type ProviderConnectionAdapterKind, type ProviderConnectionRecord, type ProviderConnectionStore, type RunAgentSettingsStore
} from '@sage/task-domain';
import type { SecretBackend } from '@sage/secret-vault';
import { isPublicHttpsUrl } from './provider-connection.js';

export interface ProviderConnectionsPrincipalAuthenticator {
  authenticateRequest?(request: FastifyRequest): { readonly principalId: string; readonly tenantId: string } | undefined;
}

export interface RegisterProviderConnectionRoutesOptions {
  readonly tenantId: string;
  readonly store: ProviderConnectionStore & RunAgentSettingsStore;
  /** 缺省时凭据写入 fail-closed（503），元数据读写不受影响。 */
  readonly secretBackend?: SecretBackend;
  readonly authenticator: ProviderConnectionsPrincipalAuthenticator;
  readonly now?: () => Date;
}

export interface ProviderConnectionView {
  readonly id: string;
  readonly name: string;
  readonly source: 'user' | 'deployment-env';
  readonly adapterKind: ProviderConnectionAdapterKind;
  readonly baseUrl: string;
  /** 默认模型（未显式选择时使用），恒属于 models。 */
  readonly modelId: string;
  /** 允许的模型 id（默认模型在首位）；存量条目为 [modelId]。 */
  readonly models: readonly string[];
  readonly providerName?: string;
  readonly modelName?: string;
  readonly enabled: boolean;
  readonly credentialPresent: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly updatedBy?: string;
}

const ADAPTER_KINDS: readonly ProviderConnectionAdapterKind[] = ['openai-compatible', 'anthropic'];
const writeFields = new Set(['name', 'adapterKind', 'baseUrl', 'modelId', 'models', 'providerName', 'modelName', 'apiKey']);

export class SecretWriteUnavailable extends Error {
  constructor(message: string) { super(message); this.name = 'SecretWriteUnavailable'; }
}

const sendError = (reply: FastifyReply, status: number, code: string, message: string, retryable = false): FastifyReply =>
  reply.code(status).send({ error: { code, message, retryable } });

const viewOf = (record: ProviderConnectionRecord): ProviderConnectionView => ({
  id: record.id,
  name: record.name,
  source: record.source,
  adapterKind: record.adapterKind,
  baseUrl: record.baseUrl,
  modelId: record.modelId,
  models: connectionModels(record),
  ...(record.providerName === undefined ? {} : { providerName: record.providerName }),
  ...(record.modelName === undefined ? {} : { modelName: record.modelName }),
  enabled: record.enabled,
  credentialPresent: record.credentialPresent,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  ...(record.updatedBy === undefined ? {} : { updatedBy: record.updatedBy })
});

interface ParsedWrite {
  readonly name: string;
  readonly adapterKind: ProviderConnectionAdapterKind;
  readonly baseUrl: string;
  readonly modelId: string;
  /** 省略 = 创建时 [modelId]、更新时保留既有列表。 */
  readonly models?: readonly string[];
  readonly providerName?: string;
  readonly modelName?: string;
  readonly apiKey?: string;
}

const parseWrite = (body: unknown): { readonly write?: ParsedWrite; readonly error?: string } => {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { error: 'body must be an object' };
  const raw = body as Record<string, unknown>;
  if (typeof raw.name !== 'string' || raw.name.trim().length === 0 || raw.name.length > 128) return { error: 'name must be 1-128 characters' };
  if (typeof raw.adapterKind !== 'string' || !ADAPTER_KINDS.includes(raw.adapterKind as ProviderConnectionAdapterKind)) {
    return { error: `adapterKind must be one of ${ADAPTER_KINDS.join(', ')}` };
  }
  if (typeof raw.baseUrl !== 'string' || !isPublicHttpsUrl(raw.baseUrl)) return { error: 'baseUrl must be a public HTTPS endpoint' };
  if (typeof raw.modelId !== 'string' || raw.modelId.length === 0 || raw.modelId.length > 256) return { error: 'modelId must be 1-256 characters' };
  let models: readonly string[] | undefined;
  if (raw.models !== undefined) {
    if (!Array.isArray(raw.models) || raw.models.length > PROVIDER_CONNECTION_MAX_MODELS) {
      return { error: `models must be an array of at most ${PROVIDER_CONNECTION_MAX_MODELS} model ids` };
    }
    if (raw.models.some((item) => typeof item !== 'string' || item.trim().length === 0 || item.length > PROVIDER_CONNECTION_MODEL_ID_MAX_LENGTH)) {
      return { error: `models entries must be non-empty strings of at most ${PROVIDER_CONNECTION_MODEL_ID_MAX_LENGTH} characters` };
    }
    models = normalizeConnectionModels(raw.modelId, raw.models as readonly string[]);
    if (models === undefined) return { error: `models must contain at most ${PROVIDER_CONNECTION_MAX_MODELS} distinct model ids including modelId` };
  }
  if (raw.providerName !== undefined && (typeof raw.providerName !== 'string' || raw.providerName.length > 128)) return { error: 'providerName must be a string of at most 128 characters' };
  if (raw.modelName !== undefined && (typeof raw.modelName !== 'string' || raw.modelName.length > 256)) return { error: 'modelName must be a string of at most 256 characters' };
  if (raw.apiKey !== undefined && (typeof raw.apiKey !== 'string' || raw.apiKey.length === 0)) return { error: 'apiKey must be a non-empty string when provided' };
  return {
    write: {
      name: raw.name.trim(),
      adapterKind: raw.adapterKind as ProviderConnectionAdapterKind,
      baseUrl: raw.baseUrl,
      modelId: raw.modelId,
      ...(models === undefined ? {} : { models }),
      ...(raw.providerName === undefined ? {} : { providerName: raw.providerName as string }),
      ...(raw.modelName === undefined ? {} : { modelName: raw.modelName as string }),
      ...(raw.apiKey === undefined ? {} : { apiKey: raw.apiKey as string })
    }
  };
};

const rejectedFields = (body: unknown): string[] => {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return ['body'];
  return Object.keys(body as Record<string, unknown>).filter((key) => !writeFields.has(key));
};

export function registerProviderConnectionRoutes(app: FastifyInstance, options: RegisterProviderConnectionRoutesOptions): void {
  const now = options.now ?? (() => new Date());

  const principalFor = (request: FastifyRequest): { readonly principalId: string } | undefined => {
    if (options.authenticator.authenticateRequest) return options.authenticator.authenticateRequest(request);
    const auth = request.headers['x-authentication-id'];
    return typeof auth === 'string' && auth.length > 0 ? { principalId: auth } : undefined;
  };

  const sealCredential = (apiKey: string) => {
    if (options.secretBackend === undefined) {
      throw new SecretWriteUnavailable('SAGE_SECRET_MASTER_KEY is not configured; credential writes are unavailable');
    }
    const sealed = options.secretBackend.seal(apiKey);
    return { ciphertext: sealed.ciphertext, keyVersion: sealed.keyVersion, updatedAt: now().toISOString() };
  };

  app.get('/v1/provider-connections', async (_request, reply) => {
    if (!principalFor(_request)) return sendError(reply, 401, 'PROVIDER_CONNECTIONS_AUTHENTICATION_REQUIRED', 'Provider connections API requires authentication');
    try {
      const connections = await options.store.listProviderConnections(options.tenantId);
      return { schemaVersion: 'ProviderConnections.v1', connections: connections.map(viewOf) };
    } catch {
      return sendError(reply, 503, 'PROVIDER_CONNECTIONS_UNAVAILABLE', 'Provider connection store is unavailable', true);
    }
  });

  app.post<{ Body: unknown }>('/v1/provider-connections', {
    preValidation: async (request, reply) => {
      const rejected = rejectedFields(request.body);
      if (rejected.length > 0) return sendError(reply, 400, 'PROVIDER_CONNECTION_UNTRUSTED_FIELD', `Untrusted fields rejected: ${rejected.join(',')}`);
    }
  }, async (request, reply) => {
    const principal = principalFor(request);
    if (!principal) return sendError(reply, 401, 'PROVIDER_CONNECTIONS_AUTHENTICATION_REQUIRED', 'Provider connections API requires authentication');
    const { write, error } = parseWrite(request.body);
    if (write === undefined || write.apiKey === undefined) {
      return sendError(reply, 400, 'PROVIDER_CONNECTION_INVALID_REQUEST', error ?? 'apiKey is required when creating a connection');
    }
    let credential;
    try { credential = sealCredential(write.apiKey); } catch (cause) {
      if (cause instanceof SecretWriteUnavailable) return sendError(reply, 503, 'SECRET_BACKEND_UNAVAILABLE', cause.message, true);
      throw cause;
    }
    try {
      const id = `conn-${randomUUID()}`;
      const record = await options.store.createProviderConnection(options.tenantId, id, {
        name: write.name, source: 'user', adapterKind: write.adapterKind, baseUrl: write.baseUrl, modelId: write.modelId,
        ...(write.models === undefined ? {} : { models: write.models }),
        ...(write.providerName === undefined ? {} : { providerName: write.providerName }),
        ...(write.modelName === undefined ? {} : { modelName: write.modelName }),
        enabled: true, updatedBy: `principal://${principal.principalId}`, credential
      }, now().toISOString());
      return reply.code(201).send({ schemaVersion: 'ProviderConnection.v1', connection: viewOf(record) });
    } catch {
      return sendError(reply, 503, 'PROVIDER_CONNECTIONS_UNAVAILABLE', 'Provider connection store is unavailable', true);
    }
  });

  app.put<{ Params: { id: string }; Body: unknown }>('/v1/provider-connections/:id', {
    preValidation: async (request, reply) => {
      const rejected = rejectedFields(request.body);
      if (rejected.length > 0) return sendError(reply, 400, 'PROVIDER_CONNECTION_UNTRUSTED_FIELD', `Untrusted fields rejected: ${rejected.join(',')}`);
    }
  }, async (request, reply) => {
    const principal = principalFor(request);
    if (!principal) return sendError(reply, 401, 'PROVIDER_CONNECTIONS_AUTHENTICATION_REQUIRED', 'Provider connections API requires authentication');
    const existing = await options.store.getProviderConnection(options.tenantId, request.params.id);
    if (existing === undefined) return sendError(reply, 404, 'PROVIDER_CONNECTION_NOT_FOUND', 'Provider connection not found');
    if (existing.source === 'deployment-env') {
      return sendError(reply, 409, 'PROVIDER_CONNECTION_PROTECTED', 'Deployment-env connections are maintained by the trusted bootstrap and cannot be modified via the API', false);
    }
    const { write, error } = parseWrite(request.body);
    if (write === undefined) return sendError(reply, 400, 'PROVIDER_CONNECTION_INVALID_REQUEST', error ?? 'invalid request');
    let credential;
    if (write.apiKey !== undefined) {
      try { credential = sealCredential(write.apiKey); } catch (cause) {
        if (cause instanceof SecretWriteUnavailable) return sendError(reply, 503, 'SECRET_BACKEND_UNAVAILABLE', cause.message, true);
        throw cause;
      }
    }
    try {
      const updated = await options.store.updateProviderConnection(options.tenantId, request.params.id, {
        name: write.name, source: 'user', adapterKind: write.adapterKind, baseUrl: write.baseUrl, modelId: write.modelId,
        ...(write.models === undefined ? {} : { models: write.models }),
        ...(write.providerName === undefined ? {} : { providerName: write.providerName }),
        ...(write.modelName === undefined ? {} : { modelName: write.modelName }),
        enabled: existing.enabled, updatedBy: `principal://${principal.principalId}`,
        ...(credential === undefined ? {} : { credential })
      }, now().toISOString());
      if (updated === undefined) return sendError(reply, 404, 'PROVIDER_CONNECTION_NOT_FOUND', 'Provider connection not found');
      return { schemaVersion: 'ProviderConnection.v1', connection: viewOf(updated) };
    } catch {
      return sendError(reply, 503, 'PROVIDER_CONNECTIONS_UNAVAILABLE', 'Provider connection store is unavailable', true);
    }
  });

  app.delete<{ Params: { id: string } }>('/v1/provider-connections/:id', async (request, reply) => {
    if (!principalFor(request)) return sendError(reply, 401, 'PROVIDER_CONNECTIONS_AUTHENTICATION_REQUIRED', 'Provider connections API requires authentication');
    const existing = await options.store.getProviderConnection(options.tenantId, request.params.id);
    if (existing === undefined) return sendError(reply, 404, 'PROVIDER_CONNECTION_NOT_FOUND', 'Provider connection not found');
    if (existing.source === 'deployment-env') {
      return sendError(reply, 409, 'PROVIDER_CONNECTION_PROTECTED', 'Deployment-env connections are maintained by the trusted bootstrap and cannot be deleted via the API', false);
    }
    const settings = await options.store.getRunAgentSettings(options.tenantId);
    if (settings?.providerConnectionId === request.params.id) {
      return sendError(reply, 409, 'PROVIDER_CONNECTION_IN_USE', 'Provider connection is referenced by run agent settings; clear the reference before deleting', false);
    }
    const deleted = await options.store.deleteProviderConnection(options.tenantId, request.params.id);
    if (!deleted) return sendError(reply, 404, 'PROVIDER_CONNECTION_NOT_FOUND', 'Provider connection not found');
    return { schemaVersion: 'ProviderConnection.v1', deleted: request.params.id };
  });
}

/**
 * 部署 env 引导（vendor 中立）：SAGE_BOOTSTRAP_PROVIDER_API_KEY 非空且 SecretBackend 可用时幂等 upsert
 * deployment-env 条目；baseUrl/model 由 SAGE_BOOTSTRAP_PROVIDER_BASE_URL / SAGE_BOOTSTRAP_PROVIDER_MODEL
 * 必填提供（无任何 vendor 默认值），缺失或不合法时跳过（WARN 由调用方输出），不阻塞启动。
 * 可选 SAGE_BOOTSTRAP_PROVIDER_MODELS（逗号分隔）声明额外允许的模型；不合法时仅保留默认模型。
 */
export async function bootstrapDeploymentEnvProviderConnection(
  store: ProviderConnectionStore,
  secretBackend: SecretBackend | undefined,
  env: Record<string, string | undefined>,
  tenantId: string,
  now: () => Date = () => new Date()
): Promise<'registered' | 'skipped'> {
  const apiKey = env.SAGE_BOOTSTRAP_PROVIDER_API_KEY?.trim();
  if (apiKey === undefined || apiKey.length === 0 || secretBackend === undefined) return 'skipped';
  const baseUrl = env.SAGE_BOOTSTRAP_PROVIDER_BASE_URL?.trim();
  const modelId = env.SAGE_BOOTSTRAP_PROVIDER_MODEL?.trim();
  const adapterOverride = env.SAGE_BOOTSTRAP_PROVIDER_ADAPTER?.trim();
  const adapterKind = (adapterOverride === undefined || adapterOverride.length === 0 ? 'anthropic' : adapterOverride) as ProviderConnectionAdapterKind;
  if (baseUrl === undefined || baseUrl.length === 0 || !isPublicHttpsUrl(baseUrl)) return 'skipped';
  if (modelId === undefined || modelId.length === 0) return 'skipped';
  if (!ADAPTER_KINDS.includes(adapterKind)) return 'skipped';
  const extraModels = (env.SAGE_BOOTSTRAP_PROVIDER_MODELS ?? '').split(',').map((item) => item.trim()).filter((item) => item.length > 0);
  const models = normalizeConnectionModels(modelId, extraModels) ?? [modelId];
  const sealed = secretBackend.seal(apiKey);
  const credential = { ciphertext: sealed.ciphertext, keyVersion: sealed.keyVersion, updatedAt: now().toISOString() };
  const write = {
    name: env.SAGE_BOOTSTRAP_PROVIDER_NAME?.trim() || '部署环境 Provider', source: 'deployment-env' as const,
    adapterKind, baseUrl, modelId, models, modelName: modelId,
    enabled: true, updatedBy: 'bootstrap://deployment-env', credential
  };
  const existing = await store.getProviderConnection(tenantId, DEPLOYMENT_ENV_CONNECTION_ID);
  if (existing === undefined) {
    await store.createProviderConnection(tenantId, DEPLOYMENT_ENV_CONNECTION_ID, write, now().toISOString());
  } else {
    await store.updateProviderConnection(tenantId, DEPLOYMENT_ENV_CONNECTION_ID, write, now().toISOString());
  }
  return 'registered';
}
