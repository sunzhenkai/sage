import type { ToolDef } from './types.js';
import { chatTools } from './chat.js';
import { taskTools } from './task.js';
import { packageTools, appTools, runTools } from './package.js';
import {
  providerCatalogTools,
  providerConnectionTools,
  scheduleTools,
  effectTools,
  runAgentSettingsTools,
} from './provider.js';

/**
 * 全量 tool registry：1:1 映射 /v1/* 既有端点。
 * - 静态清单（可测试 / 可审阅，不运行时爬 Fastify 路由树）；
 * - 排除清单（design §3）：timeline SSE、/livez、/readyz、/internal/*、/mcp 自身。
 * - 命名规范：{group}_{action} snake_case。
 */
export const allTools: readonly ToolDef[] = [
  ...chatTools,
  ...taskTools,
  ...packageTools,
  ...appTools,
  ...runTools,
  ...providerCatalogTools,
  ...providerConnectionTools,
  ...scheduleTools,
  ...effectTools,
  ...runAgentSettingsTools,
];

/** 判据 10 资源组 → 至少一个 tool 覆盖断言用。 */
export const REQUIRED_GROUPS = [
  'chat',
  'task',
  'package',
  'app',
  'run',
  'provider_catalog',
  'provider_connection',
  'schedule',
  'effect',
  'run_agent_settings',
] as const;

/** 被排除端点（SHALL NOT 出现在 tools/list）。 */
export const EXCLUDED_PATHS = [
  '/v1/chat/sessions/:sessionId/timeline',
  '/livez',
  '/readyz',
  '/internal/schedule-dispatch/releases/:releaseId',
  '/mcp',
] as const;
