## 1. 工具与依赖

- [x] 1.1 确认工作区 Playwright 包、Chromium 版本、`9612` dev server、`9613` mock 和浏览器缓存状态；若缺依赖，安装/解析最小 `@playwright/test` 并记录版本与结果。
- [x] 1.2 增加 `playwright.config.ts` 和 `scripts/screenshots.ts`，固定 `http://127.0.0.1:9612`、三档视口、五视图 query、`zh-CN/en`、fixture/等待条件和 evidence 输出路径。
- [x] 1.3 增加 package script（如 `screenshots`/`browser-smoke`），使截图和浏览器检查可从 `platform/apps/agent-web` 重复执行。

## 2. 证据采集

- [x] 2.1 对五视图在 375px、860px、1280px 运行截图，生成 PNG、清单和版本/命令记录；每个不可达状态标 blocked 并写原因。
- [x] 2.2 对可达的 normal、selected、loading、empty、error、hover/focus/confirm 状态执行浏览器断言并保存 DOM/console 结果。
- [x] 2.3 核验固定 URL、locale、fixture、`.is-current`/`aria-current`、status/alert、窄宽度 `scrollWidth/clientWidth` 和 console error，形成证据状态表。

## 3. 回归与收口

- [x] 3.1 运行 `check:ui-tokens`、`typecheck`、`build`，记录命令、退出状态、截图/清单路径和未覆盖状态。
- [x] 3.2 运行 `openspec validate --strict --type change ui-detail-polish-evidence`，将结果写入 proposal 验证记录。
- [x] 3.3 保持所有未完成项未勾，在验证记录逐条写明依赖、服务、浏览器或状态阻塞原因。
