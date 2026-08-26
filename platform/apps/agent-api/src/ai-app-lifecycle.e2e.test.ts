import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { assemblePackageInput } from '@sage/agent-run-admission';

/**
 * AI App 全生命周期端到端验证：创建 App → 提交 Release → 发起运行 → 产物管理。
 * 以真实 HTTP 入口打已启动的本地开发栈（api/worker 均需 SAGE_FAKE_LIVE_PROVIDER=true），
 * 输出由进程内 fake live provider 确定性回放（`已收到：<user message>`）。
 *
 * 运行方式（默认跳过，避免污染常规测试）：
 *   corepack pnpm test:ai-app-e2e   # 等价于 SAGE_AI_APP_E2E=1 vitest run 本文件
 * 可选环境变量：SAGE_E2E_API_URL（默认 http://127.0.0.1:9610）、SAGE_E2E_WORKER_URL（默认 http://127.0.0.1:9611）。
 */

const apiBase = process.env.SAGE_E2E_API_URL ?? 'http://127.0.0.1:9610';
const workerBase = process.env.SAGE_E2E_WORKER_URL ?? 'http://127.0.0.1:9611';
const AUTH_HEADERS = { 'content-type': 'application/json', 'x-authentication-id': 'local-dev-auth' };
const APP_ID = 'lifecycle-probe';
const USER_INPUT = 'lifecycle-probe e2e marker: 创建/提交/运行/产物管理全链路验证';
const sampleRoot = fileURLToPath(new URL('../../../examples/ai-apps/lifecycle-probe', import.meta.url));

const e2e = describe.skipIf(process.env.SAGE_AI_APP_E2E !== '1');

type JsonObject = Record<string, unknown>;
interface HttpResult {
  readonly status: number;
  readonly body: unknown;
}

const asObject = (value: unknown): JsonObject =>
  (typeof value === 'object' && value !== null ? value as JsonObject : {});

