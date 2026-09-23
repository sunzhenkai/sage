## 1. 审查输入与定位

- [x] 1.1 读取 `ui-detail-polish-evidence` 的当前基线、截图/断言和状态清单；缺任一当前证据则保持本任务未勾并写明阻塞。
- [x] 1.2 执行当前 Cursor Grok 4.7 只读审查，记录 endpoint、模型字符串、日期、SHA、输入范围和"不改文件"要求，将 P0/P1/P2 归入 view/docs/evidence。
- [x] 1.3 为每个 view P0/P1 建立当前 source/evidence 处置行；历史报告漂移条目必须标 revalidated 或 rejected，不直接复制旧行号。

## 2. 修复 P0/P1 与记录 P2

- [x] 2.1 修复共享 shell、导航/折叠、可访问名称、live region、焦点和通用组件状态问题，保留 `.pane-item`/`.is-current`/`.is-active`、status/alert 和查询参数选中语义。
- [x] 2.2 修复列表/详情/表单/局部视图的窄宽度溢出、换行、时间/元信息挤压、loading/empty/error 可辨识和必要 CSS 细节，保持五视图结构和功能契约。
- [x] 2.3 对每个已修复 P0/P1 运行当前截图与 DOM 断言，保存修复前后证据；对接受项逐条记录当前理由、风险和替代方案。
- [x] 2.4 为当前 P2 写明 fixed、accepted、deferred 或 rejected 状态及理由，不把已知债务升级为无证据的新缺陷。

## 3. 回归与收口

- [x] 3.1 运行 `check:ui-tokens`、`corepack pnpm --filter @sage/agent-web typecheck`、`corepack pnpm --filter @sage/agent-web build`，并核对 `ui-v1.md` 功能语义未改变。
- [x] 3.2 用 evidence 的固定三视口、五视图和可达状态重新截图/断言，确认无横向溢出、无 console error、关键 ARIA/选中/反馈语义保持。
- [x] 3.3 将 source/evidence/fix/acceptance/P2 状态和命令结果写入 proposal 验证记录。
- [x] 3.4 运行 `openspec validate --strict --type change ui-detail-polish-view`，并将结果写入验证记录。
- [x] 3.5 保持所有未完成项未勾，在验证记录逐条写明依赖、服务、浏览器、审查模型或状态阻塞原因。
