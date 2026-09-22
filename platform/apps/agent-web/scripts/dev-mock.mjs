// 开发辅助 mock API（仅本地视觉验证与联调，不属于产品运行时）。
// 运行：node scripts/dev-mock.mjs  （监听 127.0.0.1:9613）
// 配套：SAGE_API_PROXY_TARGET=http://127.0.0.1:9613 pnpm --filter @sage/agent-web dev
// 注意：9610 通常是真实 agent-api，9611/9612 常被本地栈与 dev server 占用。
import { createServer } from 'node:http'

const json = (res, status, body) => {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(text)
}

const now = () => new Date().toISOString()
const minutesAgo = (n) => new Date(Date.now() - n * 60_000).toISOString()
const hoursAgo = (n) => new Date(Date.now() - n * 3_600_000).toISOString()

// ---------- Chat ----------

const sessions = [
  {
    schemaVersion: '1', sessionId: 'ses-trending-report', status: 'open',
    title: 'GitHub trending 解读', preview: '帮我总结这周 trending 的共性…',
    createdAt: hoursAgo(26), updatedAt: minutesAgo(12), retentionEligibleAt: hoursAgo(-720),
  },
  {
    schemaVersion: '1', sessionId: 'ses-risk-audit', status: 'open',
    title: '风险排查：provider 配额',
    createdAt: hoursAgo(50), updatedAt: hoursAgo(3), retentionEligibleAt: hoursAgo(-720),
  },
  {
    schemaVersion: '1', sessionId: 'ses-finance-brief', status: 'closed',
    title: '财经简报 9/22', preview: '已生成简报，汇率部分见产物。',
    createdAt: hoursAgo(70), updatedAt: hoursAgo(30), retentionEligibleAt: hoursAgo(-720),
  },
  {
    schemaVersion: '1', sessionId: 'ses-refactor-plan', status: 'open',
    createdAt: hoursAgo(90), updatedAt: hoursAgo(48), retentionEligibleAt: hoursAgo(-720),
  },
  {
    schemaVersion: '1', sessionId: 'ses-old-archived', status: 'closed',
    title: '旧版生命周期探针验证', preview: 'probe 输出符合预期。',
    archivedAt: hoursAgo(100), createdAt: hoursAgo(200), updatedAt: hoursAgo(100),
    retentionEligibleAt: hoursAgo(-720),
  },
  {
    schemaVersion: '1', sessionId: 'ses-long-running', status: 'open',
    title: '长任务：索引重建', preview: '索引重建进行中，预计 40 分钟。',
    createdAt: hoursAgo(10), updatedAt: minutesAgo(2), retentionEligibleAt: hoursAgo(-720),
  },
]

