# Agent Web 实现 Prompt

> 用途：投递给代码生成 agent，从零实现 `agent-web`。
> 唯一功能规格：`docs/design/ui/ui-v1.md`（下称"规格"）。
> 本文件只负责约束任务边界、交付物与实现纪律，不重复规格中的功能条款。

## 0. 你的任务

实现一个可运行的 Sage 本地工作区单页 Web 控制面 `agent-web`。

- 先完整读取 `docs/design/ui/ui-v1.md`，把它当作已实现行为的唯一契约。
- 规格中出现的每个功能、状态、字段、接口路径、参数、错误码、边界与竞态规则都必须被实现或被显式消费。
- 规格未规定的部分（界面结构、组件拆分、布局、样式、视觉、动效、文案措辞的组织方式）由你自行决定。
- 如果实现过程中发现规格存在矛盾或缺口，停下来报告，不要自行改写功能语义。

## 1. 必须遵守的硬约束

### 1.1 技术栈

- React + Vite SPA，TypeScript。
- 挂载到 `index.html` 中 id 为 `root` 的节点，入口使用 `StrictMode`。
- 依赖 `@sage/app-contracts` 表示 Chat / Catalog / Schedule 等公共契约。
- 不引入不在仓库 lockfile 中的重型框架；新增依赖需说明理由。

### 1.2 运行边界

- API 默认使用同源相对路径 `/v1`。
- 所有浏览器请求携带 `credentials: "include"`。
- 视图组件必须允许注入自定义 `fetch` 与 `apiBase`，以支持测试与嵌入。
- Vite 配置：dev server 监听 `0.0.0.0:9612`，端口占用直接报错，不自动换端口。
- dev 与 preview 都把 `/v1` 代理到 `SAGE_API_PROXY_TARGET`，默认 `http://127.0.0.1:9610`。
- 若 `SAGE_SERVICE_TOKEN` 非空，代理在服务端注入 `Authorization: Bearer <token>`；浏览器永远不持有该 token。
- SSE 代理必须在收到上游响应头后强制 flush。
- preview 缓存：只有带内容哈希的 `/assets` 产物用 immutable 长缓存；`index.html` 与 `/v1` 保持 ETag/304。

### 1.3 仓库命令

```bash
cd platform
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @sage/agent-web typecheck
corepack pnpm --filter @sage/agent-web dev
corepack pnpm --filter @sage/agent-web build
```

交付前必须 `typecheck` 与 `build` 通过。

## 2. 功能范围

按规格实现以下全部视图与能力，不得删减：

1. **应用壳层与路由**：查询参数路由、`workspaceHref`、客户端导航拦截规则、`popstate` 与导航事件刷新、五个视图导航、首页入口、折叠偏好、全局新建对话、启动异常降级。
2. **本地化与格式化**：`zh-CN` / `en`、初始化顺序、`<html lang>`、字典结构一致、插值、三种时间格式。
3. **通用 API 行为**：JSON helper、content-type 规则、错误解析优先级、错误契约、局部失败不覆盖全局数据。
4. **Chat**：会话列表分页 / 搜索 / 过滤 / 归档 / 两段删除、会话恢复、SSE 实时流与断线重建、消息发送、runtime 选择、时间线模型、Markdown 安全子集、thinking 拆分、tool / artifact / error / task / retry / promote 活动、原始事件流查看与复制、快捷提示与可写性。
5. **Tasks**：列表与状态过滤、客户端搜索、running 计数、详情并行请求与降级、projection freshness、timeline、run logs 分 attempt 与增量追加、artifacts 预览与下载、Pause / Resume / Cancel / Retry 控制、`effect_unknown` 语义、失败详情。
6. **Providers**：默认模型查看与保存、provider connection 列表、创建 / 编辑 / 删除、deployment-env 只读、API key 不回显、catalog 搜索与分页与预填、catalog sync 轮询与 429 / 403 处理、snapshot changed、键盘选择语义。
7. **AI Apps / Packages**：App 列表、创建、详情（manifest summary / assets / releases）、archive 上传新版本、三个内置示例导入与幂等、软删除、按 manifest task 与 inputs 启动 run。
8. **Schedules**：只读列表、触发历史、Pause / Resume / Delete、认证失败配置指引、taskId 跳转。
9. **浏览器持久化与安全边界**：三个 localStorage key、storage 失败静默降级、凭据与 token 边界、Markdown raw HTML 不执行、外链无 opener、未配置凭据 fail closed。
10. **并发、竞态与恢复**：乱序响应、AbortController 作废、实体切换清理、去重键、写操作 guard、SSE cursor 重建、locale 变化重新请求。

