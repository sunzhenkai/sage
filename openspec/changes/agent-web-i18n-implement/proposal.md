# Proposal

## Why

agent-web 控制台界面文案全量硬编码英文，没有多语言能力；中文用户（本机与局域网开发场景）需要中文界面，其他语言用户需要稳定的英文默认。同时服务端「未命名会话」搜索回退默认（zh-CN）与「默认英文」目标不一致，且前端从未传递 locale。

## What Changes

- 新增轻量自研 i18n 核心（`src/lib/i18n.ts`）：语言检测（zh* → 简体；其余 / 无匹配 → 英文默认）、`?lang=` 覆盖、`t()` 插值与订阅式当前语言、`html lang` 同步；零运行时依赖
- 新增词典 `locales/en.ts`（源，as const）与 `locales/zh-CN.ts`，键位对齐由自动测试校验；全量用户可见文案（导航 / 页头 / 按钮 / 表单 / 空态 / 错误提示 / tooltip / aria-label）迁移到词典
- 时间与相对时间格式化（含图表日期轴）随当前语言
- Settings → Appearance 新增「Language：Auto / English / 中文」，持久化于 `sage.agent-web.settings`
- 服务端：`chat-domain` `normalizeHistoryLocale` 默认由 `zh-CN` 改为 `en`（**BREAKING**：未携带 locale 的旧查询回退词变化）；agent-web 会话列表查询携带当前 locale
- 文档：agent-web README 增补 i18n 行为说明

## Capabilities

### New Capabilities
- `agent-web-i18n`: agent-web 控制台的多语言行为——自动检测与默认、手动切换与持久化、文案词典化、本地化格式化、会话 locale 传递与未命名回退。

### Modified Capabilities
（无——本仓尚无既有 specs。）

## Impact

- `platform/apps/agent-web`：`src/lib/*`（i18n / settings / utils / api）、`src/pages/*`、`src/components/*`、`index.html`；新增 `src/lib/locales/`、`src/lib/i18n.test.ts`、`platform/evidence/agent-web-i18n/ui-manifest.json`
- `platform/packages/chat-domain`：`src/history.ts` 默认值 + 测试
- 行为变更：未携带 locale 的会话搜索回退默认 en（旧 zh-CN）；UI 文案渲染随浏览器语言
- 非目标：不本地化服务端错误文案 / mock 数据；不做 URL 路由式 locale；不加第三方语言；不建 Active Instance（adopt-only 降级已确认）
