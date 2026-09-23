## Why
UI 检查报告（tasks/20260923-ui-audit/ui-check.md，基线 725ad1f）指出 6 处 `CONTEXT.md` 用语契约违规（P1#6~#11）：默认模型列表可用状态写死英文、视图标题使用禁词 AI Apps、英文侧把 Session 称作 conversation/chat、正文把「默认运行模型」写成「默认模型」、Chat Run / 待变 Task 的实例被单独叫 Run、Declared Task 被叫 Task 且表头用 entry。

## What Changes
- `ProvidersView.tsx`：可用状态改 i18n 词条，与 `common.notAvailable` 对称（P1#6）
- `packages.title` 改「应用」/ `Apps`，rail 与 topbar 一并生效（P1#7）
- `en.ts` 中 conversation / chat / thread 词条改 Session / Sessions、`New session`（P1#8）
- `zh-CN.ts` / `en.ts` 中「默认模型」句改「默认运行模型」/ `default run model`（P1#9）
- 「重试此 Run」改「重试此 Chat Run」；启动成功文案与「打开 Task」对齐（P1#10）
- 「声明的 Task」与启动表单标签改 Declared Task；`entry` 列头改 i18n 词条（P1#11）
- 涉及文件：`platform/apps/agent-web/src/i18n/{zh-CN,en}.ts`、`App.tsx`、`ChatView.tsx`、`PackagesView.tsx`、`ProvidersView.tsx` 中的文案点

## Non-goals
- 不改后端 API、不加新功能
- 不动结构性 / a11y 修复（归 `ui-polish-a11y-interaction` 与 `ui-polish-packages-list`）
- 报告写明的取舍（快捷提示英文草稿）不列入

## 涉及面
| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | platform/apps/agent-web 前端代码 |

## 验收标准
- [ ] P1#6~#11 逐条对照 ui-check.md 验证通过
- [ ] 界面文案对照 `CONTEXT.md` 用语契约无违规词（AI App、conversation、thread、单独 chat、默认模型、单独 Run、entry、单独 Task）
- [ ] `pnpm lint`（agent-web 范围）通过；手工冒烟无 console error

## 验证记录

### 2026-09-23
- `corepack pnpm -C platform/apps/agent-web typecheck`：通过（`tsc -b --pretty false`，exit 0）。`package.json` 无 agent-web 范围 `lint` 脚本，按既有 `typecheck` 脚本执行。
- grep 复核：`AI Apps`、`>entry<`、`默认模型`、`Retry this run` / `重试此 Run`、`Start run` / `启动 run` 在 UI 词条与视图文案中无残留；`conversations` 仅作为 i18n key 标识符保留，注释中的旧术语不属于界面文案。
- Vite + Playwright 中英双语冒烟：rail / topbar 显示 `应用` / `Apps`；默认运行模型标题与引导句显示新词条；Packages 启动区显示 `Declared Task` / `启动 Task` / `Start Task`；console error 为 0（最近一次页面加载）。