/** 阶段包装：任一阶段失败都抛出标明阶段与响应摘要的错误，而非笼统异常。 */
async function stage<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (cause) {
    throw new Error(`[stage:${name}] ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

async function request(path: string, init: RequestInit = {}, base: string = apiBase): Promise<HttpResult> {
  const response = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
  const text = await response.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* 保留原文 */ }
  return { status: response.status, body };
}

function summarize(result: HttpResult): string {
  return typeof result.body === 'string' ? result.body.slice(0, 300) : JSON.stringify(result.body).slice(0, 300);
}

function expectOk(result: HttpResult, expected: readonly number[], action: string): void {
  expect(expected, `${action} 返回 ${result.status}: ${summarize(result)}`).toContain(result.status);
}

e2e('AI App 全生命周期端到端验证（live stack + fake provider）', () => {
  beforeAll(async () => {
    const api = await request('/readyz', {}, apiBase).catch((cause: unknown) => ({ status: 0, body: String(cause) }));
    const apiMode = asObject(asObject(api.body).providerExecution).mode;
    if (api.status !== 200 || apiMode !== 'fake') {
      throw new Error(`[stage:preflight] agent-api 未就绪或未启用 fake provider（${apiBase}/readyz → ${api.status}）：请注入 SAGE_FAKE_LIVE_PROVIDER=true 重启本地栈`);
    }
    const worker = await request('/readyz', {}, workerBase).catch((cause: unknown) => ({ status: 0, body: String(cause) }));
    const workerMode = asObject(asObject(worker.body).providerExecution).mode;
    if (worker.status !== 200 || workerMode !== 'fake') {
      throw new Error(`[stage:preflight] agent-worker 未就绪或未启用 fake provider（${workerBase}/readyz → ${worker.status}）：请注入 SAGE_FAKE_LIVE_PROVIDER=true 重启本地栈`);
    }
  });

  it('走通创建 → 提交 → 运行 → 产物管理并对每阶段断言', { timeout: 180_000 }, async () => {
    // 前置：seed 工作区 provider + 运行 agent 设置（包运行准入硬要求 provider 依赖，fake 模式下同样校验）。
    await stage('seed-provider', async () => {
      const created = await request('/v1/provider-connections', {
        method: 'POST', headers: AUTH_HEADERS,
        body: JSON.stringify({ name: 'ai-app-e2e provider', adapterKind: 'anthropic', baseUrl: 'https://api.minimaxi.com/anthropic', modelId: 'MiniMax-M3', apiKey: 'ai-app-e2e-fake-key' })
      });
      expectOk(created, [201], '创建 provider connection');
      const connectionId = asObject(asObject(created.body).connection).id as string;
      const settings = await request('/v1/run-agent/settings', {
        method: 'PUT', headers: AUTH_HEADERS,
        body: JSON.stringify({ providerConnectionId: connectionId })
      });
      expectOk(settings, [200], '设置运行 agent provider');
    });

    // 阶段一：创建 App 主体（先幂等清理同名 App；软删除后重建被拒则沿用既有 active App）。
    await stage('create-app', async () => {
      await request(`/v1/apps/${APP_ID}`, { method: 'DELETE', headers: AUTH_HEADERS });
      const created = await request('/v1/apps', {
        method: 'POST', headers: AUTH_HEADERS,
        body: JSON.stringify({ appId: APP_ID, name: 'Lifecycle Probe', description: 'AI App 全生命周期端到端验证专用测试应用' })
      });
      const createdBody = asObject(created.body);
      if (created.status === 201) {
        expect(createdBody.appId).toBe(APP_ID);
        expect(createdBody.status).toBe('active');
        return;
      }
      expect(created.status, `创建 App 返回 ${created.status}: ${summarize(created)}`).toBe(409);
      const existing = await request(`/v1/apps/${APP_ID}`, { headers: AUTH_HEADERS });
      expectOk(existing, [200], '查询既有 App');
      expect(asObject(existing.body).status).toBe('active');
    });

    // 阶段二：提交源包，服务端编译并登记为不可变 Release。
    const releaseId = await stage('submit-release', async () => {
      const files: Record<string, string> = {
        'app.yaml': await readFile(`${sampleRoot}/app.yaml`, 'utf8'),
        'prompts/system.md': await readFile(`${sampleRoot}/prompts/system.md`, 'utf8')
      };
      const submitted = await request(`/v1/apps/${APP_ID}/releases`, {
        method: 'POST', headers: AUTH_HEADERS, body: JSON.stringify({ files })
      });
      expectOk(submitted, [200, 201], '提交 Release');
      const submittedBody = asObject(submitted.body);
      expect(submittedBody.schemaVersion).toBe('PackageReleaseResult.v1');
      expect(submittedBody.appId).toBe(APP_ID);
      expect(submittedBody.releaseId).toMatch(/^sha256:/);
      return submittedBody.releaseId as string;
    });

    // 阶段三：从 Release 发起运行，轮询至成功终态。
    const taskId = await stage('run', async () => {
      const admitted = await request(`/v1/releases/${encodeURIComponent(releaseId)}/runs`, {
        method: 'POST', headers: AUTH_HEADERS, body: JSON.stringify({ input: USER_INPUT })
      });
      // 幂等：同 Release + 同输入重复发起返回 200/existing（复用既有 taskId），首次为 202/admitted。
      expectOk(admitted, [200, 202], '发起运行');
      const admittedBody = asObject(admitted.body);
      expect(admittedBody.schemaVersion).toBe('PackageRunResult.v1');
      expect(['admitted', 'existing']).toContain(admittedBody.status);
      const taskId = admittedBody.taskId as string;
      const deadline = Date.now() + 120_000;
      let last: unknown;
      for (;;) {
        const view = await request(`/v1/tasks/${encodeURIComponent(taskId)}`, { headers: AUTH_HEADERS });
        const viewBody = asObject(view.body);
        last = view.body;
        if (view.status === 200 && viewBody.status === 'succeeded') return taskId;
        if (view.status === 200 && (viewBody.status === 'failed' || viewBody.status === 'cancelled')) {
          throw new Error(`运行到达失败终态 ${String(viewBody.status)}: ${summarize(view)}`);
        }
        if (Date.now() >= deadline) break;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
      throw new Error(`等待运行成功终态超时（taskId=${taskId}），最近状态: ${JSON.stringify(last).slice(0, 300)}`);
    });

    // 阶段四：产物管理——列表存在产物引用，详情可解析出与确定性期望完全一致的内容。
    await stage('artifacts', async () => {
      const list = await request(`/v1/tasks/${encodeURIComponent(taskId)}/artifacts`, { headers: AUTH_HEADERS });
      expectOk(list, [200], '查询产物列表');
      const artifacts = asObject(list.body).artifacts;
      expect(Array.isArray(artifacts)).toBe(true);
      expect((artifacts as unknown[]).length, '产物列表为空').toBeGreaterThan(0);
      const artifactId = asObject((artifacts as unknown[])[0]).artifactId as string;
      const detail = await request(`/v1/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifactId)}`, { headers: AUTH_HEADERS });
      expectOk(detail, [200], '查询产物详情');
      const entryPrompt = await readFile(`${sampleRoot}/prompts/system.md`, 'utf8');
      const assembled = assemblePackageInput({ entryPrompt, references: [], userInput: USER_INPUT });
      expect(asObject(detail.body).content).toBe(`已收到：${assembled.text.trim().slice(0, 2_000)}`);
    });
  });
});
