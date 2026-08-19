import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const apiPort = process.env.SAGE_API_HOST_PORT ?? '13000';
const workerPort = process.env.SAGE_WORKER_HEALTH_HOST_PORT ?? '13001';
const webPort = process.env.SAGE_WEB_HOST_PORT ?? '14173';
const api = `http://127.0.0.1:${apiPort}`;
const worker = `http://127.0.0.1:${workerPort}`;
const web = `http://127.0.0.1:${webPort}`;

function compose(args, options = {}) {
  const result = spawnSync('docker', ['compose', ...args], { cwd: root, encoding: 'utf8', stdio: options.quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
  if (result.status !== 0) throw new Error(`docker compose ${args.join(' ')} failed`);
  return result;
}

async function request(url, init = {}) {
  const response = await globalThis.fetch(url, { ...init, signal: globalThis.AbortSignal.timeout(10_000) });
  const text = await response.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* HTML/text response */ }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}: ${typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200)}`);
  return body;
}

async function waitFor(label, fn, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

let failure;
try {
  compose(['config', '--quiet']);
  compose(['up', '-d', '--build', '--wait']);
  const status = compose(['ps', '--format', 'json'], { quiet: true }).stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const expected = new Set(['postgres', 'temporal', 'artifact-store', 'agent-api', 'agent-worker', 'agent-web']);
  if (status.length !== expected.size || status.some((service) => !expected.has(service.Service) || service.State !== 'running' || !service.Status.includes('(healthy)'))) {
    throw new Error(`Compose services are not all healthy: ${status.map((service) => `${service.Service}:${service.Status}`).join(', ')}`);
  }
  await request(`${api}/livez`);
  await request(`${api}/readyz`);
  const workerReady = await request(`${worker}/readyz`);
  if (workerReady.namespace !== 'sage-dev' || workerReady.taskQueue !== 'sage-agent-task-v1') throw new Error('Worker readiness contract mismatch');
  await request(`${web}/`);

  const session = await request(`${api}/v1/chat/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'local smoke' }) });
  const accepted = await request(`${api}/v1/chat/sessions/${encodeURIComponent(session.sessionId)}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parts: [{ kind: 'text', text: 'local smoke message' }] })
  });
  const conversation = await waitFor('Chat Run succeeded', async () => {
    const value = await request(`${api}/v1/chat/sessions/${encodeURIComponent(session.sessionId)}`);
    return value.runs.some((run) => run.runId === accepted.run.runId && run.status === 'succeeded') ? value : undefined;
  });
  if (!conversation.messages.some((message) => message.role === 'assistant')) throw new Error('Chat assistant message missing');

  const promoted = await request(`${api}/v1/chat/messages/${encodeURIComponent(accepted.message.messageId)}/promotions`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-authentication-id': 'local-dev-auth' }, body: JSON.stringify({ mode: 'explicit', taskType: 'sage.agent-task.v1' })
  });
  const taskId = promoted.association.taskId;
  const task = await waitFor('Task succeeded', async () => {
    const value = await request(`${api}/v1/tasks/${encodeURIComponent(taskId)}`, { headers: { 'x-authentication-id': 'local-dev-auth' } });
    return value.status === 'succeeded' ? value : undefined;
  });
  if (task.targetSnapshot.taskQueue !== 'sage-agent-task-v1') throw new Error('Task queue contract mismatch');
  const proxied = await request(`${web}/v1/chat/sessions/${encodeURIComponent(session.sessionId)}/events?afterSequence=0`);
  if (!Array.isArray(proxied.events)) throw new Error('Web API proxy response missing events');
  process.stdout.write(`local smoke passed: session=${session.sessionId} task=${taskId}\n`);
} catch (error) {
  failure = error;
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  try {
    compose(['ps']);
    compose(['logs', '--tail=80', 'agent-api', 'agent-worker', 'agent-web']);
  } catch { /* preserve the original failure */ }
} finally {
  if (process.env.SMOKE_KEEP_SERVICES !== '1') {
    try { compose(['down', '--remove-orphans']); } catch (error) { if (!failure) failure = error; }
  }
}
if (failure) process.exitCode = 1;
