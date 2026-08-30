## Why
按 `platform-ui-inspect-check` 产出并经用户确认的 ui-inspect 检查清单，对 agent-web 现有页面做优雅重构（ui-inspect 可选模式），让页面更有留白与层次；只修空间细节与降噪，不换视觉身份。

## What Changes
- 修改范围限 `platform/apps/agent-web/src/`（样式以 `styles.css` 为主，必要时动组件内联结构）
- 先 P0 再 P1；P2 未修要列出并说明为何留下
- 优雅重构走 ui-inspect 4 阶段：听诊（3 条最伤节奏的问题，点到具体 class/属性）→ 处方（只在现有 token / 字体里开方）→ 手术（呼吸感、微交互、降噪）→ 点睛（1 条收尾技巧）
- 处方默认不换色、不换字体、不引入 Tailwind / shadcn / 任何新依赖；要换视觉语言必须先征得用户同意

## Non-goals
- 不整站换肤、不重建 token、不加功能、不重做信息架构
- 不修功能 bug（发现功能 bug 只记录，不在本 change 处理）
- 不改 `docs/` 下静态页面

## 验收标准
- [x] 用户确认清单中的 P0 / P1 项全部修复，或逐项说明不做/降级的原因（P0×2、P1×2 全部修复，P2×2 也一并修复，recheck 逐条 pass，见 `refine-plan.md`）
- [x] 重构后逐视图截图复检（recheck: pass / fail / partial），与检查清单一一对应，证据存于本 change 目录 `evidence/`
- [x] `pnpm --filter @sage/agent-web typecheck` 通过，platform 根 `pnpm test` 不引入新失败
- [x] 保持功能与选择器语义，响应式不断，对比度 ≥ 4.5:1；hover / focus / active / disabled / loading / empty / error 状态齐全
- [x] 无平行实现、无魔法数字（跟项目刻度），与既有页面同一套视觉语言

## 验证记录

- 服务：`curl http://127.0.0.1:9612/` 与 `/v1/tasks` 均 200（复用已运行服务，未重启）。
- `cd platform && corepack pnpm --filter @sage/agent-web typecheck`：通过（tsc --noEmit 无输出）。
- `cd platform && corepack pnpm test`：Test Files 2 failed | 165 passed | 23 skipped；Tests 2 failed | 1037 passed | 80 skipped。2 个失败均为既有失败、与本次改动无关：
  - `scripts/agent-platform-final/final.test.ts`：断言 `platform/evidence/agent-platform-final/*` 证据文件（这些文件在改动前已是 git dirty 状态），不 import agent-web；
  - `examples/node-host/src/index.test.ts`（live provider token budget）：仅依赖 `@sage/agent-client` / `@sage/harness-pi`，不 import agent-web。
  - 单独重跑这两个文件在改动后仍同样失败（`corepack pnpm vitest run scripts/agent-platform-final/final.test.ts examples/node-host/src/index.test.ts` → 2 failed），且 agent-web 全部测试文件（chat/tasks/providers/workspace-providers/locale/responsive-a11y 等）在根命令下全部通过。
- Playwright MCP 复检（桌面 1440×900 + 窄屏 375×812，dev server HMR 实时生效）：6 条 finding 逐条 recheck 全 pass，坐标实测与截图证据见 `refine-plan.md` 与 `evidence/`（providers-desktop/mobile、providers-dialog-desktop、chat-session-desktop/mobile、tasks-detail-desktop/mobile、tasks-detail-attempt-select）。
- 约束核对：改动限 `platform/apps/agent-web/src/`（styles.css / providers.tsx / tasks.tsx / locale.tsx / workspace-providers.tsx + 一处测试断言随文案改名同步）；未换色、未换字体、未引入依赖；颜色零改动故对比度不变；响应式 375px 实测无横向滚动。

