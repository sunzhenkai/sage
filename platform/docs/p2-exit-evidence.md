# P2 退出证据

结论：**P2 通过。自动化 gate、独立 AI Security Owner 技术评审与独立 AI Quality Owner 技术评审均已通过，授权 P3/P4 开发。** 这些非人类技术评审不构成人类生产批准；P7 仍须完成真实人类架构、安全与运维 Go/No-Go。

## 修复后实现证据

- `@sage/platform-ports`：TypeBox runtime schemas 覆盖 environment、Artifact/Connection/Secret/Checkpoint refs、reference envelope、Run/Tool correlation 与 Credential resolution；提供递归 sensitive-data assertion 和原子 `IdempotencyStore` port。
- `@sage/tool-runtime`：固定 validate/authorize/execute/normalize/event 语义；Tool 返回在内联/Artifact 前检查 resolved credential、known secrets、sensitive keys/patterns；读泄漏稳定拒绝，已执行写泄漏归一为 `effect_unknown`；实例内 effect Map 已移除。
- `@sage/agent-state-postgres`：Run correlation 在 SQL 前按 allowlist schema 验证；新增 `tool_idempotency` 表和 PostgreSQL 原子 claim/complete/release store。
- `@sage/local-fakes`：Credential fake 精确绑定 secret/connection、tenant、environment、purpose、scope；新增共享原子 in-memory IdempotencyStore。
- `@sage/observability`：Pino correlation/fields/message 与 OTel span/metric 名称及属性全部过滤；`assertNoSensitiveData` 对 prompt/history/event/checkpoint/trace 五类 fixtures 做递归扫描。
- Tool 对抗测试覆盖返回值泄漏不写 Artifact、跨 Pipeline 并发去重、pre-commit 清理和 event recorder 前置拒绝不误报 unknown effect。

## 精确验证记录

2026-08-12T21:49+08:00 至 21:50+08:00 执行：

1. `corepack pnpm install --frozen-lockfile`：退出码 0；11 个 workspace projects，lockfile up to date。
2. P2 对抗/contract tests：platform schemas 3、Tool runtime 14、local fakes 8、observability 5 项均通过；state tests 的非 DB 边界通过。普通环境中的 4 个 PostgreSQL integration tests按设计 skip，并由步骤 3 无 skip 覆盖。
3. `corepack pnpm test:p2:integration`：退出码 0；Compose PostgreSQL Healthy；3 files、29 tests passed、0 skipped。覆盖真实 state persistence、Run correlation、跨 store 原子幂等/持久 completion/precommit release，以及 Artifact/Credential/Tool failure injection。
4. `corepack pnpm check`：退出码 0；ESLint 0 errors；`Dependency boundaries: OK`；typecheck 通过；10 test files、51 tests passed，普通 unit gate 中 4 个 PostgreSQL tests 按设计 skip；全部 workspace build 通过。
5. `openspec validate "sage-p2-secure-state-artifact-and-observability-foundation" --type change --strict --no-interactive --json`：退出码 0；1 passed、0 failed、0 issues。

## Gate 判定

- Tool fail-closed、输出泄漏与副作用语义：通过。
- Runtime correlation allowlist 与 PostgreSQL 写前验证：通过。
- 跨实例/并发/持久幂等及 precommit 清理：通过。
- Credential 四维上下文与 scope 绑定：通过。
- Pino/OTel 全路径过滤与五类 fixture 扫描：通过。
- PostgreSQL、Artifact/Credential contracts 与 backend failure injection：通过。
- 独立 AI security/quality review：通过，身份和范围见 `docs/p2-security-quality-review.md`。
- 独立 AI Security/Quality Owner 技术评审（OpenSpec 4.2）：**APPROVED**；非人类身份已披露。生产人类审批由 P7 单独阻断。

OpenSpec change 保持 active，未归档；仓库未提交。