function baseTimeline(sessionId) {
  return [
    {
      schemaVersion: '1', sessionId, runId: 'run-1', sequence: 1,
      occurredAt: hoursAgo(5), payload: { kind: 'text', text: 'Summarize project.', messageId: 'msg-u1', promotionEligibility: 'explicit' },
    },
    {
      schemaVersion: '1', sessionId, runId: 'run-1', sequence: 2,
      occurredAt: hoursAgo(5), payload: { kind: 'run', status: 'succeeded', attempt: 1 },
    },
    {
      schemaVersion: '1', sessionId, runId: 'run-1', sequence: 3,
      occurredAt: hoursAgo(5), payload: { kind: 'text', text: '## 概览\n\n项目本周有 **3 个重点**：\n\n- 索引重建管线\n- provider catalog 刷新\n- `effect` 裁决链路\n\n详见 <https://example.com/report>。' },
    },
    {
      schemaVersion: '1', sessionId, runId: 'run-2', sequence: 4,
      occurredAt: hoursAgo(4), payload: { kind: 'text', text: 'Create a Task', messageId: 'msg-u2', promotionEligibility: 'explicit' },
    },
    {
      schemaVersion: '1', sessionId, runId: 'run-2', sequence: 5,
      occurredAt: hoursAgo(4), payload: { kind: 'run', status: 'failed', attempt: 1 },
    },
    {
      schemaVersion: '1', sessionId, runId: 'run-2', sequence: 6,
      occurredAt: hoursAgo(4), payload: { kind: 'error', error: { code: 'CHAT_AGENT_FAILED', message: '模型调用超时，可重试。', retryable: true } },
    },
    {
      schemaVersion: '1', sessionId, runId: 'run-3', sequence: 7,
      occurredAt: minutesAgo(30), payload: { kind: 'text', text: '帮我盯一下索引重建的进度', messageId: 'msg-u3', promotionEligibility: 'explicit' },
    },
    {
      schemaVersion: '1', sessionId, runId: 'run-3', sequence: 8,
      occurredAt: minutesAgo(30), payload: { kind: 'tool', toolName: 'task.watch', status: 'completed', artifact: { artifactRef: 'artifact://watch/report.json', name: 'watch-report.json', mediaType: 'application/json', sizeBytes: 4096 } },
    },
    {
      schemaVersion: '1', sessionId, runId: 'run-3', sequence: 9,
      occurredAt: minutesAgo(29), payload: { kind: 'task', title: '索引重建监控', status: 'running', taskId: 'task-watch-1', reason: '已路由到 durable 执行' },
    },
    {
      schemaVersion: '1', sessionId, runId: 'run-3', sequence: 10,
      occurredAt: minutesAgo(29), payload: { kind: 'run', status: 'active', attempt: 1 },
    },
    {
      schemaVersion: '1', sessionId, runId: 'run-4', sequence: 11,
      occurredAt: minutesAgo(8), payload: { kind: 'text', text: '<think>用户想要一个风险清单，先列外部依赖。</think>\n1. **catalog sync** 的 429 频率限制\n2. archive 上传的 8MiB 上限\n\n| 风险 | 等级 |\n| --- | --- |\n| catalog 429 | 中 |\n| 上传超限 | 低 |', messageId: 'msg-u4' },
    },
    {
      schemaVersion: '1', sessionId, runId: 'run-4', sequence: 12,
      occurredAt: minutesAgo(8), payload: { kind: 'run', status: 'succeeded', attempt: 1 },
    },
  ]
}

const timelines = new Map(sessions.map((s) => [s.sessionId, baseTimeline(s.sessionId)]))
let liveSequence = 100

// ---------- Tasks ----------

