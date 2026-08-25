# trusted-provider-registry-stage0-badge-scope

## Why
「工作区设置 → 服务商」页中，「运行 Agent」卡的 MiniMax 可用性徽章（「未检测到 MiniMax — 当前进程环境缺少 MINIMAX_API_KEY」）与「外部配置」卡的正常状态并排出现，形成割裂观感。根因：两条凭据通道（包运行=受信服务端 env；对话=浏览器本地 profile 按次下发）互不相通，徽章文案未限定其只约束 ai-app 包运行。本 change 是 S1 注册表落地前的过渡文案修复，先消除误导。

## What Changes
- agent-web 徽章文案（中英 locale）明确作用域：受检对象是 ai-app 包运行的服务端受信环境，不影响对话页外部配置
- 「运行 Agent」卡副标题补充一句「对话页外部配置不受此影响」
- providers 组件测试断言同步更新

## Capabilities

### Modified Capabilities
- `run-agent-settings`: 新增「可用性状态展示的作用域限定」requirement——设置面展示 provider 可用性时 MUST 显式标识其作用域（包运行受信环境），MUST NOT 表述为对对话页外部配置的判定

## Impact
| 仓库 | 角色 | 说明 |
|------|------|------|
| platform/apps/agent-web | 必须 | locale 文案 + 徽章展示 + 测试 |

## Non-goals
- 不改可用性判定逻辑（仍是受信 env 非空检测；S1 才改为读注册表）
- 不合并两条凭据通道（S1/S2 范围）
