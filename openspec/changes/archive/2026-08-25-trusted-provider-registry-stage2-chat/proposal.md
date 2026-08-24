# trusted-provider-registry-stage2-chat

## Why
对话页目前只能用 browser-local profile（key 存浏览器 sessionStorage、每次请求下发）作为真实模型运行时；工作区 provider（S1 注册表，凭据服务端密封存储）无法用于对话。产品上两条通道应并存各有定位：browser-local=隐私优先随身 key；工作区 provider=key 不进浏览器、跨设备可用、与包运行同一凭据源。本 change 让对话页可选择工作区 provider 运行。

## What Changes
- Chat 消息提交/重试的 provider 参数新增引用形态 `{ connectionId }`：服务端从注册表解析条目并解密凭据构造该次 Run 的 provider 路由；明文 key 不出现在请求、响应、事件或浏览器
- 引用解析失败（条目缺失/停用/凭据缺失/SecretBackend 不可用）以稳定错误拒绝该次 Run，不回退本地运行时、不影响会话其余状态
- Chat 运行时快速选择器新增「工作区 provider」分组：列出 enabled 且凭据在场的条目；选择持久化与恢复语义与既有 profile 一致
- browser-local profile 路径完全不变

## Capabilities

### Modified Capabilities
- `persistent-short-chat`: Provider-routed Chat 执行接受 provider route 的引用形态（connectionId），服务端解析、失败稳定拒绝
- `chat-user-interface`: 运行时快速选择器新增工作区 provider 分组（key 不进浏览器，无 per-tab secret 要求）

## Impact
| 仓库 | 角色 | 说明 |
|------|------|------|
| platform/apps/agent-api | 必须 | chat 消息/重试的 provider 参数引用解析 |
| platform/apps/agent-web | 必须 | 运行时选择器分组 + 提交路径 + locale |
| platform/packages/chat-domain | 参考 | 请求契约若涉及需同步（以实际代码为准） |

## Non-goals
- 不改 browser-local profile 的存储与下发语义
- 不为对话页做注册表管理入口（Providers 页已有，S1）
- 不做对话侧计费/配额