const tasks = [
  {
    taskId: 'task-watch-1', taskType: 'sage.agent-task.v1', workflowId: 'wf-watch-1', targetId: 'target/local-1',
    attempt: 1, status: 'running', revision: 3, projectionUpdatedAt: minutesAgo(1), freshness: 'fresh',
    sessionId: 'ses-trending-report', runId: 'run-3',
    targetSnapshot: { targetId: 'target/local-1', environment: 'local', namespace: 'default', taskQueue: 'agent-tasks' },
  },
  {
    taskId: 'task-index-rebuild', taskType: 'sage.agent-task.v1', workflowId: 'wf-idx-9', targetId: 'target/local-1',
    attempt: 2, status: 'paused', revision: 7, projectionUpdatedAt: minutesAgo(15), freshness: 'fresh',
    targetSnapshot: { targetId: 'target/local-1', environment: 'local', namespace: 'default', taskQueue: 'agent-tasks' },
  },
  {
    taskId: 'task-finance-0919', taskType: 'sage.batch-agent-task.v1', workflowId: 'wf-fin-3', targetId: 'target/batch-2',
    attempt: 1, status: 'succeeded', revision: 2, projectionUpdatedAt: hoursAgo(30), freshness: 'stale', staleReason: 'projection lag detected',
    sessionId: 'ses-finance-brief', targetSnapshot: { targetId: 'target/batch-2', environment: 'local', namespace: 'default', taskQueue: 'batch-tasks' },
  },
  {
    taskId: 'task-legacy-import', taskType: 'sage.agent-task.v1', workflowId: 'wf-leg-2', targetId: 'target/legacy',
    attempt: 3, status: 'failed', revision: 5, projectionUpdatedAt: hoursAgo(8), freshness: 'fresh',
    failureCode: 'TOOL_EGRESS_DENIED', failureDetail: '工具访问外部地址被拒绝：api.legacy.example.com',
    targetSnapshot: { targetId: 'target/legacy', environment: 'local', namespace: 'default', taskQueue: 'agent-tasks' },
  },
  {
    taskId: 'task-probe-7', taskType: 'sage.agent-task.v1', workflowId: 'wf-probe-7', targetId: 'target/probe',
    attempt: 1, status: 'cancelled', revision: 1, projectionUpdatedAt: hoursAgo(60), freshness: 'unavailable',
    targetSnapshot: { targetId: 'target/probe', environment: 'local', namespace: 'default', taskQueue: 'probe-tasks' },
  },
  {
    taskId: 'task-fx-resolver', taskType: 'sage.agent-task.v1', workflowId: 'wf-fx-1', targetId: 'target/fx',
    attempt: 1, status: 'effect_unknown', revision: 4, projectionUpdatedAt: minutesAgo(40), freshness: 'fresh',
    targetSnapshot: { targetId: 'target/fx', environment: 'local', namespace: 'default', taskQueue: 'agent-tasks' },
  },
]

const taskEvents = (taskId) => [
  { eventId: `${taskId}-e1`, sequence: 1, kind: 'task', type: 'task.started', occurredAt: hoursAgo(2), payload: { taskId } },
  { eventId: `${taskId}-e2`, sequence: 2, kind: 'agent', type: 'model.completed', occurredAt: hoursAgo(2), payload: { model: 'claude-sonnet-4' } },
  { eventId: `${taskId}-e3`, sequence: 3, kind: 'agent', type: 'tool.completed', occurredAt: hoursAgo(1), payload: { tool: 'fs.read', path: 'data/snapshot.json' } },
  { eventId: `${taskId}-e4`, sequence: 4, kind: 'agent', type: 'checkpoint.sealed', occurredAt: minutesAgo(30), payload: { checkpoint: 'checkpoint://c-1' } },
]

const runLogs = {
  attempts: [
    { runId: 'run-a', attemptId: 'attempt-1', lastWrittenAt: hoursAgo(2) },
    { runId: 'run-a', attemptId: 'attempt-2', lastWrittenAt: minutesAgo(20) },
  ],
  selected: { runId: 'run-a', attemptId: 'attempt-2' },
  events: [
    { eventId: 'l1', sequence: 1, type: 'model.completed', occurredAt: hoursAgo(2), payload: { model: 'claude-sonnet-4', tokensIn: 1200, tokensOut: 320 }, receipts: [], artifacts: [] },
    { eventId: 'l2', sequence: 2, type: 'tool.completed', occurredAt: hoursAgo(2), payload: { tool: 'fs.read', ms: 12 }, receipts: [{}], artifacts: [] },
    { eventId: 'l3', sequence: 3, type: 'checkpoint.sealed', occurredAt: minutesAgo(30), payload: { checkpoint: 'checkpoint://c-1' }, receipts: [], artifacts: [{}] },
    { eventId: 'l4', sequence: 4, type: 'run.completed', occurredAt: minutesAgo(20), payload: { status: 'succeeded' }, receipts: [], artifacts: [] },
  ],
  nextFromSequence: undefined,
}

const artifacts = [
  { artifactId: 'art-1', artifactRef: 'artifact://pkg/output.tar.gz', name: 'output.tar.gz', mediaType: 'application/gzip' },
  { artifactId: 'art-2', artifactRef: 'artifact://report/summary.md', name: 'summary.md', mediaType: 'text/markdown' },
  { artifactId: 'art-3', artifactRef: 'artifact://report/data.json', name: 'data.json', mediaType: 'application/json' },
]

