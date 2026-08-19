# T0004 实施进度

- 更新：2026-08-15
- 阶段：`done`
- 当前 change：`web-interface-localization`
- 当前任务：T0004 全部实现与验证完成，准备 task-archive

## OpenSpec 进度

| change | 完成 | 总数 | 剩余 | planning root |
|--------|------|------|------|---------------|
| `web-interface-localization` | 14 | 14 | 0 | `<worktree>/openspec` |

## 本轮完成

- 1.1 locale 类型、BCP 47 规范化、持久化优先级、浏览器检测和中文回退已实现
- 1.2 en/zh-CN typed dictionaries、命名插值和 key parity/非空测试已完成
- 1.3 LocaleProvider/useLocale、sage.web.locale best-effort 持久化、Intl 日期时间 helper 和 document.documentElement.lang 同步已完成
- 1.4 locale.test.tsx 通过 5 tests，覆盖规范化、优先级、无效值、语言 API/storage 异常、中文回退、即时切换和 document lang
- 2.1 main.tsx 根部接入 LocaleProvider，WorkspaceShell 提供可访问 zh-CN/English select，切换保留当前路由上下文
- 2.2 main、WorkspaceShell、BootError、ChatLanding 的标题、导航、状态、empty/loading/error、placeholder 和辅助文案已统一使用 t()
- 2.3 现有 Workspace/Chat/recovery/composer/interaction tests 保持通过，切换不改变业务上下文与请求行为
- 3.1 chat.tsx 的 timeline、composer、run、promotion、artifact、retry/recovery/status 文案已进入 dictionary；用户内容和 POST payload 保持原值
- 3.2 tasks.tsx 使用 locale status labels、Task controls、projection/timeline 文案和 formatDateTime；API enum 与控制 payload 未改变
- 3.3 providers.tsx 的 catalog、profile 表单、sync/check/error/loading/empty、aria-label/title 已使用 dictionary；Provider/model 标识和 profile payload 保持原值
- 3.4 Agent Web 回归 13 files/34 tests 通过，locale.test.tsx 覆盖双语 dictionary、切换、storage 异常和 document lang，业务请求/状态转换测试保持通过
- 4.1 已扫描 Agent Web src，公共/Workspace/Chat/Task/Provider/Profile 用户可见文案迁移到 t()；locale.test.tsx 校验两套 dictionary key 完全一致且值非空
- 4.2 pnpm exec vitest run apps/agent-web/src 通过 13 files/34 tests；pnpm --filter @sage/agent-web typecheck 通过；pnpm --filter @sage/agent-web build 通过
- 1.1-4.3 全部 14 项 OpenSpec checkbox 已完成；T0004 README 8 项验收标准已完成

## 验证证据

- pnpm --filter @sage/agent-web typecheck 通过；pnpm exec vitest run apps/agent-web/src 通过 13 files/34 tests；pnpm exec vitest run apps/agent-web/src/locale.test.tsx 通过 5 tests；pnpm --filter @sage/agent-web build 通过
- 最终 typecheck 通过；最终 Vitest 14 files/39 tests 通过；最终 production build 通过；browser smoke：390px 语言控件可见，fr-FR 无显式选择回退 zh-CN/中文标题，en-US 自动检测得到 en/英文标题，显式 en 切换无需刷新更新文案且 html lang=en、localStorage=en，刷新后仍恢复 en，Intl zh-CN/en 日期格式不同

## 阻塞

- 无

## 下一步

- 运行 openspec archive web-interface-localization，再运行 taskctl archive T0004 门禁

## Git 快照

- `.` checkout=`.` branch=`feat-web-i18n` dirty=yes
  - ` M .service-manager.md`
  - `A  openspec/changes/web-interface-localization/.openspec.yaml`
  - `A  openspec/changes/web-interface-localization/design.md`
  - `A  openspec/changes/web-interface-localization/proposal.md`
  - `A  openspec/changes/web-interface-localization/specs/web-interface-localization/spec.md`
  - `AM openspec/changes/web-interface-localization/tasks.md`
  - ` M platform/apps/agent-web/src/chat.tsx`
  - ` M platform/apps/agent-web/src/main.tsx`
  - `M  platform/apps/agent-web/src/providers.test.tsx`
  - `MM platform/apps/agent-web/src/providers.tsx`
  - `MM platform/apps/agent-web/src/styles.css`
  - ` M platform/apps/agent-web/src/tasks.tsx`
  - ` M platform/apps/agent-web/src/workspace.tsx`
  - ` M platform/packages/provider-catalog/src/projection.test.ts`
  - ` M platform/packages/provider-catalog/src/projection.ts`
  - `AM tasks/2026-08-15/T0004-web-i18n/README.md`
  - `MM tasks/INDEX.md`
  - `?? platform/apps/agent-web/src/locale.test.tsx`
  - `?? platform/apps/agent-web/src/locale.tsx`
  - `?? tasks/2026-08-15/T0004-web-i18n/progress.md`
