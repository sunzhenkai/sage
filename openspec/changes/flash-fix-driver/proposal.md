## Why
sage agent-web 是 React + Vite 单页应用，但没有任何客户端路由：所有导航（侧边栏、聊天历史、任务列表、包列表）都是 `<a href="?view=...">` 整页链接 + `window.location.assign()`。每次导航/刷新都触发完整页面加载 → 重新下载 CSS/JS（无强缓存头）→ 白屏（背景色在 CSS 里未内联）→ React 重新引导重建 SSE、重拉全部数据 → 整页闪一下。

## What Changes
- 本 change 是 taskflow driver，不直接改代码，只编排子 change

## Non-goals
- 不做后端/API 改动（数据加载延迟、SSE 重连逻辑不属于本任务范围，客户端路由化后由既有 useEffect cleanup 自然收敛）
- 不引入 react-router 等第三方路由依赖（视图为查询参数路由 `?view=...`，用原生 History API 包轻量路由即可）
- 不换生产静态服务器（vite preview 已带 gzip/brotli；资源强缓存在 vite preview headers 层实现）

## 涉及面
| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | 会修改 platform/apps/agent-web，实施前切任务分支 |

## 验收标准
- [x] 侧边栏/导航/历史/任务/包链接点击为客户端路由切换，不再整页跳转（`history.pushState`，无白屏重载）
- [x] 浏览器前进/后退（popstate）能正确切换视图并恢复对应会话/任务上下文
- [x] 背景色内联到 index.html，首帧不再白屏（无 FOUC）
- [x] `#root` 预置同色骨架屏，React 挂载前页面非空白
- [x] `/assets/*`（带内容哈希）配置 `public, max-age=31536000, immutable`，index.html 保持 `no-cache`
- [x] 视图切换时仅重拉所需数据，不重建整个应用、不重复建立无关 SSE 连接
- [x] 全仓回归与静态检查通过（typecheck/lint/build/agent-web 单测；全仓 test 除 1 个既有 agent-platform-final 失败外通过，见验证记录）

## Driver 协议
- 本 change 无 spec 增量（`.openspec.yaml` 已设 `skip_specs: true`）
- 子 change 一律命名 `{task}-<slice>`，与本 change 同一 planning root；跨 root 时在涉及面表显式记录 root 或 store id
- 实现进度只认子 change 自己的 `tasks.md`；本文件的 checkbox 只在对应子 change 全勾且 `validate --strict` 通过后才勾
- 涉及面里角色为 `必须` 的仓在实施前切任务分支；dirty 或 fetch 失败一律停下问用户，不自动 stash / reset / 强制切换
- 只有「checkbox 全勾」「需要用户决策」「本轮预算耗尽」三种情况允许结束一轮；单项做不了就保持未勾，在验证记录写一行原因后继续下一项
- 结束时逐条列出未勾项与原因，不按 change 汇总

## 验证记录

### 实施验证（2026-08-23，feat/flash-fix）

- **flash-fix-routing**：新增 `src/routing.ts`（`navigate`/`useLocation`/全局 `<a>` 拦截），`main.tsx` 布局/内容分离（`WorkspaceApp` 按 `useLocation` 切换视图），`workspace.tsx` 默认导航改 pushState。新增 `routing.test.tsx`（12 用例：isInternalRouteHref / handleAnchorNavigation / navigate pushState 与 assign / useLocation / WorkspaceApp 布局分离 / 切走关闭 SSE / 后退恢复上下文）。agent-web 单测 107/107 通过，`openspec validate --strict --type change flash-fix-routing` 通过。浏览器实测（vite preview + Playwright）：点击侧边栏 Tasks → URL 变 `?view=tasks` 无整页重载，侧边栏保留；后退恢复 chat 视图。
- **flash-fix-firstpaint**：`index.html` 内联 `<html style="background:#f4f6fb">` + `#root` 预置 `.boot-skeleton` 骨架（左侧 `#101828` 边栏块 + 主区 `#f4f6fb`/`#e4e9f2` 占位），样式内联 `<style>`。build 通过，`dist/index.html` 含内联背景与骨架。Playwright 禁用 JS 验证：`htmlBg=background:#f4f6fb`、骨架存在（13 子节点）；挂载后 `skeletonRemoved=true`、root 仅 `.app-frame`，无残留。`openspec validate --strict --type change flash-fix-firstpaint` 通过。
- **flash-fix-cache**：`vite.config.ts` 新增 `previewCacheHeaders` 插件（`configurePreviewServer` 中间件，仅对 `/assets/*` 带扩展名设 `Cache-Control: public, max-age=31536000, immutable`）。vite 8 不再把 `preview.configurePreviewServer` 作为插件 hook 收集（`getSortedPluginHooks` 只读 `config.plugins`），故改为插件实现。curl 验证：`/assets/*.js|css` → immutable；`/`（index.html）→ no-cache + ETag；`/v1` 代理 → 无 immutable。`openspec validate --strict --type change flash-fix-cache` 通过。

### 全仓回归（2026-08-23）

- `pnpm typecheck`（platform）通过
- `pnpm lint`（platform）通过
- `pnpm build`（platform 全仓）通过
- agent-web 单测 107/107 通过（20 个测试文件）
- `pnpm test`（全仓）：**1 个既有失败** `scripts/agent-platform-final/final.test.ts > preflight is truthfully blocked by production external evidence`（断言 preflight 前 3 个依赖为 PASS 实际非）。已验证该失败在移除全部 flash-fix 改动后仍存在，且与 evidence 恢复无关——根因是 HEAD commit `b5c4645` 归档 agent-package E2E 后 openspec 状态与 `entry-preflight.json` 未同步，非本 change 引入。其余 795 通过 / 60 跳过。

> 注：`pnpm test` 运行时 agent-platform-final 套件会重写 `platform/evidence/agent-platform-final/*.json`（checkedAt 更新），此行为为套件既有逻辑，未提交这些 evidence 改动。
