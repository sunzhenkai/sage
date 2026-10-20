# 术语

- **MCP API key**：外部 MCP client 访问 `/mcp` 的 Bearer key，来源 `SAGE_SERVICE_TOKEN_HASHES`；未配置即全拒。
- **内部派发 token**：agent-worker 调 `/internal/schedule-dispatch/releases/*` 的 Bearer token，来源 `SAGE_SERVICE_TOKEN`；与 MCP key 共用同一密钥。
- **web→server**：agent-web 页面发往 agent-api 的 `/v1/...` 管理请求；本任务暂不校验凭据，依靠后续用户登录/鉴权。
- **固定开发身份**：runtime 启动时构造的 `config.principal`，目前代表唯一本地用户。
