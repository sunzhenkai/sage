# 示例 ai app 包

三个示例源包，用于端到端验证 agent-package 链路（源规范 → 编译 → 登记 → 从包发起运行 → 前端展示管理）。内容均为通用公开领域知识，不涉及任何公司或内部系统信息。

| 示例包 | 主题 | 说明 |
|--------|------|------|
| `github-trending/` | GitHub 热门项目解读 | 分析 trending 项目快照，产出排名解读、亮点与趋势 digest（展示页见 `docs/showcase/github-trending.html`） |
| `finance-briefing/` | 财经简报 | 拉取最新外汇汇率（Frankfurter）与全球主要股指快照（Yahoo Finance），产出结构化财经简报 |
| `lifecycle-probe/` | 生命周期探针 | 无 references、无 output.schema.json 的最小包，输出确定性，专用于「创建 → 提交 → 运行 → 产物管理」全链路验证（见下文） |

## 目录结构（以 finance-briefing 为例）

```
finance-briefing/
├── app.yaml               # manifest：id/version/entry/model 要求/budgets/skillRefs/capabilityRefs/inputs/dataSources/tasks
├── prompts/
│   └── system.md          # entry prompt
├── references/            # ≥2 篇通用领域资料
│   ├── market-data-basics.md
│   └── brief-writing-guide.md
└── output.schema.json     # 可选输出 JSON Schema
```

## 前置条件

- 本地栈已启动：`postgres`（127.0.0.1:15432）、`temporal`（127.0.0.1:17233）、`agent-api`（127.0.0.1:9610）、`agent-worker`。
- 本地 API 使用 `SAGE_DEPLOYMENT_MODE=local`，默认租户 `tenant-local`，默认认证 `local-dev-auth`。

## 命令序列

### 1. 校验并编译（包级测试内）

```bash
cd platform
pnpm --filter @sage/agent-package-release test   # 含 github-trending / finance-briefing / lifecycle-probe 三个 smoke 测试
# 预期：src/github-trending.smoke.test.ts、src/finance-briefing.smoke.test.ts、src/lifecycle-probe.smoke.test.ts 通过，输出合法 AgentPackageRelease.v1（compilerBuild=local-dev）
```

### 2. 登记到运行中的 agent-api

```bash
cd platform
pnpm --filter @sage/agent-api register-package examples/ai-apps/finance-briefing \
  --api-url http://127.0.0.1:9610 --auth local-dev-auth
```

预期输出（`201`/`200`，幂等登记）：

```json
{
  "schemaVersion": "PackageReleaseResult.v1",
  "status": "stored",
  "packageId": "finance-briefing",
  "packageVersion": "2.0.0",
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
  -d '{"task":"finance-brief","params":{}}'
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
curl -sS http://127.0.0.1:9610/v1/packages/finance-briefing -H 'x-authentication-id: local-dev-auth'
```

## 说明

- 同一 Release + 相同输入重复发起运行：`status` 返回 `existing`，不产生新 Attempt。
- production 模式（`SAGE_DEPLOYMENT_MODE != local`）下 runs 端点返回 `501 PACKAGE_RUN_ADMISSION_NOT_AVAILABLE`（fail closed）。

## 真实 provider 执行（local 专属）

包运行与 Chat 统一经受信 provider 注册表执行，不存在离线/回声模式：未配置 provider 时，Chat 阻止发送并引导配置，包运行准入直接 `409 PROVIDER_DEPENDENCY_MISSING`。在 Providers 页添加「工作区 provider」（凭据服务端密封，只写不读），并在「运行 Agent」设置中选择该条目；worker 在执行边界解密凭据，进程 env 不持有任何 provider key。

前置：`SAGE_SECRET_MASTER_KEY`（base64 编码 32 字节，如 `openssl rand -base64 32`）必须同时注入 agent-api 与 agent-worker，缺失或非法时两个进程启动即失败（fail-fast，稳定错误 `LOCAL_RUNTIME_REQUIRES_SAGE_SECRET_MASTER_KEY`）。

