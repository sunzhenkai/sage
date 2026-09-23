## 1. 视图迁移状态表

- [x] 1.1 建立 Chat、Tasks、Packages、Providers、Schedules、Settings 六视图迁移状态表，列明 surface、target token、证据状态和 gap。
- [x] 1.2 固定 dev mock 数据、375px/860px/1280px 视口和截图状态集合，明确 normal、hover、selected、loading、empty、error 的可用/阻塞判定。

## 2. 逐视图迁移

- [x] 2.1 迁移 Chat 视图 CSS 与必要皮肤适配，保留对话列表、时间线、聊天输入和状态语义；完成 Chat 关键状态截图。
- [x] 2.2 迁移 Tasks 视图 CSS 与必要皮肤适配，保留列表、详情、timeline、run logs、artifacts 和控制状态；完成 Tasks 关键状态截图。
- [x] 2.3 迁移 Packages 视图 CSS 与必要皮肤适配，保留应用列表、详情、manifest、assets、releases 和上传/启动状态；完成 Packages 关键状态截图。
- [x] 2.4 迁移 Providers/Settings 视图 CSS 与必要皮肤适配，保留连接列表、模型面板、目录 combobox、键盘和状态语义；完成 Providers/Settings 关键状态截图。
- [x] 2.5 迁移 Schedules 视图 CSS 与必要皮肤适配，保留列表、触发历史、控制操作和认证状态；完成 Schedules 关键状态截图。

## 3. 回归与独立 review

- [x] 3.1 运行 `corepack pnpm --filter @sage/agent-web typecheck`、`corepack pnpm --filter @sage/agent-web build`、system token 检查和功能契约核对，确认 `ui-v1.md` 语义不变。
- [x] 3.2 补齐 375px、860px、1280px 截图证据清单；无法运行浏览器时逐条记录阻塞，不以 build 成功替代。
- [x] 3.3 执行 cursor + grok-4.7 只读 review，修复 P0/P1 finding 或记录逐条接受理由，P2 写入迁移状态表。
- [x] 3.4 清理最终视图样式中的园丁台色值、`bud-pulse` 记忆点、目标外阴影和未映射视觉 token。
- [x] 3.5 运行 `openspec validate --strict --type change ui-notion-design-views`，将结果写入 proposal 验证记录。
