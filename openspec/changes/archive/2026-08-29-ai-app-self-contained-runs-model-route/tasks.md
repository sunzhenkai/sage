# ai-app-self-contained-runs-model-route — Tasks

## 1. 解析函数与接线

- [x] 1.1 共享纯解析函数：`(manifestRoute, registryEntries, settingsDefault) → connectionId | undefined`（model/fallbacks 依序精确匹配 + 兜底），单测覆盖优先级矩阵
- [x] 1.2 准入依赖检查接入（预检两条来源，错误消息区分来源）；Spec model 段记录解析输入
- [x] 1.3 worker `resolveConnectionLiveClient` 接入同一函数；v1/无声明路径零改动

## 2. 测试与验证

- [x] 2.1 准入/worker 测试：manifest 命中优先、无命中回退默认、双缺失 409/失败、v1 golden 等价、key 不泄露断言
- [x] 2.2 本地栈端到端：声明 modelRoute 的示例 Task 按声明条目执行；无声明 Task 行为不变
- [x] 2.3 根 `pnpm typecheck && pnpm lint` 与治理扫描通过
