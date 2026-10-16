import * as z from 'zod';
import type { ToolDef } from './types.js';

/** package / app / run 组：/v1/packages、/v1/apps、/v1/releases/:id/runs。 */

export const packageTools: readonly ToolDef[] = [
  {
    name: 'package_list',
    description: 'List registered agent packages.',
    schema: {},
    build: () => ({ method: 'GET', path: '/v1/packages' }),
  },
  {
    name: 'package_get',
    description: 'Get a package with its manifest, assets, and releases.',
    schema: { packageId: z.string().min(1) },
    build: (a) => ({ method: 'GET', path: `/v1/packages/${a.packageId}` }),
  },
  {
    name: 'package_register_release',
    description: 'Register a package release (source files payload).',
    schema: {
      packageId: z.string().min(1),
      files: z.record(z.string(), z.unknown()).describe('Source files map'),
    },
    build: (a) => ({ method: 'POST', path: `/v1/packages/${a.packageId}/releases`, body: { files: a.files } }),
  },
];

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
    description: 'Get an app by id.',
    schema: { appId: z.string().min(1) },
    build: (a) => ({ method: 'GET', path: `/v1/apps/${a.appId}` }),
  },
  {
    name: 'app_delete',
    description: 'Delete an app.',
    schema: { appId: z.string().min(1) },
    build: (a) => ({ method: 'DELETE', path: `/v1/apps/${a.appId}` }),
  },
  {
    name: 'app_upload_release',
    description: 'Upload an app release (source files payload, non-multipart JSON path).',
    schema: {
      appId: z.string().min(1),
      files: z.record(z.string(), z.unknown()).describe('Source files map'),
    },
    build: (a) => ({ method: 'POST', path: `/v1/apps/${a.appId}/releases`, body: { files: a.files } }),
  },
];

export const runTools: readonly ToolDef[] = [
  {
    name: 'run_create',
    description: 'Create a run for a package release (async, returns 202).',
    schema: {
      releaseId: z.string().min(1),
      body: z.unknown().optional().describe('CreatePackageRunRequest payload'),
    },
    build: (a) => ({ method: 'POST', path: `/v1/releases/${a.releaseId}/runs`, ...(a.body === undefined ? {} : { body: a.body }) }),
  },
];
