# ai-app-self-contained-runs-input-binding

## Why

Run「创建即闭环」的输入端落地（driver 设计 §3.2/§3.3 / ADR）：现状包运行依赖任务级自由文本 `input`，调度场景无人输入即空跑；App 声明的数据依赖（dataSources）无兑现路径，模型拿不到真实数据。本变更使 Run 在创建时完成参数解析与数据快照物化，之后 retry/重放/调度复用同一输入。

## What Changes

- 准入参数解析：`POST /v1/releases/:releaseId/runs` 请求体改为 `{ task?, params?, taskId? }`；params 按 manifest `inputs` 声明校验（未声明/类型不符/缺必填 → 400 `PACKAGE_PARAMS_INVALID`），缺省取默认值，`task` 缺省取唯一/隐式任务（多任务且未指定 → 400）。
- dataSources 兑现：准入时按声明经受控出口抓取（复用 tool-runtime `DefaultDenyEgressPolicy` + `RevalidatingEgressConnector`；白名单 env `SAGE_PACKAGE_SNAPSHOT_EGRESS_ALLOWLIST`，缺省空即全拒绝），每条 10s 超时、声明 maxBytes 流式上限；`onFailure: fail`（缺省）失败 → 502 `PACKAGE_SNAPSHOT_SOURCE_UNAVAILABLE`（retryable，无任务副作用），`markMissing` → 注入缺失标注段继续。
- 组装输入扩展：`--- snapshot: {name} ---` 段（markMissing 输出 `[snapshot {name} unavailable: {reason}]`）与 `--- params ---` 段；快照内容与来源 URL、参数解析值全部纳入 `inputDigest`/幂等 commandKey。
- **BREAKING（局部）**：请求体自由文本 `input` 字段返回 `410 INPUT_REMOVED`（错误信息指引用 params 或 Chat promotion）；前端同批切换（F 子变更 UI 侧，本变更先带 API 兼容提示）。
- 本变更吸收 `package-run-input-snapshots` 提案的全部内容（快照注入、出口治理、fail-closed 语义），差异：`inputSnapshots` 更名 `dataSources` 并入 manifest v2、新增 `onFailure: markMissing` 与参数绑定；该提案在完成后归档。

## Capabilities

### New Capabilities
- `package-run-input-resolution`: 包运行输入解析——params 声明校验与默认值、dataSources 受控出口获取、注入与完整性覆盖、fail/markMissing 失败语义、自由文本 input 的移除。

### Modified Capabilities
- `agent-run-admission`: 「基于 Release 的运行 admission 与包输入物化」需求更新为 params + 快照物化与 `input` 字段移除。

## Impact

- `apps/agent-api`：`runs-api.ts`（params 解析、抓取、410）、egress 接线与 env、`runtime.ts`/compose 白名单注入。
- `packages/agent-run-admission`：`package-input.ts` 段拼装与 digest 扩展。
- `packages/tool-runtime`：复用，不修改。
- 依赖 A（manifest v2 归一化形）先行。
