# ai-app-self-contained-runs-model-route — Design

## Context

模型路由闭环子变更；决策级依据 driver `design/app-task-run-model.md` §3.1 末条与 `design/phasing-and-migration.md` §2（E 可与 C 并行）。现状：`resolveConnectionLiveClient` 只按 run-agent-settings 的 connectionId 解析。

## Goals / Non-Goals

**Goals:** manifest modelRoute（model+fallbacks 依序）优先、设置兜底的双来源解析，准入与 worker 一致；v1/无声明零变化。**Non-Goals:** 模型路由的 fuzzy 匹配、按租户覆盖路由、Chat 链路（Chat 继续走设置 + 会话选择，不变）。

## Decisions

- **匹配语义**：注册表条目 `modelId` 与 manifest `model`/`fallbacks[i]` 精确相等且条目 enabled、凭据在场即为可用；`modelRoute.provider` 字段作为条目 provider 标识的软校验（不一致时警告日志、不阻断——注册表 modelId 已全局唯一）。
- **解析结果传递**：准入把「解析出的 connectionId（或 manifest 路由未命中标记）」写入 Spec 的 model 要求段（既有 goalRef/model 字段承载），worker 按同一函数解析——两处共享一个纯解析函数（放 `agent-run-admission` 或 `task-domain`，实现时按依赖方向定），避免双实现漂移。
- **fail-closed 不放松**：两条来源都不可用才拒绝；错误码/消息沿用 `PROVIDER_DEPENDENCY_MISSING`，消息区分「manifest 路由未命中且默认不可用」。

## Risks / Trade-offs

- [Spec 携带 connectionId 造成绑定漂移] → Spec 记录解析函数的输入（manifest 路由 + 设置引用）而非仅结果 id，重放/重试语义稳定。 [注册表条目轮换使路由漂移] → 执行边界逐 slice 重解析为既有行为，接受（与现状一致）。
