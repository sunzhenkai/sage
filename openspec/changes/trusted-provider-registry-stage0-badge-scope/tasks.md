# Tasks — trusted-provider-registry-stage0-badge-scope

## 1. 文案与展示

- [ ] 1.1 locale（中英）更新 `minimaxDetected`/`minimaxNotDetected` 与「运行 Agent」副标题：作用域限定为 ai-app 包运行受信环境，附「对话页外部配置不受影响」说明
- [ ] 1.2 `providers.tsx` 徽章结构保持不变，确认 aria/title 与新文案一致；同步更新 `providers.test.tsx` 断言

## 2. 验证

- [ ] 2.1 agent-web 测试全绿；`openspec validate --strict --type change trusted-provider-registry-stage0-badge-scope` 通过
