# sage-app-package-model-web

## Why

控制台仍把 Package 当作第二入口，且没有新建、草稿编辑/上传/下载、Release 详情与下载。新模型下 App 是唯一管理面。方案见 `~/code/tasks/ongoing/sage-app-package-model/design/app-release-model.md` §8。

## What Changes

- 路由：`/apps`、`/apps/:appId`、新增 `/apps/:appId/releases/:releaseId`；删除 `/packages*` 页面、导航与快捷键，`/packages` 重定向到 `/apps`。
- 应用列表：新增「新建应用」；保留「导入示例」。
- 应用详情：概览 / 草稿 / 发布历史 / 运行；草稿面板支持文件树与文本编辑、保存（`If-Match`）、上传压缩包、下载草稿、显示 revision 与未发布状态。
- 发布：用草稿 `app.yaml` 的版本发布，带 `baseRevision`；冲突提示；成功后进入 Release 行。
- Release：列表/详情页展示 manifest、assets、provenance、source/bundle 下载、运行。
- 调度：创建表单改为先选 App，再选 Release（FIXED）或「跟随最新」（FOLLOW），提交仍用 `{ definition, releaseId }`。
- 示例导入改为 create → putDraft → publish。
- 客户端类型、mock、i18n 同步；删除用户可见的 Package 文案。

## Non-goals

- 不新建视觉体系（adopt-only，沿用 `DESIGN.md` 与现有组件）。
- 不实现多文件拖拽排序、语法高亮以外的编辑器能力。
- 不改服务端；服务端由前序切片提供。

## 涉及面

| 仓库 | 角色 | 说明 |
|------|------|------|
| repos/github/sunzhenkai/sage | 必须 | `platform/apps/agent-web`（routes、pages、components、lib、locales、mock） |

## 验收标准

- [x] 浏览器中可新建 App、编辑/上传/下载草稿、发布、打开 Release 详情并下载 source/bundle、从 Release 运行并看到历史。
- [x] 导航无 Packages；访问 `/packages` 重定向 `/apps`；`/v1/packages` 无前端调用。
- [x] `corepack pnpm --filter @sage/agent-web build`（含 `check:design`）与 `typecheck` 通过；关键路由在 1280×800 与 375×812 可用。

## 验证记录

### 7.1 静态检查与构建

- `corepack pnpm --filter @sage/agent-web typecheck`：exit 0。
- `corepack pnpm --filter @sage/agent-web exec vitest run src/lib`：9 个文件 62 个用例全部通过。
- `corepack pnpm --filter @sage/agent-web build`：`prepare-examples` 生成 3 个示例、`check-design` OK、`tsc` 通过、`vite build` 成功（dist 1.13 MB / gzip 337 kB，仅 chunk 体积提示）。

### 7.2 浏览器走查（本地 agent-api + agent-web）

**1280×800**

- Apps 列表显示 `draft r2`、`v1.0.0`、`1 release`、未发布标记；新建 `verify-app-1020` 后跳转详情。
- 上传压缩包：选择 `verify-app-1020.tar.gz`（5 个文件）导入成功，revision 前进；文件树选择 `app.yaml` 可编辑并保存（r1 → r2），未发布标记出现。
- 下载草稿得到 tar.gz，`tar -tzf` 列出 5 个源文件；再次上传同包得到相同文件集合。
- 发布 v1.0.0 成功并显示 Release 行；Release 详情展示 manifest / assets / provenance，source 与 bundle 下载均为有效 tar.gz（bundle 含 `dist/index.js`）。
- 从 Release 运行跳转运行详情，App 详情运行历史可见新运行。
- Schedules：`verify-follow-1020`（FOLLOW）详情显示 `Follow latest`，创建时锚点为 `v1.0.0`；`verify-fixed-1020`（FIXED）详情显示 `FIXED sha256:5900…`，原始定义含 `releaseId` 与 `contentDigest`。
- 控制台无新增错误（历史遗留的 pattern 报错在转义修复后不再出现；Vite 需 touch 文件刷新 transform 缓存）。

**375×812（侧栏折叠）**

- `/apps` 列表表格横向滚动（内容宽 934 > 容器 263），操作可达。
- App 详情与 Release 详情在 `lg` 以下隐藏右侧属性栏（`DetailLayout` aside `hidden lg:block`），主内容占满宽度；Release 头部操作降为图标按钮（`sm` 以上显示文字），App 面包屑与状态 meta 按断点隐藏，均无横向溢出。
- 草稿编辑器、发布按钮、下载与运行入口可用。

截图：`tmp/verify-web-1280-app.png`、`tmp/verify-web-1280-release.png`、`tmp/verify-web-1280-schedule-fixed.png`、`tmp/verify-web-375-list.png`、`tmp/verify-web-375-app.png`、`tmp/verify-web-375-app-collapsed-2.png`、`tmp/verify-web-375-release-2.png`。
