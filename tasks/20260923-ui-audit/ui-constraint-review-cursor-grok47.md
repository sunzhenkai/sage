# agent-web UI 约束治理评审

- 日期：2026-09-23
- 角色：只读独立评审（不改产品源码）
- 范围：约束文档本身。不重审整套界面，不把已写明的刻意取舍（仅亮色、三段式、园丁台身份）当成视觉问题。
- 行号对应本次检出的文件正文。`openspec/` 在工作树中不存在，`git ls-files 'openspec/*'` 无结果。

## 结论

**需修订。** 现行结构契约（`layout-v1.md` 的三段式、`.pane-item`、仅亮色）可以留下。不能留下的是三套互相打架的“看起来还有效”的规则：旧实现 prompt 仍用祈使句取消样式验收、参考视觉稿仍被写成评审基线、用语 Avoid 没有适用范围。量化规则里，列宽、通知条数、对比度注释是可核对的；「90% 灰阶」「动效仅三种」「全站唯一选中类」要么不可测，要么已经和同一份契约或 `global.css` 矛盾。

必须先做的 5 件事：

1. 在 `ui-v1-frontend-prompt.md` 文件自身标明归档，并改掉 §3 末条、§4、§8 里「样式自由 / 明确不设限」。同时删掉 `layout-v1.md` 的「prompt 不修改」。仓库内没有发现指向该 prompt 的 agent 默认加载配置，不要为一条不存在的路径做移除。
2. 把 `design-language.md` 的状态从「供实现与评审对照」降为历史参考，写明不得用于验收；停用 §12 速写提示。不要把它改写成第二份园丁台 token 手册。
3. 在 `layout-v1.md` 写明排他权威：结构与列表/通知语义以该文件为准，色值与动效时长以 `global.css` 的 `:root` 为准，冲突时 CSS 赢。改掉已经不成立的「动效仅三种」「时长走 `--dur-*`」「全站唯一选中类」。
4. 给 `CONTEXT.md` 的 Avoid 加上适用范围（用户可见称呼），并写明 Chat / Task / Run / entry / 「默认模型」在领域对象、API 字段、规格简称上的例外。不要据此去改 `runId`、`taskId`、`entry`。
5. 在 `ui-check.md` 文首标明一次性快照、不是长期约束，并注明至少三条已与当前源码不符（导航标签隐藏方式、`.settings-view`、通知栈的 live region）。

## 文档清单与权威层级

