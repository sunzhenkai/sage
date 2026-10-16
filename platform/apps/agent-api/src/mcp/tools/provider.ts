import * as z from 'zod';
import type { ToolDef } from './types.js';

/** provider_catalog / provider_connection / schedule / effect / run_agent_settings 组。 */

export const providerCatalogTools: readonly ToolDef[] = [
  {
    name: 'provider_catalog_get_status',
    description: 'Get provider catalog sync status.',
    schema: {},
    build: () => ({ method: 'GET', path: '/v1/provider-catalog/status' }),
  },
  {
    name: 'provider_catalog_list_providers',
    description: 'List providers from the catalog.',
    schema: {
      limit: z.string().regex(/^(?:[1-9]|[1-9][0-9]|100)$/).optional(),
      q: z.string().max(100).optional(),
      cursor: z.string().optional(),
    },
    build: (a) => ({ method: 'GET', path: '/v1/provider-catalog/providers', query: omitUndefined(a) }),
  },
  {
    name: 'provider_catalog_list_models',
    description: 'List models from the catalog.',
    schema: {
      limit: z.string().regex(/^(?:[1-9]|[1-9][0-9]|100)$/).optional(),
      q: z.string().max(100).optional(),
      providerId: z.string().optional(),
      status: z.string().optional(),
      capability: z.string().min(1).max(100).optional(),
      cursor: z.string().optional(),
    },
    build: (a) => ({
      method: 'GET',
      path: '/v1/provider-catalog/models',
      query: omitUndefined({ limit: a.limit, q: a.q, providerId: a.providerId, status: a.status, capability: a.capability, cursor: a.cursor }),
    }),
  },
  {
    name: 'provider_catalog_get_sync_attempt',
    description: 'Get a provider catalog sync attempt by id.',
    schema: { attemptId: z.string().min(1) },
    build: (a) => ({ method: 'GET', path: `/v1/provider-catalog/sync/${a.attemptId}` }),
  },
  {
    name: 'provider_catalog_check_connection',
    description: 'Probe a provider connection (baseUrl + adapterKind + modelId + optional apiKey).',
    schema: {
      adapterKind: z.string().min(1),
      baseUrl: z.string().min(1).max(2048),
      modelId: z.string().min(1).max(256),
      apiKey: z.string().max(4096).optional(),
    },
    build: (a) => ({
      method: 'POST',
      path: '/v1/provider-catalog/check-connection',
      body: {
        adapterKind: a.adapterKind,
        baseUrl: a.baseUrl,
        modelId: a.modelId,
        ...(a.apiKey === undefined ? {} : { apiKey: a.apiKey }),
      },
    }),
  },
  {
    name: 'provider_catalog_sync',
    description: 'Trigger a manual provider catalog sync (admin, returns 202).',
    schema: {},
    build: () => ({ method: 'POST', path: '/v1/provider-catalog/sync', body: {} }),
  },
];

export const providerConnectionTools: readonly ToolDef[] = [
  {
    name: 'provider_connection_list',
    description: 'List workspace provider connections.',
    schema: {},
    build: () => ({ method: 'GET', path: '/v1/provider-connections' }),
  },
  {
    name: 'provider_connection_create',
    description: 'Create a provider connection (apiKey sealed server-side).',
    schema: {
      name: z.string().min(1),
      adapterKind: z.string().min(1),
      baseUrl: z.string().min(1),
      modelId: z.string().min(1),
      apiKey: z.string().min(1),
      providerName: z.string().optional(),
      modelName: z.string().optional(),
    },
    build: (a) => ({
      method: 'POST',
      path: '/v1/provider-connections',
      body: {
        name: a.name, adapterKind: a.adapterKind, baseUrl: a.baseUrl, modelId: a.modelId, apiKey: a.apiKey,
        ...(a.providerName === undefined ? {} : { providerName: a.providerName }),
        ...(a.modelName === undefined ? {} : { modelName: a.modelName }),
      },
    }),
  },
  {
    name: 'provider_connection_update',
    description: 'Update a provider connection by id.',
    schema: {
      id: z.string().min(1),
      name: z.string().optional(),
      adapterKind: z.string().optional(),
      baseUrl: z.string().optional(),
      modelId: z.string().optional(),
      apiKey: z.string().optional(),
      providerName: z.string().optional(),
      modelName: z.string().optional(),
    },
    build: (a) => ({
      method: 'PUT',
      path: `/v1/provider-connections/${a.id}`,
      body: omitUndefined({
        name: a.name, adapterKind: a.adapterKind, baseUrl: a.baseUrl, modelId: a.modelId,
        apiKey: a.apiKey, providerName: a.providerName, modelName: a.modelName,
      }),
    }),
  },
  {
    name: 'provider_connection_delete',
    description: 'Delete a provider connection by id.',
    schema: { id: z.string().min(1) },
    build: (a) => ({ method: 'DELETE', path: `/v1/provider-connections/${a.id}` }),
  },
];

