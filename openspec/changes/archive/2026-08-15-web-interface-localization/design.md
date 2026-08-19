## Context

Agent Web 是单个 React/Vite 应用，`main.tsx` 负责公共 shell 与页面分发，Chat、Task、Workspace、Provider、Profile 的用户可见文案目前直接分布在各组件中。应用已经使用 `localStorage` 保存浏览器侧 Provider Profile，但没有 locale 类型、翻译资源、语言上下文或统一格式化入口。

本变更横切多个 Web 模块，但不改变服务端 API、URL 查询参数、领域模型或持久化数据结构。需要在保持现有导出组件可测试、现有业务交互不变的前提下，加入两种语言、确定性的启动解析、运行时切换和完整回归验证。

## Goals / Non-Goals

**Goals:**

- 建立唯一的 locale 规范形态：`zh-CN | en`。
- 建立确定性的初始化优先级：有效的显式用户选择 > 浏览器首选语言 > `zh-CN`。
- 提供应用级 locale context、typed message key、插值和 locale-sensitive 格式化入口。
- 覆盖公共 shell 与 Chat、Task、Workspace、Provider、Profile 的静态和动态界面文案。
- 让语言切换即时生效、尽力持久化，并同步文档语言与可访问名称。
- 以单元、组件和浏览器 smoke 验证回退、切换、翻译完整性和业务回归。

**Non-Goals:**

- 不本地化服务端返回的用户内容、模型名称、Provider 名称、任务数据、artifact 内容或日志。
- 不新增服务端用户偏好 API、账号级语言同步、数据库字段或 URL locale 路由。
- 不支持 `zh-TW`、`zh-HK` 等独立翻译包；当前所有 `zh-*` 浏览器偏好映射到 `zh-CN`。
- 不重构现有页面导航、业务状态机、API client 或视觉系统。
- 不引入运行时机器翻译或异步加载翻译包。

## Decisions

### 1. 使用轻量 typed locale 模块，不新增第三方 i18n 运行时

在 `@sage/agent-web` 内建立 locale 类型、两套 message dictionary、解析函数、React provider/hook 和格式化 helpers。英文资源定义完整 key 形状，中文资源必须满足相同 key 集；调用方只通过 `t(messageKey, values?)` 获取产品文案。

选择该方案是因为当前仅有两种语言、单个前端包、无需复数规则或远程资源加载，typed dictionary 足以提供编译期约束和较小迁移面。备选 `i18next`/`react-intl` 能提供更丰富生态，但会增加依赖、抽象和测试面；若未来需要多语言、复杂复数或按需加载，再以当前 locale contract 为边界替换实现。

### 2. 只在边界规范化 locale

内部仅使用 `zh-CN` 和 `en`。初始化解析顺序如下：

1. 尝试读取同源存储键 `sage.web.locale`；值能规范化为受支持 locale 时直接采用。
2. 没有有效显式选择时，按顺序读取 `navigator.languages`，并以 `navigator.language` 作为兼容输入。
3. 对输入执行大小写不敏感的 BCP 47 前缀匹配：`zh`/`zh-*` 映射 `zh-CN`，`en`/`en-*` 映射 `en`。
4. 语言 API 不可读、抛错、为空或所有结果均不受支持时，采用 `zh-CN`。

无效持久化值会被隔离而不是扩展为新的内部形态。备选方案是将任意语言交给浏览器或使用 `en` 作为默认，但这会破坏“检测失败默认中文”的明确产品契约。

### 3. 显式选择即时更新，持久化为 best-effort

语言控件调用应用级 `setLocale`，先更新内存状态并重渲染，再尝试写入 `sage.web.locale`。写存储失败不能撤销当前选择、阻塞渲染或使应用进入错误页。下一次加载时，有效持久化选择优先于浏览器检测；自动检测结果本身不写入存储，以免把环境推断伪装成用户决定。

控件使用原生可访问表单语义，选项名称同时保持“中文”和“English”的自描述能力，避免用户进入陌生语言后无法找回切换入口。

### 4. locale provider 位于公共 shell 之上

在应用 bootstrap 根部挂载 provider，使 shell、导航和所有页面共享同一 locale。`WorkspaceShell` 承载语言控件；页面组件通过 hook 获取 `t`、`locale` 和格式化 helpers，不在各页面重复检测或读取存储。

provider 每次 locale 变化时同步 `document.documentElement.lang`。测试或嵌入场景若没有可写 `document`/storage，纯解析函数与注入式环境边界仍可独立运行。

### 5. 产品文案与业务数据分离

以下内容必须进入翻译资源：导航、标题、按钮、字段标签、placeholder、空态、loading/error/status 辅助文案、确认提示、`aria-label`、`title` 以及由前端组合的动态句子。日期时间统一通过当前 locale 的 `Intl.DateTimeFormat` 或等价 helper 格式化。

用户输入、服务端原始错误细节、Provider/model 标识、Task/Chat 内容与 artifact 数据保持原样；只有包裹这些数据的产品文案本地化。领域枚举的展示标签可翻译，但发送给 API 的原始值不得改变。

### 6. 分层验证 locale contract

- 纯函数测试覆盖持久化值、浏览器语言顺序、大小写/地区标签、异常、空值和不支持语言。
- dictionary 完整性测试确保 `zh-CN` 与 `en` key 集一致，且不允许空翻译。
- provider/组件测试覆盖即时切换、持久化优先级、存储失败和 `<html lang>` 同步。
- 关键页面在两种 locale 下断言代表性文案，并复跑现有交互、响应式和可访问性测试。
- 浏览器 smoke 分别验证中文默认回退、英文自动检测、显式切换及刷新后恢复。

## Risks / Trade-offs

- [Risk] 全量提取分散文案容易遗漏低频 error、empty 或 accessibility 文案 → 以源码扫描清单、dictionary key parity 测试和关键页面双语 smoke 共同兜底。
- [Risk] 替换文案会使现有依赖英文文本的组件测试脆弱 → 保留业务行为断言，按 locale 显式渲染并更新必要的可见文本断言，不降低原有覆盖。
- [Risk] `localStorage` 或 `navigator` 在隐私模式、测试环境中抛错 → 所有环境访问集中在边界并使用异常隔离，最终确定性回退 `zh-CN`。
- [Risk] 轻量实现未来面对复杂复数和更多语言时能力不足 → 保持 message key 与 locale provider API 稳定，未来可在不改页面调用契约的情况下替换底层实现。
- [Trade-off] 首版翻译资源随主 bundle 同步加载，增加少量体积，但避免异步闪烁和启动失败分支。

## Migration Plan

1. 先加入纯 locale 解析、typed dictionaries、provider/hook 与独立测试，不改变页面行为。
2. 在应用根部接入 provider 和语言控件，同步 `<html lang>`。
3. 按公共 shell、Workspace/Chat、Task、Provider/Profile 的顺序迁移文案与日期时间格式化；每一组同步更新测试。
4. 执行 dictionary 完整性、Web 全量测试、typecheck、production build 和双语浏览器 smoke。
5. 若上线后需要回滚，可移除 provider/控件并恢复静态英文调用；持久化键是客户端非关键数据，无需服务端迁移，旧值可安全忽略。

## Open Questions

无。首版固定支持 `zh-CN` 与 `en`，使用 `sage.web.locale` 保存显式选择，并按本文优先级实现。
