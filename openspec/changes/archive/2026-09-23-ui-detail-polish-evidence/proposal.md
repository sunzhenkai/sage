## Why

当前 `agent-web` 只有 token/类型/构建基线，没有可复现的固定视口截图或运行时状态证据；若不先补齐 evidence，后续 Cursor Grok 4.7 审查无法区分源码推断与真实界面问题，也无法逐条核验 375px、860px、1280px 的五视图表现。

## What Changes

- 恢复并收窄 Playwright 截图配置与截图脚本，固定 `http://127.0.0.1:9612`、本地 dev mock、`375/860/1280px`、`zh-CN/en` 和五视图 query。
- 建立证据清单与状态表，记录 normal、hover、selected、loading、empty、error 等可用状态、截图路径、等待条件和不可达原因。
- 增加可重复的浏览器冒烟检查，核对路由、查询参数选中、`.pane-item`/`aria-current`、status/alert、窄宽度无横向溢出和 console error。
- 输出仅包含本地截图、清单和命令结果，不写入密钥、内部 URL 或生产信息。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。

## Impact

| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | 修改 `platform/apps/agent-web` 的 Playwright/截图工具、package scripts、证据清单和本子 change 的 OpenSpec 产物；不修改产品功能语义 |

## 验收标准

- [x] Playwright 依赖和配置可从工作区安装/解析，截图命令可重复执行；环境不可用时逐条记录阻塞，不以 `build` 替代。
- [x] 五视图在 375px、860px、1280px 均有截图或明确的不可达状态，且清单包含 URL、viewport、locale、fixture、状态和证据路径。
- [x] 浏览器冒烟覆盖路由/查询选中、可见性、窄宽度溢出、ARIA 关键语义和 console error，并保留命令输出。
- [x] `check:ui-tokens`、`typecheck`、`build` 在 evidence 变更后仍通过。
- [x] `openspec validate --strict --type change ui-detail-polish-evidence` 通过。

## 验证记录

### 环境

- Node v24.14.0 · pnpm 10.33.0 · Playwright 1.63.0 · Chromium 153.0.8010.12
- `9612` dev server 200 · `9613` mock API 200
- 分支 `ui-notion-design` · 基线 `60c2c5794cd8be71b27ce6f441172a8bc9a9c493`

### 命令与结果

| 命令 | 退出码 |
|------|--------|
| `corepack pnpm run screenshots` | 0（57 张 PNG + manifest.json） |
| `corepack pnpm run browser-smoke` | 0（6/6 tests passed） |
| `corepack pnpm run check:ui-tokens` | 0（35 target tokens, 7 CSS files） |
| `corepack pnpm run typecheck` | 0 |
| `corepack pnpm run build` | 0（350.28 KB JS / 33.89 KB CSS） |
| `openspec validate --strict --type change ui-detail-polish-evidence` | 通过 |

### 证据路径

- 截图：`platform/apps/agent-web/evidence/screenshots/{375,860,1280}/*.png`（57 张）
- 清单：`platform/apps/agent-web/evidence/screenshots/manifest.json`（每条含 URL、viewport、locale、fixture、aria-current、status/alert、console error、scrollWidth/clientWidth）

### 未覆盖状态

- hover/focus/confirm 交互态未单独截图；已通过 browser-smoke 的 DOM 断言和源码 ARIA 属性核验覆盖关键语义。
- `9612` 代理指向真实 agent-api 而非 `9613` mock，部分 fixture 选中态（ses-trending-report 等）在默认代理下不可达；截图脚本在浏览器端不做代理替换，fixture 选中态通过 URL query 标记。
