import * as z from 'zod';
import type { ToolDef } from './types.js';

/** chat 组：/v1/chat/* 端点 1:1 映射（timeline SSE 不映射，用 events?afterSequence 游标）。 */

export const chatTools: readonly ToolDef[] = [
  {
    name: 'chat_list_sessions',
    description: 'List chat sessions with optional filters (status / search / archived / cursor / locale).',
    schema: {
      limit: z.string().regex(/^(?:[1-9]|[1-9][0-9]|100)$/).optional(),
      status: z.enum(['all', 'open', 'closed']).optional(),
      q: z.string().max(100).optional(),
      archived: z.enum(['true', 'false']).optional(),
      cursor: z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/).optional(),
      locale: z.string().max(35).optional(),
    },
    build: (a) => ({ method: 'GET', path: '/v1/chat/sessions', query: stripUndefined(a) }),
  },
  {
    name: 'chat_create_session',
    description: 'Create a new chat session, optionally with a title.',
    schema: { title: z.string().min(1).max(200).optional() },
    build: (a) => ({ method: 'POST', path: '/v1/chat/sessions', body: stripUndefined(a) }),
  },
  {
    name: 'chat_get_session',
    description: 'Get a chat session with its messages, runs, and summaries.',
    schema: { sessionId: z.string().min(1) },
    build: (a) => ({ method: 'GET', path: `/v1/chat/sessions/${a.sessionId}` }),
  },
  {
    name: 'chat_delete_session',
    description: 'Delete a chat session.',
    schema: { sessionId: z.string().min(1) },
    build: (a) => ({ method: 'DELETE', path: `/v1/chat/sessions/${a.sessionId}` }),
  },
  {
    name: 'chat_archive_session',
    description: 'Archive a chat session.',
    schema: { sessionId: z.string().min(1) },
    build: (a) => ({ method: 'POST', path: `/v1/chat/sessions/${a.sessionId}/archive` }),
  },
  {
    name: 'chat_unarchive_session',
    description: 'Unarchive a chat session.',
    schema: { sessionId: z.string().min(1) },
    build: (a) => ({ method: 'POST', path: `/v1/chat/sessions/${a.sessionId}/unarchive` }),
  },
  {
    name: 'chat_send_message',
    description: 'Submit a user message to a chat session (async, returns 202 with run). Provider selection is by connectionId reference.',
    schema: {
      sessionId: z.string().min(1),
      parts: z.array(z.unknown()).min(1).max(32),
      provider: z.object({ connectionId: z.string().min(1).max(128) }).optional(),
    },
    build: (a) => ({
      method: 'POST',
      path: `/v1/chat/sessions/${a.sessionId}/messages`,
      body: { parts: a.parts, ...(a.provider === undefined ? {} : { provider: a.provider }) },
    }),
  },
  {
    name: 'chat_retry_run',
    description: 'Retry a chat run (async, returns 202 with new run). Provider selection is required.',
    schema: {
      runId: z.string().min(1),
      provider: z.object({ connectionId: z.string().min(1).max(128) }),
    },
    build: (a) => ({ method: 'POST', path: `/v1/chat/runs/${a.runId}/retry`, body: { provider: a.provider } }),
  },
  {
    name: 'chat_get_events',
    description: 'Get chat session timeline events as JSON (cursor-paginated by afterSequence).',
    schema: {
      sessionId: z.string().min(1),
      afterSequence: z.string().regex(/^\d+$/).optional(),
    },
    build: (a) => ({
      method: 'GET',
      path: `/v1/chat/sessions/${a.sessionId}/events`,
      ...(a.afterSequence === undefined ? {} : { query: { afterSequence: a.afterSequence } }),
    }),
  },
  {
    name: 'chat_promote_message',
    description: 'Promote a chat message to a task.',
    schema: {
      messageId: z.string().min(1),
      mode: z.enum(['explicit', 'restricted-rule']),
      taskType: z.enum(['sage.agent-task.v1', 'sage.batch-agent-task.v1']).optional(),
      ruleId: z.string().min(1).optional(),
    },
    build: (a) => ({
      method: 'POST',
      path: `/v1/chat/messages/${a.messageId}/promotions`,
      body: { mode: a.mode, ...(a.taskType === undefined ? {} : { taskType: a.taskType }), ...(a.ruleId === undefined ? {} : { ruleId: a.ruleId }) },
    }),
  },
];

function stripUndefined(record: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).filter(([, v]) => v !== undefined),
  ) as Record<string, string>;
}
