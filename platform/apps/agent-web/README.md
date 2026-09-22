# @sage/agent-web

Sage 本地工作区的单页 Web 控制面。React 19 + Vite + TypeScript，无第三方 UI/状态框架；样式为手写 CSS（设计基线见 `src/styles/global.css` 头注）。功能契约以 `docs/design/ui/ui-v1.md` 为唯一依据。

## 命令

```bash
cd platform
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @sage/agent-web typecheck   # tsc -b（project reference 自动构建 @sage/app-contracts）
corepack pnpm --filter @sage/agent-web build       # tsc -b && vite build
corepack pnpm --filter @sage/agent-web dev         # 0.0.0.0:9612，strictPort
corepack pnpm --filter @sage/agent-web preview
```

- API 默认同源相对路径 `/v1`，全部请求 `credentials: "include"`；视图组件可注入自定义 `fetch` 与 `apiBase`（`App(options)` → `ApiCtx`）。
- dev / preview 均把 `/v1` 代理到 `SAGE_API_PROXY_TARGET`（默认 `http://127.0.0.1:9610`）；`SAGE_SERVICE_TOKEN` 非空时代理在服务端注入 `Authorization`（浏览器永不持有）。SSE 响应在代理层去压缩/去缓存并逐帧透传。
- preview 缓存：仅 `/assets/*`（内容哈希产物）`immutable` 长缓存；`index.html` 与 `/v1` 保持 ETag/304。

## 结构

- `src/lib/` — 路由（查询参数路由 + 客户端导航拦截）、API client（错误契约解析优先级）、领域 endpoint、storage（静默降级）、i18n、安全 Markdown 子集 + think 拆分、时间格式化。
- `src/components/` — 反馈宿主（role=status / role=alert）、通用 primitives（两段确认、复制兜底、Modal、Badge 等）。
- `src/views/` — Chat / Tasks / Providers / Packages / Schedules / Settings 六个视图，各带局部 CSS。
- `scripts/dev-mock.mjs` — 开发辅助 mock API（:9613），仅用于本地联调与视觉验证，不属于产品运行时。

## 实现说明（交付自检）

### 已实现范围

规格第 3–13 章全部功能：查询路由与壳层、zh-CN/en 本地化（初始化顺序、`<html lang>`、localStorage 静默降级、三种时间格式）、通用 API 行为（JSON helper、错误契约、局部失败不覆盖全局）、Chat（列表分页/搜索/过滤/归档/两段删除、SSE 恢复与 1s cursor 重建、发送、runtime 选择、时间线分组状态机、安全 Markdown、活动行、retry/promote、原始事件 JSON Lines 复制、快捷提示）、Tasks（状态过滤/客户端搜索/running 计数、详情四请求并行与降级、控制 guard、effect_unknown 与失败详情、timeline、run logs attempt 切换与增量、artifact 预览/下载）、Providers（默认模型、connection CRUD、catalog 搜索/分页/预填/键盘语义/sync 轮询与 429/403/409）、Settings（通用=界面语言、模型=默认运行模型单选即存，tab 深链与非法回落）、Packages（列表/创建/详情 manifest/assets/releases、archive 上传校验、三个内置示例幂等导入、按声明 task/inputs 启动 run）、Schedules（列表/触发历史/pause/resume/删除、401 配置指引）。安全边界：API key 不回显、Markdown raw HTML 不执行、外链 noopener、凭据缺失 fail closed、仅三个约定 localStorage key。

### 与规格的偏差

无已知功能语义偏差。两处呈现层说明（非功能）：catalog 的 anthropic 判定按 `providerId === 'anthropic'`（models-dev 惯例）；Chat artifact 链接直接使用服务端下发的 `artifact://` 引用（规格定义其为链接）。

### 未决问题

无。

### 验收自检（规格 §14）

- Shell/路由：六视图 query 打开、前进后退、内部链接客户端导航、外链/下载不拦截 — 已验证（Playwright 实测）。
- Chat：创建/进入、搜索/过滤/归档/两段删除、恢复后 SSE 实时与断线重建（代理修复后 `text/event-stream` 透传、`:ok` 帧即时到达）、发送 202 + 增量补拉、无 provider 禁发、Markdown/autolink/think、retry/promote、原始事件复制 — 已对真实 agent-api（:9610）与 mock 实测。
- Tasks：状态过滤、搜索、详情、返回清空、控制按状态启停、timeline/logs/artifacts、run logs attempt 与增量 — 已验证。
- Providers：默认模型保存、connection 增删改、catalog 搜索/预填/键盘、sync 流程 — 已验证（真实 catalog）。
- Packages：列表/创建/打开/删除、manifest/assets/releases、run 启动 — 已验证。
- Schedules：401 时配置指引、不伪造成功 — 已验证（真实后端返回 401）。
- `typecheck` 与 `build` 通过（tsc -b 全绿；vite build 产物 ~340 KB JS / ~27 KB CSS）。

### 视觉基线

主题：本地工作区的"园丁台"——暖纸底、墨绿、鼠尾草 accent；等宽字体承担 ID/时间/digest/事件负载。记忆点：Chat 时间线"茎干"，运行中的轮次节点为呼吸芽点。动效仅服务于状态表达，尊重 `prefers-reduced-motion`。