| 文档 | 应有层级 | 文件自己怎么说 | 评审判断 |
| --- | --- | --- | --- |
| `docs/design/ui/ui-v1.md` | functional contract | `implemented behavior baseline`；非范围含一切界面描述（`ui-v1.md:3-9`） | 功能行为的权威。头部非范围与 §3.2、§3.3、§4.1、§4.2 的界面条款互相打架，见 P2-3。 |
| `docs/design/ui/layout-v1.md` | active | 「呈现层验收依据」（`layout-v1.md:3-4`） | 布局与列表选中、通知条数、仅亮色的验收契约。token 数值、动效穷尽、选中类穷尽写过了头，且部分已与运行时不符。 |
| `platform/apps/agent-web/src/styles/global.css` 头注与 `:root` | runtime truth | 园丁台主题；布局 token「唯一定义处」（`global.css:1-4`、`global.css:7-42`） | 色板、半径、字栈、布局变量的事实来源。头注不覆盖组件清单。 |
| `platform/apps/agent-web/index.html` | runtime truth（单点） | `color-scheme: light`（`index.html:7`） | 与 `layout-v1.md:77` 的仅亮色决策一致。不是问题。 |
| `CONTEXT.md` | 用语契约，且应很窄 | 「只收已经拍板的词，不写实现细节」（`CONTEXT.md:3`） | 首选词可以留。Avoid 没有读者、表面、例外，已被检查报告当成字符串禁令。 |
| `docs/design/ui/design-language.md` | reference | 状态写 reference，但同一行要求「供呈现层实现与评审对照」（`design-language.md:3-5`） | 参考截图摘录。正文和 §12 仍像现行视觉规范，且与园丁台运行时不是同一身份。 |
| `docs/design/ui/ui-v1-frontend-prompt.md` | historical prompt | 自身无状态行；开篇仍是「你的任务」（`ui-v1-frontend-prompt.md:1-13`） | 只在别的文件里被宣布为历史。文件本身仍命令实现者不要做样式验收。 |
| `platform/apps/agent-web/README.md` | 索引，不是独立权威 | 功能「唯一依据」`ui-v1.md`（`README.md:3`）；呈现验收指向 `layout-v1.md`（`README.md:55`） | 复述第三遍。停在第 3 行的读者会漏掉呈现契约。 |
| `tasks/20260923-ui-audit/ui-check.md` | 一次性 findings | 日期、基线 `725ad1f`、只读检查（`ui-check.md:1-8`） | 不是约束。文内修复建议已有条目与当前源码不一致。 |
| `docs/design/README.md` | 非 UI 索引 | 文档职责未列任何 `docs/design/ui/` 文件（`docs/design/README.md:149-167`） | 发现缺口，不是视觉规范。 |
| `docs/design/ai-app/app-task-run-model.md` | 领域模型，不是 UI 规范 | Run、`entry` 是契约字段（`app-task-run-model.md:20-59`） | 用来说明 Avoid 会误伤真实对象。不纳入 UI 验收。 |
| `layout-v1.md:5-6` 所引 `openspec/changes/...` | 被引用的决策记录 | 工作树无 `openspec/`，git 未跟踪该路径 | 来源不可达。未证实这些文件是否曾存在于其他分支。 |

查过、不列为 UI 呈现约束：`platform/docs/` 的生产治理与部署（其中 MinIO UI 只是端口）、`docs/design/_cross/` 的 token/cost 预算、`docs/design/open-questions.md` 里「Library 不依赖 UI」。这些是后端、预算或依赖边界。

未发现本仓库的 `AGENTS.md`、`.cursor/` 规则或 skill 索引把 `ui-v1-frontend-prompt.md` 列为默认加载文件。候选 A 里的「默认加载路径」**未证实**。实际暴露面是：该文件与 active 契约同在 `docs/design/ui/`，且全文仍是祈使句。

## 不合理项

### P0

**P0-1. 旧 prompt 在同目录里仍取消呈现验收，归档声明不在该文件上。**

- 证据：`ui-v1-frontend-prompt.md:13`、`:70`、`:72-77`、`:111` 要求结构、配色、动效、断点自行决定，并写明「样式是自由度，不是验收项」「优先……而不是视觉一致性」。同目录 `layout-v1.md:3`、`:8` 与 `README.md:55` 写验收以 layout 为准、prompt 只是历史且「不修改」。
- 为什么不合理：失效声明写在别的文件里。只打开 prompt 的实现者得到的指令与 active 契约相反。`layout-v1.md:8` 的「不修改」把这个口子固定住了。这是写明的取舍，但它使冲突无法在被引用的那份文件上关闭。
- 影响：呈现层返工会被 prompt 解释成「规格允许」。功能约束（技术栈、安全边界、§6 功能自检）仍有效，不该整文件删除。

### P1

**P1-1. `design-language.md` 以评审基线的口吻描述另一套产品身份。**

- 证据：定位是 Linear / Notion、白底、Tailwind 灰阶（`design-language.md:9`、`:20-28`）。运行时是暖纸、墨绿、鼠尾草（`global.css:1-4`、`:7-21`；`layout-v1.md:78`；`README.md:53`）。参考稿自己也写色值落地以 `global.css` 为准（`design-language.md:5`），但状态行仍要求「实现与评审对照」（`:3`）。
- 为什么不合理：reference 可以保留摘录。把它同时当成对照基线，评审就会用白灰发丝线去否定园丁台，或让生成任务按 §12 画回 Linear（`design-language.md:118-120`）。
- 影响：视觉返工方向会反。身份漂移不是「文档还没补色值」，两套色相和材质都不同。