// ---------- Providers ----------

const connections = [
  {
    id: 'conn-anthropic', name: 'Anthropic · Claude Sonnet 4', source: 'user', adapterKind: 'anthropic',
    baseUrl: 'https://api.anthropic.com', modelId: 'claude-sonnet-4-20250514', providerName: 'Anthropic',
    modelName: 'Claude Sonnet 4', enabled: true, credentialPresent: true,
  },
  {
    id: 'conn-openai', name: 'OpenAI Compatible · Local', source: 'user', adapterKind: 'openai-compatible',
    baseUrl: 'https://llm.local.example.com/v1', modelId: 'qwen3-coder', enabled: true, credentialPresent: false,
  },
  {
    id: 'conn-deploy', name: 'Deployment · Shared Key', source: 'deployment-env', adapterKind: 'anthropic',
    baseUrl: 'https://api.anthropic.com', modelId: 'claude-haiku-4-20250414', enabled: true, credentialPresent: true,
  },
]

const catalogProviders = {
  schemaVersion: '1', snapshotId: 'snap-1', activeSince: hoursAgo(24), stale: false,
  items: [
    { providerId: 'anthropic', name: 'Anthropic', api: 'https://api.anthropic.com' },
    { providerId: 'openai', name: 'OpenAI', api: 'https://api.openai.com/v1' },
    { providerId: 'google', name: 'Google Gemini', api: 'https://generativelanguage.googleapis.com' },
    { providerId: 'mistral', name: 'Mistral', api: 'https://api.mistral.ai' },
  ],
}

const catalogModels = {
  schemaVersion: '1', snapshotId: 'snap-1', activeSince: hoursAgo(24), stale: false,
  items: [
    { modelId: 'claude-sonnet-4-20250514', providerId: 'anthropic', name: 'Claude Sonnet 4', status: 'active', capabilities: ['tools', 'vision'], effectiveBaseUrl: 'https://api.anthropic.com' },
    { modelId: 'claude-haiku-4-20250414', providerId: 'anthropic', name: 'Claude Haiku 4', status: 'active', capabilities: ['tools'], effectiveBaseUrl: 'https://api.anthropic.com' },
    { modelId: 'gpt-4.1', providerId: 'openai', name: 'GPT-4.1', status: 'active', capabilities: ['tools'], effectiveBaseUrl: 'https://api.openai.com/v1' },
    { modelId: 'gemini-2.5-pro', providerId: 'google', name: 'Gemini 2.5 Pro', status: 'active', capabilities: ['tools', 'vision'], effectiveBaseUrl: 'https://generativelanguage.googleapis.com' },
  ],
}

// ---------- Apps ----------

const appDetail = {
  appId: 'github-trending', name: 'GitHub Trending',
  description: 'Reads the real GitHub trending snapshot and produces an interpretation report.',
  status: 'active', createdAt: hoursAgo(100),
  manifest: {
    version: '0.2.0', description: 'Trending report generator', entry: 'prompts/system.md',
    modelRoute: { provider: 'any', model: 'any' },
    skillRefs: ['web.fetch', 'report.write'], capabilityRefs: ['fs.read', 'fs.write'],
    inputs: [
      { name: 'language', type: 'string', required: false, default: 'any' },
      { name: 'depth', type: 'number', required: false, default: 10 },
      { name: 'focus', type: 'string', required: false, enum: ['repositories', 'developers'] },
    ],
    dataSources: [{ name: 'trending-snapshot', onFailure: 'fail' }],
    tasks: [{ name: 'report' }, { name: 'quick-scan' }],
  },
  assets: [
    { relativePath: 'app.yaml', kind: 'manifest', bytes: 812, digest: 'sha256:aa11…', preview: 'id: github-trending\nversion: 0.2.0\nentry: prompts/system.md' },
    { relativePath: 'prompts/system.md', kind: 'prompt', bytes: 2048, digest: 'sha256:bb22…', preview: 'You read the trending snapshot and write a report…' },
    { relativePath: 'dist/index.wasm', kind: 'binary', bytes: 1_812_334, digest: 'sha256:cc33…' },
  ],
  releases: [
    { releaseId: 'rel-2', packageVersion: '0.2.0', compilerBuild: 'sagec 1.4.2', contentDigest: 'sha256:9f2c…e1', createdAt: hoursAgo(20) },
    { releaseId: 'rel-1', packageVersion: '0.1.0', compilerBuild: 'sagec 1.4.0', contentDigest: 'sha256:1ab8…77', createdAt: hoursAgo(90) },
  ],
}

