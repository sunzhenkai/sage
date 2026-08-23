## Why

侧边栏在桌面端始终占据 244px 固定宽度，而聊天、任务、服务商等视图的核心内容需要更大的阅读宽度；同时当前没有显式的收起/展开入口，用户只能被动接受常驻侧栏。

## What Changes

- 侧边栏支持「收起为仅图标」与「展开恢复完整」两种形态，切换入口常驻侧栏，并保持用户选择持久化（浏览器本地存储），再次进入页面时恢复
- 收起态下隐藏品牌文字、工作区切换器、导航标签文字、runtime 卡片、账户文字与语言控件标签等文本内容，仅保留导航图标（并保留当前视图的激活态），将宽度收缩为紧凑的图标列
- 切换 SHALL 不触发整页重载（客户端状态切换），移动端（≤700px）侧栏布局维持现有顶部导航形态，不引入收起功能
- 为收起/展开按钮与图标化侧栏补充双语文案与 aria 语义，保持既有用户账户区位于侧边栏底部的布局约束

## Capabilities

### New Capabilities
- `workspace-shell`: 覆盖 Web workspace shell 的侧边栏布局与交互。当前仓库中尚无此独立 spec（Web shell 行为分散在 `chat-user-interface` 与 `workspace-status-presentation`），本 change 引入该 capability 承载侧边栏收起/展开行为；用户区位于侧边栏底部等既有布局约束仍由 `workspace-status-presentation` 声明，不重复声明

### Modified Capabilities

（无）

## Impact

- `platform/apps/agent-web/src/main.tsx`：WorkspaceShell 侧栏结构（新增收起切换按钮、条件渲染文本）
- `platform/apps/agent-web/src/styles.css`：侧栏 collapsed 样式与过渡
- `platform/apps/agent-web/src/locale.tsx`：新增中英文案（收起/展开、图标化侧栏 aria）
- `platform/apps/agent-web/src/header-alignment.test.tsx`：补充侧栏收起相关断言
- 纯前端交互改动，不影响 agent-api / agent-worker 契约
