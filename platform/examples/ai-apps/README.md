# 示例 ai app 包

两个示例源包，用于端到端验证 agent-package 链路（源规范 → 编译 → 登记 → 从包发起运行 → 前端展示管理）。内容均为通用公开领域知识，不涉及任何公司或内部系统信息。

| 示例包 | 主题 | 说明 |
|--------|------|------|
| `ops-analyst/` | 通用运维分析 | 解读监控指标、定位告警、生成排查建议 |
| `github-trending/` | GitHub 热门项目解读 | 分析 trending 项目快照，产出排名解读、亮点与趋势 digest（展示页见 `docs/showcase/github-trending.html`） |

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

默认情况下 worker 用本地确定性 echo harness 执行包运行（输出「已收到：…」）。给 agent-worker 进程配置以下环境变量后，`task-input://package/` 路径的 slice 改为真实模型调用（github-trending 的 modelRoute 即 `minimax-cn` / `MiniMax-M3`）：

| 环境变量 | 必填 | 默认 | 说明 |
|----------|------|------|------|
| `MINIMAX_API_KEY` | 启用开关 | —（未设则 echo） | MiniMax 中国站 API key，只留在 worker 进程内存，不落日志/存储 |
| `MINIMAX_BASE_URL` | 否 | `https://api.minimaxi.com/anthropic` | Anthropic 兼容端点（SDK 自动拼 `/v1/messages`） |
| `MINIMAX_MODEL` | 否 | `MiniMax-M3` | 模型名 |

运行成功后，输出文本物化在 `task_run_output`，可经 `GET /v1/tasks/<taskId>/artifacts/<artifactId>` 取回（响应含 `content` 字段）。