const apps = [
  { appId: 'github-trending', name: 'GitHub Trending', description: appDetail.description, releaseCount: 2, latestVersion: '0.2.0', latestContentDigest: 'sha256:9f2c…e1', updatedAt: hoursAgo(20) },
  { appId: 'finance-briefing', name: 'Finance Briefing', description: 'Reads exchange-rate and index snapshots and produces a finance briefing.', releaseCount: 1, latestVersion: '0.1.0', updatedAt: hoursAgo(60) },
  { appId: 'lifecycle-probe', name: 'Lifecycle Probe', description: 'Lifecycle pipeline probe with no inputs and fixed output.', releaseCount: 3, latestVersion: '1.2.0', updatedAt: hoursAgo(10) },
]

// ---------- Schedules ----------

const schedules = [
  {
    schemaVersion: '1',
    definition: {
      schemaVersion: '1', scheduleId: 'sched-nightly-report', tenantId: 't-local',
      trigger: { kind: 'cron', expression: '0 8 * * *', timezone: 'Asia/Shanghai' },
      overlapPolicy: 'SKIP', misfirePolicy: 'CATCH_UP_ONE',
      releaseBinding: { strategy: 'FIXED', releaseId: 'rel-2', contentDigest: 'sha256:9f2ce1'.padEnd(71, '0') },
      targetConstraints: { allowedEnvironments: ['local'] },
      budget: { limits: [{ dimension: 'runs', limit: 10 }] },
      invocation: { task: 'report' },
    },
    revision: 4, state: 'ACTIVE', contentDigest: 'sha256:a'.padEnd(64, '0'),
    createdAtMs: Date.now() - 86_400_000 * 7, updatedAtMs: Date.now() - 3_600_000,
    nextFireAtMs: Date.now() + 14_400_000,
  },
  {
    schemaVersion: '1',
    definition: {
      schemaVersion: '1', scheduleId: 'sched-fx-snapshot', tenantId: 't-local',
      trigger: { kind: 'interval', everyMs: 1_800_000 },
      overlapPolicy: 'ALLOW', misfirePolicy: 'SKIP',
      releaseBinding: { strategy: 'FOLLOW' },
      targetConstraints: { allowedEnvironments: ['local'] },
      budget: { limits: [{ dimension: 'runs', limit: 100 }] },
      invocation: { task: 'snapshot' },
    },
    revision: 2, state: 'PAUSED', contentDigest: 'sha256:b'.padEnd(64, '0'),
    createdAtMs: Date.now() - 86_400_000 * 3, updatedAtMs: Date.now() - 7_200_000,
  },
]

const triggers = [
  { schemaVersion: '1', scheduleId: 'sched-nightly-report', occurrenceId: 'occ-3', kind: 'SUCCEEDED', occurredAtMs: Date.now() - 86_400_000, taskId: 'task-finance-0919' },
  { schemaVersion: '1', scheduleId: 'sched-nightly-report', occurrenceId: 'occ-2', kind: 'FAILED', occurredAtMs: Date.now() - 172_800_000, errorCode: 'PROVIDER_DEPENDENCY_MISSING' },
  { schemaVersion: '1', scheduleId: 'sched-nightly-report', occurrenceId: 'occ-1', kind: 'MISSED', occurredAtMs: Date.now() - 259_200_000 },
]