**P1-2. 参考稿把本仓库不存在的组件写成反复出现的组件语言。**

- 证据：命令面板、看板列、keycap、看板状态三位一体（`design-language.md:83-90`、`:92-104`）。在 `platform/apps/agent-web/src` 内检索 `command palette` / `看板` / `keycap` 无对应实现。运行时选中反馈是 `.pane-item.is-current` 与 `.rail-link.is-active`（`global.css:161-166`、`:760-774`），不是灰胶囊看板。
- 为什么不合理：组件清单没有「本产品未采用」的边界。对照评审会把缺失的命令面板、看板当成缺口。
- 影响：验收范围被参考截图撑大。未逐屏证明「永远不存在这些组件」；能证实的是当前 `agent-web` 源码没有这套结构。

**P1-3. 色、状态色、动效时长没有排他的 source of truth。**

- 证据：`design-language.md:30-38` 把蓝/琥珀/绿/红绑到完成、进行中、审核、阻塞。`global.css:431-438` 的徽标是另一套：succeeded/running 用 `--sage`，paused/warning 用 `--amber`，failed 用 `--clay`，info 用 `--steel`。`layout-v1.md:55-64` 只抄了 `--faint`、`--faint-text`、`--amber` 和布局 token，没覆盖 `:root` 里的 `--paper`、`--sage`、`--clay`、`--shadow-pop`。`layout-v1.md:70-72` 写动效仅 view-in、bud-pulse、spinner，且时长走 `--dur-*`；同节 `:70` 又规定第四种 `notice-in` 120ms。运行时有四段 `@keyframes`（`global.css:254`、`:311`、`:563`、`:904`），`notice-in` 写死 120ms（`:308`），spinner 写死 `0.8s linear`（`:555`），不走 `--dur-*`。
- 为什么不合理：不是「完全没有划分」。划分有了，但不排他：reference 仍发色义，active 契约既抄数值又与自己的动效清单冲突，CSS 才是实际生效的值。再添一份 token 文档会变成第四个头。
- 影响：改一个琥珀或一条动效，三处文档和 CSS 会各说各话。按 layout 字面验收，当前 spinner 与 `notice-in` 会同时「违规」和「被要求存在」。

**P1-4. 「全站唯一选中类」按字面已经不成立，且和导航契约冲突。**

- 证据：`layout-v1.md:38` 写 `.is-current` 是全站唯一选中类，禁止视图私有变体。主导航与设置子菜单用 `.rail-link.is-active`（`App.tsx:124`、`SettingsView.tsx:43`，样式 `global.css:161-166`）。分段控制用 `.segmented-item.is-active`（`ui.tsx:249`，样式 `global.css:533`）。目录选项用 `.catalog-combobox-option.is-active`（`ProvidersView.tsx:1015`）。`CONTEXT.md:50` 还要求子菜单与主菜单同一套 hover/选中，也就是 `is-active`，不是 `is-current`。
- 为什么不合理：「列表行只用 `.pane-item` + `.is-current`」是可执行的。括号里的「全站唯一」把 rail、分段、combobox 一并禁掉，和同一系统的导航规格相反。
- 影响：严格评审会要求把 `is-active` 并进 `is-current`，破坏导航与列表两种语义。

**P1-5. `CONTEXT.md` 的 Avoid 过泛，和功能契约、领域模型用的是同一批词。**

