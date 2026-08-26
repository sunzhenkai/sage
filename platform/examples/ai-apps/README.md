# 示例 ai app 包

两个示例源包，用于端到端验证 agent-package 链路（源规范 → 编译 → 登记 → 从包发起运行 → 前端展示管理）。内容均为通用公开领域知识，不涉及任何公司或内部系统信息。

| 示例包 | 主题 | 说明 |
|--------|------|------|
| `ops-analyst/` | 通用运维分析 | 解读监控指标、定位告警、生成排查建议 |
| `github-trending/` | GitHub 热门项目解读 | 分析 trending 项目快照，产出排名解读、亮点与趋势 digest（展示页见 `docs/showcase/github-trending.html`） |
| `lifecycle-probe/` | 生命周期探针 | 无 references、无 output.schema.json 的最小包，输出确定性，专用于「创建 → 提交 → 运行 → 产物管理」全链路端到端验证（见下文「全链路端到端验证」） |

## 目录结构（以 ops-analyst 为例）

```
ops-analyst/
├── app.yaml               # manifest：id/version/entry/model 要求/budgets/skillRefs/capabilityRefs
├── prompts/
│   └── system.md          # entry prompt
├── references/            # ≥2 篇通用领域资料
│   ├── observability-basics.md
│   ├── troubleshooting-playbook.md
│   └── runbook-conventions.md
└── output.schema.json     # 可选输出 JSON Schema
```

## 前置条件

- 本地栈已启动：`postgres`（127.0.0.1:15432）、`temporal`（127.0.0.1:17233）、`agent-api`（127.0.0.1:9610）、`agent-worker`。
- 本地 API 使用 `SAGE_DEPLOYMENT_MODE=local`，默认租户 `tenant-local`，默认认证 `local-dev-auth`。

## 命令序列

### 1. 校验并编译（包级测试内）

```bash
cd platform
pnpm --filter @sage/agent-package-release test   # 含 sample-app / github-trending 两个 smoke 测试
# 预期：src/sample-app.smoke.test.ts、src/github-trending.smoke.test.ts 通过，输出合法 AgentPackageRelease.v1（compilerBuild=local-dev）
```

### 2. 登记到运行中的 agent-api

```bash
cd platform
pnpm --filter @sage/agent-api register-package examples/ai-apps/ops-analyst \
  --api-url http://127.0.0.1:9610 --auth local-dev-auth
```

预期输出（`201`/`200`，幂等登记）：

```json
{
  "schemaVersion": "PackageReleaseResult.v1",
  "status": "stored",
  "packageId": "ops-analyst",
  "packageVersion": "1.0.0",
  "releaseRef": "release://sha256:...",
  "releaseId": "sha256:...",
  "contentDigest": "sha256:...",
  "lockDigest": "sha256:...",
  "compilerBuild": "local-dev"
}
```

### 3. 从包发起运行

```bash
curl -sS -X POST http://127.0.0.1:9610/v1/releases/<releaseId>/runs \
  -H 'content-type: application/json' \
  -H 'x-authentication-id: local-dev-auth' \
  -d '{"input":"p95 延迟突增，错误率同步上升，如何排查？"}'
```

预期输出（`202`）：

```json
{
  "schemaVersion": "PackageRunResult.v1",
  "status": "admitted",
  "taskId": "pkg-...",
  "runId": "run-pkg-...",
  "attemptId": "attempt-pkg-...-1",
  "releaseRef": "release://sha256:...",
  "releaseId": "sha256:...",
  "specRef": "spec://package/...",
  "specDigest": "sha256:...",
  "inputRef": "task-input://package/tenant-local/pkg-..."
}
```

### 4. 查看运行状态与产物

```bash
curl -sS http://127.0.0.1:9610/v1/tasks/<taskId> -H 'x-authentication-id: local-dev-auth'
curl -sS http://127.0.0.1:9610/v1/tasks/<taskId>/events -H 'x-authentication-id: local-dev-auth'
curl -sS http://127.0.0.1:9610/v1/tasks/<taskId>/artifacts -H 'x-authentication-id: local-dev-auth'
```

### 5. 包列表与详情

