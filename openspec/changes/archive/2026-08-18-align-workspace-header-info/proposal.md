## Why

`platform/apps/agent-web` 右侧内容区域的 header 信息完全重复：`WorkspaceShell` 顶部有一条通用 topbar（"Sage/对话" 面包屑、"本地开发模式" 标志、右上角用户头像），而每个页面内部又各自渲染 page-heading，导致同一屏出现两行含义重叠的头部信息，且用户区域位于右上角与工作区上下文脱节。

## What Changes

- **用户区域下沉**：移除右上角用户头像（及通知按钮），将用户账户区域移动到左侧边栏底部（左下角）。
- **移除通用 topbar 重复信息**：删除 shell 级 topbar 中的面包屑导航、"本地开发模式" 标志；shell 不再渲染页面头部，头部信息由各页面自持。
- **对话页面头部对齐**：页面头部呈现实时流连接状态、运行时（Local Pi Harness）chip，以及会话信息（会话 id、事件数、运行状态、"打开任务工作区"入口）。
- **任务页面同样处理**：头部仅保留任务统计与刷新操作，不再与 shell 头部重复。
- **服务商页面同样处理**：头部仅保留目录同步与新增操作；系统运行时信息保留在页面内的 system-runtime 面板。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `workspace-status-presentation`：工作区头部信息的唯一来源与摆放位置（页面自持头部、用户区域位于侧边栏底部、对话页头部包含流连接状态/运行时/会话信息）。

## Impact

- 代码：`platform/apps/agent-web/src/main.tsx`、`chat.tsx`、`tasks.tsx`、`providers.tsx`、`styles.css`、`locale.tsx`。
- 不改变任何后端接口与数据契约。