- 证据：文首说不写实现细节（`CONTEXT.md:3`），但没有「只约束用户可见文案」。Session 的定义是「一条 Chat 会话」，Avoid 含 `chat（当作对象时）`（`:19-21`）。Task 禁止在指本实例时说 Run（`:29`）；Chat Run 禁止单独说 Run，也禁止说 Task（`:35-37`）；Declared Task 禁止单独说 Task，并禁止 `entry`（`:31-33`）。「默认运行模型」禁止「默认模型」（`:39-41`）。同一仓库里，`ui-v1.md:15-18`、`:69`、`:77`、`:313`、`:647`、`:879` 使用 AI App / Package、Run、默认模型；`layout-v1.md:51` 写 pinned「默认模型」；`app-task-run-model.md:57-59` 把 `entry` 和 Run 当作契约字段。`ui-check.md:52-80` 已把这些 Avoid 收成 P1 文案缺陷，包括列头 `entry` 和「重试此 Run」。
- 为什么不合理：「当作对象时」「单独使用」「当说话人其实指这条实例」没有操作定义，普通英语、视图名 Chat、API 字段和用户可见标签会被同一条规则打中。首选词本身是拍板结果，问题在禁令半径。
- 影响：英文界面、规格和代码标识会被要求改成绕口的全称；功能契约与布局契约里的「默认模型」会被判违规。未证实界面上每一处 Run/Task 都是误用，只证实规则覆盖面大于它声明的「用语」。

**P1-6. 不可测或已自相矛盾的量化禁令，缺少验证点和例外。**

- 证据与区分：
  - 不可测：`design-language.md:14`「90% 界面是灰阶」；`:13`「几乎不用阴影」；`:108`「全中文界面」。后者还和 `ui-v1.md:116-122` 的 zh-CN/en 双语冲突。
  - 有数字但没有判定程序：`layout-v1.md:31`「至多一个」视图级主按钮。例外只点了对话空态 CTA，没有定义怎样算主按钮。本次未逐视图数按钮，不把当前界面记成违规。
  - 看起来可测、文本已经假：`layout-v1.md:72`「动效仅三种」「时长走 `--dur-*`」，见 P1-3。`--pane-gap` 在 `layout-v1.md:59` 与 `global.css:39` 有定义，全 `agent-web` 无消费者。
  - 可核对、应保留：`--pane-list-w` 只在 `global.css:36` 与 `:913` 赋值；通知 6s / 上限 4 与 `Feedback.tsx:40-42` 一致；对比度注释在 `global.css:14`、`:23` 与 `layout-v1.md:62-64` 重复，但是测量记录而不是无法理解的禁令。
- 为什么不合理：把可核对的不变量和口号式比例写在同一层，评审无法决定哪条该自动化、哪条该忽略。
- 影响：要么全部当成口味不执行，要么用「90%」「仅三种」打出假失败。

### P2

**P2-1. `ui-check.md` 被放在审计目录里，文体却像待办规范，而且已经漂移。**

- 证据：`ui-check.md:6-8` 把 `layout-v1` 和 `CONTEXT.md` 当作本轮依据，并给出「应修」。`:22-26` 称 `.rail-label` 为 `display: none`，选择器是 `.settings-page`。当前折叠与窄屏用的是 clip 隐藏（`global.css:181-195`、`:922-935`），子菜单选择器是 `.settings-view .settings-nav`（`:953`）。`:34-37` 称通知栈外层 `aria-live="polite"`。当前 `Feedback.tsx:87-89` 的栈没有 `aria-live`，子节点各自 `role="alert"` / `role="status"`。
- 为什么不合理：一次性报告可以保留。不标明快照，后续评审会把过期行号当成未关闭约束。
- 影响：重复修已经变过的导航和通知，或用旧行号争论。其余 P1/P2 条目本次**未复核**是否已修，不能从这两处漂移推出整份报告作废。

**P2-2. 呈现规则有三处同义复述。**

- 证据：园丁台身份出现在 `global.css:1-4`、`layout-v1.md:78`、`README.md:53`。prompt 已过时出现在 `layout-v1.md:8` 与 `README.md:55`，不出现在 prompt 自己身上。布局数字同时写在 `layout-v1.md:56-61` 和 `global.css:35-41`。`.page` 又把 16px/20px 写死（`global.css:731`），不使用 `--page-pad-*`。
- 为什么不合理：复述没有「谁赢」。README 第 3 行的「功能契约唯一依据」也容易被读成整个 UI 只有 `ui-v1.md`。
- 影响：改主题或改 prompt 地位时要改三份，漏一处就回到 P0。

