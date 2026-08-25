# vendor-neutral-provider-registry

## Why

平台定位是通用 agent 平台，但包运行的 provider 链路仍绑死单一供应商：`MINIMAX_API_KEY` 等 vendor 环境变量写进 worker/api 代码、`defaultProvider` 枚举含 `minimax` 字面量、设置页徽章直呼 vendor 名。同时 `auto`（静默回退 echo 的历史兼容壳）掩盖配置错误——实测当前环境徽章报「未检测到 MiniMax」且 `defaultProvider=minimax` 被 pin 住，包运行直接硬失败。受信 provider 注册表（vendor 中立、凭据密封）已建成，应成为唯一事实源，legacy env 路径只保留为通用化后的部署引导入口。

## What Changes

- **BREAKING** `defaultProvider` 取值收敛为 `echo | connection`，删除 `auto` 与 `minimax` 字面量；无设置记录时等效 `echo`（离线模式）。存量 `auto`/`minimax` 记录在读取/迁移时归一为 `echo`
- **BREAKING** agent-worker 删除 env 驱动的 live 路由（`readLiveProviderRouteFromEnv` / `MINIMAX_API_KEY` 直读）：包运行执行只认注册表 `connection` 条目或本地 echo harness；worker 进程不再需要任何 provider key
- **BREAKING** 部署 env 引导去 vendor 化：`MINIMAX_API_KEY`/`MINIMAX_BASE_URL`/`MINIMAX_MODEL` 改为中性变量（`SAGE_BOOTSTRAP_PROVIDER_API_KEY`/`SAGE_BOOTSTRAP_PROVIDER_BASE_URL`/`SAGE_BOOTSTRAP_PROVIDER_MODEL`），引导条目固定 id 与显示名去 MiniMax 化
- 运行前准入检查与 worker 执行前 fail-closed 语义保留，但判定对象只剩注册表条目（`echo` 照常准入/执行）
- Providers 页「运行 Agent」设置面改为纯注册表驱动：下拉列出注册表条目 + 离线模式，可用性徽章只反映注册表条目状态，文案不含任何 vendor 名；无可用条目时引导添加工作区 provider
- echo 在 UI 语义上改称为「离线模式（不调用模型）」，不再是与真实 provider 并列的选项

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `run-agent-settings`: `defaultProvider` 枚举收敛（删 `auto`/`minimax`）、缺省语义改为 `echo`、可用性列表不再含 legacy env 检测条目、准入检查去掉 env 分支
- `package-run-live-provider`: 受信 env 路由整段移除，live 执行只经注册表 connection 模式；worker `/readyz` provider 模式标识与启动 WARN 相应调整
- `trusted-provider-registry`: 部署 env 引导条目的 env 变量名、固定 id、显示名去 vendor 化

## Impact

- **代码**：`platform/packages/task-domain`（`RunAgentDefaultProvider` 类型、引导条目常量）、`platform/apps/agent-api`（run-agent-settings-api、provider-connections-api 引导、runs-api 准入）、`platform/apps/agent-worker`（runtime、activities）、`platform/apps/agent-web`（providers 设置面、locale 文案）
- **测试**：上述各包的既有测试（含 fail-closed、引导幂等、徽章文案断言）需同步改写
- **数据**：存量 `run_agent_settings` 中 `auto`/`minimax` 记录归一为 `echo`（当前 tenant 实测为 `minimax`）
- **运维**：`.service-manager.md` 与 `platform/examples/ai-apps/README.md` 的 env 说明更新；本地启动如需 live provider，改为注入 `SAGE_SECRET_MASTER_KEY`（必需）+ 可选引导变量，或 UI 手配工作区 provider
- **对话页**：browser-local profile 与工作区 provider 选择（`ws:<id>`）语义不变
