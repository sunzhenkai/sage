# agent-package-e2e-run-path Design

## Context

driver design（D3/D4）已定：新端点不动 `/v1/tasks`；输入走物化表 + 新 inputRef scheme。本设计细化到模块与数据层。运行链路现状见 `docs/design/task-lifecycle-code-map.md`（legacy 路径：controller → workflow → executeAgentSlice → claimSlice → resolver → agent-lib）。

## Goals / Non-Goals

**Goals:** 包运行复用全部既有运行设施（routing/owner CAS/slice 幂等/投影），新增面最小。

**Non-Goals:** Spec Store 换持久化实现（沿用本地组合）；输出契约校验（output.schema.json 先随物化输入注入 prompt，不做机器校验）。

## Decisions

### 端点与身份
- `POST /v1/releases/{releaseId}/runs`，body：`{ input: string, taskId?: string }`（缺省服务端生成 `pkg-{uuid}`）。
- admission 映射：`releaseRef/releaseDigest` ← registry 记录；`goalRef = goal://package/{packageId}/{version}/{entryPromptPath}`；`engineId/skillRefs/modelRouteRef` ← manifest；`boundsRef` ← manifest budgets 映射为 slice 默认值；`principal/tenant` ← 服务端鉴权层（客户端不可覆盖）。
- Spec 持久化：create-only putSpec（复用 agent-run-admission 幂等机，idempotencyKey = `tenant+releaseId+input digest`），随后走既有 controller.create 启 workflow。

### 物化输入表
```sql
task_package_input (
  tenant_id, task_id,          -- PK
  release_id, release_digest,  -- 溯源
  assembled_input text,        -- entry prompt + references 清单 + 用户输入
  asset_digests jsonb,         -- 资产 digest 清单（可审计重建）
  created_at timestamptz
)
```
- 写入时机：admission 成功后、启动 workflow 前，与 task_routing 同事务为佳；至少保证先于 workflow start。
- resolver：`task-input://package/{tenant}/{taskId}` → 读表返回 `assembled_input`；缺行返回稳定错误（不回退 chat）。

### 拼装规则（v1，无模板引擎）
```
<entry prompt 正文>
--- references ---
<每个 reference 的相对路径与正文>
--- user input ---
<用户输入>
```
asset_digests 记录每个资产的 sha256，保证 Release 更新后旧运行可审计。

### Production fail closed
`SAGE_DEPLOYMENT_MODE != local` 时 runs 端点返回 501 `PACKAGE_RUN_ADMISSION_NOT_AVAILABLE`（未接 ProductionAdmissionCoordinator 前不放开）。

## Risks / Trade-offs

- [物化输入与 Release 资产存在双写] → asset_digests 清单 + Release 不可变，可审计；不做运行期重读
- [runs 端点绕过 slice 预算自定义] → manifest budgets 映射默认 slice，用户不可透传（防越权扩大预算）
- [admission 幂等键碰撞] → input digest 覆盖同输入重复提交；同输入新意图需显式新 taskId

## Migration Plan

新表随 postgres-migrations 增量 migration 发布；端点/ resolver 全增量。回滚撤端点即可，已物化数据只读无害。
