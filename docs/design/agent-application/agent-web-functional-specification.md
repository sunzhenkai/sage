# Agent Web 功能规格

- 状态：implemented behavior baseline
- 代码来源：`platform/apps/agent-web`
- 更新日期：2026-09-02
- 范围：功能、状态机、前后端契约与可复现行为
- 非范围：页面样式、视觉布局、配色、图标设计、响应式尺寸与 CSS 实现

本文目标是一个实现者在不阅读 `agent-web` 源码的情况下，能够重建出等价的 Web 功能；但不要求复刻具体视觉呈现。

## 1. 产品定位

`agent-web` 是 Sage 本地工作区的单页 Web 控制面，提供：

1. Chat 会话、实时时间线、消息发送、Run 重试与 Task 提升。
2. durable Task 的列表、详情、控制、时间线、运行日志和产物消费。
3. Provider / 模型连接、默认运行模型与模型目录辅助配置。
4. AI App / Package 的登记、版本发布、示例导入与运行启动。
5. Schedule 的只读列表、触发历史与暂停/恢复/删除控制。
6. 查询参数驱动的客户端路由和中英文本地化。

Web 只做用户交互、状态编排和 API 调用；Chat Message、Run、Task、Release、Schedule、Provider 元数据和凭据的权威状态在后端服务与存储中。

## 2. 技术与运行边界

### 2.1 应用形态

- React + Vite SPA，挂载到 `index.html` 中 id 为 `root` 的节点。
- 入口使用 `StrictMode`。
- 前端依赖 `@sage/app-contracts` 表示 Chat / Catalog / Schedule 等公共契约。
- API 默认使用同源相对路径 `/v1`。可测试或嵌入时可向视图组件注入自定义 `fetch` 与 `apiBase`。
- 所有浏览器请求携带 `credentials: "include"`。

### 2.2 开发与代理

Vite 配置满足：

| 项 | 行为 |
|---|---|
| dev server | 监听 `0.0.0.0:9612`，端口被占用时报错，不自动换端口。 |
| `/v1` 代理 | dev 和 preview 都把 `/v1` 转发到 `SAGE_API_PROXY_TARGET`。 |
| 默认 API 目标 | `http://127.0.0.1:9610`。 |
| service token | 若设置非空 `SAGE_SERVICE_TOKEN`，代理在服务端为 `/v1` 请求注入 `Authorization: Bearer <token>`；浏览器不持有 token。 |
| SSE | 上游返回头后强制 flush，避免 EventSource 因代理缓冲长期停在 connecting。 |
| preview cache | 只有带内容哈希的 `/assets` 构建产物使用 immutable 长缓存；`index.html` 与 `/v1` 保持 ETag/304 行为。 |

本地常用命令：

```bash
cd platform
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @sage/agent-web typecheck
corepack pnpm --filter @sage/agent-web dev
corepack pnpm --filter @sage/agent-web build
```

完整本地栈可使用 `corepack pnpm smoke:local`；Compose 场景中 Web 宿主端口默认是 `14173`，容器端口是 `4173`，`/v1` 指向 `agent-api`。

## 3. 路由与应用壳层

### 3.1 查询路由

应用不切换 path，只使用当前 path 下的 query：

| Query | 含义 |
|---|---|
| 无 `view` 或 `view=chat` | Chat。 |
| `view=tasks` | Task 工作区。 |
| `view=providers` | Provider / 配置。 |
| `view=packages` | AI App / Package。 |
| `view=schedules` | Schedule。 |
| `session=<id>` | 当前 Chat 会话；也用于在其他视图间保留会话上下文。 |
| `task=<id>` | 打开 Task 详情。 |
| `package=<id>` | 打开 Package / App 详情。 |

规则：

1. 未知 `view` 一律回落到 Chat。
2. 内部链接由 `workspaceHref` 生成；Chat 不写入 `view`，其他视图写入 `view`。
3. 同源且相同 path 的左键点击使用 `history.pushState` 和自定义导航事件完成客户端导航。
4. 以下情况不拦截：修饰键或非左键点击、`target="_blank"`、下载链接、`#`、`mailto:`、`tel:`、data URL、外部 URL 或非当前 path 的链接。
5. `popstate` 与自定义导航事件都会刷新路由状态。
6. Chat、Tasks、Packages、Schedules 的活动实体变化会重建对应内容组件，避免旧请求或旧状态跨实体残留。

### 3.2 Workspace Shell

壳层提供跨视图稳定功能：

1. 品牌链接回 Chat；若当前存在 `session`，首页链接保留该会话上下文。
2. 主导航包含 Chat、Tasks、Packages、Schedules 与 Providers；当前视图有选中态，导航元素带可访问名称。
3. 折叠/展开导航区的开关状态保存在 `localStorage` key `sage.web.sidebar.collapsed`，值为 `"true"` / `"false"`。读取或写入失败时静默降级。
4. Shell 中提供全局“新建对话”动作。
5. 搜索入口、system runtime 卡片和账号菜单是静态占位，不承担业务动作。
6. 应用启动渲染异常时降级为错误页：显示工作区不可用、原始错误信息或默认运行时失败文案，并提供返回 `/` 的动作。

### 3.3 全局反馈原语

必须提供以下语义反馈组件：

| 原语 | 行为 |
|---|---|
| Banner | 支持 success / error。错误使用断言式 live region；成功使用 status。可带标题、正文、动作和可关闭按钮。 |
| InlineNotice | 行内提示；error 使用断言式 live region，普通提示使用 status。 |
| LoadingState | 表示整区加载中，包含主文案和可选说明。 |
| EmptyPanel | 表示可操作的空态，包含标题、说明和可选动作。 |

## 4. 本地化与格式化

### 4.1 语言

支持 `zh-CN` 与 `en`。

初始化顺序：

1. 读取 `localStorage` key `sage.web.locale`。
2. 若不可用或值无效，按 `navigator.languages` 与 `navigator.language` 探测；`zh*` 映射为 `zh-CN`，`en*` 映射为 `en`。
3. 仍无法确定时默认 `zh-CN`。

