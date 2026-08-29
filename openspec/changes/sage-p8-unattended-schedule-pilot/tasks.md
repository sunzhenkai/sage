# 任务：AI App 无人值守定时运行 Pilot

## 1. 契约与存储基座

- [x] 1.1 `platform-ports` 新增 canonical Schedule 契约（`ScheduleDefinition`、`ScheduleOccurrence`、`ScheduleTriggerEvent`、`SchedulePort`、错误码），`local-fakes` 提供确定性 fake adapter；单测覆盖契约校验
- [x] 1.2 `app-contracts` 新增 `/v1/schedules`（创建/列表/详情/暂停/恢复/删除/触发历史）与 `/v1/effects/resolutions` 的 HTTP schema 与客户端；单测
- [x] 1.3 `postgres-migrations` 新增 `schedules`、`schedule_trigger_events`、`effect_resolutions`（append-only）表与索引，向前兼容；迁移测试
- [x] 1.4 `agent-state-postgres` Consumption Ledger 扩展 schedule 账户：聚合上限 + 可选窗口、reserve 前检查、与 invocation 结算同事务累加；单测 + 集成测试覆盖"余额不足拒止/跨 run 聚合/窗口滚动"（spec: consumption-ledger delta）

## 2. Schedule Plane 核心

- [ ] 2.1 新建 `temporal-schedules` 包：`SchedulePort` adapter（create/pause/resume/delete/list），overlap 策略映射 SKIP/ALLOW_ALL/BUFFER_ONE，spec 声明式触发规则映射；单测（真实 Temporal 垂直链路可选 gate）
- [ ] 2.2 `ScheduleTriggerDispatcher.v1` 确定性 workflow：仅 activity 调用 admission，workflow ID = `schedule:{scheduleId}:occ:{occurrenceId}` 幂等；replay 测试证明无 I/O、有界重试后稳定 failed trigger
- [ ] 2.3 admission 集成：schedule trigger 来源身份、FIXED/FOLLOW Release 解析（FIXED 创建时固化 digest、FOLLOW 每次 admission 解析 active + rollout policy）、schedule 账户预检、依赖不可用 fail closed 记 failed trigger；单测 + 集成测试（spec: ai-app-schedule-plane 触发/绑定 requirement）
- [ ] 2.4 状态对账 activity：按触发规则推算期望 occurrence 与已记录事件差集 → missed/skipped 事件与指标；边界（暂停窗口不补偿、设施不可用恢复后）测试
- [ ] 2.5 schedule conformance：fake adapter 与 temporal adapter 过同一 conformance 用例（触发/overlap/misfire/pause-resume/幂等）；`check-p8-boundaries` 脚本：canonical 契约与公共 schema 无 Temporal Schedule 类型，dispatcher workflow 无 I/O

## 3. Schedule API / UI / 观测

- [ ] 3.1 `agent-api` schedules 路由：CRUD + pause/resume + 触发历史，认证、租户隔离、不可变审计；API 集成测试（含越权拒绝）
- [ ] 3.2 `agent-web` Schedule 管理 UI：列表、详情（状态/next fire/绑定 release/预算账户）、触发历史、暂停/恢复；组件测试
- [ ] 3.3 观测埋点：succeeded/failed/skipped/missed trigger 指标，schedule → occurrence → task → spec digest 关联字段，高基数 ID 不进 metrics label；单测

## 4. 无人值守失败自治

- [ ] 4.1 `POST /v1/effects/resolutions`：裁决提交（结论 + 动作）、append-only 审计、重复冲突拒绝、未裁决前 action key 保持阻断；API 集成测试（spec: unattended-run-autonomy 裁决 requirement）
- [ ] 4.2 裁决执行链路："未提交 + 继续"经 admission 生成新 Spec/attempt（携带原 effect 与裁决引用）新建 coordinator run；"已提交 + 继续"依赖 Effect Ledger replay 幂等不重复副作用；真实 Postgres/Temporal 集成测试
- [ ] 4.3 `production-governance` failure-taxonomy：稳定错误码 → 告警规则/runbook/响应路由映射表，Prometheus 规则与 Grafana 注解生成，未知错误码兜底告警；单测
- [ ] 4.4 自动重试预算护栏：delivery/semantic retry 前读取 task 级与 schedule 级权威余额，不足/ledger 不可用停止重试并告警；单测 + 集成测试

## 5. Pilot 链路认证

- [ ] 5.1 service token 验证（`Authorization: Bearer`、哈希存储、常量时间比较、多 key 轮换）接入 packages/apps/runs/schedules/resolutions 五条链路；stub 信任头在这五条链路停止提权；单测 + API 测试（spec: unattended-schedule-pilot-gate 认证 requirement）
- [ ] 5.2 `scripts/register-package.ts` 与本地开发文档改为 dev token；`compose.yaml`/env 注入路径更新

## 6. Soak 与端到端验证

- [ ] 6.1 soak runner（`platform/scripts/p8/`）：`soak.config.json`（窗口/频次/触发下限/成功率阈值/故障注入清单：provider 失效、worker 重启、投影延迟、预算耗尽、pause/resume），时钟源注入支持压缩时钟，机器证据输出 `platform/evidence/p8/`；runner 单测
- [ ] 6.2 `test:p8:exercises` 接线：压缩时钟等效窗口含故障注入的自动化验证，输出各验收维度证据 JSON；本地可重复执行
- [ ] 6.3 `ai-app-lifecycle-e2e` schedule 路径用例：注册 → Release → 创建 schedule → 触发 → admission → durable run → 投影/触发历史/预算账户一致；FIXED 不漂移与失败触发 fail closed 断言（spec: ai-app-lifecycle-e2e delta）

## 7. 运行门与文档

- [ ] 7.1 风险显式接受台账（单点 PostgreSQL、调度设施单副本等）：记录/检查机制，UNFILLED 阻断 GO；单测
- [ ] 7.2 告警路由检查：每条无人值守告警须有响应主体与 runbook，占位 roster 记 UNFILLED；单测
- [ ] 7.3 soak 证据 schema 与门校验：窗口起止、触发数、成功率、零静默重复、故障处置结论；短窗/缺证据不得通过
- [ ] 7.4 pilot go/no-go 接线：门决议引用 soak 证据、风险台账、认证与告警检查，任一 UNFILLED 输出 NO-GO；证据可追溯；单测
- [ ] 7.5 文档：`platform/docs/p8-*.md`（决策、告警/裁决 runbook、soak 执行说明）、README 状态更新
- [ ] 7.6 【人类输入，不可伪造】真实 14 天 soak 证据与 oncall roster：保持 UNFILLED 并阻断 GO，直到真实环境执行与人员提供（P7 诚实证据纪律）

## 8. 收尾验证

- [ ] 8.1 `corepack pnpm check` 全绿（ESLint、依赖/P4–P8 边界、严格 TS、单测、构建）
- [ ] 8.2 既有集成/垂直链路回归（P4/P5/P6/P7 套件与 `test:p7:exercises` 不回归）
- [ ] 8.3 `openspec validate sage-p8-unattended-schedule-pilot --strict` 通过