```bash
curl -sS http://127.0.0.1:9610/v1/packages -H 'x-authentication-id: local-dev-auth'
curl -sS http://127.0.0.1:9610/v1/packages/ops-analyst -H 'x-authentication-id: local-dev-auth'
```

## 说明

- 同一 Release + 相同输入重复发起运行：`status` 返回 `existing`，不产生新 Attempt。
- production 模式（`SAGE_DEPLOYMENT_MODE != local`）下 runs 端点返回 `501 PACKAGE_RUN_ADMISSION_NOT_AVAILABLE`（fail closed）。

## 真实 provider 执行（local 专属）

包运行与 Chat 统一经受信 provider 注册表执行，不存在离线/回声模式：未配置 provider 时，Chat 阻止发送并引导配置，包运行准入直接 `409 PROVIDER_DEPENDENCY_MISSING`。在 Providers 页添加「工作区 provider」（凭据服务端密封，只写不读），并在「运行 Agent」设置中选择该条目；worker 在执行边界解密凭据，进程 env 不持有任何 provider key。

前置：`SAGE_SECRET_MASTER_KEY`（base64 编码 32 字节，如 `openssl rand -base64 32`）必须同时注入 agent-api 与 agent-worker，缺失或非法时两个进程启动即失败（fail-fast，稳定错误 `LOCAL_RUNTIME_REQUIRES_SAGE_SECRET_MASTER_KEY`）。

测试/CI 可启用受信开关 `SAGE_FAKE_LIVE_PROVIDER=true`（agent-api 与 agent-worker 同时注入）：模型调用被进程内确定性替身替换（设置→注册表解析→harness 路由全链路保真），无需真实外部模型服务；`/readyz` 会暴露非敏感的 `providerExecution.mode=fake` 标识。

自动化部署可改用 env 引导（agent-api 启动时幂等注册 `deployment-env` 条目）：

| 环境变量 | 必填 | 说明 |
|----------|------|------|
| `SAGE_BOOTSTRAP_PROVIDER_API_KEY` | 是（启用开关） | provider API key，密封后入库，不明文落盘 |
| `SAGE_BOOTSTRAP_PROVIDER_BASE_URL` | 是 | 公共 HTTPS 端点（无默认值） |
| `SAGE_BOOTSTRAP_PROVIDER_MODEL` | 是 | 模型名（无默认值） |
| `SAGE_BOOTSTRAP_PROVIDER_NAME` | 否 | 条目显示名（缺省「部署环境 Provider」） |
| `SAGE_BOOTSTRAP_PROVIDER_ADAPTER` | 否 | 适配器类型（缺省 `anthropic`，可选 `openai-compatible`） |

运行成功后，输出文本物化在 `task_run_output`，可经 `GET /v1/tasks/<taskId>/artifacts/<artifactId>` 取回（响应含 `content` 字段）。

## 全链路端到端验证（lifecycle-probe）

`lifecycle-probe/` 配套一条自动化端到端验证（`platform/apps/agent-api/src/ai-app-lifecycle.e2e.test.ts`），以真实 HTTP 入口依次走通：创建 App 主体 → 提交源包编译登记 Release → 发起运行并等待成功终态 → 查询产物列表与详情并断言确定性内容（fake provider 回放 `已收到：<组装输入>`）。

前置条件：

- 本地栈已启动（postgres/temporal/agent-api/agent-worker），且 **agent-api 与 agent-worker 均注入了 `SAGE_FAKE_LIVE_PROVIDER=true`**（`/readyz` 的 `providerExecution.mode` 为 `fake`）。
- `packages/*` 已构建（`corepack pnpm exec tsc -b`）。

执行：

```bash
cd platform
corepack pnpm test:ai-app-e2e   # 等价于 SAGE_AI_APP_E2E=1 vitest run apps/agent-api/src/ai-app-lifecycle.e2e.test.ts
```

默认不设置 `SAGE_AI_APP_E2E=1` 时该套件自动 skip，不影响常规 `pnpm test`。可选环境变量 `SAGE_E2E_API_URL` / `SAGE_E2E_WORKER_URL` 覆盖目标栈地址（默认 9610/9611）。验证会 seed 一个名为 `ai-app-e2e provider` 的工作区 provider 并将其设为运行 agent 设置（fake 模式下凭据不会被真实使用）。
