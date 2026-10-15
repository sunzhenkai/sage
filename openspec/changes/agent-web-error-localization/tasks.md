# Tasks

## 1. 错误码清单与解析层

- [x] 1.1 新增 `src/lib/error-codes.ts`：精确码清单（agent-api `sendError` 全部 code + 两个 chat 内核 code）、透传族前缀清单、detail 保留码清单、`errorCodeFamily()`（最长前缀）与 `keepsErrorDetail()`；验证：`pnpm --filter @sage/agent-web typecheck` 通过
- [x] 1.2 新增 `src/lib/error-message.ts`：`errorDisplay()` 精确 → 族 → 服务端英文回退；detail 保留策略（标记 code 与服务端文案异于译文时保留）；验证：单测绿

## 2. 词典

- [x] 2.1 `locales/en.ts` + `locales/zh-CN.ts` 新增 `errors` 命名空间（59 个精确码 + 28 个族前缀；中文用词遵循术语表：供应商 / 发布包 / 定时任务 / 运行 / 租户）；验证：`locales.test.ts` 键位对齐绿 + typecheck 绿

## 3. 渲染接入

- [x] 3.1 `components/ui/misc.tsx` `ErrorState` 改用 `errorDisplay()`，detail 以次要 `Mono` 样式渲染；验证：走查 + typecheck 绿
- [x] 3.2 `pages/chat.tsx`：运行列表错误 meta、发送错误、运行错误卡片接入；验证：typecheck 绿
- [x] 3.3 `pages/settings.tsx`：`readyz` 错误接入；验证：typecheck 绿

## 4. 测试与守卫

- [x] 4.1 `src/lib/error-message.test.ts`：中文/英文精确码、detail 保留、族兜底、未登记回退、Error 实例、非 code 值透传；验证：vitest 绿
- [x] 4.2 `src/lib/error-codes.test.ts`：清单与 en / zh-CN 词典键位完全一致（无死条目）、detail 码 ⊆ 精确码、族最长前缀；验证：vitest 绿

## 5. 工程门与文档

- [x] 5.1 工程门：`pnpm --filter @sage/agent-web typecheck` / `build`（含 `check:design`）、`pnpm exec eslint apps/agent-web/src --max-warnings=0`、`pnpm vitest run apps/agent-web`；验证：全部 exit 0，结果记入验证记录
- [x] 5.2 `apps/agent-web/README.md`：Known boundaries 收窄为「未登记 code 与服务端非文案内容保持英文」；验证：与实现一致
- [x] 5.3 `tasks/ongoing/agent-web-i18n/TASK.md`：决策区追加 superseding 记录（原 Q3 / 非目标作废），指向本 change；验证：记录存在
- [x] 5.4 平台全量 `pnpm test` 回归；验证：绿（无回归）
