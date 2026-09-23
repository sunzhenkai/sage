## Context

`agent-web` 当前已能运行 `check:ui-tokens`、`typecheck` 和 `build`，但没有 `@playwright/test`、截图脚本、证据清单或当前截图；Chromium 缓存中已有 151/153/154 三个版本，本地 `9610/9611/9612/9613` 服务当前健康，dev server 绑定 `0.0.0.0:9612`，mock API 返回固定本地数据。历史截图脚本和报告只能作为工具线索，不能作为当前证据。

本子 change 只负责 evidence 工具、截图和浏览器检查，不负责 Cursor 报告、UI 修复或文档修订。

## Goals / Non-Goals

**Goals:**

- 建立固定视口、固定 URL、固定 locale 和固定 fixture 的可重复截图流程。
- 记录五视图、三档视口、可用状态、失败/阻塞原因、浏览器和依赖版本。
- 通过浏览器 DOM/CSS 检查验证关键结构、选中、ARIA、窄宽度和 console 行为。
- 为 driver 的 Cursor 审查提供当前证据清单和可引用路径。

**Non-Goals:**

- 不改 `ui-v1.md` 功能契约、API、领域字段或安全边界。
- 不修 P0/P1；审查后的修复归 `ui-detail-polish-view`。
- 不修改文档权威关系；文档 finding 归 `ui-detail-polish-docs`。
- 不新增业务页面、命令面板、看板或暗色主题。
- 不执行提交、推送、归档、打 tag、部署或其他线上动作。

## Decisions

1. **使用当前工作区安装 Playwright。** 以 `@playwright/test` 为 devDependency，优先使用缓存 Chromium；若锁定版本与缓存不匹配，记录版本并先做最小解析/安装，不依赖历史绝对路径导入。
2. **dev server 复用现有健康进程。** `9612` 当前返回 200，mock API 当前返回 200；脚本不启动或杀掉已有服务，先检查健康，再在固定 URL 打开页面。需要 mock 时记录 `SAGE_API_PROXY_TARGET=http://127.0.0.1:9613`。
3. **截图按视口×视图组织。** 输出到 `platform/apps/agent-web/evidence/screenshots/<viewport>/<view>[-state].png`，每张图记录 URL、viewport、locale、fixture 和状态；状态不可达则在清单标 `blocked` 并写原因。
4. **状态集合以现有可复现行为为准。** 五视图至少覆盖 normal/selected/loading/empty/error 中实际可达到的状态；hover、focus、confirm 等通过交互动作或 DOM 检查补充，不伪造不可达数据。
5. **检查从 DOM 断言开始。** 覆盖五视图 query、`.is-current`/`aria-current`、status/alert、列表横向溢出、console error 和窄宽度布局；截图是视觉证据，不替代断言。
6. **证据目录本地、非密钥。** 清单、报告、截图和日志只保存在工作区允许的 evidence 目录；不记录 `SAGE_SERVICE_TOKEN`、API key、内部 URL 或凭据。

## Risks / Trade-offs

- [当前没有 Playwright 包，安装可能受网络/锁定版本影响] → 先解析版本并记录失败；可用 Chromium 缓存时只补最小依赖，失败保持任务未勾。
- [dev server 和 mock 进程已存在，重复启动会冲突] → 只做 HTTP 健康检查和复用，不启动第二个 `strictPort` 服务。
- [截图状态受 fixture/API 影响] → 固定 URL、locale、viewport、fixture 和等待条件；不可达状态写入 blocked，不伪造成功。
- [浏览器版本与历史工具不一致] → 记录实际浏览器版本和 Playwright 版本；不以历史 `playwright-report.json` 代替当前运行。
- [隐藏滚动条可能掩盖横向溢出] → 同时用 `scrollWidth/clientWidth` 和截图检查，失败保留证据。
- [截图脚本可能误把空态当成错误] → 以 DOM 状态和 fixture 共同判定，清单记录每个状态的判定条件。

## Migration Plan

1. 在 `platform/apps/agent-web` 增加最小 Playwright 依赖、配置和 `evidence/screenshots` 目录。
2. 实现固定五视图/三视口/中英文截图脚本，输出 PNG 与 Markdown/JSON 状态清单。
3. 实现浏览器冒烟断言，覆盖 query、选中、ARIA、溢出、console error 和状态可达性。
4. 启动检查使用现有 `9612`、`9613` 健康服务；若端口不可用，停止并记录阻塞。
5. 运行截图、断言和 `check:ui-tokens`/`typecheck`/`build`，把结果回填本子 change。
6. 回滚只回滚 evidence 工具和 package scripts，不回滚产品源码或功能契约。

## Open Questions

无。Playwright 安装、浏览器版本、服务端口和状态集合均可通过当前环境实际运行结果确定；失败按验证记录保留，不在提案阶段改变范围。
