# vendor-neutral-provider-registry — 设计

## Context

见 proposal.md - Why。现状要点（实测于 2026-08-25）：`defaultProvider` 枚举为 `auto|minimax|echo|connection`；worker 启动时经 `readLiveProviderRouteFromEnv()` 直读 `MINIMAX_API_KEY` 构造进程级 live client；agent-api 的 `minimaxAvailableFromEnv()` 以 env 非空判定徽章状态——两侧各读各的 env，存在状态分叉。注册表 connection 路径（stage1 已建成）功能完备：`resolveConnectionLiveClient` 在执行边界解析条目并解密凭据，fail-closed 语义齐备。当前环境从未成功引导过 deployment-env 条目（无 key 且无 master key），注册表为空，设置记录为 `defaultProvider=minimax`。

## Goals / Non-Goals

**Goals:**
- 包运行 live 执行只走注册表 connection 模式；worker 进程完全不认识 provider key
- `defaultProvider` 收敛为 `echo | connection`，legacy 取值安全归一
- env 引导通用化，作为自动化部署的凭据投递入口保留
- 设置面 UI 去 vendor 化，可用性只反映注册表

**Non-Goals:**
- 不改对话页：browser-local profile 与 `ws:<connectionId>` 选择语义不变
- 不改 SecretBackend 接口与 keyring 机制（`SAGE_SECRET_MASTER_KEY` 注入属运维约定，只更新文档）
- 不扩展 live client 的 adapter 支持面（既有支持范围之外的新 adapter 另立 change）
- 不做生产多租户运营面

## Decisions

### D1: legacy 取值读取时归一，不做 SQL 迁移

存量 `auto`/`minimax` 在 `getRunAgentSettings` 读取路径归一为 `echo`（`providerConnectionId` 丢弃），不写回。

- 理由：设置每 tenant 单行、每 slice 现读，读取归一即可保证 api 准入与 worker 执行看到同一值；幂等、无迁移顺序风险（dev 环境 tsx watch 重启场景下 migration 已是踩坑点）。
- 备选：SQL migration 一次性改写——更"干净"但多一个迁移文件，且归一逻辑仍要留在代码里防旧备份恢复；不值。

### D2: worker 整体删除 env 路由，而非保留为兜底

删除 `readLiveProviderRouteFromEnv`、`packageAgentClient` 的 env 装配、`providerStatusOf` 及 `/readyz` 的 `provider` 字段与启动 WARN；worker 仅保留 `liveClientFactory` + `secretBackend` + `providerConnections`，`decidePackageRunClientChoice` 输入收敛为 `echo | connection`。

- 理由：只要 worker 还读 env，api（徽章）与 worker（执行）的分叉就在；且 worker env 持有明文 key 与"凭据只留注册表密封"的治理方向相悖。
- 代价：live 执行必须 `SAGE_SECRET_MASTER_KEY` 可用（解密凭据）。本地 dev 需把 master key 纳入启动约定（文档更新，属运维动作）。
- 备选：worker 保留 env 兜底仅当注册表为空——重新引入分叉与 vendor 变量，否决。

### D3: env 引导变量通用化，baseUrl/model 必填

`SAGE_BOOTSTRAP_PROVIDER_API_KEY`（非空才触发）+ 必填 `SAGE_BOOTSTRAP_PROVIDER_BASE_URL`/`SAGE_BOOTSTRAP_PROVIDER_MODEL`，可选 `SAGE_BOOTSTRAP_PROVIDER_NAME`/`SAGE_BOOTSTRAP_PROVIDER_ADAPTER`（缺省 `anthropic`）。引导条目固定 id 由 `deployment-env-minimax` 改为 `deployment-env-default`。`MINIMAX_*` 一律不再识别（不做别名兼容）。

- 理由：通用平台不应内置任何 vendor 缺省端点；必填缺失时跳过 + WARN，比静默兜底到某个 vendor 端点更诚实。别名兼容会把 vendor 名继续留在代码里，与目标相悖。
- baseUrl 复用注册表既有公共 HTTPS 校验（拒绝内网/localhost）。
- 既有环境从未成功引导（无 key 无 master key），id 变更无存量条目迁移问题；若某环境存在旧 id 条目，它受保护、无害残留，不处理。

### D4: 可用性列表与徽章纯注册表驱动

`providerStatuses` 删除 legacy `minimax` env 条目，只列注册表条目；`minimaxAvailableFromEnv` 删除。UI 设置面：下拉 = 离线模式（`echo`）+ 各注册表条目（`connection:<id>`）；徽章文案去 vendor 名，无可用条目时引导「添加工作区 provider」。

- 理由：spec 已要求；同时消除「徽章绿但执行不可用」分叉（徽章与执行读同一注册表 + 同一 enabled/credentialPresent 判定）。

### D5: echo 保留值名、改 UI 语义为「离线模式」

枚举值仍叫 `echo`（避免存储与 API 的额外迁移面），仅 UI 文案表述为「离线模式（不调用模型）」。

- 备选：连枚举值一起改名 `offline`——纯粹的额外迁移与兼容成本，无行为收益，否决。

## Risks / Trade-offs

- [master key 未纳入启动约定时，connection 模式全部 fail-closed，live 能力归零] → 本 change 同步更新 `.service-manager.md` 与示例文档，把 `SAGE_SECRET_MASTER_KEY` 列为本地启用 live 的必需注入；fail-closed 本身即是既有治理语义
- [读取归一掩盖了存量记录与新枚举的差异，设置面看不到"被归一"这件事] → 归一仅发生在读取；用户下次保存即落新值，可接受
- [引导条目 id 变更后，按旧 id 引用 `providerConnectionId` 的设置会指向不存在条目] → 实测当前无该条目、无该引用；准入/fail-closed 会以 `PROVIDER_DEPENDENCY_MISSING` 显式报错，不静默
- [env 引导必填 baseUrl/model 抬高了自动化部署的配置门槛] → 有意为之：显式优于 vendor 默认；部署模板在文档中给出完整样例

## Migration Plan

1. 代码变更与测试更新（见 tasks.md），不涉及 DB schema 变更
2. 部署/重启：worker 与 api 不再需要 `MINIMAX_*`；需 live 时注入 `SAGE_SECRET_MASTER_KEY`，并可选注入 `SAGE_BOOTSTRAP_PROVIDER_*` 完整组
3. 回滚：revert 代码即可；legacy 记录在旧代码下仍按原语义可读（`minimax`/`auto` 字符串未被改写），无不可逆数据操作
