# agent-package-e2e-run-path Tasks

## 1. 存储与 admission

- [ ] 1.1 postgres-migrations 新增 `task_package_input` 表 migration；task-store-postgres 增加写入/读取接口
- [ ] 1.2 agent-run-admission 扩展：Release → Spec 字段映射（goalRef/modelRoute/skillRefs/bounds）+ 幂等键（tenant+releaseId+input digest），复用 create-only putSpec 与 envelope 签发
- [ ] 1.3 输入拼装器：entry prompt + references 清单 + 用户输入 + asset_digests

## 2. 端点与 worker

- [ ] 2.1 agent-api 新增 `POST /v1/releases/{releaseId}/runs`：resolve → admission → 物化写入 → controller.create 启 workflow；production 模式 501 fail closed
- [ ] 2.2 agent-worker 新增 PackageTaskInputResolver 并接入 resolver 链（chat 路径不动）
- [ ] 2.3 错误码与 preValidation 对齐既有风格

## 3. 测试与验证

- [ ] 3.1 单测：admission 映射与幂等、拼装器、resolver（含缺行错误）
- [ ] 3.2 e2e 集成测试：登记示例 fixtures 包 → 发起运行 → workflow succeeded → projection/artifact 可查
- [ ] 3.3 lint/test 通过；`openspec validate --strict --type change agent-package-e2e-run-path` 通过
