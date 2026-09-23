## Context

`agent-web` 当前已在 `60c2c57` 完成一次类 Notion 目标视觉迁移，`check:ui-tokens`、`typecheck`、`build` 均可作为当前基线；但固定视口截图证据、当前 Cursor Grok 4.7 独立审查报告和 P0/P1 处置记录尚不存在。本地服务当前未监听 `9610`、`9611`、`9612`、`9613`，`agent-web` 未安装 `@playwright/test`，Chromium 缓存中已有可用浏览器。历史 `ui-check.md` 明确是旧快照，至少导航隐藏、`.settings-page` 选择器和通知外层 `aria-live` 三条已与当前源码不符，不能作为本轮修复清单。

动机与边界见 `proposal.md`；本文件只决定如何组织证据、审查、修复和编排子 change，不重复验收标准。

## Goals / Non-Goals

**Goals:**

- 先建立可重复的固定视口证据流程，再审查当前 UI，避免仅凭源码或历史报告下结论。
- 以当前代码、当前文档、当前截图和当前 diff 为审查范围，产出带日期、endpoint、模型、基线和范围的只读报告。
- 将审查发现按问题域拆成同 planning root 的 `ui-detail-polish-<slice>` 子 change；每个 P0/P1 都有修复证据或明确接受理由，P2 有处理状态。
- 只做呈现层、可访问性、窄宽度细节、证据工具和 OpenSpec 编排，保持功能契约与线上状态不变。

**Non-Goals:**

- 不改 `ui-v1.md` 的功能行为、状态机、API、错误语义、安全边界或领域对象。
- 不新增业务页面、路由、第三方 UI 框架、暗色主题，也不因参考设计新增命令面板、看板等不存在的功能。
- 不把历史 `ui-check.md` 的旧行号或已漂移条目直接当作修复项；不为 Avoid 子串或不可测口号新增 linter。
- 不执行 commit、push、归档、打 tag、部署、合并或其他线上状态变更。
- 不以 `build` 通过、旧报告或静态 grep 替代截图和浏览器冒烟。

## Decisions

1. **证据先行。** 恢复最小 Playwright 截图脚本和本地 dev/mock 启动链路，固定 `375/860/1280px`、`zh-CN/en` 可用状态、五视图 query、详情/空态/错误等可复现状态；输出目录只存本地证据，不写入密钥或内部 URL。服务不可启动、浏览器不可用或某状态不可达时保留对应 checkbox，并在 proposal 验证记录逐条写明原因。
2. **审查范围分两层。** 第一层审查 `60c2c57` 相对父提交的 UI 源码、UI 文档和检查工具 diff；第二层审查截图和运行时 DOM/CSS 行为。历史报告只作为“需重新验证”的线索，不继承其 P0/P1 结论。
3. **Cursor 审查采用只读输入。** 使用 `/home/wii/.local/bin/cursor` 的 agent 模式，显式传入模型 `grok-4.7`，以 read-only/plan 方式读取当前源码、当前文档、截图清单和 diff；报告必须记录 endpoint、模型完整字符串、日期、基线 SHA、输入范围和“不改文件”要求。若环境无法确认模型或只能产生旧报告，则保持审查 checkbox 未勾并记录阻塞，不伪造当前报告。
4. **按问题域拆子 change，不按历史编号照搬。** 预先登记三个可独立验收的同前缀子 change：`ui-detail-polish-evidence`（截图工具、证据与运行时检查）、`ui-detail-polish-view`（P0/P1 视图/组件/ARIA/窄宽度修复）、`ui-detail-polish-docs`（当前审查指出的文档权威、用语边界和状态回填）。最终拆分可按真实审查结果删改，但不得创建无验收内容的空 change，也不得让 driver 直接改产品代码。
5. **验证从窄到宽。** 先跑 `check:ui-tokens`、`typecheck`、`build` 和必要的静态语义检查；再启动本地 dev/mock 浏览器检查；最后用当前截图和 diff 做 Cursor 审查。每个 P0/P1 必须绑定修复提交前后的证据或接受理由，P2 写入状态记录，不把“已知债务”升级为无证据的新缺陷。
6. **driver 只做编排。** 子 change 的 `tasks.md` 是唯一实现进度；driver 的实施 checkbox 只在对应子 change 全勾且 `openspec validate --strict --type change <name>` 通过后勾选。分支、提交、归档和线上动作遵守 proposal 中的 `Driver 协议`，不由本 design 改写。

## Risks / Trade-offs

- [历史报告已漂移，照单修复会重新引入旧问题] → 只把历史报告作为线索；每个 finding 必须由当前源码、截图或运行时行为复核后才能进入子 change。
- [本地服务和 Playwright 依赖当前缺失，截图可能无法立即执行] → 先建立可重复的安装/启动命令和状态表；任何阻塞保持未勾，不以静态检查替代。
- [Cursor 模型、endpoint 或输出格式不可控] → 在报告中记录实际可验证的 endpoint、模型和输入；无法确认时把任务保持未勾并列出阻塞原因。
- [审查发现可能同时触及共享 CSS、视图和文档] → 按 evidence/view/docs 切片，明确文件范围；共享冲突按声明顺序执行，避免 driver 直接改实现。
- [截图状态受 mock 数据和 API 状态影响] → 固定 URL、viewport、locale、状态动作和等待条件；不可达状态标记 blocked 并保留原因。
- [视觉修复可能误伤功能或可访问性语义] → 保留路由、查询参数选中、`.pane-item`/`.is-current`/`.is-active`、status/alert 和仅亮色约束；每轮回归后再进入下一片。

## Migration Plan

1. 准备阶段记录工作树、分支、服务端口、浏览器和依赖状态；按 `Driver 协议` 处理分支选择。
2. 创建 `ui-detail-polish-evidence`、`ui-detail-polish-view`、`ui-detail-polish-docs` 三个子 change 的 `.openspec.yaml`、`proposal.md`、`design.md`、`tasks.md`，均设 `skip_specs: true` 并先完成提案工件。
3. 先完成 evidence 子 change：恢复截图脚本/配置、启动 dev mock、采集固定视口证据并记录状态。
4. 使用当前截图、当前源码和当前文档执行 Cursor Grok 4.7 只读审查，形成当前报告；将真实 P0/P1 映射到 view/docs 子 change，无发现则在证据与报告中明确“零 finding”。
5. 逐个 apply view/docs 子 change，修复或逐条接受 P0/P1，处理 P2 状态，并在各自 proposal 验证记录中回填命令、证据路径和理由。
6. 运行回归、浏览器冒烟和最终审查复核；回填 driver 的验收标准与验证记录。
7. 仅在用户明确要求时才执行提交、推送、归档或其他线上动作；本轮默认停在可验证的本地工件状态。

## Open Questions

无。截图工具安装、本地服务启动、Cursor 模型调用方式和子 change 拆分均已有可执行的默认路径；若执行中出现依赖、模型或环境阻塞，按 proposal 的验证记录逐项保留原因，不需要在提案阶段改变范围。
