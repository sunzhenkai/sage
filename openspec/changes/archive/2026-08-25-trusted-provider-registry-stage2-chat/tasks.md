# Tasks — trusted-provider-registry-stage2-chat

## 1. agent-api：引用形态解析

- [x] 1.1 chat 消息提交与重试入口：provider 参数双形态判别（内联 vs `connectionId`，互斥校验）；引用形态从注册表解析（enabled+凭据在场 → 解密构造路由），失败返回稳定错误 `PROVIDER_CONNECTION_UNAVAILABLE`（不启动 Run、不回退）；解析结果随 Run 携带；补单测（解析成功执行、条目缺失/停用/无凭据拒绝、互斥校验）

## 2. agent-web：运行时选择器

- [x] 2.1 Chat 页选择器新增「工作区 provider」分组：拉取 `GET /v1/provider-connections` 过滤 enabled+credentialPresent；`ws:` 前缀 runtimeId 与提交路径（引用形态，不携带 key）；选择持久化与恢复；失效回退本地 Pi + 提示；提交被拒时展示错误引导去 Providers 页；locale（中英）
- [x] 2.2 组件测试：分组渲染、恢复、失效回退、提交路径不含 key

## 3. 验证

- [x] 3.1 `pnpm typecheck` 全绿；agent-api / agent-web 测试全绿；eslint 改动文件通过；`openspec validate --strict --type change trusted-provider-registry-stage2-chat` 通过

## 验证记录（2026-08-25）

- 全仓 `pnpm typecheck` 通过；eslint（改动文件 --max-warnings=0）通过。
- 单测：app-contracts 11（含双形态 schema）、chat-provider-route 8、chat.runtime 7（含工作区引用与失效回退）、chat-recovery 修正后通过；三 app 全量套件 251 passed / 1 skipped。
- `openspec validate --strict --type change trusted-provider-registry-stage2-chat` 通过。
