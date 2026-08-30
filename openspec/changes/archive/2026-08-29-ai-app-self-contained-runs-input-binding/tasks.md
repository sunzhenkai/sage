# ai-app-self-contained-runs-input-binding — Tasks

## 1. 输入组装与幂等（agent-run-admission）

- [x] 1.1 `package-input.ts`：snapshots/params 段拼装（次序：entry→references→snapshot→params→user input）与 digest/commandKey 扩展
- [x] 1.2 单测：段次序、markMissing 标注、params 值入 digest、无声明输入逐字节等价

## 2. 受控出口与抓取（agent-api）

- [x] 2.1 egress 接线：`SAGE_PACKAGE_SNAPSHOT_EGRESS_ALLOWLIST` 解析为 `EgressRule[]`，经 `RevalidatingEgressConnector`（undici 实现 `ConnectionValidatingTransportPort`）；缺省空白名单全拒绝
- [x] 2.2 快照抓取器：逐声明抓取（10s、maxBytes 流式计数、非 2xx/解析失败映射），onFailure 语义
- [x] 2.3 `runs-api.ts`：task/params 解析（400 `PACKAGE_PARAMS_INVALID`）、`input` 字段 410 `INPUT_REMOVED`、抓取编排（幂等命中先短路）
- [x] 2.4 compose/runtime：agent-api 注入白名单 env（local：`api.github.com`）

## 3. 测试与吸收收尾

- [x] 3.1 agent-api 准入测试：params 矩阵、多任务未指定、410、白名单放行/拒绝、超时/超体积、markMissing、production 501、v1 App golden 等价
- [x] 3.2 根 `pnpm typecheck && pnpm lint` 与治理扫描通过
- [x] 3.3 归档被吸收的 `package-run-input-snapshots`（openspec archive，含其 specs/design 落档说明）
