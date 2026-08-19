## Context

P2 为 Chat 和 Task 提供共用的 Tool、状态、Artifact、Credential 与观测语义。执行事实不能因应用入口不同而改变，Secret 也不能进入 prompt、持久状态或观测载荷。

## Goals / Non-Goals

**Goals:** 建立 fail-closed Tool pipeline、Agent State/Checkpoint port、Artifact/Credential 引用、可重试副作用边界和统一 correlation。

**Non-Goals:** 不默认提供 Shell/浏览器/不可信代码执行；不保存 Secret 值；不把 Tool 业务实现写入 Workflow。

## Decisions

- Tool 必经 `validate → authorize → execute → normalize → event` 管线。未配置 Authorize 时仅 allowlist 低风险只读 Tool；Policy 或 Secret 不可用即拒绝。
- Agent State 使用 PostgreSQL Adapter；大结果以 `artifact_ref` 替代 Event/Checkpoint 内联；CredentialProvider 只返回最小作用域的短生命周期值给执行边界，业务数据仅保留 ref。
- 写 Tool 以 caller 提供的幂等键和已知提交点去重；无法判断远端副作用时返回 `effect_unknown`，不假设安全重试。
- Pino/OTel 使用 run/task/workflow/target/attempt/tool-call correlation，并在日志、trace、metric 属性写入前执行敏感数据过滤。

## Risks / Trade-offs

- [过严默认策略阻碍 demo] → 只用显式低风险 allowlist 放行，不降低默认安全性。
- [Artifact 后端瞬断] → 返回稳定可观测错误并保留引用，不内联降级。
- [未知副作用影响用户体验] → 呈现 `effect_unknown` 并要求人工或业务幂等修复。

## Migration Plan

先定义 ports 和 fakes，再实现 PostgreSQL/目标 Adapter contract tests；随后将 Library Tool 调用接入统一管线。发现 Secret 泄漏立即阻断发布、清除受影响数据、轮换密钥并扩展过滤测试。

## Open Questions

真实 Secret Manager、Artifact Store、OIDC tenant scope、Tool policy Owner 和敏感字段分类在 P0 决策中关闭。