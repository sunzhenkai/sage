## 1. 取证
- [x] 1.1 确认 agent-web `http://127.0.0.1:9612` 可用（/v1/tasks 代理通），Playwright MCP 复现 4 个问题并截图（桌面 1440；问题 2 另补窄屏 375），存 `evidence/before-*.png`
- [x] 1.2 用 browser_evaluate 量取 computed style / 坐标，定位每个问题的根因（选择器与属性），写入 `fix-plan.md`

## 2. 修复
- [x] 2.1 修问题 1：分栏间隔线右侧补间隔（与左侧节奏一致）
- [x] 2.2 修问题 2：放宽对话内容区最大宽度，与其它视图内容宽度节奏对齐
- [x] 2.3 修问题 3：会话列表 item 选中/未选中 padding 一致，高度不变
- [x] 2.4 修问题 4：选中背景覆盖整个 item（含圆角与留白处理）

## 3. 复检与验收
- [x] 3.1 Playwright MCP 复检截图（`evidence/after-*.png`），逐项给 recheck 结论写入 `fix-plan.md`
- [x] 3.2 `pnpm --filter @sage/agent-web typecheck` 与 platform 根 `pnpm test`，结果写入 proposal 验证记录
- [x] 3.3 对照 proposal 验收标准逐条回填