切换语言后：

- 更新 React context。
- 更新 `<html lang>`。
- 尝试写入 localStorage；失败时静默降级。

Provider 配置页必须暴露语言切换。

### 4.2 文案与时间

- 文案 key 需要覆盖全部功能文案；`zh-CN` 与 `en` 字典结构一致。
- 简单插值使用 `{name}` 占位符，例如 `Copied {count} events.`。
- 完整时间使用当前 locale 的 medium date + short time。
- 事件行等短时间使用当前 locale 的两位小时与分钟。
- 列表行使用固定 `MM-DD HH:mm` 紧凑格式，完整时间通过 `dateTime` / title 或详情页表达。

## 5. 通用 API 调用行为

### 5.1 JSON helper

业务 JSON 请求遵循统一规则：

1. 除 GET 外默认设置 `content-type: application/json`；`FormData` 不设置。
2. 请求携带 `credentials: "include"`。
3. 非 2xx 时解析 `{ "error": { "code", "message", "retryable" } }`。
4. 用户可见错误优先取 `error.message`，其次 `error.code`，最后 `HTTP <status>`。
5. 空响应体只能出现在明确 `204` 语义中。

### 5.2 错误响应

后端错误契约统一为：

```json
{
  "error": {
    "code": "STABLE_ERROR_CODE",
    "message": "human readable message",
    "retryable": false
  }
}
```

Web 不假设错误一定会恢复；需要操作失败与列表失败分离展示时，不得让局部失败覆盖整个页面数据。

## 6. Chat

### 6.1 会话列表

#### 初始加载

1. 进入 Chat 或刷新列表时请求 `GET /v1/chat/sessions`。
2. 默认参数：`limit=30`、`status=<当前状态>`、`locale=<当前语言>`。
3. 归档视图追加 `archived=true`。
4. 标题搜索框非空时追加 `q=<trimmed query>`。
5. 加载更多时追加 opaque `cursor`，并把返回 `items` 追加到现有列表。

会话项字段来自 `SessionHistoryItem`：

- `sessionId`
- `status`: `open` / `closed`
- `title`，缺失时显示本地化“Untitled Chat”
- `preview`，缺失时显示本地化“No persisted messages yet”
- `updatedAt`
- 归档状态由所在视图决定

#### 过滤与刷新

1. 状态过滤支持 `all`、`open`、`closed`。
2. 视图切换支持“Conversations”和“Archive”。
3. 改变状态或归档视图会清空删除确认态并重新加载。
4. 标题搜索输入不自动触发网络请求；提交过滤表单时重新加载第一页。
5. 若有 `nextCursor`，提供“Load more”；请求期间禁止重复触发。

#### 新建会话

1. 点击 New Chat 后请求 `POST /v1/chat/sessions`，body 为 `{}`。
2. 成功后使用返回 `sessionId` 跳到 `/?session=<sessionId>`。
3. 用同步 guard 防止重复提交。
4. 请求失败后恢复按钮可用，并在触发该动作的区域显示错误。

#### 会话操作

| 动作 | API | 成功行为 |
|---|---|---|
| Archive | `POST /v1/chat/sessions/:sessionId/archive` | 从当前列表移除并显示成功提示。 |
| Restore | `POST /v1/chat/sessions/:sessionId/unarchive` | 从当前归档列表移除并显示成功提示。 |
| Delete | `DELETE /v1/chat/sessions/:sessionId` | 从当前列表移除并显示成功提示。 |

规则：

1. 删除必须两段确认：先进入确认态，再显式确认才删除。
2. 同一时刻只允许一个会话操作；操作期间禁用对应动作。
3. 删除确认在切换归档视图或重新加载时清空。
4. 当前行是当前 `?session` 时，要有选中和当前页语义。

### 6.2 Chat 会话恢复与实时流

进入 `/?session=<id>` 后执行恢复序列：

1. `GET /v1/chat/sessions/:id` 获取 `session.status`、`session.title`、`session.archivedAt`。
2. `GET /v1/chat/sessions/:id/events?afterSequence=0` 加载完整持久化快照。
3. 事件按 `sequence` 去重排序，并把最新 sequence 记为 timeline cursor。
4. 若浏览器支持 `EventSource`，建立：

   ```text
   GET /v1/chat/sessions/:id/timeline?afterSequence=<cursor>
   ```

5. 收到 `event: timeline` 后解析 `data` 为 `TimelineEvent`，更新 cursor，并做按 sequence 去重合并。
6. 连接状态至少有 `connecting`、`live`、`offline/reconnecting`。
7. SSE `onerror` 时关闭旧连接，1 秒后以最新 cursor 重建连接；不使用浏览器原生自动重连，避免旧 URL cursor 造成整段重放。
8. 不支持 `EventSource` 时进入 offline 状态，但保留快照。
9. 详情接口 404 时显示 Chat 不再可用和 retention 说明，并渲染会话列表空态。
10. 其他恢复失败显示错误；因状态不可写时输入区替换为只读提示。

SSE 服务端帧格式：

```text
id: <sequence>
event: timeline
data: <TimelineEvent JSON>
```

服务端可发送 `:ok` 与 `: ping` 注释帧用于代理 flush 和保活；客户端只处理 `timeline` 事件。

发送成功后，Web 立即执行一次增量补拉：

```text
GET /v1/chat/sessions/:id/events?afterSequence=<cursor>
```

补拉失败静默，不影响现有 SSE 订阅。

### 6.3 消息发送

前提：

1. 会话必须 `open` 且未归档。
2. 必须已选择有效 workspace provider。
3. 文本 trim 后非空。
4. 没有正在进行的提交。

输入行为：

1. Enter 发送。
2. Shift+Enter 换行。
3. IME composition 或 `isComposing` 中的 Enter 不发送。
4. 发送中禁用输入和发送按钮。

提交：

```http
POST /v1/chat/sessions/:sessionId/messages
Content-Type: application/json

{
  "parts": [
    { "kind": "text", "text": "<trimmed draft>" }
  ],
  "provider": {
    "connectionId": "<selected provider connection id>"
  }
}
```

