import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Type, type Static } from 'typebox';
import type { RunAgentDefaultProvider, RunAgentSettingsStore } from '@sage/task-domain';

export interface RunAgentSettingsPrincipalAuthenticator {
  authenticateRequest?(request: FastifyRequest): { readonly principalId: string; readonly tenantId: string } | undefined;
}

export interface RegisterRunAgentSettingsRoutesOptions {
  readonly tenantId: string;
  /** 缺省时 GET/PUT 仍可用，defaultProvider 恒为 auto（内存降级，便于测试）。 */
  readonly settingsStore?: RunAgentSettingsStore;
  readonly authenticator: RunAgentSettingsPrincipalAuthenticator;
  /** 可注入的受信 env 视图；缺省读 process.env，只做非空检测、绝不回显值。 */
  readonly providerEnv?: Record<string, string | undefined>;
  readonly now?: () => Date;
}

export const RunAgentDefaultProviderSchema = Type.Union([
  Type.Literal('auto'),
  Type.Literal('minimax'),
  Type.Literal('echo')
]);
export const UpdateRunAgentSettingsRequestSchema = Type.Object({
  defaultProvider: RunAgentDefaultProviderSchema
}, { additionalProperties: false });
export type UpdateRunAgentSettingsRequest = Static<typeof UpdateRunAgentSettingsRequestSchema>;

export interface RunAgentProviderStatus {
  readonly id: 'minimax';
  readonly available: boolean;
  readonly reason?: string;
}

export interface RunAgentSettingsResponse {
  readonly schemaVersion: 'RunAgentSettings.v1';
  readonly defaultProvider: RunAgentDefaultProvider;
  readonly updatedAt?: string;
  readonly updatedBy?: string;
  readonly providers: readonly RunAgentProviderStatus[];
}

const sendError = (reply: FastifyReply, status: number, code: string, message: string, retryable = false): FastifyReply =>
  reply.code(status).send({ error: { code, message, retryable } });

/** 受信 env 非空检测：不做网络探测，不读取值内容，结果只含布尔与非敏感 reason。 */
export const minimaxAvailableFromEnv = (source: Record<string, string | undefined> = process.env): boolean =>
  (source.MINIMAX_API_KEY ?? '').trim().length > 0;

const providerStatuses = (providerEnv: Record<string, string | undefined>): readonly RunAgentProviderStatus[] => [{
  id: 'minimax',
  available: minimaxAvailableFromEnv(providerEnv),
  ...(minimaxAvailableFromEnv(providerEnv) ? {} : { reason: 'MINIMAX_API_KEY is not set in the trusted process environment' })
}];

export function registerRunAgentSettingsRoutes(app: FastifyInstance, options: RegisterRunAgentSettingsRoutesOptions): void {
  const now = options.now ?? (() => new Date());
  const providerEnv = options.providerEnv ?? process.env;
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
      defaultProvider: record?.defaultProvider ?? 'auto',
      ...(record === undefined ? {} : { updatedAt: record.updatedAt, updatedBy: record.updatedBy }),
      providers: providerStatuses(providerEnv)
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
      || !['auto', 'minimax', 'echo'].includes(body.defaultProvider)) {
      return sendError(reply, 400, 'RUN_AGENT_SETTINGS_INVALID_PROVIDER', 'defaultProvider must be one of auto, minimax, echo');
    }
    if (settingsStore === undefined) return sendError(reply, 503, 'RUN_AGENT_SETTINGS_UNAVAILABLE', 'Run agent settings store is unavailable', true);
    try {
      await settingsStore.upsertRunAgentSettings({
        tenantId: options.tenantId,
        defaultProvider: body.defaultProvider,
        updatedAt: now().toISOString(),
        updatedBy: `principal://${principal.principalId}`
      });
      return await settingsView();
    } catch {
      return sendError(reply, 503, 'RUN_AGENT_SETTINGS_UNAVAILABLE', 'Run agent settings update failed', true);
    }
  });
}

const settingsFields = new Set(['defaultProvider']);
function rejectedSettingsFields(body: unknown): string[] {
  const rejected: string[] = [];
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return ['body'];
  for (const key of Object.keys(body as Record<string, unknown>)) {
    if (!settingsFields.has(key)) rejected.push(key);
  }
  return rejected;
}
