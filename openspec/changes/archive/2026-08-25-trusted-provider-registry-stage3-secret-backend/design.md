# Design — trusted-provider-registry-stage3-secret-backend

## Context
S1 的 `LocalAesGcmSecretBackend` 单密钥、不可观测。生产 spec（`production-data-and-secret-governance`）要求 Secret Manager 解析、轮换控制与不可用 fail-closed。

## Goals / Non-Goals
- Goals：keyring 版本化与轮换语义、readyz 可观测、接口可替换性写入契约
- Non-Goals：云后端实现、自动轮换调度

## Decisions

### D1. keyring：current + previous，版本号即列表位置
`SAGE_SECRET_MASTER_KEY`（current，version = previous 长度）+ `SAGE_SECRET_MASTER_KEYS_PREVIOUS`（逗号分隔 base64，时间升序）。seal 恒用 current 并记录 version；open 按 version 取键。轮换 = 新 key 入 current、旧 key 追加 previous。版本号用「previous 列表长度」语义实现简单且单调，无需额外存储。

### D2. re-seal 途径复用既有写通道
不新增 rotate 端点：条目 PUT 重提交 apiKey 即 re-seal。逐步迁移可选、非必需（previous 中的旧 key 保留即可用）。

### D3. 可观测挂在 readyz，不新增端点
agent-api 已有 /readyz（或等价 health）；worker `/readyz` 已携带 providerMode，追加 `secretBackend.mode`。`unavailable` 不改变 ready 判定（可用性优先：无凭据依赖的运行不受影响），仅 WARN + 状态暴露——与 S1 D5 的部署可用性优先一致。

### D4. 契约演进而非重写
S1 的 SecretBackend 接口（seal/open/describe）不变，仅本地后端内部升级 keyring；调用方零改动（除 readyz 装配）。

## Risks / Trade-offs
- previous 列表过长：运维纪律约束（保留 1–2 代），spec 不强制上限。
- version 语义与列表位置耦合：接受（本地后端内部细节，密文中显式存 version，Secret Manager 后端可自定版本方案）。

## Migration Plan
1. secret-vault keyring 升级 + 单测（轮换、未知版本、current 缺失）
2. api/worker readyz + 启动 WARN + 测试
3. spec 同步与回归

## Open Questions
无。
