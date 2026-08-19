## 1. locale 基础设施

- [x] 1.1 在 `platform/apps/agent-web/src/` 新增仅接受 `zh-CN | en` 的 locale 类型、BCP 47 规范化函数和确定性初始化解析器，实现有效持久化选择 > 浏览器语言 > `zh-CN` 的优先级与异常隔离
- [x] 1.2 建立英文与简体中文 typed message dictionaries、命名插值入口和 message key parity/非空校验，覆盖公共 shell 与 Workspace、Chat、Task、Provider、Profile 所需产品文案
- [x] 1.3 实现应用级 locale provider/hook、`sage.web.locale` best-effort 持久化、locale-sensitive 日期时间 helper，并同步 `document.documentElement.lang`
- [x] 1.4 新增 locale 纯函数与 provider 测试，覆盖地区标签规范化、持久化优先级、无效值、语言 API/存储异常、中文回退、即时切换和文档语言同步

## 2. 公共 shell 与语言控件

- [x] 2.1 在应用 bootstrap 根部接入 locale provider，并在 `WorkspaceShell` 增加可访问且在两种语言中可自我识别的中文/English 切换控件
- [x] 2.2 将公共 shell、导航、boot error 和 Workspace/Chat landing 的静态、loading、empty、error、placeholder 与辅助文案迁移到统一翻译资源
- [x] 2.3 更新 shell、Workspace 和 Chat 组件测试，验证两种 locale、无刷新切换、业务上下文保持以及现有 Chat 交互/恢复行为不变

## 3. 业务页面本地化

- [x] 3.1 将 Chat timeline、composer、run/task promotion、artifact 与状态展示的产品文案迁移到翻译资源，同时保持用户内容和服务端数据原值
- [x] 3.2 将 Task list/detail、control、projection、状态标签和日期时间展示迁移到翻译与 locale 格式化入口，同时保持 API 枚举和操作 payload 不变
- [x] 3.3 将 Provider catalog、Profile 配置及其表单、同步、校验、loading/empty/error 状态和 accessibility 文案迁移到翻译资源，同时保持 Provider/model 标识和持久化 payload 不变
- [x] 3.4 更新 Chat、Task、Provider 与 Profile 的现有测试和新增双语断言，确认两种 locale 下请求、状态转换、表单隔离及响应式/可访问性行为等价

## 4. 完整性与交付验证

- [x] 4.1 扫描 `platform/apps/agent-web/src/` 的用户可见硬编码文案，补齐低频 loading、empty、error、`aria-label` 和 `title`，并用自动化测试确认两套 dictionary key 完全一致且无空值
- [x] 4.2 在 `platform/` 运行 Agent Web 定向 Vitest、`pnpm --filter @sage/agent-web typecheck`、`pnpm --filter @sage/agent-web build`，并复跑受影响的现有 Web 回归测试
- [x] 4.3 执行关键页面浏览器 smoke：验证检测缺失/不支持/失败时默认中文、英文浏览器自动检测、中文与 English 即时切换、刷新后恢复显式选择、日期时间与 `<html lang>` 同步