自动化部署可改用 env 引导（agent-api 启动时幂等注册 `deployment-env` 条目）：

| 环境变量 | 必填 | 说明 |
|----------|------|------|
| `SAGE_BOOTSTRAP_PROVIDER_API_KEY` | 是（启用开关） | provider API key，密封后入库，不明文落盘 |
| `SAGE_BOOTSTRAP_PROVIDER_BASE_URL` | 是 | 公共 HTTPS 端点（无默认值） |
| `SAGE_BOOTSTRAP_PROVIDER_MODEL` | 是 | 模型名（无默认值） |
| `SAGE_BOOTSTRAP_PROVIDER_NAME` | 否 | 条目显示名（缺省「部署环境 Provider」） |
| `SAGE_BOOTSTRAP_PROVIDER_ADAPTER` | 否 | 适配器类型（缺省 `anthropic`，可选 `openai-compatible`） |

运行成功后，输出文本物化在 `task_run_output`，可经 `GET /v1/tasks/<taskId>/artifacts/<artifactId>` 取回（响应含 `content` 字段）。

## 手动全链路验证（lifecycle-probe）

`lifecycle-probe/` 是专用于生命周期验证的最小测试源包。此前依赖 `SAGE_FAKE_LIVE_PROVIDER` 受信开关的确定性端到端套件（`ai-app-lifecycle.e2e.test.ts` + `pnpm test:ai-app-e2e`）已随该开关一并移除——不存在任何绕过真实 provider 的模型调用路径。

手工走通方式即上文「命令序列」：将 `examples/ai-apps/lifecycle-probe` 以 `pnpm --filter @sage/agent-api register-package examples/ai-apps/lifecycle-probe --api-url http://127.0.0.1:9610 --auth local-dev-auth` 登记，从 Release 发起运行，等待成功终态后经 `/v1/tasks/<taskId>/artifacts` 取回产物。整栈冒烟（`corepack pnpm smoke:local`）默认只校验服务健康与 API 面，注入 `SAGE_BOOTSTRAP_PROVIDER_*` 三项真实凭据时会额外执行 Chat→promotion→Task 模型调用垂直链路。

## v2 自闭环声明（ai-app-self-contained-runs）

三个示例均已升级 `schemaVersion: '2'`，运行不依赖任何任务级用户输入：

| 示例 | inputs | dataSources | 输出契约 |
|------|--------|-------------|----------|
| `github-trending` | `language`（可选，模型按其过滤快照） | `trending-snapshot`：GitHub Search API「2026 年新建、star 降序 Top 25」 | `trending-digest` 任务绑定 output.schema.json + `report.md` |
| `finance-briefing` | `focus`（可选，关注的市场/币种） | `fx-rates`：Frankfurter 美元参考汇率；`index-quotes`：Yahoo Finance 七大全球股指 | `finance-brief` 任务绑定 output.schema.json + `brief.md` |
| `lifecycle-probe` | — | — | 固定自检报告，逐字可断言 |

- 发起运行请求体为 `{ task?, params? }`；旧自由文本 `input` 字段返回 `410 INPUT_REMOVED`。
- 留空的参数由服务端按声明默认值补齐；声明 schema 的任务输出在物化点强制校验（不符即任务失败）。
- 数据源获取走受控出口白名单：agent-api env `SAGE_PACKAGE_SNAPSHOT_EGRESS_ALLOWLIST`（local compose 已配置 `api.github.com`、`api.frankfurter.dev`、`query1.finance.yahoo.com`；缺省即全拒绝，声明了数据源的运行会以 `PACKAGE_SNAPSHOT_SOURCE_UNAVAILABLE` 稳定失败）。
- 已知限制：数据源 URL 为静态地址（无日期/参数模板）。github-trending 以「2026 年新建」为口径；finance-briefing 的两个数据源均声明 `markMissing`（源不可达时降级为缺失标注而非整体失败，汇率数据按 ECB 口径仅工作日更新）；动态时间窗需要后续的 URL 模板契约。
