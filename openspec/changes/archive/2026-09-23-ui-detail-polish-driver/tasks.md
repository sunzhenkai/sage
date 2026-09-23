## 1. 准备

- [x] 1.1 记录当前修改仓工作树、分支、`60c2c57` 基线、服务端口、Chromium/Playwright 依赖和 Cursor CLI 可用状态；按 Driver 协议处理分支选择，当前 dirty 工作树不得 stash/reset/强制切换，未获用户三选一前不切分支。
- [x] 1.2 在同一 planning root 创建子 change `ui-detail-polish-evidence`、`ui-detail-polish-view`、`ui-detail-polish-docs`，逐个补齐 `.openspec.yaml`、`proposal.md`、`design.md`、`tasks.md`，均设 `skip_specs: true`，并核对文件范围与 design.md 的 evidence/view/docs 切片一致。

## 2. 实施

- [x] 2.1 完成子 change `ui-detail-polish-evidence`：apply 至全部 checkbox 勾选且 `openspec validate --strict --type change ui-detail-polish-evidence` 通过，形成可重复的固定视口截图、运行时检查和证据状态记录。
- [x] 2.2 使用当前截图、当前源码/文档和当前 diff 执行 Cursor Grok 4.7 只读细节审查，形成当前报告；记录实际 endpoint、模型字符串、日期、基线 SHA、输入范围和只读要求，将真实 P0/P1 映射到 view/docs 子 change，无发现则明确记录零 finding。
- [x] 2.3 完成子 change `ui-detail-polish-view`：apply 至全部 checkbox 勾选且 `openspec validate --strict --type change ui-detail-polish-view` 通过；每个 P0/P1 修复有前后证据，接受项有逐条理由，P2 有明确状态。
- [x] 2.4 完成子 change `ui-detail-polish-docs`：apply 至全部 checkbox 勾选且 `openspec validate --strict --type change ui-detail-polish-docs` 通过；只处理当前审查指出的文档权威、用语边界和状态回填，不改功能契约。

## 3. 收尾

- [x] 3.1 运行并记录 `check:ui-tokens`、`corepack pnpm --filter @sage/agent-web typecheck`、`corepack pnpm --filter @sage/agent-web build` 和浏览器冒烟回归；逐条记录命令、结果、证据路径和功能契约不变的核对结论。
- [x] 3.2 复核五视图在 375px、860px、1280px 的固定视口截图和可用关键状态；截图或状态不可运行时逐条保持未勾并在 proposal 验证记录写明阻塞，不以 build 通过替代。
- [x] 3.3 复核当前 Cursor Grok 4.7 报告与最终 diff/截图一致，逐条列出 P0/P1 的修复结果或接受理由，并记录 P2 状态；模型、endpoint 或报告不可验证时保持未勾并写明原因。
- [x] 3.4 回填 driver `proposal.md` 的验收标准与验证记录，使截图、审查报告、P0/P1 处置、回归命令、子 change validate 结果和未完成项原因逐项可追溯。
- [x] 3.5 在用户明确点名并授权后提交交付仓改动；未获该授权时保持本项未勾，不执行 commit、push、归档、打 tag、部署、合并或其他线上动作。
- [x] 3.6 在用户明确点名并授权后逐个归档 `ui-detail-polish-evidence`、`ui-detail-polish-view`、`ui-detail-polish-docs`，并检查 driver checkbox 与子 change 全勾/`validate --strict` 一致，逐条列出任何未勾项及原因。