成功返回 `202` 后清空草稿、触发增量补拉，并在用户已滚动到底部附近时强制滚动到底部。失败保留草稿并显示错误。

### 6.4 Chat runtime 选择

浏览器本地 runtime 标识格式：

- `""`：未配置。
- `ws:<providerConnectionId>`：引用工作区 provider connection。

localStorage key：

```text
sage.chat-runtime.v2
```

行为：

1. 加载 `GET /v1/provider-connections`，只保留 `enabled === true && credentialPresent === true` 的连接供 Chat 使用。
2. 加载 `GET /v1/run-agent/settings` 获取工作区默认 `providerConnectionId`。
3. 仅当浏览器从未保存过 runtime key 且当前选择为空时，把默认连接作为初始 UI 选择；不得静默覆盖用户显式选择。
4. 用户手动选择时写入 localStorage。
5. 若当前连接不再存在于可用连接集合中，运行时选择回落到未配置。
6. 未配置或失效时禁用发送，并提示到 Provider 配置页添加连接。

默认模型是 `providerConnectionId` 引用；浏览器不接收、不保存、不提交 API key。

### 6.5 时间线模型

`TimelineEvent` 关键字段：

```ts
interface TimelineEvent {
  schemaVersion: "1";
  sessionId: string;
  runId: string;
  sequence: number;
  occurredAt: string; // ISO date-time
  payload: TimelinePayload;
}
```

`TimelinePayload`：

| kind | 必读字段 | 语义 |
|---|---|---|
| `text` | `text`；可选 `messageId`、`promotionEligibility` | 用户或助手文本。 |
| `run` | `status`、`attempt` | Run 状态：`active` / `paused` / `succeeded` / `failed`。 |
| `tool` | `toolName`、`status`；可选 `artifact` | 工具活动。 |
| `artifact` | `artifact` | 产物活动。 |
| `error` | `error.code`、`error.message`、`error.retryable` | 可展示错误。 |
| `task` | `title`、`status`；可选 `taskId`、`messageId`、`reason` 等 | Task 卡片或提升状态。 |

前端按 `runId` 分组成对话轮次：

1. 同一轮中，第一条满足任一条件的 text 判定为用户消息：
   - `promotionEligibility === "explicit"`；
   - 或事件 sequence 早于本轮首个 `run` 事件的 sequence。
2. 其余 text 是助手文本。
3. 非 `run` 的其余事件按 sequence 与助手文本合并展示。
4. 最后一个 `run` payload 决定状态和 attempt。
5. 若存在 error 且最后 run 缺失或仍是 active/paused，前端显示为 failed，避免 pending 指示符长期存活。
6. active/paused 且尚无助手文本时显示 thinking pending。
7. attempt 大于 1 时展示 attempt；failed 时展示重试入口，除非 error 活动行已经承载重试。

### 6.6 助手文本渲染

助手文本先拆分字面量 `<think>` / `</think>`：

1. thinking 段渲染为可折叠“Thought process”。
2. 非 thinking 段按 Markdown 渲染。
3. 标签匹配不区分大小写。
4. 原始 HTML 不执行。

Markdown 支持以下安全子集：

| 类型 | 行为 |
|---|---|
| Paragraph | 保留软换行为换行。 |
| Heading | `#` 到 `######`，渲染层级最高映射到 h4。 |
| Fenced code | 保留原文与语言标识。 |
| Blockquote | 支持递归块解析。 |
| Rule | 渲染分隔线。 |
| Ordered / unordered list | 支持缩进嵌套和列表项内软换行。 |
| Table | 支持 GFM 式表头 + separator + 行。 |
| Inline code | 原样代码文本。 |
| Link | 仅允许 `http:`、`https:`、`mailto:`、`/`、`#`。外部链接在新标签打开且不带 opener。 |
| Autolink / bare URL | `<https://...>` 和 bare URL 变链接；bare URL 移除句尾标点。 |
| Emphasis | bold、italic、bold italic、strikethrough。 |

Raw HTML 一律作为普通文本，不注入 DOM。

### 6.7 Chat 活动与操作

#### Tool

展示工具名与 started/completed 状态；若带 artifact，则展示 artifact 链接。

#### Artifact

`artifact.artifactRef` 是链接；显示名称、media type 和 KB 大小。大小最小按 1 KB 展示。

#### Error

展示 `error.code` 和 `error.message`；`retryable === true` 时提供 Run 重试。

#### Task card

展示任务标题、本地化 status 与可选 reason。若 payload 有 `taskId`，点击进入：

```text
/?view=tasks&task=<taskId>&session=<sessionId>
```

#### Retry

可写会话中，用户可重试 failed 或可重试错误对应的 run：

```http
POST /v1/chat/runs/:runId/retry
Content-Type: application/json

{
  "provider": { "connectionId": "<selected provider connection id>" }
}
```

成功显示 retry accepted，并触发增量补拉。

#### Promote to Task

对 `promotionEligibility === "explicit"` 且有 `messageId` 的用户消息提供提升动作：

```http
POST /v1/chat/messages/:messageId/promotions
Content-Type: application/json

{
  "mode": "explicit",
  "taskType": "sage.agent-task.v1"
}
```

成功后：

1. 显示 accepted 提示。
2. 若响应 `association.taskId` 存在，提供 `/?view=tasks&task=<taskId>` 链接。
3. 触发 Chat timeline 增量补拉，让 task card 出现。

若当前会话有事件但还没有 task 事件，页头可提供显式入口进入同一会话的 Task 工作区。

### 6.8 Event stream 面板

Chat 详情必须支持展开/收起原始事件流：

1. 每行显示 sequence、时间、payload kind 和 payload JSON。
2. 提供复制全部事件按钮。
3. 复制内容是按 sequence 升序的 JSON Lines：每行一个完整 `TimelineEvent` JSON。
4. 优先使用 `navigator.clipboard.writeText`，失败后用隐藏 textarea + `execCommand("copy")` 兜底。
5. 成功提示复制数量；失败显示剪贴板不可用。

