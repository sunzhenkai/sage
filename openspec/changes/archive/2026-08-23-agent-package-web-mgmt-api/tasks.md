# agent-package-web-mgmt-api Tasks

## 1. 实现

- [x] 1.1 在 agent-api 新增 `apps-api.ts`：定义 App 请求/响应 TypeBox schema 与 `registerAppsRoutes`
- [x] 1.2 `POST /v1/apps`：字段校验（appId 格式/name/description 上界）、冲突→409、创建主体
- [x] 1.3 `GET /v1/apps`：active App 列表，join 最新 release 版本/时间/releaseCount
- [x] 1.4 `GET /v1/apps/{appId}`：App 详情（元信息 + manifest 摘要 + 资产预览 + release 历史），deleted→404
- [x] 1.5 `DELETE /v1/apps/{appId}`：幂等软删
- [x] 1.6 `POST /v1/apps/{appId}/releases`：前置 App 存在/active 校验、manifest.id 一致性校验，复用编译+登记链
- [x] 1.7 复用 authenticator（x-authentication-id / authenticateRequest），未认证→401；preValidation 拒绝未知字段
- [x] 1.8 在 index.ts 导出并在 runtime.ts 挂载新路由
- [x] 1.9 单测覆盖各端点与错误路径（9 用例：新建/冲突/非法 id/上传版本化/不存在/manifest 不一致/软删/未知字段/未认证）
- [x] 1.10 静态检查与回归：agent-api typecheck、build、eslint、`check-dependencies` 通过；packages-api/runs-api 测试无回归（20/20）
