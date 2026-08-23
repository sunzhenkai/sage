## 1. 侧边栏收起状态与切换入口

- [x] 1.1 在 `platform/apps/agent-web/src/main.tsx` 的 `WorkspaceShell` 中新增 `collapsed` 状态：初始值从 localStorage 读取（key 参照 `SIDEBAR_STORAGE_KEY`），并提供读写/失败静默回退的 best-effort 持久化
- [x] 1.2 在侧边栏顶部品牌区（或紧邻其下）新增收起/展开切换按钮：`aria-expanded` 表达当前形态，`title` + 双语 `aria-label`（「收起侧边栏」/「展开侧边栏」），点击切换 `collapsed` 并写回 localStorage
- [x] 1.3 为 `aside.sidebar` 追加 `is-collapsed` class（按 `collapsed` 状态渲染），并让 `main-column` 在收起时同步收缩宽度

## 2. 收起态样式

- [x] 2.1 在 `styles.css` 增加 `is-collapsed` 样式：隐藏品牌文字、工作区切换器文字、导航文字标签、runtime 卡片、账户文字与语言控件标签；导航项水平居中并保留激活态与图标
- [x] 2.2 为收起态下的图标化导航项补齐可访问名称（`title`/`aria-label`），并确保 `@media (max-width:700px)` 顶部导航形态不受 `is-collapsed` 影响（移动端不渲染切换入口、不引入收起行为）
- [x] 2.3 校验收起/展开在 `@media (max-width:980px)`（207px 断点）与默认（244px）下的宽度覆盖优先级

## 3. 文案与测试

- [x] 3.1 在 `locale.tsx` 中英文案字典新增收起/展开相关键（与现有键保持同名对齐），并在 `locale.test.tsx` 的「字典键一致且非空」断言下自动覆盖
- [x] 3.2 在 `header-alignment.test.tsx`（或新建侧栏测试文件）补充断言：切换按钮渲染且带 `aria-expanded` 与双语 aria-label；收起后图标导航项仍有可访问名称；切换不重载视图；localStorage 持久化后再次渲染恢复收起态
- [x] 3.3 运行 `pnpm --filter @sage/agent-web test` 与 `pnpm typecheck`，确认既有侧栏导航相关测试（`routing.test.tsx`、`header-alignment.test.tsx`）不回归
