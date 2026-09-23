## Why
UI 检查报告（tasks/20260923-ui-audit/ui-check.md，基线 725ad1f）指出：应用列表栏在 `--pane-list-w` 契约宽度（320px，≤860px 为 220px）内横向溢出（P1#1），且应用详情三张表的表头写死英文（P2#16）。两者同在 PackagesView 渲染路径，合并为一个子 change。

## What Changes
- `.pkg-row` 改为与 `.task-row` / `.schedule-row` 一致的纵向行；时间不再用 `formatFullTime` 长格式
- `.pkg-example-grid` 列宽改为 `minmax(0, 1fr)`
- inputs / data sources / releases 三张表的 `<th>` 改走 i18n 词条；`zh-CN.ts` 中 Manifest / Assets / Releases 等整词未译的标题补词条
- 涉及文件：`platform/apps/agent-web/src/views/PackagesView.{tsx,css}`、`platform/apps/agent-web/src/i18n/{zh-CN,en}.ts`

## Non-goals
- 不改后端 API、不加新视图/新功能
- 不动其他视图的列表行样式

## 涉及面
| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | platform/apps/agent-web 前端代码 |

## 验收标准
- [ ] 320px 与 220px 列表栏宽度下 `.pkg-row` 无横向溢出（对照 P1#1 各行号证据）
- [ ] ≤860px 时 `.pkg-example-grid` 不超出内容区
- [ ] 中文界面下应用详情三张表表头与标题无写死英文（对照 P2#16）
- [ ] `pnpm lint`（agent-web 范围）通过；手工冒烟无 console error

## 验证记录

### 2026-09-23
- `corepack pnpm -C platform/apps/agent-web typecheck`：通过（`tsc -b --pretty false`，exit 0）。
- Vite + Playwright 冒烟：320px（≤860px 前的 `.pkg-list-pane` clientWidth 319 / scrollWidth 319）与 220px（视口 700px 时 clientWidth 219 / scrollWidth 219）均无横向溢出；隐藏滚动条下未发现内容被裁。
- 中文界面核验：清单 / 输入参数 / 数据源 / 声明的 Task / 资产 / 发布标题与三张表表头均显示中文词条；console error 为 0。

