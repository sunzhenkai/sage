import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Type, type Static } from 'typebox';
import type { ProviderConnectionStore, RunAgentDefaultProvider, RunAgentSettingsStore } from '@sage/task-domain';

export interface RunAgentSettingsPrincipalAuthenticator {
  authenticateRequest?(request: FastifyRequest): { readonly principalId: string; readonly tenantId: string } | undefined;
}

export interface RegisterRunAgentSettingsRoutesOptions {
  readonly tenantId: string;
  /** 缺省时 GET/PUT 仍可用，defaultProvider 恒为 auto（内存降级，便于测试）。 */
  readonly settingsStore?: RunAgentSettingsStore;
  /** 可用性来源：注册表条目。 */
  readonly providerConnections?: ProviderConnectionStore;
  readonly authenticator: RunAgentSettingsPrincipalAuthenticator;
  readonly now?: () => Date;
}

export const RunAgentDefaultProviderSchema = Type.Union([
  Type.Literal('echo'),
  Type.Literal('connection')
]);
export const UpdateRunAgentSettingsRequestSchema = Type.Object({
  defaultProvider: RunAgentDefaultProviderSchema,
  providerConnectionId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 }))
}, { additionalProperties: false });
export type UpdateRunAgentSettingsRequest = Static<typeof UpdateRunAgentSettingsRequestSchema>;

export interface RunAgentProviderStatus {
  readonly id: string;
  readonly name?: string;
  readonly available: boolean;
  readonly reason?: string;
}

export interface RunAgentSettingsResponse {
  readonly schemaVersion: 'RunAgentSettings.v1';
  readonly defaultProvider: RunAgentDefaultProvider;
  readonly providerConnectionId?: string;
  readonly updatedAt?: string;
  readonly updatedBy?: string;
  readonly providers: readonly RunAgentProviderStatus[];
}

const sendError = (reply: FastifyReply, status: number, code: string, message: string, retryable = false): FastifyReply =>
  reply.code(status).send({ error: { code, message, retryable } });

/** 可用性解析：注册表 enabled 且凭据在场的条目列为 available；不再含基于进程 env 的检测条目。 */
export const providerStatuses = async (
  connections?: ProviderConnectionStore,
  tenantId?: string
): Promise<readonly RunAgentProviderStatus[]> => {
  const statuses: RunAgentProviderStatus[] = [];
  if (connections !== undefined && tenantId !== undefined) {
    const entries = await connections.listProviderConnections(tenantId);
    for (const entry of entries) {
      statuses.push({
        id: entry.id,
        name: entry.name,
        available: entry.enabled && entry.credentialPresent,
        ...(entry.enabled && entry.credentialPresent ? {} : { reason: entry.credentialPresent ? 'Connection is disabled' : 'Connection has no stored credential' })
      });
    }
  }
  return statuses;
};

export function registerRunAgentSettingsRoutes(app: FastifyInstance, options: RegisterRunAgentSettingsRoutesOptions): void {
  const now = options.now ?? (() => new Date());
  const settingsStore = options.settingsStore;

  const principalFor = (request: FastifyRequest): { readonly principalId: string } | undefined => {
    if (options.authenticator.authenticateRequest) return options.authenticator.authenticateRequest(request);
    const auth = request.headers['x-authentication-id'];
    return typeof auth === 'string' && auth.length > 0 ? { principalId: auth } : undefined;
  };

  const settingsView = async (): Promise<RunAgentSettingsResponse> => {
    const record = settingsStore === undefined ? undefined : await settingsStore.getRunAgentSettings(options.tenantId);
    return {
      schemaVersion: 'RunAgentSettings.v1',
      defaultProvider: record?.defaultProvider ?? 'echo',
      ...(record?.providerConnectionId === undefined ? {} : { providerConnectionId: record.providerConnectionId }),
      ...(record === undefined ? {} : { updatedAt: record.updatedAt, updatedBy: record.updatedBy }),
      providers: await providerStatuses(options.providerConnections, options.tenantId)
    };
  };

  app.get('/v1/run-agent/settings', async (_request, reply) => {
    const principal = principalFor(_request);
    if (!principal) return sendError(reply, 401, 'RUN_AGENT_SETTINGS_AUTHENTICATION_REQUIRED', 'Run agent settings API requires authentication');
    try {
      return await settingsView();
    } catch {
      return sendError(reply, 503, 'RUN_AGENT_SETTINGS_UNAVAILABLE', 'Run agent settings store is unavailable', true);
    }
  });

  app.put<{ Body: UpdateRunAgentSettingsRequest }>('/v1/run-agent/settings', {
    preValidation: async (request, reply) => {
      const rejected = rejectedSettingsFields(request.body);
      if (rejected.length > 0) return sendError(reply, 400, 'RUN_AGENT_SETTINGS_UNTRUSTED_FIELD', `Untrusted fields rejected: ${rejected.join(',')}`);
    }
  }, async (request, reply) => {
    const principal = principalFor(request);
    if (!principal) return sendError(reply, 401, 'RUN_AGENT_SETTINGS_AUTHENTICATION_REQUIRED', 'Run agent settings API requires authentication');
    const body = request.body as Partial<UpdateRunAgentSettingsRequest> | undefined;
    if (body === null || typeof body !== 'object' || typeof body.defaultProvider !== 'string'
      || !['echo', 'connection'].includes(body.defaultProvider)) {
      return sendError(reply, 400, 'RUN_AGENT_SETTINGS_INVALID_PROVIDER', 'defaultProvider must be one of echo, connection');
    }
    if (body.defaultProvider === 'connection') {
      if (typeof body.providerConnectionId !== 'string' || body.providerConnectionId.length === 0) {
        return sendError(reply, 400, 'RUN_AGENT_SETTINGS_INVALID_PROVIDER', 'providerConnectionId is required when defaultProvider is connection');
      }
      const connection = options.providerConnections === undefined
        ? undefined
        : await options.providerConnections.getProviderConnection(options.tenantId, body.providerConnectionId);
      if (connection === undefined || !connection.enabled) {
        return sendError(reply, 400, 'RUN_AGENT_SETTINGS_INVALID_PROVIDER', 'providerConnectionId must reference an existing enabled provider connection');
      }
    } else if (body.providerConnectionId !== undefined) {
      return sendError(reply, 400, 'RUN_AGENT_SETTINGS_INVALID_PROVIDER', 'providerConnectionId is only allowed when defaultProvider is connection');
    }
    if (settingsStore === undefined) return sendError(reply, 503, 'RUN_AGENT_SETTINGS_UNAVAILABLE', 'Run agent settings store is unavailable', true);
    try {
      await settingsStore.upsertRunAgentSettings({
        tenantId: options.tenantId,
        defaultProvider: body.defaultProvider,
        ...(body.defaultProvider === 'connection' ? { providerConnectionId: body.providerConnectionId } : {}),
        updatedAt: now().toISOString(),
        updatedBy: `principal://${principal.principalId}`
      });
      return await settingsView();
    } catch {
      return sendError(reply, 503, 'RUN_AGENT_SETTINGS_UNAVAILABLE', 'Run agent settings update failed', true);
    }
  });
}

const settingsFields = new Set(['defaultProvider', 'providerConnectionId']);
function rejectedSettingsFields(body: unknown): string[] {
  const rejected: string[] = [];
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return ['body'];
  for (const key of Object.keys(body as Record<string, unknown>)) {
    if (!settingsFields.has(key)) rejected.push(key);
  }
  return rejected;
}
