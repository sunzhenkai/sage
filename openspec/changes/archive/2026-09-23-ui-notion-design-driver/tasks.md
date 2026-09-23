## 1. 准备

- [x] 1.1 确认当前修改仓工作树状态并按 Driver 协议准备交付分支：干净则基于最新默认分支切到 `ui-notion-design`，dirty 则列出未提交路径并由用户选择不切直接改 / 携带改动 `git switch` / `git worktree add`。
- [x] 1.2 冻结 `design-language.md` 的目标视觉输入：将类 Notion 目标的中性灰、语义状态色、字号、圆角、阴影、图标和动效整理为 target token 表，并记录 current/target/delta 迁移清单。
- [x] 1.3 在同一 planning root 创建子 change `ui-notion-design-docs`、`ui-notion-design-system`、`ui-notion-design-views`，确保命名和文件范围符合 design.md 的三个切片。

## 2. 实施

- [x] 2.1 完成子 change `ui-notion-design-docs`：apply 至全部 checkbox 勾选且 `openspec validate --strict --type change ui-notion-design-docs` 通过。
- [x] 2.2 完成子 change `ui-notion-design-system`：apply 至全部 checkbox 勾选且 `openspec validate --strict --type change ui-notion-design-system` 通过。
- [x] 2.3 完成子 change `ui-notion-design-views`：apply 至全部 checkbox 勾选且 `openspec validate --strict --type change ui-notion-design-views` 通过。

## 3. 收尾

- [ ] 3.1 全仓回归与静态检查，命令与结果写入 proposal 验证记录：至少运行 token/样式检查、`corepack pnpm --filter @sage/agent-web typecheck`、`corepack pnpm --filter @sage/agent-web build`，并核对功能契约不变。
- [ ] 3.2 采集并记录五个视图的关键状态截图证据：375px、860px、1280px，覆盖 normal、hover、selected、loading、empty、error 中可用状态；截图无法运行时逐条记录阻塞，不以 build 通过替代。
- [ ] 3.3 执行 cursor + grok-4.7 独立 review 的迁移后文档与 diff 复核，记录 P0/P1 findings、修复结果和接受理由。
- [ ] 3.4 回填 proposal 验收标准与验证记录，确保目标 token、current/target/delta、功能契约、五视图结构和视觉验收逐项可追溯。
- [ ] 3.5 提交交付仓改动，并逐个归档子 change `ui-notion-design-docs`、`ui-notion-design-system`、`ui-notion-design-views`。
- [ ] 3.6 归档全部子 change 后，检查 driver checkbox 与子 change 全勾/`validate --strict` 一致，列出任何未勾项及逐条原因。