### 6.9 快捷提示与可写性

可写会话若无 provider，Composer 区域被替换为“需要 provider”的提示和跳转 Provider 配置链接。

有 provider 时提供至少三个快捷提示按钮：

1. Summarize project。
2. Create a Task。
3. Explore a risk。

点击只填充输入框并聚焦，不自动发送。

会话关闭或归档时 Composer 替换为只读提示；恢复失败时也禁止发送。关闭/归档会话中的 retry 和 promote 动作不可用。

## 7. Tasks

### 7.1 Task 列表

#### 数据

根据状态过滤请求：

```text
GET /v1/tasks              // all
GET /v1/tasks?status=running
GET /v1/tasks?status=paused
GET /v1/tasks?status=failed
GET /v1/tasks?status=succeeded
GET /v1/tasks?status=cancelled
```

返回：

```json
{ "tasks": [TaskViewModel] }
```

TaskViewModel 必须支持展示：

- `taskId`
- `taskType`
- `workflowId`
- `targetId`
- `attempt`
- `status`
- `revision`
- `projectionUpdatedAt`
- `freshness`: `fresh` / `stale` / `unavailable`
- `staleReason`
- 可选 `sessionId`、`runId`、`messageId`
- `targetSnapshot.targetId`、`environment`、`namespace`、`taskQueue`

状态集合包括 `running`、`paused`、`failed`、`succeeded`、`cancelled`、`effect_unknown`；未知状态以原文加空格展示。

#### 交互

1. 状态过滤改变时重新加载。
2. 客户端搜索对 `taskId + taskType + targetSnapshot.targetId` 做大小写不敏感子串过滤。
3. 显示 running 数量。
4. 空列表提示先到 Chat 提升 Task，并提供跳转 Chat；若 URL 有 `session`，跳转保留会话。
5. 点击任务进入 `/?view=tasks&task=<taskId>`，并尽量保留 `session`。

### 7.2 Task 详情

选中任务后并行请求：

```text
GET /v1/tasks/:taskId
GET /v1/tasks/:taskId/events
GET /v1/tasks/:taskId/artifacts
GET /v1/tasks/:taskId/run-logs
```

行为：

1. 前三个失败时展示详情错误。
2. Run logs 失败不拖垮详情，只把运行日志面板降级为暂时不可用。
3. 使用请求 token 和 AbortController 作废旧详情请求。
4. 切换详情或离开详情时作废在途 run log 增量请求。
5. URL 没有 `task` 时清空详情状态，而不是停留旧详情。
6. 详情刷新期间显示刷新中状态，并禁用刷新按钮。

详情展示：

1. projection freshness：fresh / stale / unavailable、更新时间和 stale reason。
2. revision。
3. workflow、target、namespace、task queue、attempt。
4. timeline event 数量和列表。
5. run logs。
6. artifacts。

`effect_unknown` 需要展开式说明，表达效果未知、不复活终态、需通过 effect resolution 裁决的语义。

`failed` 展开失败详情，显示 `failureCode` 和 `failureDetail`。

### 7.3 Task 控制

| 操作 | 允许状态 | API | Body |
|---|---|---|---|
| Pause | `running` | `POST /v1/tasks/:id/signals` | `{ "kind": "pause" }` |
| Resume | `paused` | `POST /v1/tasks/:id/signals` | `{ "kind": "resume" }` |
| Cancel | 非 `succeeded`、`cancelled`、`effect_unknown` | `POST /v1/tasks/:id/cancel` | `{}` |
| Retry | `failed` | `POST /v1/tasks/:id/retry` | `{}` |

规则：

1. 操作期间用 guard 防重复提交。
2. 成功后同时刷新 Task 列表和当前详情。
3. 失败显示 task control failed 或服务端错误信息。
4. 服务端仍会对不适用状态返回 404 / 409；前端按当前投影先禁用明显不合法操作。

### 7.4 Task timeline

`TaskEventView`：

```ts
interface TaskEventView {
  eventId: string;
  sequence: number;
  kind: "task" | "agent";
  type: string;
  occurredAt: string;
  payload: Readonly<Record<string, unknown>>;
}
```

展示顺序按服务端返回；每项显示 type、完整时间和 sequence。fresh 但无事件提示尚无 projection event；stale/unavailable 且无事件提示 timeline 可能落后并建议刷新。

### 7.5 Run logs

`TaskRunLogsView`：

```ts
interface TaskRunLogsView {
  attempts: readonly TaskRunLogAttemptView[];
  selected?: { runId: string; attemptId: string };
  events: readonly TaskRunLogEventView[];
  nextFromSequence?: number;
}
```

默认展示第一个 attempt。若多于一个 attempt，提供 attempt 选择。

切换 attempt：

```text
GET /v1/tasks/:id/run-logs?runId=<runId>&attemptId=<attemptId>
```

加载更多：

```text
GET /v1/tasks/:id/run-logs?runId=<runId>&attemptId=<attemptId>&fromSequence=<nextFromSequence>
```

规则：

1. 事件按 `eventId` 去重后追加。
2. 加载中禁用“load more”。
3. 失败显示运行日志不可用，但不销毁已有 events。
4. attempt 展示倒序序号和最后写入时间。
5. 事件行显示 sequence、type、payload 标量摘要和 receipt/artifact 引用数量。
6. 常见类型语义：`run.completed` 成功态，`run.failed` 失败态，`checkpoint.sealed` warning 态，`model.completed` / `tool.completed` info 态，其他 neutral。

### 7.6 Artifacts

`TaskArtifactView`：

```ts
interface TaskArtifactView {
  artifactId: string;
  artifactRef: string;
  name: string;
  mediaType: string;
}
```

列表：

1. 名称为 `output.tar.gz` 的 artifact 作为 package download，链接追加 `?download=1`。
2. 其他文件展示名称、media type 和 `artifactRef`。
3. 文本类 `text/*` 或 `application/json` 使用普通链接；其他类型追加 `?download=1`。

