## 1. 当前审查与文档定位

- [x] 1.1 读取 `ui-detail-polish-evidence` 的当前基线、截图/断言和状态清单；缺任一当前证据则保持本任务未勾并写明阻塞。
- [x] 1.2 执行当前 Cursor Grok 4.7 只读审查，记录 endpoint、模型字符串、日期、SHA、输入范围和"不改文件"要求，将 docs finding 单独归类。
- [x] 1.3 为每个 docs P0/P1 建立当前 source/evidence 处置行；历史报告和约束评审的旧行号必须标 revalidated/rejected。

## 2. 文档权威与状态修订

- [x] 2.1 核对并修订 `ui-v1.md`、`layout-v1.md`、`design-language.md`、`target-token-map.md` 的状态和权威边界，保持功能契约、结构/交互、目标视觉意图和运行时 token 各自职责单一。
- [x] 2.2 核对并修订 `CONTEXT.md` 的 Avoid 适用范围、例外和用户可见用语边界，明确不约束代码标识、API、query、manifest、规格字段和领域对象。
- [x] 2.3 核对并修订 `ui-v1-frontend-prompt.md`、README、`docs/design/README.md` 和历史报告引用状态，使历史内容不可作为当前验收依据，索引可达且死链状态明确。
- [x] 2.4 对每个已修复 docs P0/P1 保存当前 source/evidence 和修复前后核验；对接受项记录当前理由、风险和替代方案。

## 3. 回归与收口

- [x] 3.1 运行文档状态/链接/引用/Avoid 边界/功能契约静态核验，并运行 `check:ui-tokens`、`corepack pnpm --filter @sage/agent-web typecheck`、`corepack pnpm --filter @sage/agent-web build`。
- [x] 3.2 为当前 P2 写明 fixed、accepted、deferred 或 rejected 状态及理由，不把已知债务升级为无证据的新缺陷。
- [x] 3.3 将 source/evidence/fix/acceptance/P2 状态和命令结果写入 proposal 验证记录。
- [x] 3.4 运行 `openspec validate --strict --type change ui-detail-polish-docs`，并将结果写入验证记录。
- [x] 3.5 保持所有未完成项未勾，在验证记录逐条写明依赖、服务、浏览器、审查模型或状态阻塞原因。
