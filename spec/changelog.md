# 镜像同步

## 2026-08-29 — `bd9cdc8` 基线补记

- 模式：concise
- 范围：全仓(跳过 `node_modules/`、`openspec/`、`tasks/archive/` 中的旧产物)
- 变更：首轮 init + build 写出金字塔骨架;随后补交 archify 架构/时序/数据流/状态机图与索引。`.mirror.json` 当时把 synced_commit 记成了 main @ `8f56bf8`,但正文实际反映到 `bd9cdc8`;本轮起以 `bd9cdc8` 为真实增量基点。

## 2026-08-29 — `9c26a54`

- 模式：concise
- 分支：`ai-app-self-contained-runs`(默认分支 main @ `8f56bf8` 无新提交;本轮按用户工作分支同步,合并回 main 后无需重跑)
- 范围：`bd9cdc8..9c26a54` 增量(199 个文件,其中代码/文档 131 个;openspec 台账仅归档引用)
- 变更：
  - **模块页(9 个)**：apps(schedules/resolutions/service-token/package-snapshots、worker dispatcher 与 output-contract、web schedules/example-apps)、task-domain(新包 `temporal-schedules` 归入,007 迁移、run_contract)、contracts-and-policy(failure-taxonomy、pilot-gate、app-contracts schedules/resolutions wire、platform-ports Schedule canonical)、release-and-admission(manifest v2、`admitScheduleTrigger`、`sample-app.smoke.test.ts` → `finance-briefing.smoke.test.ts` rename)、state-persistence(009 迁移、schedule-store、schedule 预算)、agent-lib-runtime(snapshot-egress)、observability-and-local(触发指标、InMemory schedule store)、examples-and-evidence(p8 soak/boundary 脚本、soak evidence、示例替换,根表展开为可路由前缀)、design-and-changes(docs/adr、docs/design/ai-app)。
  - **恢复投影**：surface(/v1/schedules、/v1/effects/resolutions、INPUT_REMOVED 410、service token 五链路)、surface/config(6 个新键)、data(009 四表 + RLS + append-only、007 run_contract、按包迁移目录)、runtime(dispatcher worker、控制面直连、重试预算护栏、告警生成)、build(p8 测试命令、check-p8-boundaries 并入 check:deps)、context(service token、快照白名单、无人值守 actor)。
  - **切面**：structure(schedules/resolutions 路由与 wire 契约、dispatcher workflow/task queue)、behavior(8 条 P8 行为契约)、side-effects(5 条新副作用)、decisions(ADR + P8 D1–D10 与运行门)、runtime(`sage_schedule_trigger_total`、调度面回滚)、verify(p8 套件与测试映射)、traffic(schedule 发布/回滚 + P8 runbook)、source(p8 证据)。
  - **知识层**：新概念 App Manifest v2 / Schedule Plane / Pilot Gate;新实体 Schedule 记录;新处理线 schedule-triggered-run、unattended-failure-resolution;EffectLedger 实体补裁决语义;三个 INDEX 与 overview 同步。
  - **图**：archify 新增 `schedule-trigger-run-sequence.html`(showcase,validate 9/9 通过;visual-check 因环境无 Chrome 记 skipped)。
