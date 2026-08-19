## 1. 状态呈现互斥修复

- [x] 1.1 在 `workspace.tsx` 的 `ChatLanding` 中调整错误/加载/空状态渲染顺序：存在 `error` 时仅展示错误横幅，不展示空状态、历史列表或 Load more。
- [x] 1.2 在 `tasks.tsx` 的 `TasksApp` 中调整错误/加载/空状态渲染顺序：存在 `error` 时仅展示错误横幅，不展示空状态或任务表格。
- [x] 1.3 为 `ChatLanding` 添加「加载失败时只展示错误态」的单元测试。
- [x] 1.4 为 `TasksApp` 添加「加载失败时只展示错误态」的单元测试。

## 2. Provider 弹窗交互补全

- [x] 2.1 在 `providers.tsx` 中为 `provider-modal-backdrop` 添加 `onClick` 处理器，仅当点击目标为蒙层时关闭 dialog。
- [x] 2.2 调整 Provider combobox 的 `keyboard` 辅助函数，避免 `Escape` 关闭下拉后被 `stopPropagation` 吞掉；让事件在选项关闭后继续冒泡到 dialog。
- [x] 2.3 为 dialog 添加 `Escape` 关闭处理，并确保在 creating 模式下生效。
- [x] 2.4 使用 `useRef` 保存「Add provider」按钮引用，dialog 关闭时将焦点返回到该按钮。
- [x] 2.5 更新 `providers.test.tsx`：新增 Esc 关闭、backdrop 关闭、焦点回归的测试。

## 3. Chat 会话恢复失败状态修复

- [x] 3.1 在 `chat.tsx` 的 `ChatApp` 中引入派生状态 `sessionWritable`，仅当 `sessionStatus === 'open'` 时允许写入。
- [x] 3.2 当 `error` 存在且 `sessionStatus !== 'open'` 时，将 Composer 替换为只读提示或隐藏，禁用快速提示按钮。
- [x] 3.3 保留 404 recovery 页面逻辑不变。
- [x] 3.4 为 `ChatApp` 添加非 404 错误下 Composer 禁用的单元测试。

## 4. 本地化文案补齐

- [x] 4.1 在 `locale.tsx` 的 `enMessages` 中补充 `savedMetadata`、`catalogSyncStatus`、`catalogSyncAttempt` 三个键。
- [x] 4.2 在 `locale.tsx` 的 `zhMessages` 中补充上述三个键的简体中文翻译，并确保 key 集一致。
- [x] 4.3 在 `providers.tsx` 的 `save()` 中，将保存成功提示替换为 `t('savedMetadata', { name: metadata.name })`。
- [x] 4.4 在 `providers.tsx` 的 `syncCatalog()` 中，将同步状态提示替换为 `t('catalogSyncStatus', ...)` + `t('catalogSyncAttempt', ...)` 组合。
- [x] 4.5 为 `providers.test.tsx` 添加中英文切换后提示文案本地化的测试。

## 5. Provider 通知防覆盖

- [x] 5.1 为 `checkConnection` 引入局部 token ref，在异步回调返回前检查 token 是否最新，过期则跳过 `setNotice`。
- [x] 5.2 为 `syncCatalog` 引入同样的 token 检查机制。
- [x] 5.3 为快速连续操作场景补充单元测试，验证最新通知不会被过期请求覆盖。

## 6. Task detail 刷新防重入

- [x] 6.1 在 `tasks.tsx` 的 `TaskDetail` 中，将刷新按钮设置为 `disabled={detailLoading}`。
- [x] 6.2 为 `TasksApp`/`TaskDetail` 补充刷新期间按钮禁用的测试。

## 7. 导航快捷键处理

- [x] 7.1 评估实现成本后，在 `workspace.tsx` 中移除侧边栏 Chat 项上的 `⌘ K` 标注；或实现全局 `Meta+K` 快捷键导航到 Chat。
- [x] 7.2 若选择实现快捷键，补充对应键盘测试。

## 8. 回归验证

- [x] 8.1 运行 `pnpm typecheck` 与 `npx vitest run`，确保现有 39 个测试全部通过。
- [x] 8.2 使用 Playwright 手动验证：Provider 弹窗 Esc/backdrop 关闭、Chat/Tasks 错误态、中英文 Provider 提示、Task 刷新禁用。
- [x] 8.3 运行 `openspec validate fix-agent-web-functional-issues --strict` 确认规划产物通过校验。