**P2-3. `ui-v1.md` 宣布界面为非范围，正文又规定壳层、反馈语义、语言入口个数和列表时间格式。**

- 证据：`ui-v1.md:7-9` 对「页面结构、组件形态、布局、样式与视觉呈现」全部非范围。`:93-95` 规定当前视图可辨识、折叠偏好、全局「新建对话」。`:99-108` 规定 status/alert、加载、空态的语义（形态仍放开）。`:130` 规定语言切换在 rail 底部、通用面板、模型与连接面板各一处。`:136-138` 规定三种时间格式，列表行固定 `MM-DD HH:mm`。
- 为什么不合理：这些条款多数是功能可观察行为，不该被「非范围」一笔勾销，也不该被 prompt 的「样式自由」勾销。现在两句都绝对，读者不知道语言入口和时间格式算不算验收。
- 影响：和 layout 的通知形态（`layout-v1.md:70`）叠在一起时，语义层和形态层的边界要靠猜测。两者内容大体衔接，不是第二套配色。

**P2-4. 布局契约的决策来源是死链。**

- 证据：`layout-v1.md:5-6` 指向 `openspec/changes/agent-web-three-pane-layout/` 与 `openspec/changes/archive/2026-09-23-agent-web-three-pane-layout/design.md`。工作树没有 `openspec/` 目录，`git ls-files` 无匹配。根 `README.md:18`、`:61` 也写了 `openspec/`，同样打不开。
- 为什么不合理：契约正文仍可读，但「实现取舍见某文件」无法核对。未证实该目录是否只存在于未合并分支。
- 影响：不能把缺失的 design.md 里的例外补进评审。不要为了死链重开三段式决策。

**P2-5. 用语表自己写了一条视觉规则。**

- 证据：`CONTEXT.md:49-51` 规定子菜单在「内容卡片左侧」，且与主菜单同款 hover/选中，并 Avoid「侧边栏 / 二级 rail / tabs」。`layout-v1.md:25`、`:51` 才是列结构和 `.rail-link` 的验收描述。
- 为什么不合理：与文首「不写实现细节」不一致。视觉是否同款应由 layout 与 `.rail-link` 判定，Avoid「tabs」会误伤设置里真实的 tab 查询参数（`ui-v1.md:81` 的 `tab=general|connections`）。
- 影响：术语评审和布局评审抢同一条规则。

## 初步结论复核

| 候选 | 判定 | 说明 |
| --- | --- | --- |
| A. prompt §3/§4 与 layout 冲突，应归档或移出默认加载路径 | **修正后同意** | 冲突成立，见 P0-1。同意给文件自身加归档状态并改掉样式自由条款。不同意把「移出 agent 默认加载路径」写成已证实问题：仓库内没有这种配置。真正的暴露面是 `docs/design/ui/` 并列和祈使语气。`layout-v1.md:8` 的「不修改」应撤销，否则归档做不到。功能纪律（安全、技术栈、§6 对 `ui-v1` §14 的自检）不要随样式条款一起删。 |
| B. design-language 仍是 Linear/Notion，与园丁台运行时身份漂移 | **同意** | 见 P1-1、P1-2。补充：文件第 5 行已经把色值权威让给 CSS，所以不是「完全没声明层级」，而是状态行和正文、§12 把 reference 又抬回评审/生成规范。命令面板和看板在当前 `agent-web` 源码中未找到。 |
| C. 两份文档同时当视觉/布局权威，token 与状态色没有唯一来源 | **修正后同意** | 方向对，见 P1-3。过满的说法是「没有唯一来源」。已有不完全划分：layout = 结构验收，CSS = 主题变量，design-language = 参考且自称色值让位。缺的是排他和冲突规则。状态色在 reference 与 `.badge-*` 之间确实没有归属。不要新建第四份 token 规范。 |
| D. 量化规则过多且不可测 | **修正后反对一刀切** | 「过多且都不可测」不成立。320/220、通知 6 秒与 4 条、`.pane-item` 三态、对比度注释可以对着 CSS/常量核对。不合理的是没把它们和口号分开，见 P1-6：90% 灰阶、全中文、几乎无阴影、未定义的「至多一个主按钮」、已经写错的「仅三种」「时长走 `--dur-*`」。不要删掉列宽和 `.pane-item` 表。 |
| E. Avoid 过强，Chat/Task/Run 单称容易误伤 | **同意** | 见 P1-5。补充误伤面：`entry` 是 manifest 字段；`ui-v1` 与 `layout-v1` 自己写「默认模型」；「chat（当作对象时）」没有测试标准，而定义句就含 Chat。不要取消 Session / Declared Task / Chat Run 这些首选词。 |
| F. `ui-check.md` 是一次性 findings，不应成为长期约束 | **同意** | 见 P2-1。补充：它不只是「不该升级为规范」，其中导航隐藏、`.settings-page`、通知 `aria-live` 三条已经和当前文件不符。未复核其余条目，不要把整份报告标成「全部过期」。 |