成功任务的第一个可预览文件进行内联预览：

```text
GET /v1/tasks/:taskId/artifacts/:artifactId
```

预览规则：

1. 响应 `encoding === "base64"` 时不把 base64 当文本渲染，显示为空内容或不可预览；二进制只适合下载。
2. 响应 `content` 为普通文本时先按 `<think>` 拆分，再按 Markdown 渲染。
3. 请求失败显示 output preview unavailable。
4. 组件卸载或依赖变化时取消状态写入。

## 8. Providers 与模型配置

### 8.1 Run Agent 默认模型

进入 Provider 页后请求：

```text
GET /v1/run-agent/settings
```

响应：

```json
{
  "schemaVersion": "RunAgentSettings.v2",
  "unset": false,
  "providerConnectionId": "<id>",
  "providers": [
    {
      "id": "<connection id>",
      "name": "<display name>",
      "available": true,
      "reason": "optional unavailable reason"
    }
  ]
}
```

交互：

1. 下拉显示 `unset` 与所有注册表 provider 状态。
2. `available = enabled && credentialPresent`；不可用项仍可见，但带 unavailable 标识。
3. 当前未设置时显示 warning。
4. 当前设置可用显示 ready；设置不可用显示 unavailable warning。
5. 用户选择有效连接后立即保存：

   ```http
   PUT /v1/run-agent/settings
   Content-Type: application/json

   { "providerConnectionId": "<id>" }
   ```

6. 保存中禁止重复选择。
7. 成功使用响应更新状态并显示 saved。
8. 空值选择不触发保存。

### 8.2 Workspace provider connections

`WorkspaceProviderView`：

```ts
interface WorkspaceProviderView {
  id: string;
  name: string;
  source: "user" | "deployment-env";
  adapterKind: "openai-compatible" | "anthropic";
  baseUrl: string;
  modelId: string;
  providerName?: string;
  modelName?: string;
  enabled: boolean;
  credentialPresent: boolean;
}
```

列表接口：

```text
GET /v1/provider-connections
```

返回：

```json
{
  "schemaVersion": "ProviderConnections.v1",
  "connections": [WorkspaceProviderView]
}
```

展示规则：

1. 显示名称、provider name/model name 或 model id、source、凭据在场状态。
2. `deployment-env` 连接只读；不可编辑或删除。
3. `user` 连接可编辑和删除。
4. 永不显示 ciphertext 或 API key；只显示 `credentialPresent`。

#### 创建或编辑

表单字段：

| 字段 | 创建 | 编辑 |
|---|---|---|
| `name` | 必填 | 必填 |
| `adapterKind` | `anthropic` 或 `openai-compatible` | 可改 |
| `baseUrl` | 必填，public HTTPS | 可改 |
| `modelId` | 必填 | 可改 |
| `apiKey` | 必填 | 留空表示不轮换；非空才提交 |
| `providerName` / `modelName` | 可选目录展示名 | 可选 |

创建：

```http
POST /v1/provider-connections
Content-Type: application/json

{
  "name": "...",
  "adapterKind": "anthropic | openai-compatible",
  "baseUrl": "https://...",
  "modelId": "...",
  "apiKey": "...",
  "providerName": "optional",
  "modelName": "optional"
}
```

编辑：

```http
PUT /v1/provider-connections/:id
```

body 同创建，但 `apiKey` 只有用户输入时才包含。保存成功后关闭弹窗、刷新连接列表、显示 saved。

服务端约束：

- `name` 1–128 字符。
- `baseUrl` 必须是 public HTTPS URL。
- `modelId` 1–256 字符。
- 未知字段拒绝。
- Secret backend 不可用时凭据写入返回 503。

#### 删除

```http
DELETE /v1/provider-connections/:id
```

规则：

1. 两段确认。
2. 若待删除连接是当前默认模型，显示会影响默认模型的 warning。
3. 成功后刷新列表并显示 deleted。
4. 删除被默认设置引用的连接时，后端返回 409 `PROVIDER_CONNECTION_IN_USE`；Web 显示服务端错误。

### 8.3 Provider catalog 辅助选择

添加/编辑弹窗优先使用 catalog：

#### Provider 搜索

输入防抖 250ms 后：

```text
GET /v1/provider-catalog/providers?limit=100&q=<query>
```

追加页：

```text
GET /v1/provider-catalog/providers?limit=100&q=<query>&cursor=<nextCursor>
```

#### Model 搜索

必须先选择 provider；输入防抖 250ms 后：

```text
GET /v1/provider-catalog/models?limit=100&providerId=<providerId>&status=all&q=<query>
```

追加页带上 `cursor=<nextCursor>`。

#### 选择行为

1. 选择 provider 后：
   - 记录 selected provider id；
   - 清空 models / model query；
   - 自动聚焦或打开 model 选择；
   - 若用户未改过 adapter，`anthropic` provider 默认 `anthropic`，其他默认 `openai-compatible`；
   - 若用户未改过名称，用 provider display name 预填。
2. 选择 model 后：
   - 预填 `modelId` 与 `modelName`；
   - 若用户未改过 base URL，使用 `effectiveBaseUrl`；
   - 若用户未改过名称，使用 `<provider name> · <model name>`。
3. 用户手工编辑过的 `name`、`adapterKind`、`baseUrl` 不被目录选择覆盖。
4. 手工修改 `modelId` 时移除旧 `modelName`。
5. Catalog 不可用时切换为完全手工输入。

#### Catalog 刷新

刷新按钮：

```http
POST /v1/provider-catalog/sync
Content-Type: application/json

{}
```

行为：

1. 429 显示 rate limited；优先使用响应 `error.retryAfterSeconds`，缺省 60 秒。
2. 403 显示 forbidden。
3. 成功返回 `attemptId` 时，每秒轮询一次：

   ```text
   GET /v1/provider-catalog/sync/:attemptId
   ```

   最多 10 次；状态到达 `succeeded`、`not_modified`、`failed` 或 `cancelled` 即停止。
