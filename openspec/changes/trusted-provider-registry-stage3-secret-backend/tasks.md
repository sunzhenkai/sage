# Tasks — trusted-provider-registry-stage3-secret-backend

## 1. secret-vault keyring

- [ ] 1.1 本地后端升级 keyring：`SAGE_SECRET_MASTER_KEY`（current）+ `SAGE_SECRET_MASTER_KEYS_PREVIOUS`（逗号分隔）；seal 记录 current 版本、open 按 version 选 key；未知版本/current 缺失/长度错均稳定 fail-closed；`describe()` 返回非敏感模式标识；单测（轮换后旧密文可解、re-seal 前后版本变化、未知版本失败、无 previous 时行为与 S1 一致）

## 2. 可观测

- [ ] 2.1 agent-api 与 agent-worker `/readyz`（或等价 health 面）携带 `secretBackend.mode`（`local-aes-gcm` | `unavailable`，不含密钥材料/指纹）；后端不可用时启动 WARN；不改变既有 ready 判定；补测试

## 3. 验证

- [ ] 3.1 `pnpm typecheck` 全绿；secret-vault / agent-api / agent-worker 测试全绿；eslint 改动文件通过；`openspec validate --strict --type change trusted-provider-registry-stage3-secret-backend` 通过
