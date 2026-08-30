## Why
用户指出 4 个 ui-inspect 漏检的 chat 视图问题（`platform-ui-inspect-check` 之后补报）：

1. 对话页面与会话列表之间的间隔线右侧没有间隔（分栏线贴死右侧面板）
2. 对话内容区域设置了最大宽度且居中，视觉效果和内容展示量都非常受限
3. 会话列表 item 点击之后 padding 变了，点击前后高度不一致
4. 点击对话之后，会话列表 item 的选中背景色没有覆盖整个 item

## What Changes
- 修改范围限 `platform/apps/agent-web/src/`（`styles.css` 为主，必要时动 `chat.tsx` / `workspace.tsx` 结构）
- 内容区加宽：与 tasks/packages 等其它视图的内容宽度节奏对齐，不发明新刻度；保持可读行宽，不撑满整屏
- 其余 3 条按现状取证后最小修复，走既有 token，不引入新依赖

## Non-goals
- 不换色、不换字体、不动其它视图
- 不改交互逻辑与功能

## 验收标准
- [x] 4 个问题逐项截图复检通过（桌面 1440 + 窄屏 375），证据存本 change `evidence/`
- [x] 会话列表 item 选中/未选中态高度一致，选中背景覆盖整个 item
- [x] `pnpm --filter @sage/agent-web typecheck` 通过，platform 根 `pnpm test` 不引入新失败

## 验证记录

- typecheck：`cd platform && corepack pnpm --filter @sage/agent-web typecheck` → 通过（tsc --noEmit 无输出，exit 0）。
- agent-web 定向测试：`corepack pnpm exec vitest run apps/agent-web/src` → 168/169 通过；唯一失败 `locale.test.tsx` 文案密度用例由并行工作（`ai-app-output-redefine-archive-upload` 改动 `locale.tsx`，mtime 20:11，晚于本轮首次全量测试）引入，与本 change 无关。
- platform 根 `corepack pnpm test`：3 个失败用例 + 10 个文件级失败。其中 2 个为已知基线（`scripts/agent-platform-final/final.test.ts`、`examples/node-host` live provider budget）；其余（`locale.test.tsx`、`apps/agent-api/*` ×7、`apps/agent-worker/*` ×3）均为并行工作引入（`Cannot find package '@sage/agent-package-release'`），本 change 只改 `chat.tsx` 一个 className 与 `styles.css`，不触及这些链路。首轮全量测试（并行改动落盘前）仅 2 个已知基线失败。
- Playwright 复检（桌面 1440 / 宽屏 1920 / 窄屏 375）逐项通过，详见 `fix-plan.md` 的 Recheck 表与 `evidence/after-*.png`。
