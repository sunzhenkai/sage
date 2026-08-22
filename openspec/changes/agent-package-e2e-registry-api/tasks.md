# agent-package-e2e-registry-api Tasks

## 1. 端点实现

- [ ] 1.1 agent-api 新增 packages 路由模块：POST `/v1/packages/{packageId}/releases`（接收源包 tar/JSON 结构，调编译器与 registry 登记，幂等处理）、GET `/v1/packages`、GET `/v1/packages/{packageId}`
- [ ] 1.2 请求/响应契约（TypeBox）与 preValidation 未知字段拒绝，对齐既有 task-api 风格
- [ ] 1.3 registry 存储接线：package 维度索引（packageId → releases）与详情查询接口

## 2. 登记脚本与测试

- [ ] 2.1 提供 `scripts/register-package.ts`（或等价入口）：本地目录 → 编译 → 调 agent-api 登记
- [ ] 2.2 集成测试：登记/幂等/非法拒绝/列表/详情
- [ ] 2.3 lint/test 通过；`openspec validate --strict --type change agent-package-e2e-registry-api` 通过