4. 完成后重载 provider 第一页；若已选择 provider，也重载 model 第一页。
5. 刷新期间禁用按钮。

#### Snapshot changed

Catalog 查询返回 409 时表示 cursor / snapshot 已变化：

1. 显示 catalog updated notice。
2. 重新加载对应第一页。
3. 不把 409 当作致命错误。

#### Catalog combobox 键盘

provider 与 model combobox 支持相同键盘语义：

- ArrowDown 选择下一项。
- ArrowUp 选择上一项。
- Enter 选择当前项。
- Escape 关闭下拉。

## 9. AI Apps / Packages

### 9.1 App 列表

```text
GET /v1/apps
```

返回映射为 UI summary：

| API 字段 | UI 字段 |
|---|---|
| `appId` | `packageId` |
| `name` | `name` |
| `description` | `description` |
| `releaseCount` | `releaseCount` |
| `latestVersion` | `latestVersion`，缺失显示 `—` |
| `latestContentDigest` | `latestContentDigest`，缺失为空 |
| `updatedAt`，缺失用 `createdAt` | `updatedAt` |

列表显示名称、package id、release 数量、最新版本和更新时间；点击进入：

```text
/?view=packages&package=<appId>
```

### 9.2 创建 App

弹窗表单字段：

| 字段 | 约束 |
|---|---|
| App ID | trim 后必填；pattern `^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$`；maxlength 128。 |
| App name | trim 后必填；1–128 字符。 |
| Description | 可选；最多 2048 字符。 |

提交：

```http
POST /v1/apps
Content-Type: application/json

{
  "appId": "my-app",
  "name": "My App",
  "description": "optional"
}
```

成功后刷新列表并进入新 App 详情。

### 9.3 App 详情

```text
GET /v1/apps/:appId
```

详情包含：

1. `appId`、`name`、`description`、`status`、`createdAt`。
2. 最新 release 的 manifest summary。
3. assets。
4. releases。

#### Manifest summary

可展示：

- `version`
- `description`
- `entry`
- `modelRoute.provider`
- `modelRoute.model`
- `skillRefs`
- `capabilityRefs`
- `inputs`
- `dataSources`
- `tasks`

`inputs` 中每个字段含 `name`、`type`、`required`、可选 `enum`、可选 `default`。

#### Assets

每个 asset 显示：

- `relativePath`
- `kind`
- `bytes`
- `digest`
- 可选 `preview`

bytes 格式化：小于 1 KiB 显示 B；小于 1 MiB 显示 KB；否则显示 MB。有 preview 时以纯文本展示；无 preview 时说明不可预览。

#### Releases

每个 release 显示：

- `packageVersion`
- `compilerBuild`
- `contentDigest`
- `createdAt`

服务端通常按最新版本优先返回。

### 9.4 上传新版本

详情页提供上传开关。前端验证：

1. 必须选择文件。
2. 文件最大 8 MiB。
3. 文件名必须匹配 `.tar.gz`、`.tgz`、`.tar`、`.zip` 或 `.gz`。

提交使用 multipart：

```http
POST /v1/apps/:appId/releases
Content-Type: multipart/form-data

file=<archive>
```

服务端解包 archive，要求 `app.yaml` 的 `manifest.id` 与路径 `appId` 一致，然后编译并登记 release。重复内容返回已有 release，新内容返回新 release。

成功后刷新详情并显示上传成功与 `packageVersion`。

### 9.5 导入示例 App

内置至少三个示例：

| App ID | 名称 | 语义 |
|---|---|---|
| `github-trending` | GitHub Trending | 读取真实 GitHub trending 快照并产出解读报告。 |
| `finance-briefing` | Finance Briefing | 读取汇率和股指快照并产出财经简报。 |
| `lifecycle-probe` | Lifecycle Probe | 无输入、固定输出的生命周期链路探针。 |

每个示例携带：

- `appId`
- `name`
- `description`
- `version`
- `files`: path → source content

导入流程：

1. `POST /v1/apps` 创建 App。
2. 若返回 409 或 `APP_ALREADY_EXISTS`，不视为失败。
3. `POST /v1/apps/:appId/releases`，JSON body：

   ```json
   { "files": { "app.yaml": "...", "prompts/system.md": "..." } }
   ```

4. 成功后刷新列表并跳到该 App 详情。
5. 同一示例重复导入应保持幂等；Release 登记重复内容返回已有 release。
6. 导入中禁止导入其他示例。

### 9.6 删除 App

```http
DELETE /v1/apps/:appId
```

规则：

1. 两段确认。
2. 删除中禁用确认按钮。
3. 成功后跳回 Package 列表。
4. 后端删除是软删除，不存在或已删除也返回成功。

### 9.7 启动 Package Run

必须存在至少一个 release；Web 使用详情中第一个 release 的 `releaseId`。

表单：

1. `manifest.tasks` 多于一个时提供 task 选择，缺省第一个。
2. 按 `manifest.inputs` 生成输入控件。
3. `enum` 使用下拉，并带“使用默认值”空选项。
4. `number` 输入转成 JS number；非有限数显示参数错误。
5. 留空字段不提交，交由服务端使用声明默认值。

请求：

```http
POST /v1/releases/:releaseId/runs
Content-Type: application/json

{
  "task": "optional declared task",
  "params": {
    "<declared input>": "string or number"
  }
}
```

规则：

1. 启动使用 guard 防重复。
2. 成功响应包含 `taskId`，Web 显示 run started 和 `/?view=tasks&task=<taskId>` 链接。
3. `PROVIDER_DEPENDENCY_MISSING` 表示 manifest 模型路由和默认模型都无法解析到可用 provider connection；运行不会被创建。
4. 服务端校验未知参数、类型、枚举、required 缺省；失败显示错误。
5. 服务端按 manifest 声明抓取 data source 快照；`onFailure: fail` 的数据源失败会整体拒绝运行。

成功响应核心字段：

```json
{
  "schemaVersion": "PackageRunResult.v1",
  "status": "admitted | existing",
  "taskId": "...",
  "runId": "...",
  "attemptId": "...",
  "releaseId": "...",
  "specRef": "...",
  "specDigest": "...",
  "inputRef": "..."
}
```

