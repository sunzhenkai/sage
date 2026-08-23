## 1. 路由核心

- [x] 1.1 新建 `src/routing.ts`：`navigate(href)`（pushState + 事件广播）与 `useLocation()`（useSyncExternalStore 订阅 popstate，返回 URLSearchParams 稳定快照）
- [x] 1.2 保持 `workspaceHref` URL 形态不变（`?view=chat&session=...`），仅确认现有生成逻辑

## 2. 全局拦截与布局分离

- [x] 2.1 根组件挂全局 `<a>` 点击委托：站内查询路由链接 `preventDefault` + `navigate`，外部/下载放行
- [x] 2.2 `WorkspaceShell`/`renderWorkspace` 布局只挂载一次：view 与参数来自 `useLocation`，主区按 view 渲染内容；内容区 key 按 `view+session` 控制重挂载
- [x] 2.3 `WorkspaceShell` 的 `navigate` 默认实现从 `window.location.assign` 改为 pushState 路由（保留 props 注入能力）

## 3. 视图数据收敛

- [x] 3.1 确认 ChatApp `useEffect` 依赖 `[apiBase, sessionId, fetcher]`，切 view 离开时 cleanup 关闭 SSE、切回按 afterSequence 增量恢复（如有缺漏补上）
- [x] 3.2 确认 tasks/packages/providers 视图切换只重拉自身数据，无全量重新引导残留

## 4. 测试适配

- [x] 4.1 `renderWorkspace` 保持纯函数入口（可传 search），`useLocation` 支持测试注入
- [x] 4.2 适配 workspace/chat/tasks/packages/providers 测试：`window.location.assign` 断言改为 pushState/URL 断言，jsdom 模拟前进/后退
- [x] 4.3 新增路由行为测试：侧边栏导航不整页（URL 更新 + 内容切换）、后退恢复上下文、切走释放 SSE

## 5. 验证

- [x] 5.1 `pnpm --filter @sage/agent-web typecheck` 通过
- [x] 5.2 agent-web 单测通过（`pnpm --filter @sage/agent-web test` 或对应 vitest）
- [x] 5.3 `openspec validate --strict --type change flash-fix-routing` 通过
