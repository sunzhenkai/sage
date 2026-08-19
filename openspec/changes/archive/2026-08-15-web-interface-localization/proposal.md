## Why

当前 Agent Web 的用户可见文案分散在 React 组件中且仅提供英文，既无法为中文用户提供一致体验，也没有统一的语言检测、切换与回退契约。需要建立可测试的 Web 本地化能力，使界面默认对中文用户友好，同时保留完整英文体验。

## What Changes

- 新增统一的 Web locale 状态与翻译资源，支持简体中文（`zh-CN`）和英文（`en`）。
- 首次进入时检测浏览器首选语言；检测不可用、失败、结果缺失或不受支持时回退到简体中文。
- 新增可访问的语言切换入口，切换后无需刷新即可更新当前界面，并持久化用户主动选择。
- 明确用户选择优先于自动检测；只有不存在有效用户选择时才执行浏览器语言检测。
- 将 Chat、Task、Workspace、Provider、Profile 及公共 shell 的用户可见文案和 locale-sensitive 日期时间纳入统一 locale 边界。
- 新增翻译完整性、检测与回退、选择持久化、运行时切换及关键页面回归验证。
- 本轮属于**新增**能力，不改变现有业务 API、路由、数据模型或工作流语义。

## Capabilities

### New Capabilities

- `web-interface-localization`: 定义 Web 支持的 locale、语言解析优先级、中文默认回退、用户切换与持久化、翻译覆盖和 locale-sensitive 格式化行为。

### Modified Capabilities

无。现有 Chat、Task、Workspace、Provider 与 Profile capability 的业务要求保持不变，本变更只为其用户界面增加横切的本地化呈现能力。

## Impact

- 主要影响 `platform/apps/agent-web/src/` 下的应用入口、公共 shell、页面组件、翻译资源及测试。
- 可能调整 `platform/apps/agent-web/package.json`；设计阶段优先采用仓内轻量 typed locale 模块，避免在没有必要时新增运行时依赖。
- 使用浏览器语言信息与同源持久化存储保存显式 locale 偏好；不新增服务端 API、数据库字段或跨服务协议。
- 需要更新 Web 单元/交互测试，并通过 typecheck、production build 与关键页面浏览器 smoke。