## 10. Schedules

### 10.1 列表

```text
GET /v1/schedules
```

返回：

```json
{
  "schemaVersion": "ScheduleListResult.v1",
  "schedules": [ScheduleView]
}
```

每个 schedule 显示：

| 字段 | 展示 |
|---|---|
| `definition.scheduleId` | 可打开详情的 schedule 标识。 |
| `definition.invocation.task` | 绑定 task 名称。 |
| `state` | `ACTIVE`、`PAUSED`、`DELETED`。 |
| trigger | cron 显示 `expression (timezone)`；interval 显示分钟。 |
| `definition.releaseBinding` | `FIXED <releaseId>` 或 `FOLLOW`。 |
| `nextFireAtMs` | ISO 时间；缺失显示无。 |

交互：

1. 提供手动刷新。
2. `ACTIVE` 显示 Pause；非 `ACTIVE` 显示 Resume。
3. Pause / Resume：
   - `POST /v1/schedules/:id/pause`
   - `POST /v1/schedules/:id/resume`
4. Delete：
   - `DELETE /v1/schedules/:id`
   - 必须原生确认或等价确认。
5. 操作成功后刷新列表；若当前详情属于该 schedule 且未删除，同时刷新触发历史。
6. 操作期间全局 busy 禁用 schedule 动作。

### 10.2 触发历史

点击 schedule 请求：

```text
GET /v1/schedules/:id/triggers
```

返回：

```json
{
  "schemaVersion": "ScheduleTriggerHistory.v1",
  "scheduleId": "...",
  "events": [
    {
      "occurrenceId": "...",
      "kind": "SUCCEEDED | FAILED | SKIPPED | MISSED",
      "occurredAtMs": 0,
      "taskId": "optional",
      "errorCode": "optional"
    }
  ]
}
```

展示：

1. occurrence id、时间、结果类型。
2. 有 `taskId` 时链接到 `/?view=tasks&task=<taskId>`。
3. 有 `errorCode` 时展示错误码。
4. 空历史显示 no trigger events。

### 10.3 认证失败

Schedule 管理依赖服务端注入 service token。

若返回 401 或 `SCHEDULE_AUTHENTICATION_REQUIRED`：

1. 列表错误显示配置指引，而不是只显示原始 HTTP 错误。
2. 历史错误同样显示认证指引。
3. 不得回退到 stub 信任头，不得伪造本地成功状态。

服务端需要配置 `SAGE_SERVICE_TOKEN` / `SAGE_SERVICE_TOKEN_HASHES` 之一并刷新栈。

## 11. 关键 API 契约总表

下表列出 Web 当前功能依赖的接口。

### Chat

| 方法与路径 | 用途 | 请求 / 响应要点 |
|---|---|---|
| `GET /v1/chat/sessions` | 会话分页列表 | query：`limit`、`status`、`q`、`archived`、`cursor`、`locale`；响应 `{ schemaVersion, items, nextCursor? }`。 |
| `POST /v1/chat/sessions` | 新建会话 | body `{}` 或 `{ title? }`；返回 `Session`。 |
| `GET /v1/chat/sessions/:id` | 恢复详情 | 返回 `{ session, messages, runs, summaries }`；Web 主要读 session。 |
| `POST /v1/chat/sessions/:id/archive` | 归档 | 返回归档后的 session / store 结果。 |
| `POST /v1/chat/sessions/:id/unarchive` | 恢复 | 返回 unarchive 后的 session / store 结果。 |
| `DELETE /v1/chat/sessions/:id` | 删除 | `204`。 |
| `POST /v1/chat/sessions/:id/messages` | 发送文本 | body `{ parts, provider? }`；`202` 返回 `{ message, run }`。 |
| `POST /v1/chat/runs/:runId/retry` | 重试 run | body `{ provider }`；`202` 返回 `{ run }`。 |
| `GET /v1/chat/sessions/:id/events` | timeline 快照 | query `afterSequence`；返回 `{ events }`。 |
| `GET /v1/chat/sessions/:id/timeline` | SSE | query `afterSequence`；`text/event-stream`，帧名为 `timeline`。 |
| `POST /v1/chat/messages/:messageId/promotions` | 提升 Task | body `{ mode, taskType? }`；首建 `202`，重复 `200`，返回 `{ association, task }`。 |

### Tasks

| 方法与路径 | 用途 |
|---|---|
| `GET /v1/tasks` | Task 列表，支持 `status`、`taskType`、`environment`、`limit`。 |
| `GET /v1/tasks/:id` | Task 详情 / projection。 |
| `GET /v1/tasks/:id/events` | Task timeline events。 |
| `GET /v1/tasks/:id/artifacts` | Task artifact references。 |
| `GET /v1/tasks/:id/artifacts/:artifactId` | Artifact 内容；`?download=1` 触发附件响应。 |
| `GET /v1/tasks/:id/run-logs` | Run logs，支持 `runId`、`attemptId`、`fromSequence`、`limit`。 |
| `POST /v1/tasks/:id/signals` | Pause / Resume。 |
| `POST /v1/tasks/:id/cancel` | Cancel。 |
| `POST /v1/tasks/:id/retry` | Retry。 |

### Provider

| 方法与路径 | 用途 |
|---|---|
| `GET /v1/run-agent/settings` | 默认模型与 provider availability。 |
| `PUT /v1/run-agent/settings` | 保存 `providerConnectionId`。 |
| `GET /v1/provider-connections` | Workspace connection 列表。 |
| `POST /v1/provider-connections` | 创建 user connection，需要 API key。 |
| `PUT /v1/provider-connections/:id` | 更新 user connection；空 API key 不轮换。 |
| `DELETE /v1/provider-connections/:id` | 删除 user connection。 |
| `GET /v1/provider-catalog/providers` | Provider catalog 分页搜索。 |
| `GET /v1/provider-catalog/models` | Model catalog 分页搜索。 |
| `POST /v1/provider-catalog/sync` | 手动触发 catalog sync。 |
| `GET /v1/provider-catalog/sync/:attemptId` | 查询 sync attempt。 |

