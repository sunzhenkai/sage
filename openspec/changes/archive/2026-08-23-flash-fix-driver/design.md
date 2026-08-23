## Context

agent-web 是 React + Vite SPA，`main.tsx` 的 `renderWorkspace()` 一次性读取 `location.search` 决定 `view`，`WorkspaceShell` 与内容一并挂载。导航全部是 `<a href="?view=...">`（`workspace.tsx` 的 `workspaceHref`）与 `window.location.assign()`（`workspace.tsx` 的 `navigate` 默认实现），无任何客户端路由（无 `pushState`/`popstate`）。产物 `dist/index.html` 的 `#root` 为空，背景色 `#f4f6fb` 在 `styles.css` 而非 HTML；vite preview 对静态资源仅 ETag/304、无强缓存头。

## Goals / Non-Goals

**Goals:**
- 导航从整页跳转改为客户端路由（`history.pushState` + `popstate`），侧边栏/品牌布局不重挂载
- 首帧非白屏、非空白：背景内联 + `#root` 骨架屏
- `/assets/*` 带内容哈希资源强缓存，`index.html` no-cache
- 视图切换只重拉所需数据，不重复建无关 SSE

**Non-Goals:**
- 不引入 react-router（查询参数路由用原生 History API 已足够）
- 不改后端/API、不换生产静态服务器

## Decisions

### D1 客户端路由：原生 History API 轻量封装，而非 react-router
理由：视图形态是**查询参数路由**（`?view=chat&session=...`），不是路径路由；加 react-router 需改造所有 `href` 语义且引入依赖。用 `history.pushState` + `popstate` 封装一个 `navigate(href)` + `useLocation()` 钩子：`navigate` 内部 `pushState` 并触发自定义事件，`useLocation` 订阅 `popstate` 与自定义事件返回 `URLSearchParams`。
替代方案：react-router（重、语义不匹配）。

### D2 全局拦截 `<a>` 点击，局部渲染
在根组件挂一个 click handler：命中 `a[href]` 且为站内查询路由（`href` 以 `?` 开头，或同源同 path）时 `preventDefault` + `navigate`。`WorkspaceShell` 的 `navigate` 从 `window.location.assign` 改为 `pushState`。非路由链接（如文件下载、外部）放行。

### D3 布局与内容分离，视图状态上浮
`WorkspaceShell`（侧边栏/品牌/布局）只渲染一次；`view` 与 URL 参数（sessionId/taskId/packageId）由 `useLocation` 提供。主区按 `view` 选择内容组件。**关键约束**：切换 view 时若 `sessionId` 仍在 URL 中，`ChatApp` 不因布局重渲染而重挂载——通过给内容区稳定 key（仅按 `view`+`sessionId` 组合，而非整个 location）控制，或在各 App 的 `useEffect` 依赖里精确限定（既有 `[apiBase, sessionId, fetcher]` 已具备，切 view 不重建 SSE）。切走时 `useEffect` cleanup 关闭 SSE，切回时按 `afterSequence` 增量拉取。

### D4 首帧骨架屏 + 背景内联
`index.html` 的 `<html style="background:#f4f6fb">` + `#root` 内预置与最终布局同色的静态骨架（左侧深色边栏块 + 主区浅灰占位），样式内联 `<style>`（首帧即生效）。`createRoot().render()` 会自动替换 `#root` 内容，无需清理代码。`styles.css` 保留同名规则保证水合后一致（骨架类只作用于 `#root:empty` 或挂载即消失，避免残留）。

### D5 静态资源强缓存
`vite.config.ts` 的 `preview.headers`：`/assets/` 下带内容哈希文件给 `public, max-age=31536000, immutable`；`index.html` 保持 `no-cache`（发版后可拿到新入口）。实现：在 `configurePreviewServer` 中按 `pathname` 判断写 `Cache-Control`，或直接配 `headers` 兜底 + 对 `index.html` 特殊处理。

## Risks / Trade-offs

- **测试适配成本**：`workspace.test.tsx`、`chat.test.tsx` 等大量使用 `renderWorkspace()` 与 `location` mock。路由化后 `navigate` 默认实现变化、`useLocation` 依赖 `history`，需同步适配测试（注入 `navigate`/`location` 或用 jsdom 的 `history.pushState`）。这是本任务主要成本。
- **会话切换语义**：`sessionId` 变化 → `ChatApp` 重挂载重建 SSE，属期望行为（切会话）；需避免的是"切视图但 sessionId 不变"时的不必要重挂载。
- **浏览器前进/后退**：`popstate` 需恢复对应视图与上下文，URL 参数即真相源（server-driven location），无需额外状态同步。
- **骨架屏一致性**：骨架与真实布局需同色，避免"闪一下又变"；用 `#root:empty` 限定骨架仅在 JS 未挂载时可见。
