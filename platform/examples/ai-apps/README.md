# ops-analyst 示例 ai app 包

通用运维分析助手的源包示例，用于端到端验证 agent-package 链路（源规范 → 编译 → 登记 → 从包发起运行 → 前端展示管理）。内容仅使用通用运维准则，不涉及任何公司或内部系统信息。

## 目录结构

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
pnpm --filter @sage/agent-package-release test   # 含 sample-app.smoke.test.ts
# 预期：src/sample-app.smoke.test.ts 通过，输出合法 AgentPackageRelease.v1（compilerBuild=local-dev）
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
