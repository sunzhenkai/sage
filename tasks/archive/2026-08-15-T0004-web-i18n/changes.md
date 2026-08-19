# T0004 Web i18n 交付记录

## 工作上下文

- canonical checkout: `.` (`<worktree>`)
- 实际 checkout: `.`，非 worktree
- 分支：`feat-web-i18n`，基线 `master`
- 未创建 commit；保留用户已有 dirty 工作树，不执行 stash/reset/clean。

## 实现摘要

- 新增 `platform/apps/agent-web/src/locale.tsx`：支持 `zh-CN | en`、BCP 47 规范化、持久化优先级、浏览器检测、中文回退、typed dictionaries、命名插值、Intl 日期时间和 `document.documentElement.lang` 同步。
- 新增 `platform/apps/agent-web/src/locale.test.tsx`：覆盖 locale 解析、异常隔离、dictionary parity/非空、即时切换、best-effort storage 和文档语言同步。
- 将 `main.tsx`、Workspace/Chat/Task/Provider 页面用户可见文案迁移到统一翻译资源，增加可访问语言控件，并保留 API payload、领域数据和业务交互语义。
- 移动端保留语言控件可见；补齐 loading/empty/error/accessibility 文案。

## OpenSpec

- change：`web-interface-localization`
- 已归档至：`openspec/changes/archive/2026-08-15-web-interface-localization/`
- main spec 已由 `openspec archive --yes --json` 更新，结果：added 6、modified 0、removed 0、renamed 0。
- tasks：14/14 完成；T0004 README 验收标准 8/8 完成。

## 验证证据

- `pnpm --filter @sage/agent-web typecheck`：通过。
- `pnpm exec vitest run apps/agent-web/src`：14 files、39 tests 全部通过。
- `pnpm --filter @sage/agent-web build`：Vite production build 通过。
- 浏览器 smoke（临时 14175 preview，已清理；未停止已有 14173 服务）：390px 下语言控件可见；注入 `fr-FR` 且无显式选择回退 `zh-CN`/中文标题；注入 `en-US` 自动检测为 `en`/英文标题；显式切换更新文案、`html lang` 和 `localStorage` 且无刷新；刷新恢复显式 `en`；Intl `zh-CN` 与 `en` 日期输出不同。

## 工作树说明

归档时工作树仍 dirty。除本任务新增/修改文件外，git-summary 还检测到 `.service-manager.md`、`platform/packages/provider-catalog/src/projection.ts` 及其测试等已有工作树改动；未擅自覆盖、提交、清理或重置。`taskctl archive` 使用 `--allow-dirty` 仅记录并归档 T0004，不改变这些工作树内容。

## 归档门禁覆盖

- 允许 dirty checkout：.
