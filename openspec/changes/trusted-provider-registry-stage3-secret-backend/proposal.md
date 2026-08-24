# trusted-provider-registry-stage3-secret-backend

## Why
S1 的密封凭据依赖单一 `SAGE_SECRET_MASTER_KEY`：换主密钥即令全部存量密文不可解，且后端不可用（缺 key/长度错）只在写入时暴露，运行面（readyz/启动日志）不感知。对齐 `production-data-and-secret-governance`（Secret Manager 解析、轮换不落明文、不可用 fail-closed）与 `credential-reference-isolation`（执行边界解析）的既有治理要求，本 change 把 SecretBackend 从实现细节收严为治理契约：key 版本化与轮换、可观测、可替换。

## What Changes
- secret-vault：本地后端升级 keyring——`SAGE_SECRET_MASTER_KEY` 为 current，`SAGE_SECRET_MASTER_KEYS_PREVIOUS`（逗号分隔）为历史版本；`seal` 记录 current 版本号，`open` 按 keyVersion 选 key，未知版本/后端不可用 fail-closed
- 轮换流程产品化：配置新 current + 旧 key 入 previous → 存量密文仍可解；条目 PUT 重提交 key 即 re-seal 到新版本
- agent-api 与 agent-worker `/readyz` 携带非敏感 `secretBackend` 状态（`mode: local-aes-gcm | unavailable`，不含任何密钥材料）；不可用时启动 WARN
- 主 spec 补治理 requirement：后端可替换（生产 Secret Manager 实现同接口即可替换）、轮换不落明文、不可用 fail-closed

## Capabilities

### Modified Capabilities
- `trusted-provider-registry`: 「凭据只写不读」补 key 版本化与轮换语义；新增「SecretBackend 治理与可观测」requirement

## Impact
| 仓库 | 角色 | 说明 |
|------|------|------|
| platform/packages/secret-vault | 必须 | keyring 后端 + 单测 |
| platform/apps/agent-api | 必须 | readyz secretBackend 状态 + 启动 WARN |
| platform/apps/agent-worker | 必须 | readyz secretBackend 状态 + 启动 WARN |
| openspec/specs/trusted-provider-registry | 必须 | 治理 requirement |

## Non-goals
- 不实现真实 Secret Manager / KMS / Vault 云后端（接口已可替换，留待生产阶段）
- 不做自动轮换调度（轮换是运维动作，产品提供语义与指引）
- 不加计费维度