## 3. 不许做的事

- 不许修改、简化或"优化"规格中的功能语义。
- 不许用 stub、假数据或假成功代替真实 API 调用；失败必须真实失败。
- 不许把 API key、ciphertext、service token 写入浏览器存储或提交给无关接口。
- 不许在 Markdown 渲染中执行 raw HTML。
- 不许让局部请求失败清空或覆盖整个页面数据。
- 不许在没有样式要求时把视觉实现当成任务目标；样式是自由度，不是验收项。

## 4. 样式与呈现：明确不设限

- 规格已声明界面描述为非范围，本任务同样不做样式限定。
- 页面结构、组件粒度、布局方式、配色、字体、间距、圆角、阴影、动效、响应式断点全部由你自行决定。
- 唯一与呈现相关的强制要求来自功能契约：可辨识的当前视图与当前会话、明确可辨识的加载 / 空态 / 成功 / 错误反馈、可辨识的选中与禁用状态、live region 语义。
- 优先保证功能正确、状态可达、交互可辨识，而不是视觉一致性。

## 5. 实现纪律

1. **规格驱动**：每实现一个功能点，回到规格对应章节核对字段名、路径、参数、状态集合与边界。
2. **契约优先**：先确定 API client、类型与状态容器，再实现视图。
3. **状态隔离**：每个视图的实体切换必须清理旧状态并作废在途请求。
4. **可测性**：`fetch` 与 `apiBase` 可注入；关键状态机逻辑与视图解耦。
5. **异常路径**：对每个接口失败、401、403、404、409、429、503 按下文规格处理，不吞错、不伪造成功。
6. **增量交付**：按 Shell → Chat → Tasks → Providers → Packages → Schedules 顺序推进，每段可独立验证。

## 6. 验收

实现完成后，必须逐条对照规格第 14 章《功能验收清单》自检，至少覆盖：

- 五个视图可通过 query 正确打开，前进后退有效，内部链接客户端导航，外链与下载不受影响，偏好刷新后保留。
- Chat 全流程：创建、搜索、过滤、归档、恢复、两段删除、刷新恢复、SSE 增量与断线重连、无 provider 禁止发送、发送与补拉、Markdown / thinking 渲染、retry、promote、原始事件流与复制。
- Tasks 全流程：状态过滤、搜索、详情、返回清空、控制按钮启用禁用与刷新、timeline、run logs 切换 attempt 与增量加载、文本产物预览、二进制下载。
- Providers 全流程：默认模型保存、connection 增删改、deployment-env 只读、API key 不回显、catalog 搜索分页预填、不可用手工录入、sync 的 loading / 429 / 403 / 成功 / 失败。
- Packages 全流程：列表、创建、打开、删除、上传 archive、manifest / assets / releases、按 task 与 inputs 启动 run、跳转 Task、三个示例幂等导入。
- Schedules 全流程：列表与触发历史、pause / resume / 确认删除、taskId 跳转、未认证配置指引且不伪造成功。
- `corepack pnpm --filter @sage/agent-web typecheck` 与 `build` 通过。

## 7. 交付输出

1. 可运行源码，落在 `platform/apps/agent-web`。
2. `package.json` 脚本至少包含 `dev`、`build`、`typecheck`。
3. Vite 配置满足第 1.2 节全部行为。
4. 一份简短实现说明：已实现范围、与规格的偏差（应为空或已确认）、未决问题（应为空）。
5. 自检结果：验收清单逐项结论 + `typecheck` / `build` 输出摘要。

## 8. 遇到不确定时的处理

- 规格已规定：照做，不要自由发挥。
- 规格未规定且属于样式或结构：自行决定，继续推进。
- 规格未规定且影响功能语义：暂停并报告，给出你的推荐方案。
