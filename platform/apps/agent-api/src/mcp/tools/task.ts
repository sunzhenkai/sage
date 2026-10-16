import * as z from 'zod';
import type { ToolDef } from './types.js';

/** task 组：/v1/tasks/* 端点 1:1 映射。 */

const signalBody = {
  kind: z.enum(['pause', 'resume']),
  controlId: z.string().min(1).max(128).optional(),
} as const;
const controlBody = {
  controlId: z.string().min(1).max(128).optional(),
} as const;

export const taskTools: readonly ToolDef[] = [
  {
    name: 'task_create',
    description: 'Create a new task (async, returns 202).',
    schema: { body: z.unknown().describe('CreateTaskRequest payload') },
    build: (a) => ({ method: 'POST', path: '/v1/tasks', body: a.body }),
  },
  {
    name: 'task_list',
    description: 'List tasks with optional filters.',
    schema: {
      status: z.string().optional(),
      taskType: z.string().optional(),
      environment: z.string().optional(),
      limit: z.string().optional(),
    },
    build: (a) => ({ method: 'GET', path: '/v1/tasks', query: omitUndefined(a) }),
  },
  {
    name: 'task_get',
    description: 'Get a task by id.',
    schema: { taskId: z.string().min(1) },
    build: (a) => ({ method: 'GET', path: `/v1/tasks/${a.taskId}` }),
  },
  {
    name: 'task_get_events',
    description: 'Get a task\'s events.',
    schema: { taskId: z.string().min(1) },
    build: (a) => ({ method: 'GET', path: `/v1/tasks/${a.taskId}/events` }),
  },
  {
    name: 'task_get_artifacts',
    description: 'List a task\'s artifacts.',
    schema: { taskId: z.string().min(1) },
    build: (a) => ({ method: 'GET', path: `/v1/tasks/${a.taskId}/artifacts` }),
  },
  {
    name: 'task_get_artifact',
    description: 'Get a task artifact by id (optionally download as base64).',
    schema: {
      taskId: z.string().min(1),
      artifactId: z.string().min(1),
      download: z.enum(['1']).optional(),
    },
    build: (a) => ({
      method: 'GET',
      path: `/v1/tasks/${a.taskId}/artifacts/${a.artifactId}`,
      ...(a.download === undefined ? {} : { query: { download: a.download } }),
    }),
  },
  {
    name: 'task_get_run_logs',
    description: 'Get a task\'s run logs (cursor-paginated by fromSequence).',
    schema: {
      taskId: z.string().min(1),
      runId: z.string().optional(),
      attemptId: z.string().optional(),
      fromSequence: z.string().regex(/^\d+$/).optional(),
      limit: z.string().regex(/^\d+$/).optional(),
    },
    build: (a) => ({
      method: 'GET',
      path: `/v1/tasks/${a.taskId}/run-logs`,
      query: omitUndefined({ runId: a.runId, attemptId: a.attemptId, fromSequence: a.fromSequence, limit: a.limit }),
    }),
  },
  {
    name: 'task_send_signal',
    description: 'Send a pause/resume signal to a task.',
    schema: { taskId: z.string().min(1), ...signalBody },
    build: (a) => ({
      method: 'POST',
      path: `/v1/tasks/${a.taskId}/signal`,
      body: { kind: a.kind, ...(a.controlId === undefined ? {} : { controlId: a.controlId }) },
    }),
  },
  {
    name: 'task_send_signals',
    description: 'Send a pause/resume signal to a task (plural alias).',
    schema: { taskId: z.string().min(1), ...signalBody },
    build: (a) => ({
      method: 'POST',
      path: `/v1/tasks/${a.taskId}/signals`,
      body: { kind: a.kind, ...(a.controlId === undefined ? {} : { controlId: a.controlId }) },
    }),
  },
  {
    name: 'task_cancel',
    description: 'Cancel a task.',
    schema: { taskId: z.string().min(1), ...controlBody },
    build: (a) => ({
      method: 'POST',
      path: `/v1/tasks/${a.taskId}/cancel`,
      body: a.controlId === undefined ? {} : { controlId: a.controlId },
    }),
  },
  {
    name: 'task_retry',
    description: 'Retry a task.',
    schema: { taskId: z.string().min(1), ...controlBody },
    build: (a) => ({
      method: 'POST',
      path: `/v1/tasks/${a.taskId}/retry`,
      body: a.controlId === undefined ? {} : { controlId: a.controlId },
    }),
  },
];

function omitUndefined(record: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]),
  ) as Record<string, string>;
}
