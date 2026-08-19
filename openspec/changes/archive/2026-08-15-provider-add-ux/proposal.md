## Why

当前 Providers 页面已有 browser-local profile metadata、Provider/Model Catalog 选择和 tab-only API key，但新增 profile 仍以普通编辑面板呈现，用户缺少清晰的“选择 Provider → 自动填充 → 修改 → 保存”路径，也没有直接可见的连接检测反馈。现在补齐这条流程，可以提升可用性，同时保持 Local Pi runtime 不被 external profile 驱动、secret 不进入 metadata 的既有边界。

## What Changes

- 将 Add provider 入口改为具备 dialog 语义的新增 modal，先引导选择 Provider，再展示自动填充的名称、模型候选和 Base URL。
- Provider 选择后使用当前 Catalog snapshot 填充 provider/model metadata 与来源 URL；名称默认使用 Provider 名称，但名称和 Base URL 保持可编辑。
- 保留当前 tab-only API key 输入和 metadata/secret 隔离；保存成功后关闭新增 modal 并展示 profile。
- 为已保存 profile 增加连接检测图标，支持 loading、success、failure 状态和稳定脱敏错误。
- 增加 API-side provider connection check route：只接受显式 profile metadata、Base URL、model 和本次请求 key，执行有界、不可重定向的轻量检测，不持久化请求内容或 secret。
- 保持 Chat/Task payload、Local PiHarness assembly、Provider Catalog sync 和 profile localStorage schema 的既有边界不变。

## Capabilities

### New Capabilities

无。连接检测属于现有 Provider profile 管理能力的新增操作，不单独引入执行 runtime。

### Modified Capabilities

- `browser-provider-profile-management`：新增 modal 添加流程、自动填充/编辑语义、保存后的连接检测入口与安全状态反馈。
- `provider-model-catalog`：新增受控的 Provider 连接检测 API；Catalog read/sync 语义保持不变。

## Impact

- Web：`platform/apps/agent-web/src/providers.tsx`、相关测试和样式；新增 dialog、连接检测图标及状态反馈。
- API/contracts：`platform/apps/agent-api/src/catalog-api.ts`、`platform/packages/app-contracts` 的检测请求/响应白名单与对应测试。
- Provider catalog：复用已存在的认证和 runtime route 注册边界，不写入 profile、API key 或 Catalog snapshot。
- 验证：Provider Web/API 定向测试、typecheck 和 Web/build；不要求停止或修改用户已有 host 服务。