### Apps / Releases / Runs

| 方法与路径 | 用途 |
|---|---|
| `GET /v1/apps` | App summary 列表。 |
| `POST /v1/apps` | 创建 App。 |
| `GET /v1/apps/:appId` | App manifest、assets、releases 详情。 |
| `DELETE /v1/apps/:appId` | 软删除 App。 |
| `POST /v1/apps/:appId/releases` | JSON files 或 multipart archive 发布 release。 |
| `POST /v1/releases/:releaseId/runs` | 按最新/指定 release 启动 package run。 |

### Schedules

| 方法与路径 | 用途 |
|---|---|
| `GET /v1/schedules` | Schedule 快照列表。 |
| `GET /v1/schedules/:id/triggers` | 触发历史。 |
| `POST /v1/schedules/:id/pause` | 暂停。 |
| `POST /v1/schedules/:id/resume` | 恢复。 |
| `DELETE /v1/schedules/:id` | 删除。 |

## 12. 浏览器持久化与安全边界

浏览器只保存以下少量 UI 偏好：

| Key | 值 | 语义 |
|---|---|---|
| `sage.web.locale` | `"zh-CN"` / `"en"` | 界面语言。 |
| `sage.web.sidebar.collapsed` | `"true"` / `"false"` | 导航折叠偏好。 |
| `sage.chat-runtime.v2` | `""` 或 `"ws:<providerConnectionId>"` | Chat 运行时选择。 |

所有 localStorage 访问都必须可容忍 privacy mode / storage failure。

安全边界：

1. API key 只在创建或轮换 connection 的请求中出现；列表、Chat 提交和默认模型设置不回显 key。
2. Chat 只提交 `connectionId`；真实凭据由服务端从 secret backend 解封。
3. Schedule 等 service token 只能由同源代理在服务端注入。
4. Markdown raw HTML 不执行。
5. 外部链接使用无 opener 的新标签。
6. 未配置凭据时相关功能 fail closed，不提供假成功。

## 13. 并发、竞态与恢复

实现必须满足：

1. Chat event、task detail、run logs、catalog provider/model 查询都要求乱序响应不能覆盖新状态。
2. 实体切换时作废旧 AbortController / token。
3. Tasks / Packages URL 从详情回到列表时，清空详情状态并中止在途请求。
4. Chat timeline 使用 sequence 作唯一 cursor 与去重键。
5. Task run logs 使用 eventId 去重追加。
6. Provider catalog 分页按 providerId / modelId 去重合并。
7. 创建、删除、启动 run、控制 task 等写操作使用 guard 防重复提交。
8. SSE 断线后以最新 sequence 重建，而不是重放旧 URL 起点。
9. 会话标题搜索依赖 locale；切换语言后重新请求时携带新 locale。

## 14. 可访问性语义

为保持功能可用性，重建时必须保留以下语义：

1. 导航、列表、时间线、event stream、任务控制、provider 表单等区域有明确可访问名称。
2. 当前导航、当前会话、当前设置位置有 current 状态。
3. 错误 Banner / InlineNotice 使用 alert；成功或中性状态使用 status。
4. Modal 打开时移动焦点，Escape 关闭，Tab 焦点循环，关闭后焦点归还。
5. 表单控件有 label 或 aria-label。
6. 删除确认使用 alert / alertgroup 语义。
7. 图标或装饰字符不承载唯一信息。
8. Composer 支持 IME 组合输入，不会在候选词确认时误发送。

## 15. 功能验收清单

最小功能验收应覆盖：

### Shell / 路由

- [ ] 五个视图可通过 query 正确打开。
- [ ] 浏览器前进后退有效。
- [ ] 内部链接客户端导航，外部与下载链接不受影响。
- [ ] 语言、导航折叠、Chat runtime 偏好刷新后保留。

### Chat

- [ ] 能创建会话并进入会话。
- [ ] 会话列表能搜索、状态过滤、切换归档、加载更多。
- [ ] 能归档、恢复、两段确认删除。
- [ ] 刷新后能恢复标题、状态、归档态和历史事件。
- [ ] SSE 能增量更新；断线后不重放旧事件。
- [ ] 无有效 provider 时不能发送。
- [ ] 能发送文本、增量补拉并渲染 Markdown / thinking。
- [ ] 可重试错误 run。
- [ ] 能显式提升消息为 Task 并跳转。
- [ ] 能展开 event stream 并复制 JSON Lines。

### Tasks

- [ ] 能按状态加载 Task 列表并客户端搜索。
- [ ] 能打开详情、刷新、返回清空详情。
- [ ] 状态控制按钮按当前状态启用/禁用。
- [ ] Pause / Resume / Cancel / Retry 成功后列表与详情刷新。
- [ ] Timeline、run logs、artifacts 正确展示。
- [ ] Run logs 可切换 attempt 并增量加载。
- [ ] 文本产物可预览，二进制/归档可下载。

### Providers

- [ ] 能查看并保存默认模型。
- [ ] 能创建、编辑、删除 user provider connection。
- [ ] deployment-env connection 只读。
- [ ] API key 不回显。
- [ ] Catalog 能搜索 provider/model、分页、预填表单。
- [ ] Catalog 不可用时可手工录入。
- [ ] 手动 sync 能处理 loading、429、403、成功与失败。

### Packages

- [ ] 能列出、创建、打开、删除 App。
- [ ] 能上传 archive 发布新版本。
- [ ] manifest、assets、releases 正确展示。
- [ ] 能按声明 task 和 inputs 启动 run。
- [ ] run 成功后能跳转对应 Task。
- [ ] 三个内置示例可导入且重复导入幂等。

### Schedules

- [ ] 能加载 schedule 列表和触发历史。
- [ ] 能暂停、恢复和确认删除。
- [ ] 触发历史中的 taskId 能跳转 Task。
- [ ] 未认证时显示配置指引且不伪造成功。
