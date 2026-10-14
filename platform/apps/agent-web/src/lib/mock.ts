/**
 * Dev-only demo data. Enabled by `?mock=1` (persisted in localStorage, `?mock=0` to leave) or VITE_MOCK=1.
 * Mock mode is read-only: it never calls agent-api, and write operations are rejected locally.
 */
import type { CatalogModelItem, CatalogProviderItem, ChatRun, Message, ScheduleSnapshot, ScheduleTriggerEvent, SessionListItem, TaskStatus, TaskView, TimelineEvent } from './types';

const KEY = 'sage.agent-web.mock';

function initMock(): boolean {
  if (typeof window === 'undefined') return false;
  const param = new URLSearchParams(window.location.search).get('mock');
  if (param === '1') localStorage.setItem(KEY, '1');
  if (param === '0') localStorage.removeItem(KEY);
  return import.meta.env.VITE_MOCK === '1' || localStorage.getItem(KEY) === '1';
}
const enabled = initMock();
export const isMock = (): boolean => enabled;
export function exitMock(): void { localStorage.removeItem(KEY); window.location.search = ''; }

// ---- deterministic data ----
let seed = 42;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rnd() * 16).toString(16)).join('');
const uuid = () => `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;
const NOW = Date.now();
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const titles = ['Weekly finance briefing', 'Summarize incident INC-2291', 'Draft release notes v2.4', 'Compare FX moves vs last week', 'Triage support backlog', 'Explain temporal retry policy', 'Refactor schedule binding', 'Market open checklist', 'Postgres migration plan', 'Evaluate provider latency', 'Investigate SSE reconnects', 'Generate onboarding doc'];
const prompts = ['Give me a concise briefing on today\u2019s FX moves and index closes.', 'What changed between release 2.3 and 2.4?', 'Summarize the root cause and follow-ups.', 'List the top 5 risks for the migration.'];
const answers = ['Here is today\u2019s briefing:\n\n• USD/CNY 7.12 (−0.18%)\n• EUR/USD 1.0874 (+0.22%)\n• S&P 500 closed +0.6% led by semis; Hang Seng −0.4%.\n\nNet: risk-on tone in US hours, Asia lagging on property headlines.', 'Release 2.4 adds durable coordinator v2, schedule FOLLOW bindings and run-log pagination. Two breaking changes: the singular /signal route is deprecated and provider selection is now required.', 'Root cause: the artifact store briefly returned 503 during a rolling restart; workers retried without backoff. Follow-ups: add jitter, alert on sage_artifact_store_unavailable_total.'];

export const mockSessions: SessionListItem[] = titles.map((title, i) => {
  const t = NOW - i * 0.55 * DAY - rnd() * 3_600_000;
  return { schemaVersion: '1', sessionId: `session-${uuid()}`, status: 'open', title, preview: pick(prompts), lastMessageRole: rnd() > 0.3 ? 'assistant' : 'user', lastMessageAt: iso(t), createdAt: iso(t - 3_600_000), updatedAt: iso(t) };
});

const runsBySession = new Map<string, ChatRun[]>();
const eventsBySession = new Map<string, TimelineEvent[]>();
const messagesBySession = new Map<string, Message[]>();
const toolPool = ['web-snapshot-reader', 'fx-rates.fetch', 'index-closes.fetch', 'artifact.write', 'search.news', 'calendar.lookup'];
const ev = (s: SessionListItem, runId: string, seq: number, at: number, payload: TimelineEvent['payload']): TimelineEvent => ({ schemaVersion: '1', sessionId: s.sessionId, runId, sequence: seq, occurredAt: iso(at), payload });
mockSessions.forEach((s, si) => {
  const count = si === 0 ? 2 : 1 + Math.floor(rnd() * 5);
  const runs: ChatRun[] = []; const events: TimelineEvent[] = []; const messages: Message[] = []; let seq = 0;
  for (let k = 0; k < count; k++) {
    const live = si === 0 && k === count - 1;
    const start = live ? NOW - 14_000 : new Date(s.createdAt).getTime() + k * 900_000;
    const runId = `run-${uuid()}`; const messageId = `message-${uuid()}`;
    const status = live ? 'active' : si === 0 ? 'succeeded' : rnd() < 0.78 ? 'succeeded' : 'failed';
    const dur = 2_000 + rnd() * 26_000;
    runs.push({ schemaVersion: '1', runId, sessionId: s.sessionId, userMessageId: messageId, attempt: 1, status, startedAt: iso(start), ...(live ? {} : { completedAt: iso(start + dur) }), ...(status === 'failed' ? { error: { code: 'CHAT_AGENT_FAILED', message: 'Upstream provider timed out after 60s', retryable: true } } : {}) });
    const text = si === 0 ? (k === 0 ? prompts[0]! : 'Now compare that with last week and flag anything unusual.') : pick(prompts);
    messages.push({ schemaVersion: '1', messageId, sessionId: s.sessionId, turn: k * 2 + 1, role: 'user', parts: [{ kind: 'text', text }], createdAt: iso(start) });
    events.push(ev(s, runId, ++seq, start, { kind: 'text', text, messageId }));
    events.push(ev(s, runId, ++seq, start, { kind: 'run', status: 'active', attempt: 1 }));
    const nTools = si === 0 ? 3 : Math.floor(rnd() * 4);
    const used = si === 0 ? ['fx-rates.fetch', 'index-closes.fetch', 'artifact.write'] : Array.from({ length: nTools }, () => pick(toolPool));
    used.forEach((toolName, ti) => {
      const t0 = start + 600 + ti * 1800;
      events.push(ev(s, runId, ++seq, t0, { kind: 'tool', toolName, status: 'started' }));
      if (!(live && ti === used.length - 1)) events.push(ev(s, runId, ++seq, t0 + 1200, { kind: 'tool', toolName, status: 'completed', ...(toolName === 'artifact.write' ? { artifact: { artifactId: `art-${hex(6)}`, name: 'briefing.md', mediaType: 'text/markdown', sizeBytes: 4182 } } : {}) }));
    });
    if (!live && (si === 0 || rnd() > 0.6)) events.push(ev(s, runId, ++seq, start + dur - 500, { kind: 'artifact', artifact: { artifactId: `art-${hex(6)}`, name: pick(['briefing.md', 'summary.json', 'risks.csv']), mediaType: 'text/plain', sizeBytes: 900 + Math.floor(rnd() * 8000) } }));
    if (live) events.push(ev(s, runId, ++seq, NOW - 2_000, { kind: 'text', text: 'Week over week, USD/CNY is down 0.4% while EUR/USD gained 1.1%. The S&P 500 is up 1.8%' }));
    else if (status === 'succeeded') events.push(ev(s, runId, ++seq, start + dur, { kind: 'text', text: si === 0 ? answers[0]! : pick(answers) }));
    else events.push(ev(s, runId, ++seq, start + dur, { kind: 'error', error: { code: 'CHAT_AGENT_FAILED', message: 'Upstream provider timed out after 60s', retryable: true } }));
    if (!live) events.push(ev(s, runId, ++seq, start + dur, { kind: 'run', status, attempt: 1 }));
  }
  runsBySession.set(s.sessionId, runs); eventsBySession.set(s.sessionId, events); messagesBySession.set(s.sessionId, messages);
});

const taskTypes = ['finance-brief', 'release-notes', 'incident-summary', 'data-sync'];
const statusWeights: [TaskStatus, number][] = [['succeeded', 0.55], ['running', 0.14], ['failed', 0.12], ['paused', 0.07], ['cancelled', 0.07], ['effect_unknown', 0.05]];
const weighted = (): TaskStatus => { let r = rnd(); for (const [s, w] of statusWeights) { if ((r -= w) <= 0) return s; } return 'succeeded'; };
export const mockTasks: TaskView[] = Array.from({ length: 46 }, (_, i) => {
  const t = NOW - rnd() * 13 * DAY;
  const taskType = pick(taskTypes);
  return { schemaVersion: '1', taskId: `task-${taskType}-${(4120 - i).toString()}`, taskType, workflowId: `wf-${hex(10)}`, targetId: pick(['worker-a', 'worker-b', 'worker-gpu']), attempt: rnd() > 0.8 ? 2 : 1, status: weighted(), revision: Math.floor(rnd() * 9), projectionSource: 'writer', projectionFreshness: 'fresh', lifecyclePath: 'DURABLE_COORDINATOR_V2', projectionUpdatedAt: iso(t), historyObservedAt: iso(t + 2000), sessionId: pick(mockSessions).sessionId };
}).sort((a, b) => String(b.projectionUpdatedAt).localeCompare(String(a.projectionUpdatedAt)));

{
  const s0 = mockSessions[0]!; const evs = eventsBySession.get(s0.sessionId)!; const first = evs[0]!; const t = mockTasks.find((x) => x.taskType === 'finance-brief') ?? mockTasks[0]!;
  const runEnd = evs.findIndex((e) => e.runId === first.runId && e.payload.kind === 'run' && e.payload.status !== 'active');
  evs.splice(runEnd, 0, { ...first, sequence: 0, occurredAt: first.occurredAt, payload: { kind: 'task', taskId: t.taskId, title: 'Schedule daily FX briefing', status: 'promoted', promotionMode: 'explicit' } });
  evs.forEach((e, i) => { e.sequence = i + 1; });
}

const def = (scheduleId: string, displayName: string, trigger: ScheduleSnapshot['definition']['trigger'], task: string): ScheduleSnapshot['definition'] => ({
  schemaVersion: '1', scheduleId, tenantId: 'tenant-local', displayName, trigger, overlapPolicy: 'SKIP', misfirePolicy: 'CATCH_UP_ONE', releaseBinding: { strategy: 'FOLLOW' },
  targetConstraints: { allowedEnvironments: ['local'] }, budget: { limits: [{ dimension: 'runs', limit: 48 }] }, invocation: { task }
});
export const mockSchedules: ScheduleSnapshot[] = [
  { schemaVersion: '1', definition: def('finance.morning', 'Morning finance brief', { kind: 'cron', expression: '0 8 * * 1-5', timezone: 'Asia/Shanghai' }, 'finance-brief'), revision: 4, state: 'ACTIVE', contentDigest: `sha256:${hex(64)}`, createdAtMs: NOW - 20 * DAY, updatedAtMs: NOW - 2 * DAY, nextFireAtMs: NOW + 9 * 3_600_000 },
  { schemaVersion: '1', definition: def('release.notes', 'Release notes digest', { kind: 'cron', expression: '0 18 * * 5', timezone: 'Asia/Shanghai' }, 'release-notes'), revision: 2, state: 'ACTIVE', contentDigest: `sha256:${hex(64)}`, createdAtMs: NOW - 12 * DAY, updatedAtMs: NOW - 5 * DAY, nextFireAtMs: NOW + 2 * DAY },
  { schemaVersion: '1', definition: def('sync.hourly', 'Hourly data sync', { kind: 'interval', everyMs: 3_600_000 }, 'data-sync'), revision: 7, state: 'ACTIVE', contentDigest: `sha256:${hex(64)}`, createdAtMs: NOW - 30 * DAY, updatedAtMs: NOW - DAY, nextFireAtMs: NOW + 1_200_000 },
  { schemaVersion: '1', definition: def('incident.weekly', 'Weekly incident review', { kind: 'cron', expression: '0 10 * * 1', timezone: 'UTC' }, 'incident-summary'), revision: 1, state: 'PAUSED', contentDigest: `sha256:${hex(64)}`, createdAtMs: NOW - 8 * DAY, updatedAtMs: NOW - 3 * DAY }
];
export const mockTriggers: Record<string, ScheduleTriggerEvent[]> = Object.fromEntries(mockSchedules.map((s) => [s.definition.scheduleId, Array.from({ length: 28 }, (_, i) => {
  const r = rnd();
  return { scheduleId: s.definition.scheduleId, occurrenceId: `occ-${hex(8)}`, kind: r < 0.8 ? 'SUCCEEDED' : r < 0.9 ? 'FAILED' : r < 0.96 ? 'SKIPPED' : 'MISSED', occurredAtMs: NOW - i * (s.definition.trigger.kind === 'interval' ? 0.45 : 0.5) * DAY - rnd() * 3_600_000, taskId: pick(mockTasks).taskId } as ScheduleTriggerEvent;
})]));

const providers = [
  { id: 'conn-openai', name: 'openai-prod', source: 'user', adapterKind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-4o-mini', enabled: true, credentialPresent: true, createdAt: iso(NOW - 30 * DAY), updatedAt: iso(NOW - 2 * DAY) },
  { id: 'conn-anthropic', name: 'anthropic', source: 'user', adapterKind: 'anthropic', baseUrl: 'https://api.anthropic.com', modelId: 'claude-sonnet', enabled: true, credentialPresent: true, createdAt: iso(NOW - 20 * DAY), updatedAt: iso(NOW - 6 * DAY) },
  { id: 'conn-env', name: 'minimax-cn', source: 'deployment-env', adapterKind: 'openai-compatible', baseUrl: 'https://api.minimax.chat/v1', modelId: 'MiniMax-M3', enabled: true, credentialPresent: true, createdAt: iso(NOW - 40 * DAY), updatedAt: iso(NOW - 40 * DAY) }
];

// models.dev snapshot stand-in for the Add-connection provider/model pickers.
const catalogProviders: CatalogProviderItem[] = [
  { providerId: 'openai', name: 'OpenAI', npm: '@ai-sdk/openai' },
  { providerId: 'anthropic', name: 'Anthropic', npm: '@ai-sdk/anthropic' },
  { providerId: 'openrouter', name: 'OpenRouter', api: 'https://openrouter.ai/api/v1', npm: '@openrouter/ai-sdk-provider' },
  { providerId: 'deepseek', name: 'DeepSeek', api: 'https://api.deepseek.com', npm: '@ai-sdk/openai-compatible' },
  { providerId: 'minimax-cn', name: 'MiniMax (minimax.cn)', api: 'https://api.minimax.cn/anthropic/v1', npm: '@ai-sdk/anthropic' },
  { providerId: 'zhipuai', name: 'Zhipu AI', api: 'https://open.bigmodel.cn/api/paas/v4', npm: '@ai-sdk/openai-compatible' }
];
const catalogModels: CatalogModelItem[] = [
  { modelId: 'gpt-5.4', providerId: 'openai', name: 'GPT-5.4', status: 'active', capabilities: ['input:text', 'output:text', 'tool_call'], releaseDate: '2026-03-05' },
  { modelId: 'gpt-5.4-mini', providerId: 'openai', name: 'GPT-5.4 mini', status: 'active', capabilities: ['input:text', 'output:text'], releaseDate: '2026-03-05' },
  { modelId: 'gpt-4o-mini', providerId: 'openai', name: 'GPT-4o mini', status: 'deprecated', capabilities: ['input:text', 'output:text'], releaseDate: '2024-07-18' },
  { modelId: 'claude-opus-4-5', providerId: 'anthropic', name: 'Claude Opus 4.5 (latest)', status: 'active', capabilities: ['input:text', 'output:text', 'tool_call'], releaseDate: '2025-11-24' },
  { modelId: 'claude-haiku-4-5', providerId: 'anthropic', name: 'Claude Haiku 4.5 (latest)', status: 'active', capabilities: ['input:text', 'output:text'], releaseDate: '2025-10-15' },
  { modelId: 'anthropic/claude-opus-4-5', providerId: 'openrouter', name: 'Claude Opus 4.5', status: 'active', capabilities: ['input:text', 'output:text'], releaseDate: '2025-11-24', effectiveBaseUrl: 'https://openrouter.ai/api/v1' },
  { modelId: 'deepseek/deepseek-chat', providerId: 'openrouter', name: 'DeepSeek V3', status: 'active', capabilities: ['input:text', 'output:text'], releaseDate: '2025-12-01', effectiveBaseUrl: 'https://openrouter.ai/api/v1' },
  { modelId: 'deepseek-chat', providerId: 'deepseek', name: 'DeepSeek Chat', status: 'active', capabilities: ['input:text', 'output:text'], releaseDate: '2025-09-29' },
  { modelId: 'deepseek-reasoner', providerId: 'deepseek', name: 'DeepSeek Reasoner', status: 'active', capabilities: ['input:text', 'output:text'], releaseDate: '2025-09-29' },
  { modelId: 'MiniMax-M3', providerId: 'minimax-cn', name: 'MiniMax M3', status: 'active', capabilities: ['input:text', 'output:text'], releaseDate: '2026-01-10', effectiveBaseUrl: 'https://api.minimax.cn/anthropic/v1' },
  { modelId: 'MiniMax-M2.1', providerId: 'minimax-cn', name: 'MiniMax M2.1', status: 'active', capabilities: ['input:text', 'output:text'], releaseDate: '2025-11-20', effectiveBaseUrl: 'https://api.minimax.cn/anthropic/v1' },
  { modelId: 'glm-5', providerId: 'zhipuai', name: 'GLM-5', status: 'active', capabilities: ['input:text', 'output:text'], releaseDate: '2026-01-15' },
  { modelId: 'glm-4.6', providerId: 'zhipuai', name: 'GLM-4.6', status: 'deprecated', capabilities: ['input:text', 'output:text'], releaseDate: '2025-10-30' }
];

type MockQuery = Record<string, string | number | boolean | undefined>;
const catalogFilter = <T extends { name: string }>(query: MockQuery, items: readonly T[], text: (item: T) => string, limit: number) => {
  const q = String(query.q ?? '').trim().toLowerCase();
  const matching = items.filter((item) => !q || text(item).toLowerCase().includes(q));
  return { matching, items: matching.slice(0, limit), truncated: matching.length > limit };
};
const limitOf = (query: MockQuery, fallback: number) => Math.min(Math.max(Number(query.limit ?? fallback) || fallback, 1), 100);

/** Resolve a GET path to demo data. Returns undefined for unknown paths. */
export function mockGet(path: string, query: MockQuery = {}): unknown {
  const p = path.split('?')[0]!;
  const m = (re: RegExp) => p.match(re);
  if (p === '/livez') return { status: 'alive' };
  if (p === '/readyz') return { status: 'ready', mode: 'mock' };
  if (p === '/v1/chat/sessions') return { schemaVersion: '1', items: mockSessions, nextCursor: null };
  let r = m(/^\/v1\/chat\/sessions\/([^/]+)\/events$/); if (r) return { events: eventsBySession.get(decodeURIComponent(r[1]!)) ?? [] };
  r = m(/^\/v1\/chat\/sessions\/([^/]+)$/); if (r) {
    const id = decodeURIComponent(r[1]!); const s = mockSessions.find((x) => x.sessionId === id);
    return s ? { session: s, messages: messagesBySession.get(id) ?? [], runs: runsBySession.get(id) ?? [], summaries: [] } : undefined;
  }
  if (p === '/v1/tasks') return { tasks: mockTasks };
  r = m(/^\/v1\/tasks\/([^/]+)\/events$/); if (r) {
    const t = mockTasks.find((x) => x.taskId === decodeURIComponent(r![1]!)); const base = new Date(String(t?.projectionUpdatedAt ?? iso(NOW))).getTime() - 600_000;
    return { events: ['task.created', 'task.routed', 'attempt.started', 'checkpoint.saved', 'tool.completed', `task.${t?.status ?? 'succeeded'}`].map((type, i) => ({ eventId: `evt-${i}`, type, occurredAt: iso(base + i * 95_000) })) };
  }
  r = m(/^\/v1\/tasks\/([^/]+)\/run-logs$/); if (r) return { attempts: [{ runId: 'run-1', attemptId: 'attempt-1' }], selected: { runId: 'run-1', attemptId: 'attempt-1' }, events: ['agent.started', 'model.request', 'model.response', 'tool.call', 'tool.result', 'agent.completed'].map((type, i) => ({ eventId: `rl-${i}`, runId: 'run-1', attemptId: 'attempt-1', sequence: i + 1, type, payload: { tokens: 120 + i * 37 } })) };
  r = m(/^\/v1\/tasks\/([^/]+)\/artifacts$/); if (r) return { artifacts: [{ artifactId: 'art-1', name: 'briefing.md', mediaType: 'text/markdown', sizeBytes: 4182 }, { artifactId: 'art-2', name: 'output.json', mediaType: 'application/json', sizeBytes: 912 }] };
  r = m(/^\/v1\/tasks\/([^/]+)\/artifacts\/([^/]+)$/); if (r) return { artifactId: r[2], name: 'briefing.md', mediaType: 'text/markdown', content: '# Morning brief\n\nUSD/CNY 7.12 …', encoding: 'utf8' };
  r = m(/^\/v1\/tasks\/([^/]+)$/); if (r) return mockTasks.find((x) => x.taskId === decodeURIComponent(r![1]!));
  if (p === '/v1/apps') return { apps: [
    { appId: 'finance-briefing', status: 'active', releaseCount: 3, latestVersion: '2.0.0', createdAt: iso(NOW - 30 * DAY), updatedAt: iso(NOW - 3 * DAY) },
    { appId: 'release-notes', status: 'active', releaseCount: 5, latestVersion: '1.4.2', createdAt: iso(NOW - 25 * DAY), updatedAt: iso(NOW - DAY) },
    { appId: 'incident-summary', status: 'active', releaseCount: 2, latestVersion: '0.9.0', createdAt: iso(NOW - 9 * DAY), updatedAt: iso(NOW - 4 * DAY) },
    { appId: 'data-sync', status: 'disabled', releaseCount: 1, latestVersion: '0.1.0', createdAt: iso(NOW - 6 * DAY), updatedAt: iso(NOW - 6 * DAY) }
  ] };
  r = m(/^\/v1\/apps\/([^/]+)$/); if (r) return { appId: r[1], status: 'active', createdAt: iso(NOW - 30 * DAY), manifest: { id: r[1], version: '2.0.0', description: 'Daily cross-market briefing generated from FX and index data sources.', entry: 'prompts/system.md', modelRoute: { provider: 'minimax-cn', model: 'MiniMax-M3' }, skillRefs: ['skill://finance-brief/v1'], capabilityRefs: ['capability://web-snapshot-reader/v1'], inputs: [{ name: 'focus', type: 'string', required: false }], dataSources: [{ name: 'fx-rates', url: 'https://api.frankfurter.dev/v1/latest' }], tasks: [{ name: 'finance-brief', entry: 'prompts/system.md' }] }, assets: [{ relativePath: 'prompts/system.md', kind: 'prompt', digest: `sha256:${hex(64)}`, bytes: 2306, preview: 'You are a finance analyst…' }] };
  if (p === '/v1/packages') return { packages: [
    { packageId: 'finance-briefing', latestVersion: '2.0.0', releaseCount: 3, latestContentDigest: `sha256:${hex(64)}`, updatedAt: iso(NOW - 3 * DAY) },
    { packageId: 'release-notes', latestVersion: '1.4.2', releaseCount: 5, latestContentDigest: `sha256:${hex(64)}`, updatedAt: iso(NOW - DAY) }
  ] };
  r = m(/^\/v1\/packages\/([^/]+)$/); if (r) return { packageId: r[1], releases: [] };
  if (p === '/v1/schedules') return { schemaVersion: 'ScheduleListResult.v1', schedules: mockSchedules };
  r = m(/^\/v1\/schedules\/([^/]+)\/triggers$/); if (r) return { schemaVersion: 'ScheduleTriggerHistory.v1', scheduleId: r[1], events: mockTriggers[decodeURIComponent(r[1]!)] ?? [] };
  r = m(/^\/v1\/schedules\/([^/]+)$/); if (r) return mockSchedules.find((s) => s.definition.scheduleId === decodeURIComponent(r![1]!));
  if (p === '/v1/provider-connections') return { schemaVersion: 'ProviderConnections.v1', connections: providers };
  if (p === '/v1/run-agent/settings') return { schemaVersion: 'RunAgentSettings.v2', unset: false, providerConnectionId: 'conn-openai', updatedAt: iso(NOW - 2 * DAY), updatedBy: 'principal://demo', providers: providers.map((x) => ({ id: x.id, name: x.name, available: true })) };
  if (p === '/v1/provider-catalog/status') return { source: 'models-dev', availability: 'available', projection: 'ready', providerCount: catalogProviders.length, modelCount: catalogModels.length, lastSuccessAt: iso(NOW - 6 * 3_600_000), nextSyncAt: iso(NOW + 18 * 3_600_000) };
  if (p === '/v1/provider-catalog/providers') {
    const { items, truncated } = catalogFilter(query, catalogProviders, (item) => `${item.name}\n${item.providerId}`, limitOf(query, 50));
    return { schemaVersion: '1', snapshotId: 'mock-snapshot-models-dev', activeSince: iso(NOW - 8 * DAY), stale: false, items, ...(truncated ? { nextCursor: 'mock-next' } : {}) };
  }
  if (p === '/v1/provider-catalog/models') {
    const providerId = String(query.providerId ?? '');
    const status = String(query.status ?? 'active');
    const scoped = catalogModels.filter((item) => (providerId === '' || item.providerId === providerId) && (status === 'all' || item.status === status));
    const { items, truncated } = catalogFilter(query, scoped, (item) => `${item.name}\n${item.modelId}`, limitOf(query, 50));
    return { schemaVersion: '1', snapshotId: 'mock-snapshot-models-dev', activeSince: iso(NOW - 8 * DAY), stale: false, items, ...(truncated ? { nextCursor: 'mock-next' } : {}) };
  }
  return undefined;
}

/** Resolve a non-mutating POST (connection probe) to demo data; writes stay rejected client-side. */
export function mockPost(path: string, body?: unknown): unknown {
  const p = path.split('?')[0]!;
  if (p === '/v1/provider-catalog/check-connection') {
    const apiKey = (body as { apiKey?: string } | undefined)?.apiKey;
    return apiKey ? { status: 'connected', checkedAt: iso(NOW), message: 'Connected' } : { status: 'unauthorized', checkedAt: iso(NOW), message: 'API key was rejected' };
  }
  return undefined;
}

/** Mock "provider usage" — runs attributed to connections (not available from the real API). */
export const mockProviderUsage = [{ name: 'openai-prod', value: 182 }, { name: 'anthropic', value: 97 }, { name: 'minimax-cn', value: 41 }];

/** Deterministic pseudo-usage series for mock mode (sparklines, provider metrics). */
export function mockSeries(seed: string, n: number, base = 6): number[] {
  let h = 2166136261; for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const r = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 1000) / 1000; };
  return Array.from({ length: n }, (_, i) => Math.max(0, Math.round(base * (0.55 + r() * 0.9) * (0.75 + (i / n) * 0.5))));
}
export const mockTokensPerRun = 3_800;
export const mockCostPer1k = 0.0042;
