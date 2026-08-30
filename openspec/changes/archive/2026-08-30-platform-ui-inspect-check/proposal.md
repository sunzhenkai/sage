## Why
对 agent-web 现有五个视图（chat / tasks / packages / schedules / providers）做 dotf-ui-design 的 ui-inspect 空间细节检查，以截图取证，产出分级（P0–Pn）检查清单，作为后续优雅重构的输入。

## What Changes
- 不修改任何产品代码；只新增检查报告 `openspec/changes/platform-ui-inspect-check/report.md` 与截图证据
- 按 ui-inspect 清单逐视图检查：整体布局、内容块 padding、元素间隔、分割线、图标与按钮、对齐、呼吸/降噪/微交互、交互克制
- 桌面宽度必查，窄屏（约 375–390px）补查布局响应式；同屏可到的交互态（empty / error / 展开）带上

## Non-goals
- 不修任何发现的问题（修复归 `platform-ui-inspect-refine`）
- 不引入 Playwright 等新的测试设施；截图用会话内可用的浏览器能力（Playwright MCP）
- 不检查 docs/ 下静态页面

## 验收标准
- [ ] 五个视图均有桌面截图，关键页补窄屏截图，证据存于本 change 目录 `evidence/`
- [ ] `report.md` 按 ui-inspect 输出格式给出 scope / viewport / evidence / mode / findings（P0–Pn，含位置与应对齐的规则），无问题也要写明看过的面
- [ ] 检查清单已向用户呈报

## 验证记录
