import * as z from 'zod';
import type { ToolDef } from './types.js';

/** app / run 组：/v1/apps（元数据、草稿、发布）与 /v1/releases/:id/runs。 */

const appPath = (appId: string): string => `/v1/apps/${encodeURIComponent(appId)}`;
const ifMatchHeader = (value: unknown): { readonly headers: Readonly<Record<string, string>> } | Record<string, never> =>
  value === undefined ? {} : { headers: { 'if-match': String(value) } };

export const appTools: readonly ToolDef[] = [
  {
    name: 'app_list',
    description: 'List apps.',
    schema: {},
    build: () => ({ method: 'GET', path: '/v1/apps' }),
  },
  {
    name: 'app_create',
    description: 'Create a new app.',
    schema: { body: z.unknown().describe('CreateAppRequest payload') },
    build: (a) => ({ method: 'POST', path: '/v1/apps', body: a.body }),
  },
  {
    name: 'app_get',
    description: 'Get an app by id, including draft state and release summaries.',
    schema: { appId: z.string().min(1) },
    build: (a) => ({ method: 'GET', path: appPath(a.appId) }),
  },
  {
    name: 'app_update',
    description: 'Update app metadata (name/description). Optionally pass ifMatch like "r3".',
    schema: {
      appId: z.string().min(1),
      body: z.unknown().describe('UpdateAppRequest payload'),
      ifMatch: z.string().min(1).optional().describe('Optional If-Match revision, e.g. "r3"'),
    },
    build: (a) => ({ method: 'PATCH', path: appPath(a.appId), ...ifMatchHeader(a.ifMatch), body: a.body }),
  },
  {
    name: 'app_delete',
    description: 'Soft-delete an app.',
    schema: { appId: z.string().min(1) },
    build: (a) => ({ method: 'DELETE', path: appPath(a.appId) }),
  },
  {
    name: 'app_get_draft',
    description: 'Get the app draft files with its current revision and digest.',
    schema: { appId: z.string().min(1) },
    build: (a) => ({ method: 'GET', path: `${appPath(a.appId)}/draft` }),
  },
  {
    name: 'app_put_draft',
    description: 'Replace the app draft files. Optionally pass ifMatch like "r3".',
    schema: {
      appId: z.string().min(1),
      files: z.record(z.string(), z.string()).describe('Draft source files map'),
      ifMatch: z.string().min(1).optional().describe('Optional If-Match revision, e.g. "r3"'),
    },
    build: (a) => ({ method: 'PUT', path: `${appPath(a.appId)}/draft`, ...ifMatchHeader(a.ifMatch), body: { files: a.files } }),
  },
  {
    name: 'app_publish_release',
    description: 'Publish the current app draft as an immutable release.',
    schema: {
      appId: z.string().min(1),
      baseRevision: z.number().int().min(0).describe('Draft revision the publish is based on'),
    },
    build: (a) => ({ method: 'POST', path: `${appPath(a.appId)}/releases`, body: { baseRevision: a.baseRevision } }),
  },
  {
    name: 'app_list_releases',
    description: 'List immutable releases for an app.',
    schema: { appId: z.string().min(1) },
    build: (a) => ({ method: 'GET', path: `${appPath(a.appId)}/releases` }),
  },
];

export const runTools: readonly ToolDef[] = [
  {
    name: 'run_create',
    description: 'Create a run for an app release (async, returns 202).',
    schema: {
      releaseId: z.string().min(1),
      body: z.unknown().optional().describe('CreatePackageRunRequest payload'),
    },
    build: (a) => ({ method: 'POST', path: `/v1/releases/${encodeURIComponent(a.releaseId)}/runs`, ...(a.body === undefined ? {} : { body: a.body }) }),
  },
];