初步结论没有覆盖、本次补上的：

- `layout-v1` 内部就有动效清单自相矛盾（P1-3），不需要等到和 design-language 对比。
- `ui-v1` 的「界面非范围」写得绝对，和它自己的壳层、反馈、语言入口、时间格式冲突（P2-3）。这不是建议把功能规格改成视觉稿。
- 决策来源 `openspec/` 打不开（P2-4）。
- `CONTEXT.md` 混进了子菜单视觉要求（P2-5）。
- 根 `docs/design/README.md` 的文档职责不指向任何 UI 契约，active 契约靠目录偶遇，prompt 也靠目录偶遇。

## 优化方案

| 优先级 | 改哪份 | 改成什么 | 验收 |
| --- | --- | --- | --- |
| P0 | `docs/design/ui/ui-v1-frontend-prompt.md` | 文首加状态：archived / 不得用于呈现验收。删或改写 `:70`、§4 全文、`:111` 的「样式或结构自行决定」。保留技术栈、安全、功能范围和对照 `ui-v1` §14 的自检。文首指向 `layout-v1.md` 与 `global.css` 头注。 | 新读者只读该文件，不能得出「配色和布局可以自定且不验收」。功能自检条款仍在。 |
| P0 | `docs/design/ui/layout-v1.md:8` | 删掉「不修改」。改成：prompt 的样式自由条款已归档，以本文件与 `global.css` 为准。 | 两份文件对 prompt 地位的句子一致。 |
| P1 | `docs/design/ui/design-language.md:3` 与 §8、§9、§12 | 状态改为「历史参考，不得验收、不得作为生成提示」。§8–§9 组件与看板色义前加一句：来自外部截图，不是 `agent-web` 组件清单。§12 速写提示标为停用，或改成指向园丁台头注的一句话，不要保留 Linear/Notion 生成指令。不要在本文件重写一整套 token。 | 评审清单若引用本文件，只能引用「已废弃的参考」，不能引用色值或组件清单作为失败条件。 |
| P1 | `docs/design/ui/layout-v1.md` 开头、§3、§5、§6 | 加五条排他规则：① 结构、列职责、`.pane-item` 列表三态、通知条数与持续时间、仅亮色，以本文件为准；② 色值、半径、字栈、动效时长以 `global.css` `:root` 为准，本文件 token 表改为名称与用途，数值不抄，或注明抄录日期且冲突时 CSS 赢；③ 状态色以 `.badge-*` 为准，不采用 design-language 的蓝完成/绿审核；④ 「全站唯一选中类」改为「列表 item 的选中类只有 `.is-current`」；rail / segmented / combobox 的 `.is-active` 是另一种语义，允许；⑤ 动效清单改成与四段 `@keyframes` 一致，删掉「时长一律走 `--dur-*`」，或让 spinner、`notice-in` 真正改用 token 后再写回这条。`--pane-gap` 要么标成未使用，要么从验收表移除。 | 用本文件逐条能判定对错，且不会把 `global.css:555` 的 spinner 或 `:161` 的 `is-active` 判失败。 |
| P1 | `CONTEXT.md` | 在 Language 下加适用范围：只约束 `agent-web` 用户可见称呼；不约束代码标识、API 路径、query 名、manifest 字段、规格里的领域对象。例外写明：视图名 Chat 可用；durable 实例叫 Task，一轮模型调用叫 Chat Run，单独的 Run 只在已指明哪一种时可用；`entry` 作为字段名可用，用户可见列头不要只用 entry；「默认模型」若作为「默认运行模型」的界面简称，要么允许并在表内注明，要么把 `layout-v1.md:51` 和用户可见文案改成全称，二选一，不要两处各写各的。删掉或移出 `:49-51` 的视觉同款要求，改指向 `layout-v1` §4。 | 不能再把 `en` 句里的 chat、或 `prompts/system.md` 的 `entry` 键，自动判为违规。用户可见的「AI Apps」「Conversations」是否要改，另案对着词表，不在本规则里用子串扫描。 |
| P2 | `tasks/20260923-ui-audit/ui-check.md` 文首 | 加「快照，不是契约；不要作为后续验收依据」。脚注三条已漂移：导航标签、`.settings-page`、通知栈 `aria-live`。其余条目标「未复核」。 | 后续 UI 评审的依据列表里没有这份文件。 |
| P2 | `platform/apps/agent-web/README.md:3` 与 `:51-55` | 第 3 行改为：功能行为以 `ui-v1.md` 为准，呈现以 `layout-v1.md` 为准，色值以 `global.css` 为准。视觉基线段改成链接，不再抄主题散文和 prompt 历史。 | README 不再构成第三份主题正文。 |
| P2 | `docs/design/ui/ui-v1.md:7-9` | 非范围改为：不规定配色、密度、组件皮肤、列宽。保留并点名仍属功能验收的条款：当前视图可辨识、反馈的 status/alert 语义、语言入口三处、三种时间格式。形态细节指向 `layout-v1`，避免两套像素规则。 | 读完头部的人不会认为 §4.2 的 `MM-DD HH:mm` 可以不做。 |
| P2 | `docs/design/ui/layout-v1.md:5-6` | 死链改成「决策来源文件当前不在本检出中」，或在 openspec 真正入库后再链回去。不要凭空补一份 design.md。 | 链接要么可打开，要么明确写不可用。 |
| P2 | `docs/design/README.md` 文档职责 | 增加三行索引：`ui-v1` 功能、`layout-v1` 呈现、`design-language` 历史参考、prompt 已归档。 | 从总览能走到 active 契约，而不是只走到架构文。 |

