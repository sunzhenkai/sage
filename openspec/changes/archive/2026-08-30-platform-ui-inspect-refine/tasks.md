## 1. 输入确认
- [x] 1.1 读取 `openspec/changes/platform-ui-inspect-check/report.md` 与用户对重构范围的确认结论，圈定本 change 要修的 P0 / P1 清单
- [x] 1.2 阶段一·听诊：列出最伤节奏/可读性的 3 个问题，点到具体 class 或 CSS 属性

## 2. 处方
- [x] 2.1 阶段二·处方：在现有 token / 字体（`styles.css` `:root` 变量）内给出留白台阶、层级、降噪、行高方案；要换视觉语言先征得用户同意
- [x] 2.2 处方与逐条 finding 的对应关系写入本 change 的 `refine-plan.md`

## 3. 手术
- [x] 3.1 阶段三·手术：按确认清单修 P0（重叠/溢出/遮挡）
- [x] 3.2 修 P1（节奏不一致、多余交互层）：呼吸感（padding / margin / line-height 跟项目刻度）、微交互（已有可点目标加 150–200ms 克制 transition）、降噪（删多余边框与硬阴影，用背景层级分区）
- [x] 3.3 P2 逐项处理或记录留下的理由

## 4. 复检与验收
- [x] 4.1 `pnpm --filter @sage/agent-web typecheck` 与 platform 根 `pnpm test`，结果写入 proposal 验证记录
- [x] 4.2 阶段四·点睛：给 1 条具体收尾技巧并落地（如适用）
- [x] 4.3 用 Playwright MCP 对改动视图重新截图（桌面 + 必要的窄屏），存本 change `evidence/`，逐条对照检查清单给出 recheck 结论
- [x] 4.4 对照 proposal 验收标准逐条回填
