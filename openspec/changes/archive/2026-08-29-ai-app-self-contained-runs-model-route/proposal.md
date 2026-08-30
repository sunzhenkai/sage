# ai-app-self-contained-runs-model-route

## Why

处理逻辑自闭环的最后一段（driver 设计 §3.1 / ADR）：manifest `modelRoute` 现状是纯声明，实际执行完全由 workspace 运行 agent 设置（run-agent-settings）决定——App 不拥有自己的执行语义，声明的 provider/model/fallbacks 从不参与解析。

## What Changes

- 解析优先级（准入与 worker 执行边界一致）：Task 所在 manifest 的 `modelRoute`（model 与 fallbacks 依序）优先在受信 provider 注册表中匹配可用条目（modelId 精确相等且启用、凭据在场）；无可用匹配时回退运行 agent 设置的默认条目；两者皆不可用 → 既有 `PROVIDER_DEPENDENCY_MISSING` fail-closed（语义与现状一致，不新增照常准入路径）。
- `modelRoute` 自始为 manifest 必填，路由匹配优先对**所有**包运行生效（v1 包同样适用——这正是「App 拥有执行语义」的落点）；未匹配回退 run-agent-settings，设置语义不变。行为等价性承诺限于输入物化与未匹配回退路径，不含路由选择本身（实施期修正：原稿「v1 仅走设置」措辞与 modelRoute 必填事实矛盾）。
- API key 治理不变：凭据只在执行边界解密，不出现在任何持久化/响应（既有 `package-run-live-provider` 约束延续）。
- `run-agent-settings` spec 定位更新：从「包运行唯一路由来源」调整为「兜底默认」；`package-run-live-provider` 的路由需求同步更新解析顺序。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities
- `run-agent-settings`: 「运行前依赖检查（准入）」与「执行前依赖检查（worker fail-closed）」需求更新为 App 声明路由优先、设置兜底的解析顺序（fail-closed 语义不变）。
- `package-run-live-provider`: 「注册表驱动的包运行 provider 路由」需求更新：路由来源优先级 manifest modelRoute > 运行 agent 设置默认。

## Impact

- `apps/agent-api`：准入依赖检查按解析顺序预检（manifest 路由可满足或默认可用）。
- `apps/agent-worker`：`resolveConnectionLiveClient` 增加按 manifest modelRoute 的注册表匹配（需要准入侧把解析结果或 manifest 路由传到 slice 输入/Spec）。
- `packages/trusted-provider-registry`：只读查询复用，不修改。
- 依赖 A（manifest 归一化形）先行。