## 不要改

- 不要改 `global.css` 的暖纸 / 墨绿 / 鼠尾草去贴 Linear 灰阶。那是运行时身份，`layout-v1.md:78` 已承认。
- 不要推翻三段式、层 2 常驻、仅亮色、`.pane-item` 三态。这些是 active 契约，且仅亮色与 `index.html:7` 一致。
- 不要把 `ui-v1.md` 的功能语义、错误码、竞态改成视觉规范，也不要删 §14。
- 不要新写一份「设计 token 总表」把 `:root` 再抄一遍。
- 不要按 `ui-check.md` 的修复建议直接改界面。至少导航隐藏和通知 live region 两条已与源码不符；其余未复核。
- 不要为了 Avoid 重命名 `taskId`、`runId`、manifest `entry`、query `view=chat`。
- `layout-v1.md:66` 写明字号九档未收敛，是已知债务。本轮不要顺手发明一套新 type scale。
- 不要把 `design-language.md` 删掉。降级即可，摘录仍可解释「这套界面不是从参考截图原样落地」。

## Verdict

**需修订。** 结构契约可用，约束体系不能直接当验收标准。先做上面 5 条，再谈自动化检查。在那之前，可自动化的只有很窄的一组：`--pane-list-w` 的赋值点、`.pane-item` / `.is-current` 是否出现在列表行、通知常量是否仍为 6000ms 与 4。不要为「90% 灰阶」或 Avoid 子串写 linter。
