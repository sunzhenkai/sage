# trusted-provider-registry-driver

## Why
把包运行与对话的模型凭据来源统一为受信 provider 注册表：API key 由预设 provider 提供，env（`MINIMAX_API_KEY`）降级为部署级引导条目。分四个 stage 推进：S0 徽章文案作用域修复、S1 注册表核心（表+凭据加密+providerRef+env 自动注册+UI）、S2 对话页接入工作区 provider、S3 SecretBackend 抽象与 fail-closed。用户决策：同 provider 多条目允许；暂不加计费报账维度。

## What Changes
- 本 change 是 taskflow driver，不直接改代码，只编排子 change
- S0 `trusted-provider-registry-stage0-badge-scope`：修复「运行 Agent」徽章文案与作用域（明确只约束 ai-app 包运行、不影响对话页外部配置）
- S1 `trusted-provider-registry-stage1-registry`：受信 provider 注册表核心——`provider_connections` 表（tenant 维度、同 provider 多条目）+ 服务端加密凭据存储 + 凭据只写不读 API + 运行 agent 设置升级 `providerRef` + env 自动注册为部署级条目 + 徽章改读注册表 + Providers 页「工作区 provider」管理面
- S2 `trusted-provider-registry-stage2-chat`：对话页新增「使用工作区 provider」运行时选项（凭据不进浏览器），与 browser-local profile 并存
- S3 `trusted-provider-registry-stage3-secret-backend`：凭据存取抽为 SecretBackend 接口（本地后端 AES-256-GCM + `SAGE_SECRET_MASTER_KEY`），fail-closed 语义对齐 `production-data-and-secret-governance`

## Non-goals
- 不做 Model Broker / Consumption Ledger 接入（用户决策：暂不加报账维度）
- 不实现真实 Secret Manager / KMS 云后端（S3 只留接口与本地后端）
- 不改变 browser-local profile 的既有语义（隐私优先，key 只进 sessionStorage）
- 不做多租户运营面（tenant 仍是现有单租户模型）

## 涉及面
| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | 已切任务分支 task/trusted-provider-registry；会修改 platform/ 下多个包与 openspec |

## 验收标准
- [ ] Providers 页不再出现「未检测到 MiniMax」与外部配置正常状态并存的割裂观感：徽章与外部配置读同一注册表，或文案明确作用域
- [ ] 同一 tenant 可创建同一 provider 的多个受信条目（如个人 key 与部署 key 并存），互不覆盖
- [ ] API key 仅通过写通道进入服务端加密存储；任何 GET/列表/日志/事件/错误响应均不回显 key 明文
- [ ] `MINIMAX_API_KEY` env 在启动时自动注册为 `deployment-env` 来源条目；`defaultProvider=minimax` 语义向后兼容
- [ ] 包运行凭据解析只在执行边界发生（reference-only），事件/checkpoint/Temporal payload 不含 key
- [ ] 对话页可选择工作区 provider 运行（key 不进浏览器），也可继续用 browser-local profile
- [ ] SecretBackend 接口落地，本地后端缺 master key 时 fail-closed 而非明文落库
- [ ] 全仓 typecheck / 相关测试全绿；全部子 change `validate --strict` 通过并归档

## Driver 协议
- 本 change 无 spec 增量（`.openspec.yaml` 已设 `skip_specs: true`）
- 子 change 一律命名 `{task}-<slice>`，与本 change 同一 planning root；跨 root 时在涉及面表显式记录 root 或 store id
- 实现进度只认子 change 自己的 `tasks.md`；本文件的 checkbox 只在对应子 change 全勾且 `validate --strict` 通过后才勾
- 涉及面里角色为 `必须` 的仓在实施前切任务分支；dirty 或 fetch 失败一律停下问用户，不自动 stash / reset / 强制切换
- 只有「checkbox 全勾」「需要用户决策」「本轮预算耗尽」三种情况允许结束一轮；单项做不了就保持未勾，在验证记录写一行原因后继续下一项
- 结束时逐条列出未勾项与原因，不按 change 汇总

## 验证记录
