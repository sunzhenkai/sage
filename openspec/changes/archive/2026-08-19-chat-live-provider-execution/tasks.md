# Tasks

- [x] 1. `app-contracts`：新增 `ChatProviderRoute` schema（adapterKind/baseUrl/modelId/apiKey，公共 HTTPS 约束留给 API 层校验）；`SubmitMessageRequestSchema` 与新增 `RetryRunRequestSchema` 接受可选 `provider`；补充 schema 测试
- [x] 2. `harness-pi`：新增 `LiveProviderHarness`（route + transcript 构造、pi-ai `complete` 可注入、abort/错误映射）；`LegacyPiHarness` 普通回执改为纯文本（skill metadata 场景不变）；更新/新增测试
- [x] 3. `agent-api`：submit/retry handler 解析可选 route，校验公共 HTTPS + adapterKind/modelId 非空，非法返回 400；route 存在时以 `LiveProviderHarness` 构造 per-run `LocalAgentClient`；transcript 来自 `listMessages`；新增 API 测试（route 透传、默认回退、非法 route 400、route 不落库）
- [x] 4. `agent-web/chat.tsx`：session 页头「返回对话列表」图标链接（canonical URL、双语 aria-label）
- [x] 5. `agent-web/chat.tsx`：对话区自动滚动（贴底跟踪 + 新事件/发送后滚动，上滚不打扰）
- [x] 6. `agent-web/chat.tsx`：运行时快速选择器（local + executionAvailable profiles、localStorage 持久化、缺 secret 阻止发送并提示、submit/retry 携带 route）；`locale.tsx` zh-CN/en 键；`styles.css` 样式
- [x] 7. web 测试：返回链接、选择器渲染与选择持久化、发送请求体含 route、缺 secret 阻止发送、自动滚动贴底行为
- [x] 8. `pnpm lint` + `typecheck` + 相关 vitest 全绿
- [x] 9. `openspec validate chat-live-provider-execution --strict` 通过；重建 agent-api/agent-web 容器后 Playwright 端到端验证四项修复；归档
