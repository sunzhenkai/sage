import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AgentReleaseStore, StoredRelease } from '@sage/agent-release-registry';
import type {
  ProjectionFreshness,
  TaskPackageInputStore,
  TaskPackageRunIndexEntry,
  TaskPackageRunIndexStore,
  TaskProjectionQueryStore,
  TaskProjectionView,
  TaskStatus
} from '@sage/task-domain';
import { principalFor, type AppsPrincipalAuthenticator } from './apps-api.js';

export interface RegisterAppRunsRoutesOptions {
  readonly tenantId: string;
  readonly store: AgentReleaseStore;
  readonly packageRuns: TaskPackageRunIndexStore;
  readonly packageInputs: Pick<TaskPackageInputStore, 'getPackageInput'>;
  readonly taskViews: TaskProjectionQueryStore;
  readonly authenticator: AppsPrincipalAuthenticator;
  readonly serviceTokenRequired?: boolean;
  readonly freshnessThresholdMs?: number;
  readonly now?: () => Date;
}

type AppRunStatus = TaskStatus | 'pending';

interface AppRunSummary {
  readonly taskId: string;
  readonly releaseId: string;
  readonly releaseVersion?: string;
  readonly source: 'manual' | 'schedule';
  readonly status: AppRunStatus;
  readonly freshness?: ProjectionFreshness;
  readonly failureCode?: string;
  readonly failureDetail?: string;
  readonly createdAt: string;
  readonly updatedAt?: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const RELEASE_ID = /^sha256:[a-f0-9]{64}$/;

function sendError(reply: FastifyReply, status: number, code: string, message: string, retryable = false): FastifyReply {
  return reply.code(status).send({ error: { code, message, retryable } });
}

function queryLimit(query: Record<string, unknown>): number | undefined {
  const unknown = Object.keys(query).filter((key) => key !== 'releaseId' && key !== 'limit');
  if (unknown.length > 0) return undefined;
  const raw = query.limit;
  if (raw === undefined) return DEFAULT_LIMIT;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= MAX_LIMIT ? value : undefined;
}

function runSummary(
  entry: TaskPackageRunIndexEntry,
  release: StoredRelease | undefined,
  view: TaskProjectionView | undefined
): AppRunSummary {
  return {
    taskId: entry.taskId,
    releaseId: entry.releaseId,
    ...(release === undefined ? {} : { releaseVersion: release.packageVersion }),
    source: entry.taskId.startsWith('pkg-sched-') ? 'schedule' : 'manual',
    status: view?.status ?? 'pending',
    ...(view === undefined ? {} : {
      freshness: view.freshness,
      ...(view.failureCode === undefined ? {} : { failureCode: view.failureCode }),
      ...(view.failureDetail === undefined ? {} : { failureDetail: view.failureDetail }),
      ...(view.projectionUpdatedAt === undefined ? {} : { updatedAt: view.projectionUpdatedAt })
    }),
    createdAt: entry.createdAt
  };
}

function releaseById(releases: readonly StoredRelease[], releaseId: string): StoredRelease | undefined {
  return releases.find((release) => release.release.releaseId === releaseId);
}

export function registerAppRunsRoutes(app: FastifyInstance, options: RegisterAppRunsRoutesOptions): void {
  const now = options.now ?? (() => new Date());
  const freshnessThresholdMs = options.freshnessThresholdMs ?? 30_000;

  app.get<{ Params: { appId: string }; Querystring: Record<string, unknown> }>(
    '/v1/apps/:appId/runs',
    async (request, reply) => {
      const principal = await principalFor(request, options);
      if (principal === undefined) return sendError(reply, 401, 'APP_AUTHENTICATION_REQUIRED', 'App API requires authentication');
      const app = options.store.getApp(options.tenantId, request.params.appId);
      if (app === undefined) return sendError(reply, 404, 'APP_NOT_FOUND', 'App not found');
      const releases = options.store.listAppReleases(options.tenantId, request.params.appId);
      const limit = queryLimit(request.query);
      if (limit === undefined) return sendError(reply, 400, 'INVALID_APP_RUN_QUERY', `limit must be an integer between 1 and ${MAX_LIMIT}`);
      let releaseIds: readonly string[];
      const filteredReleaseId = request.query.releaseId;
      if (filteredReleaseId !== undefined) {
        if (typeof filteredReleaseId !== 'string' || !RELEASE_ID.test(filteredReleaseId)) {
          return sendError(reply, 400, 'INVALID_APP_RUN_QUERY', 'releaseId must be sha256:<64 lowercase hex>');
        }
        if (releaseById(releases, filteredReleaseId) === undefined) {
          return sendError(reply, 404, 'APP_RELEASE_NOT_FOUND', 'Release does not belong to this app');
        }
        releaseIds = [filteredReleaseId];
      } else {
        releaseIds = releases.map((release) => release.release.releaseId);
      }
      try {
        const entries = await options.packageRuns.listPackageRuns(options.tenantId, { releaseIds, limit });
        const views = await Promise.all(entries.map((entry) =>
          options.taskViews.getTaskView(options.tenantId, entry.taskId, now(), freshnessThresholdMs)));
        return {
          schemaVersion: 'AppRunList.v1',
          appId: request.params.appId,
          runs: entries.map((entry, index) => runSummary(entry, releaseById(releases, entry.releaseId), views[index]))
        };
      } catch {
        return sendError(reply, 503, 'APP_RUN_HISTORY_UNAVAILABLE', 'App run history is temporarily unavailable', true);
      }
    }
  );

  app.get<{ Params: { appId: string; taskId: string } }>(
    '/v1/apps/:appId/runs/:taskId',
    async (request, reply) => {
      const principal = await principalFor(request, options);
      if (principal === undefined) return sendError(reply, 401, 'APP_AUTHENTICATION_REQUIRED', 'App API requires authentication');
      const app = options.store.getApp(options.tenantId, request.params.appId);
      if (app === undefined) return sendError(reply, 404, 'APP_NOT_FOUND', 'App not found');
      try {
        const input = await options.packageInputs.getPackageInput(options.tenantId, request.params.taskId);
        if (input === undefined) return sendError(reply, 404, 'APP_RUN_NOT_FOUND', 'Run not found');
        const release = releaseById(options.store.listAppReleases(options.tenantId, request.params.appId), input.releaseId);
        if (release === undefined) return sendError(reply, 404, 'APP_RUN_NOT_FOUND', 'Run not found');
        const view = await options.taskViews.getTaskView(options.tenantId, request.params.taskId, now(), freshnessThresholdMs);
        return {
          schemaVersion: 'AppRunDetail.v1',
          appId: request.params.appId,
          run: runSummary({
            taskId: input.taskId,
            releaseId: input.releaseId,
            releaseDigest: input.releaseDigest,
            createdAt: input.createdAt
          }, release, view)
        };
      } catch {
        return sendError(reply, 503, 'APP_RUN_HISTORY_UNAVAILABLE', 'App run history is temporarily unavailable', true);
      }
    }
  );
}