// ---------- 路由 ----------

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://mock')
  const path = url.pathname
  const send204 = () => { res.writeHead(204); res.end() }

  if (!path.startsWith('/v1')) return json(res, 404, { error: { code: 'NOT_FOUND', message: 'not found', retryable: false } })

  // Chat sessions
  if (path === '/v1/chat/sessions' && req.method === 'GET') {
    const status = url.searchParams.get('status') ?? 'all'
    const archived = url.searchParams.get('archived') === 'true'
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
    let items = sessions.filter((s) => (archived ? !!s.archivedAt : !s.archivedAt))
    if (status !== 'all') items = items.filter((s) => s.status === status)
    if (q) items = items.filter((s) => (s.title ?? '').toLowerCase().includes(q))
    return json(res, 200, { schemaVersion: '1', items: items.slice(0, 30), nextCursor: undefined })
  }
  if (path === '/v1/chat/sessions' && req.method === 'POST') {
    const session = { schemaVersion: '1', sessionId: `ses-${Date.now()}`, status: 'open', createdAt: now(), updatedAt: now() }
    sessions.unshift(session)
    timelines.set(session.sessionId, [])
    return json(res, 201, session)
  }
  const sessionMatch = path.match(/^\/v1\/chat\/sessions\/([^/]+)(\/(archive|unarchive|messages|events|timeline))?$/)
  if (sessionMatch) {
    const id = decodeURIComponent(sessionMatch[1])
    const session = sessions.find((s) => s.sessionId === id)
    const sub = sessionMatch[3]
    if (!sub && req.method === 'GET') {
      if (!session) return json(res, 404, { error: { code: 'CHAT_SESSION_NOT_FOUND', message: '会话已被 retention 清理', retryable: false } })
      return json(res, 200, { session, messages: [], runs: [], summaries: [] })
    }
    if (sub === 'archive' && req.method === 'POST') { session.archivedAt = now(); return json(res, 200, { session }) }
    if (sub === 'unarchive' && req.method === 'POST') { delete session.archivedAt; return json(res, 200, { session }) }
    if (!sub && req.method === 'DELETE') {
      const idx = sessions.findIndex((s) => s.sessionId === id)
      if (idx >= 0) sessions.splice(idx, 1)
      return send204()
    }
    if (sub === 'events' && req.method === 'GET') {
      const after = Number(url.searchParams.get('afterSequence') ?? '0')
      const events = (timelines.get(id) ?? []).filter((e) => e.sequence > after)
      return json(res, 200, { events })
    }
    if (sub === 'timeline' && req.method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      res.write(':ok\n\n')
      const after = Number(url.searchParams.get('afterSequence') ?? '0')
      for (const event of (timelines.get(id) ?? [])) {
        if (event.sequence > after) res.write(`id: ${event.sequence}\nevent: timeline\ndata: ${JSON.stringify(event)}\n\n`)
      }
      const timer = setInterval(() => {
        liveSequence += 1
        const event = {
          schemaVersion: '1', sessionId: id, runId: 'run-live', sequence: liveSequence,
          occurredAt: now(), payload: { kind: 'text', text: `后台心跳事件 #${liveSequence}` },
        }
        timelines.get(id)?.push(event)
        res.write(`id: ${event.sequence}\nevent: timeline\ndata: ${JSON.stringify(event)}\n\n`)
      }, 5000)
      req.on('close', () => clearInterval(timer))
      return
    }
    if (sub === 'messages' && req.method === 'POST') {
      return json(res, 202, { message: { messageId: `msg-${Date.now()}` }, run: { runId: `run-${Date.now()}` } })
    }
  }
  const retryMatch = path.match(/^\/v1\/chat\/runs\/([^/]+)\/retry$/)
  if (retryMatch && req.method === 'POST') return json(res, 202, { run: { runId: retryMatch[1] } })
  const promoteMatch = path.match(/^\/v1\/chat\/messages\/([^/]+)\/promotions$/)
  if (promoteMatch && req.method === 'POST') {
    return json(res, 202, { association: { taskId: 'task-watch-1' }, task: { taskId: 'task-watch-1' } })
  }

  // Tasks
  if (path === '/v1/tasks' && req.method === 'GET') {
    const status = url.searchParams.get('status')
    const list = status ? tasks.filter((t) => t.status === status) : tasks
    return json(res, 200, { tasks: list })
  }
  const taskMatch = path.match(/^\/v1\/tasks\/([^/]+)(\/(events|artifacts|run-logs|signals|cancel|retry|artifacts\/[^/]+))?$/)
  if (taskMatch) {
    const id = decodeURIComponent(taskMatch[1])
    const task = tasks.find((t) => t.taskId === id)
    const sub = taskMatch[3] ?? ''
    if (!sub && req.method === 'GET') {
      if (!task) return json(res, 404, { error: { code: 'TASK_NOT_FOUND', message: 'task not found', retryable: false } })
      return json(res, 200, task)
    }
    if (sub === 'events') return json(res, 200, { events: taskEvents(id) })
    if (sub === 'artifacts') return json(res, 200, { artifacts })
    if (sub.startsWith('artifacts/') && req.method === 'GET') {
      const artId = decodeURIComponent(sub.split('/')[1])
      const art = artifacts.find((a) => a.artifactId === artId)
      if (!art) return json(res, 404, { error: { code: 'ARTIFACT_NOT_FOUND', message: 'artifact not found', retryable: false } })
      if (art.mediaType === 'application/gzip') return json(res, 200, { artifactId: artId, mediaType: art.mediaType, encoding: 'base64', content: 'H4sIAAAAAAAAA+2RTU7DMBCFr1' })
      return json(res, 200, { artifactId: artId, name: art.name, mediaType: art.mediaType, content: '# 产物摘要\n\n重建完成，共处理 **1,204** 个条目。\n\n- 新增：88\n- 更新：190' })
    }
    if (sub === 'run-logs') return json(res, 200, runLogs)
    if (sub === 'signals' && req.method === 'POST') return json(res, 200, { ok: true })
    if (sub === 'cancel' && req.method === 'POST') { if (task) task.status = 'cancelled'; return json(res, 200, { ok: true }) }
    if (sub === 'retry' && req.method === 'POST') { if (task) task.status = 'running'; return json(res, 200, { ok: true }) }
  }

  // Providers
  if (path === '/v1/run-agent/settings') {
    if (req.method === 'GET') {
      return json(res, 200, {
        schemaVersion: 'RunAgentSettings.v2', unset: false, providerConnectionId: 'conn-anthropic',
        providers: connections.map((c) => ({ id: c.id, name: c.name, available: c.enabled && c.credentialPresent, reason: c.credentialPresent ? undefined : 'credential missing' })),
      })
    }
    if (req.method === 'PUT') return json(res, 200, {
      schemaVersion: 'RunAgentSettings.v2', unset: false, providerConnectionId: 'conn-anthropic',
      providers: connections.map((c) => ({ id: c.id, name: c.name, available: c.enabled && c.credentialPresent, reason: c.credentialPresent ? undefined : 'credential missing' })),
    })
  }
  if (path === '/v1/provider-connections') {
    if (req.method === 'GET') return json(res, 200, { schemaVersion: 'ProviderConnections.v1', connections })
    if (req.method === 'POST') return json(res, 201, { id: `conn-${Date.now()}` })
  }
  const connMatch = path.match(/^\/v1\/provider-connections\/([^/]+)$/)
  if (connMatch) {
    if (req.method === 'PUT') return json(res, 200, { ok: true })
    if (req.method === 'DELETE') return send204()
  }
  if (path === '/v1/provider-catalog/providers') return json(res, 200, catalogProviders)
  if (path === '/v1/provider-catalog/models') return json(res, 200, catalogModels)
  if (path === '/v1/provider-catalog/sync' && req.method === 'POST') return json(res, 200, { attemptId: 'attempt-1' })
  if (path === '/v1/provider-catalog/sync/attempt-1') return json(res, 200, { attemptId: 'attempt-1', status: 'succeeded', trigger: 'manual', queuedAt: now() })

  // Apps
  if (path === '/v1/apps' && req.method === 'GET') return json(res, 200, { apps })
  if (path === '/v1/apps' && req.method === 'POST') return json(res, 201, { appId: 'new-app' })
  const appMatch = path.match(/^\/v1\/apps\/([^/]+)(\/releases)?$/)
  if (appMatch) {
    const id = decodeURIComponent(appMatch[1])
    if (!appMatch[2] && req.method === 'GET') {
      if (id === 'github-trending') return json(res, 200, appDetail)
      const app = apps.find((a) => a.appId === id)
      if (!app) return json(res, 404, { error: { code: 'APP_NOT_FOUND', message: 'app not found', retryable: false } })
      return json(res, 200, {
        appId: app.appId, name: app.name, description: app.description, status: 'active', createdAt: hoursAgo(50),
        manifest: { version: app.latestVersion, entry: 'prompts/system.md', modelRoute: { provider: 'any', model: 'any' }, inputs: [], tasks: [{ name: 'run' }] },
        assets: [], releases: [{ releaseId: `rel-${app.appId}`, packageVersion: app.latestVersion, contentDigest: app.latestContentDigest, createdAt: app.updatedAt }],
      })
    }
    if (!appMatch[2] && req.method === 'DELETE') return send204()
    if (appMatch[2] && req.method === 'POST') return json(res, 201, { releaseId: 'rel-new', packageVersion: '0.3.0' })
  }
  const runMatch = path.match(/^\/v1\/releases\/([^/]+)\/runs$/)
  if (runMatch && req.method === 'POST') {
    return json(res, 200, { schemaVersion: 'PackageRunResult.v1', status: 'admitted', taskId: 'task-watch-1', runId: 'run-new', attemptId: 'attempt-1', releaseId: runMatch[1] })
  }

  // Schedules
  if (path === '/v1/schedules' && req.method === 'GET') return json(res, 200, { schemaVersion: 'ScheduleListResult.v1', schedules })
  const schedMatch = path.match(/^\/v1\/schedules\/([^/]+)(\/(triggers|pause|resume))?$/)
  if (schedMatch) {
    const id = decodeURIComponent(schedMatch[1])
    const sched = schedules.find((s) => s.definition.scheduleId === id)
    const sub = schedMatch[3] ?? ''
    if (!sub && req.method === 'GET') return json(res, 200, sched)
    if (sub === 'triggers') return json(res, 200, { schemaVersion: 'ScheduleTriggerHistory.v1', scheduleId: id, events: triggers })
    if (sub === 'pause' && req.method === 'POST') { if (sched) sched.state = 'PAUSED'; return json(res, 200, { ok: true }) }
    if (sub === 'resume' && req.method === 'POST') { if (sched) sched.state = 'ACTIVE'; return json(res, 200, { ok: true }) }
    if (!sub && req.method === 'DELETE') { if (sched) sched.state = 'DELETED'; return send204() }
  }

  return json(res, 404, { error: { code: 'NOT_FOUND', message: `no mock route for ${req.method} ${path}`, retryable: false } })
})

server.listen(9613, '127.0.0.1', () => {
  console.log('[dev-mock] listening on http://127.0.0.1:9613 (SSE heartbeat every 5s)')
})
