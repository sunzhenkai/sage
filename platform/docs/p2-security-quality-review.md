# P2 安全与质量独立审查

时间：2026-08-12T21:50:00+08:00  
审查身份：`AI Security Owner reviewer` 与 `AI Quality Owner reviewer`（两个独立非人类技术评审会话）  
范围：`sage-p2-secure-state-artifact-and-observability-foundation` 的 Tool runtime、runtime schemas、PostgreSQL state/idempotency、Credential/Artifact fakes、Pino/OTel filtering、tests 与 phase-gate 文档。  
技术结论：**APPROVED**。首次 Security review 发现 malformed `secret_ref` 可穿透持久化/遥测边界；修复后独立复验通过：generic/PG/Pino/OTel span/metric/fixture scanner 对抗探针全部拒绝或红化，真实 PostgreSQL 无残留；Quality review 的 frozen install、全量 check、P2 integration 与 strict validate 全通过。  
治理边界：P2 的开发期 Owner 评审由上述可追溯 AI 角色评审关闭；它不代表人类批准。生产试点的人类架构/安全/运维审批仍由 P7 Go/No-Go gate 管理。

## 修复复核

1. **Tool 返回边界**：执行输出在序列化或 Artifact `put` 前递归检查 sensitive key、token/private-key pattern、配置 known secrets 与本次 resolved credential。读 Tool 返回稳定 `SENSITIVE_TOOL_OUTPUT`；已执行写 Tool 返回非重试 `effect_unknown`；泄漏值既不内联也不写 Artifact。
2. **Run correlation**：`RuntimeCorrelationSchema`/`ToolCorrelationSchema` 仅允许 `run_id/task_id/workflow_id/target_id/attempt/tool_call_id`。PostgreSQL `putRun` 和读取边界均验证；token/password/restricted-result/未知字段测试在数据库调用前拒绝。
3. **Pino/OTel filtering**：Pino correlation、fields、message 均过滤，fields 不能覆盖可信 correlation；span/metric 名称和属性也过滤。非 allowlist correlation 在构造边界拒绝。
4. **持久/共享幂等**：新增 `IdempotencyStore` port，以及共享原子 `InMemoryIdempotencyStore` 和 PostgreSQL `PostgresIdempotencyStore`。Pipeline 实例不再持有 effect Map；测试覆盖新 Pipeline 实例、并发 claim、持久 completion 与 pre-commit release。
5. **Event recorder outage**：validate/authorize/credential 等执行前拒绝即使事件后端失败也只返回 `EVENT_RECORDING_UNAVAILABLE`，不再误报 `effect_unknown`；仅写执行后副作用可能发生时使用 `effect_unknown`。
6. **Credential fake**：Credential 绑定 secret/connection、tenant、environment、purpose、scope，任一不匹配均 fail closed；返回值保持 copy isolation。
7. **递归泄漏断言**：`assertNoSensitiveData` 递归检查 sensitive key、recognized pattern、known secrets 与 bytes；prompt/history/event/checkpoint/trace 五类 fixture 分别覆盖。
8. **Runtime schemas**：补充 environment、四类 refs、reference envelope、Run/Tool correlation、credential resolution TypeBox schemas，并用于 state、Tool、Credential 与 observability 边界。
9. **评审真实性**：不声称人类批准；OpenSpec 4.2 由两个有身份、范围、命令和对抗证据的独立 AI Owner 角色技术评审关闭，生产人类审批明确留给 P7。

## 审查命令与结果

在 `<worktree>/platform`，Node.js/pnpm 版本由仓库 engines 固定：

- 对抗与 contract tests：`corepack pnpm vitest run packages/platform-ports/src/index.test.ts packages/tool-runtime/src/index.test.ts packages/local-fakes/src/index.test.ts packages/observability/src/index.test.ts packages/agent-state-postgres/src/index.integration.test.ts`。相关测试均通过；普通无数据库环境中 PostgreSQL integration 按设计 skip，随后由下一条无 skip 覆盖。
- 真实 P2 integration：`corepack pnpm test:p2:integration`，退出码 0；PostgreSQL healthy；3 files、29 tests 全通过，无 skip。
- 全量 gate：`corepack pnpm check`，退出码 0；ESLint、依赖边界、typecheck、unit tests 与 build 全通过；10 files、51 tests passed，普通 gate 中 4 个 PostgreSQL tests 按设计 skip。
- Strict validation：`openspec validate "sage-p2-secure-state-artifact-and-observability-foundation" --type change --strict --no-interactive --json`，退出码 0；1 item passed、0 failed、0 issues。

## Gate 结论

- **Task 4.2 开发期 Security/Quality Owner 技术评审：APPROVED。** 两个独立 AI 角色评审的非人类身份、命令与证据已明确记录；不将其表述为人类批准。
- **生产人类审批：P7 PENDING。** 在 P7 Go/No-Go 前不得接纳生产试点负载。
- change 保持 active；本次不归档、不提交。