export const scheduleTools: readonly ToolDef[] = [
  {
    name: 'schedule_list',
    description: 'List schedules (requires service token auth).',
    schema: {},
    build: () => ({ method: 'GET', path: '/v1/schedules' }),
  },
  {
    name: 'schedule_create',
    description: 'Create a schedule bound to a release (requires service token auth).',
    schema: {
      definition: z.unknown().describe('ApiScheduleDefinition payload'),
      releaseId: z.string().min(1),
    },
    build: (a) => ({ method: 'POST', path: '/v1/schedules', body: { definition: a.definition, releaseId: a.releaseId } }),
  },
  {
    name: 'schedule_get',
    description: 'Get a schedule by id (requires service token auth).',
    schema: { scheduleId: z.string().min(1) },
    build: (a) => ({ method: 'GET', path: `/v1/schedules/${a.scheduleId}` }),
  },
  {
    name: 'schedule_get_triggers',
    description: 'Get a schedule\'s trigger history (requires service token auth).',
    schema: { scheduleId: z.string().min(1), limit: z.string().optional() },
    build: (a) => ({
      method: 'GET',
      path: `/v1/schedules/${a.scheduleId}/triggers`,
      ...(a.limit === undefined ? {} : { query: { limit: a.limit } }),
    }),
  },
  {
    name: 'schedule_pause',
    description: 'Pause a schedule (requires service token auth).',
    schema: { scheduleId: z.string().min(1) },
    build: (a) => ({ method: 'POST', path: `/v1/schedules/${a.scheduleId}/pause` }),
  },
  {
    name: 'schedule_resume',
    description: 'Resume a schedule (requires service token auth).',
    schema: { scheduleId: z.string().min(1) },
    build: (a) => ({ method: 'POST', path: `/v1/schedules/${a.scheduleId}/resume` }),
  },
  {
    name: 'schedule_delete',
    description: 'Delete a schedule (requires service token auth).',
    schema: { scheduleId: z.string().min(1) },
    build: (a) => ({ method: 'DELETE', path: `/v1/schedules/${a.scheduleId}` }),
  },
];

export const effectTools: readonly ToolDef[] = [
  {
    name: 'effect_resolve',
    description: 'Resolve a tool effect (idempotency-keyed, requires service token auth).',
    schema: { body: z.unknown().describe('Effect resolution payload') },
    build: (a) => ({ method: 'POST', path: '/v1/effects/resolutions', body: a.body }),
  },
];

export const runAgentSettingsTools: readonly ToolDef[] = [
  {
    name: 'run_agent_settings_get',
    description: 'Get run agent settings.',
    schema: {},
    build: () => ({ method: 'GET', path: '/v1/run-agent/settings' }),
  },
  {
    name: 'run_agent_settings_update',
    description: 'Update run agent settings.',
    schema: { body: z.unknown().describe('UpdateRunAgentSettingsRequest payload') },
    build: (a) => ({ method: 'PUT', path: '/v1/run-agent/settings', body: a.body }),
  },
];

function omitUndefined(record: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]),
  ) as Record<string, string>;
}
