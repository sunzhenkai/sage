## Context

本次变更完全局限在 `platform/apps/agent-web/src` 的 React 组件层，不改动 API、数据模型或后端行为。相关能力已有成熟 spec，参见：
- `chat-user-interface`
- `chat-session-history`
- `browser-provider-profile-management`
- `web-interface-localization`
- `workspace-status-presentation`
- `task-operations-interface`

当前主要问题集中在三类：
1. **状态呈现互斥性**：`ChatLanding` 与 `TasksApp` 在请求失败时同时渲染 `error` 与 `empty` 分支。
2. **弹窗交互与焦点**：`ProvidersApp` 的 creating dialog 缺少 `Esc`/backdrop 关闭与焦点回归。
3. **局部化缺口**：Provider 保存/同步提示写死英文，未使用统一 `locale.tsx` 资源。

所有修复均保持现有测试契约（39 个测试通过）并补充对应场景测试。

## Goals / Non-Goals

**Goals:**
- 错误态与空状态在 Chat/Tasks 列表中互斥呈现。
- Provider creating dialog 支持 `Esc`、点击蒙层关闭，并正确管理焦点。
- Chat 会话恢复失败（非 404）时 Composer 进入只读/隐藏状态。
- Provider 保存/同步提示通过 `t(key, values)` 本地化。
- Task detail 刷新按钮在请求期间禁用。

**Non-Goals:**
- 不新增路由库或状态管理库。
- 不改变后端 API 或 SSE 重连策略。
- 不重写现有样式系统，仅微调必要的 ARIA/焦点相关属性。
- 不处理 Provider 弹窗的动画/过渡。

## Decisions

### 1. 错误态与空状态互斥：按 `error` → `loading` → `empty/data` 优先级渲染

在 `ChatLanding` 和 `TasksApp` 中，当前 JSX 把 `error` 横幅与列表/空状态并列渲染。改为：
```
if (error) return error banner;
if (loading && items.length === 0) return loading;
if (items.length === 0) return empty;
return list;
```
这样无论 loading 是否结束，只要存在错误就只展示错误。该方案简单、无新依赖，且与现有测试模式一致。

**替代方案**：在错误时隐藏列表但保留搜索/筛选控件。保留控件会让用户在失败时尝试二次筛选，反而增加困惑，因此选择完全互斥。

### 2. Provider creating dialog 关闭机制：组合 `useRef` + 焦点管理

- 给 `provider-modal-backdrop` 增加 `onClick`，仅当点击目标为蒙层本身时关闭 dialog，避免点击 dialog 内容误关。
- 将 `Escape` 处理提升到 dialog 级别，并在 combobox 的 `keyboard` 辅助函数中避免 `stopPropagation()` 吞掉 `Esc`；combobox 关闭下拉后事件继续冒泡，由 dialog 关闭。
- 通过 `useRef` 保存触发按钮引用，dialog 关闭时调用 `.focus()` 回归焦点。

**替代方案**：使用 `<dialog>` 原生元素。原生 dialog 自带 backdrop/escape/focus 管理，但会引入较大重构（样式、form 结构、测试渲染器兼容性），且项目当前未使用原生 dialog，因此维持自定义实现并补齐行为。

### 3. Chat Composer 在 session 恢复失败时禁用：扩展「不可写」状态

当前逻辑仅在 `sessionStatus === 'closed'` 时隐藏 Composer，其他非 open 情况（undefined 或未知）仍展示可编辑 Composer。改为：
- 引入 `sessionWritable` 派生值：`sessionStatus === 'open'` 为可写，其他为只读。
- 当 `error` 存在且 `sessionStatus` 非 open 时，Composer 区域展示只读提示或完全隐藏，快速提示按钮一并禁用。
- 保留现有 404 recovery 页面逻辑不变。

**替代方案**：把所有非 open 错误都导向 recovery 页面。但 502/503 通常是临时故障，用户可能稍后刷新恢复，因此保留当前页面并禁用输入更合适。

### 4. Provider 提示本地化：补充翻译键并替换硬编码字符串

在 `locale.tsx` 中新增/确认以下键：
- `savedMetadata: '{name} saved as browser-local metadata.'` / `'{name} 已保存为浏览器本地元数据。'`
- `catalogSyncStatus: 'Catalog sync {status}'` / `'目录同步 {status}'`
- `catalogSyncAttempt: ' · {attempt}'` / `' · {attempt}'`

在 `providers.tsx` 中：
- 保存成功：`setNotice(t('savedMetadata', { name: metadata.name }))`
- 同步状态：`setNotice(t('catalogSyncStatus', { status: body?.status ?? 'queued' }) + (body?.attemptId ? t('catalogSyncAttempt', { attempt: body.attemptId }) : ''))`

### 5. Provider 通知防覆盖：使用 request token 模式

与现有 provider/model 搜索请求类似，为 `checkConnection` 和 `syncCatalog` 引入局部 token ref：在异步回调返回前检查 token 是否仍最新，过期则放弃 `setNotice`。save 操作本身是同步本地写入，无需 token，但可统一使用。

**替代方案**：引入通知队列。当前只有一个 notice 槽位，队列会增加复杂度，因此采用 token 丢弃过期结果。

### 6. Task detail 刷新防重入：在 `detailLoading` 期间禁用刷新按钮

`TasksApp` 已维护 `detailLoading` 状态。将 `TaskDetail` 的 `onRefresh` 按钮设置为 `disabled={detailLoading}` 即可，无需新增状态。

## Risks / Trade-offs

- **[Risk]** 错误态完全互斥后，用户无法在历史加载失败时使用搜索/筛选。
  - **Mitigation**：保留 Refresh 按钮在错误横幅内或旁边，用户可先重试；这是更清晰的恢复路径。

- **[Risk]** Provider dialog `Esc` 行为改动影响现有 combobox 键盘测试。
  - **Mitigation**：combobox 的 `Escape` 仍先关闭下拉；仅在下拉已关闭时让事件冒泡到 dialog。现有 `Escape` 关闭下拉的测试继续通过。

- **[Risk]** 焦点返回 Add provider 按钮在测试渲染器（无真实 DOM）中难以断言。
  - **Mitigation**：新增 Playwright/E2E 或 jsdom 焦点测试；单元测试至少断言 dialog 关闭后触发按钮存在于文档中。

- **[Risk]** 修改 Composer 可用性可能误伤正常慢加载场景。
  - **Mitigation**：仅当 `error` 存在且 `sessionStatus !== 'open'` 时禁用；纯 loading 状态仍保持现有 loading spinner。

## Migration Plan

无需部署迁移或数据库变更。变更仅影响前端构建产物，按常规 CI/CD 发布即可。

## Open Questions

无。
