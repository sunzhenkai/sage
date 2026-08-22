## Why
补齐 AgentPackage/Release 缺口，创建示例 ai app (agent package)，走通全流程，包括前端展示和管理

## What Changes
- 本 change 是 taskflow driver，不直接改代码，只编排子 change

## Non-goals
- 不实现生产级供应链（真实签名/SBOM 审计/OIDC），provenance 字段保留但允许本地 build 占位值
- 不引入包内原生代码执行（遵循终版架构：工具走 Capability/受信供应链，示例包不含自由脚本）
- 不接线 DURABLE_COORDINATOR_V2，运行仍走 LEGACY_TEMPORAL_TASK 路径
- 不迁移既有 chat 输入与 /v1/tasks 旧行为，新流程以增量入口提供

## 涉及面
| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | 会修改，实施前切任务分支 |

## 验收标准
- [ ] AgentPackage 源目录规范（manifest+prompts+references+output schema 等）有 schema 校验的契约定义
- [ ] 编译链落地：源目录 → 校验 → content digest → 不可变 AgentPackageRelease
- [ ] Release Registry 可登记、查询 Release，API 暴露包列表/详情
- [ ] 提交入口能基于 Release + 输入生成 canonical AgentTaskSpec/AgentExecutionEnvelope 并启动执行
- [ ] 示例 ai app package 按目录规范创建，可编译为 Release
- [ ] 端到端走通：注册示例包 → 从包发起运行 → Temporal 执行 → artifact 落地可查
- [ ] agent-web 前端可浏览包、查看详情、发起运行、查看运行状态与 artifact
- [ ] 全仓回归与静态检查通过

## Driver 协议
- 本 change 无 spec 增量（`.openspec.yaml` 已设 `skip_specs: true`）
- 子 change 一律命名 `{task}-<slice>`，与本 change 同一 planning root；跨 root 时在涉及面表显式记录 root 或 store id
- 实现进度只认子 change 自己的 `tasks.md`；本文件的 checkbox 只在对应子 change 全勾且 `validate --strict` 通过后才勾
- 涉及面里角色为 `必须` 的仓在实施前切任务分支；dirty 或 fetch 失败一律停下问用户，不自动 stash / reset / 强制切换
- 只有「checkbox 全勾」「需要用户决策」「本轮预算耗尽」三种情况允许结束一轮；单项做不了就保持未勾，在验证记录写一行原因后继续下一项
- 结束时逐条列出未勾项与原因，不按 change 汇总

## 验证记录
