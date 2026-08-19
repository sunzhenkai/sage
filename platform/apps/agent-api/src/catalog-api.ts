import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Type } from 'typebox';
import {
  ListModelsQuerySchema,
  ListProvidersQuerySchema,
  ProviderConnectionCheckRequestSchema,
  type AuthenticatedPrincipal,
  type ListModelsQuery,
  type ListProvidersQuery,
  type ProviderConnectionCheckRequest
} from '@sage/app-contracts';
import {
  CatalogAuthorizationError,
  CatalogManagerError,
  CatalogServiceError,
  requireCatalogAdmin,
  requireCatalogReadPrincipal,
  type CatalogSyncManager,
  type ProviderCatalogService,
  type ProviderCatalogStore
} from '@sage/provider-catalog';
import {
  ProviderConnectionInputError,
  probeProviderConnection,
  type ProviderConnectionProbe
} from './provider-connection.js';

export interface CatalogPrincipalAuthenticator { authenticateRequest(request: FastifyRequest): Promise<AuthenticatedPrincipal | undefined> | AuthenticatedPrincipal | undefined }
export interface RegisterCatalogRoutesOptions {
  readonly service: ProviderCatalogService;
  readonly store: ProviderCatalogStore;
  readonly manager: CatalogSyncManager;
  readonly authenticator: CatalogPrincipalAuthenticator;
  readonly probeConnection?: ProviderConnectionProbe;
  readonly now?: () => Date;
}
const emptyBody = Type.Object({}, { additionalProperties: false });
const sendError = (reply: FastifyReply, status: number, code: string, message: string, retryable = false, retryAfterSeconds?: number) =>
  reply.code(status).send({ error: { code, message, retryable, ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) } });
const principalFor = async (request: FastifyRequest, options: RegisterCatalogRoutesOptions) => requireCatalogReadPrincipal(await options.authenticator.authenticateRequest(request));
const mapped = (reply: FastifyReply, cause: unknown): FastifyReply => {
  if (cause instanceof ProviderConnectionInputError) return sendError(reply, 400, cause.code, cause.message);
  if (cause instanceof CatalogServiceError) return sendError(reply, cause.status, cause.code, cause.message, cause.status === 503);
  if (cause instanceof CatalogManagerError) return sendError(reply, cause.status, cause.code, cause.message, cause.status === 503, cause.retryAfterSeconds);
  if (cause instanceof CatalogAuthorizationError) return sendError(reply, cause.code === 'CATALOG_AUTHENTICATION_REQUIRED' ? 401 : 403, cause.code, cause.message);
  return sendError(reply, 503, 'CATALOG_UNAVAILABLE', 'Provider Catalog is temporarily unavailable', true);
};

export function registerProviderCatalogRoutes(app: FastifyInstance, options: RegisterCatalogRoutesOptions): void {
  app.get('/v1/provider-catalog/status', async (request, reply) => {
    try {
      await principalFor(request, options);
      const { state, snapshot } = await options.store.getActiveSnapshot();
      const stale = state.lastSuccessAt === undefined || (options.now ?? (() => new Date()))().getTime() - Date.parse(state.lastSuccessAt) > 26 * 60 * 60 * 1000;
      const activeAttempt = (await options.store.query<{ attempt_id: string }>('activeAttempt', `SELECT attempt_id FROM provider_catalog_sync_attempts
        WHERE source_id='models-dev' AND status IN ('queued','running') ORDER BY created_at LIMIT 1`)).rows[0];
      const attempt = activeAttempt === undefined ? undefined : await options.store.getAttempt(activeAttempt.attempt_id);
      return {
        schemaVersion: '1', source: 'models-dev', availability: snapshot === undefined ? 'unavailable' : stale ? 'stale' : 'available',
        ...(state.activeSnapshotId ? { snapshotId: state.activeSnapshotId } : {}), ...(state.activeActivatedAt ? { activeSince: state.activeActivatedAt } : {}),
        providerCount: snapshot?.providerCount ?? 0, modelCount: snapshot?.modelCount ?? 0,
        ...(state.lastCheckedAt ? { lastCheckedAt: state.lastCheckedAt } : {}), ...(state.lastSuccessAt ? { lastSuccessAt: state.lastSuccessAt } : {}),
        nextSyncAt: state.nextSyncAt, ...(attempt ? { activeAttempt: attempt } : {}), ...(state.lastErrorCode ? { errorCode: state.lastErrorCode } : {}),
        projection: snapshot === undefined ? 'unavailable' : 'ready'
      };
    } catch (cause) { return mapped(reply, cause); }
  });

  app.get<{ Querystring: ListProvidersQuery }>('/v1/provider-catalog/providers', { schema: { querystring: ListProvidersQuerySchema }, attachValidation: true }, async (request, reply) => {
    if (request.validationError) return sendError(reply, 400, 'CATALOG_INVALID_REQUEST', request.validationError.message);
    try { return await options.service.listProviders(await principalFor(request, options), request.query); }
    catch (cause) { return mapped(reply, cause); }
  });
  app.get<{ Querystring: ListModelsQuery }>('/v1/provider-catalog/models', { schema: { querystring: ListModelsQuerySchema }, attachValidation: true }, async (request, reply) => {
    if (request.validationError) return sendError(reply, 400, 'CATALOG_INVALID_REQUEST', request.validationError.message);
    try { return await options.service.listModels(await principalFor(request, options), request.query); }
    catch (cause) { return mapped(reply, cause); }
  });
  app.get<{ Params: { attemptId: string } }>('/v1/provider-catalog/sync/:attemptId', async (request, reply) => {
    try {
      await principalFor(request, options);
      const attempt = await options.store.getAttempt(request.params.attemptId);
      return attempt ?? sendError(reply, 404, 'CATALOG_SYNC_ATTEMPT_NOT_FOUND', 'Provider Catalog sync attempt not found');
    } catch (cause) { return mapped(reply, cause); }
  });
  app.post<{ Body: ProviderConnectionCheckRequest }>('/v1/provider-catalog/check-connection', { schema: { body: ProviderConnectionCheckRequestSchema }, attachValidation: true }, async (request, reply) => {
    if (request.validationError) return sendError(reply, 400, 'CATALOG_INVALID_REQUEST', request.validationError.message);
    try {
      await principalFor(request, options);
      const probe = options.probeConnection ?? ((input: ProviderConnectionCheckRequest) => probeProviderConnection(input));
      return await probe(request.body);
    } catch (cause) { return mapped(reply, cause); }
  });

  app.post<{ Body: Record<string, never> }>('/v1/provider-catalog/sync', { schema: { body: emptyBody }, attachValidation: true }, async (request, reply) => {
    if (request.validationError) return sendError(reply, 400, 'CATALOG_INVALID_REQUEST', request.validationError.message);
    try {
      const principal = requireCatalogAdmin(await options.authenticator.authenticateRequest(request));
      const attempt = await options.manager.enqueue('manual', principal);
      return reply.code(202).send({ attemptId: attempt.attemptId, status: attempt.status });
    } catch (cause) { return mapped(reply, cause); }
  });
}
