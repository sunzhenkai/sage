# Proposal

## Why

一期多语言（`agent-web-i18n`）把「服务端错误文案」显式列为非目标，中文界面下因此出现中英混排：`ErrorState` 只翻译了通用前缀，服务端 `error.message` 原样渲染英文（如「请求失败。Provider connection is referenced by run agent settings; clear the reference before deleting 409 PROVIDER_CONNECTION_IN_USE」）。本 change 作废该非目标，改为按错误码渲染本地化文案。

## What Changes

- 作废一期非目标「不本地化服务端 API 错误文案」（**BREAKING**：中文界面下已登记错误码不再保证显示英文原文）
- 新增 `src/lib/error-codes.ts`：权威错误码清单（agent-api `sendError` 全部 code + 透传 code 族 + detail 保留清单）
- 新增 `src/lib/error-message.ts`：`errorDisplay()` 解析层 —— 精确 code → 最长族前缀 → 服务端英文回退；detail 保留策略
- 词典新增 `errors` 命名空间（en 源 + zh-CN，键位对齐由测试守护）
- 接入点：`ErrorState`（全站通用）、对话运行/发送错误、设置页 `readyz` 错误
- 新增测试：解析层行为测试 + 清单/词典一致性守卫（未登记的 code 使测试失败）
- 文档：agent-web README「Known boundaries」收窄；`tasks/ongoing/agent-web-i18n/TASK.md` 追加 superseding 决策记录

## Capabilities

### New Capabilities
- `agent-web-error-localization`: agent-web 控制台对 agent-api 错误码的本地化渲染行为——精确码 → 族前缀 → 英文回退、动态 detail 保留、清单与词典一致性约束，以及未登记 code 的行为。

### Modified Capabilities
（无。`agent-web-i18n` 尚未归档进 `openspec/specs/`，本 change 不修改其要求文本；仅收窄文档记录的边界。）

## Impact

- `platform/apps/agent-web`：新增 `src/lib/error-codes.ts` / `src/lib/error-message.ts` + 两个测试；修改 `src/lib/locales/{en,zh-CN}.ts`、`src/components/ui/misc.tsx`、`src/pages/chat.tsx`、`src/pages/settings.tsx`、`README.md`
- 行为变更：中文界面下已登记错误码显示中文（原文改为次要 detail）；未登记 code 与服务端非文案内容（provider/model 名、catalog 值、mock、`task.reason`、连接探测 message）保持英文
- 非目标：不改 agent-api 的 `sendError` 英文文案；不做服务端 locale 协商；不翻译 mock 数据与用户数据
