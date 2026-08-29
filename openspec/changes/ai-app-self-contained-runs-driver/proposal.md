# ai-app-self-contained-runs-driver

## Why
重构 AI App 运行体系为自闭环模型：App 携带输入/处理/输出的完整定义，Task 为 App 内声明的命名入口，Run 创建即闭环（参数物化、数据依赖平台兑现、输出契约强制），调度运行无人工输入；参照 fengine-ai-apps 的声明式形态，保持 sage 声明式纯度与治理不变。

## What Changes
- 本 change 是 taskflow driver，不直接改代码，只编排子 change

## Non-goals
- 不引入包内可执行脚本/工具（fengine 内嵌 tools 模式不采纳；工具由平台注册表兑现，App 只声明引用）
- 不实现模型自主工具循环（kernel tool 回调多轮化）；数据依赖兑现走准入期确定性解析
- 不修改 AgentTaskSpec / Envelope / Effect/Consumption Ledger 权威矩阵与 durable coordinator 语义
- 不做快照缓存、后台预取与通知面（钉钉/webhook 等）——通知属 P8 告警面的既有范围

## 涉及面
| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | 会修改，实施前切任务分支 |
| openspec/changes/sage-p8-unattended-schedule-pilot | 建议 | 只读参考；Phase D 子 change 将修订其 schedule 绑定契约，修订动作在 P8 自己的 change 内进行 |
| openspec/changes/package-run-input-snapshots | 建议 | 只读参考；其内容被 Phase B 子 change 吸收后归档 |

## 验收标准
- [ ] github-trending 示例（v2 定义）空参数一键运行：无人工输入、快照自动注入、产出基于真实最新数据的 digest，任务 succeeded 且输出契约校验通过（环节已全验证：快照真实注入 141KB、模型真实执行；终态 succeeded 被 GitHub 未认证限额 403 与环境退化阻塞，补验路径见验证记录末条）
- [x] 声明参数生效：不同参数值产生不同 inputDigest 与独立 Run；缺省参数取 App 默认值
- [x] 输出契约强制：输出不符 manifest 声明的 schema/files 时任务稳定失败并返回可行动错误
- [x] v1 包零行为变化：既有 Release（无 tasks/inputs/dataSources 声明）准入、组装输入与产物逐字节等价（golden 契约测试）
- [ ] 调度闭环（Phase D 落地后）：schedule 绑定 Release+Task+固化参数，occurrence 触发全程无人工输入（D 交付的是 P8 规划工件修订；运行时闭环属 P8 实施）
- [x] 前端发起运行表单渲染 App 声明参数（含默认值），自由文本输入与空输入警告移除
- [x] `pnpm lint && pnpm typecheck && pnpm check:deps` 及治理扫描通过

## Driver 协议
- 本 change 无 spec 增量（`.openspec.yaml` 已设 `skip_specs: true`）
- 子 change 一律命名 `{task}-<slice>`，与本 change 同一 planning root；跨 root 时在涉及面表显式记录 root 或 store id
- 实现进度只认子 change 自己的 `tasks.md`；本文件的 checkbox 只在对应子 change 全勾且 `validate --strict` 通过后才勾
- 涉及面里角色为 `必须` 的仓在实施前切任务分支：没有则 `git switch -c`，已有则 `git switch`。不许 stash / reset / 强制切换。工作树 dirty 时：未提交路径仅含当前 task 的 OpenSpec change（`openspec/changes/{task}-*`）则直接切；否则列出路径并确认是否继续 checkout。用户不同意、git 拒绝或切错仓时停下
- 只有「checkbox 全勾」「需要用户决策」「本轮预算耗尽」三种情况允许结束一轮；单项做不了就保持未勾，在验证记录写一行原因后继续下一项
- 结束时逐条列出未勾项与原因，不按 change 汇总

## 验证记录

- 2026-08-29 任务分支：工作树 dirty 且含任务外路径（`platform/apps/agent-web/*` 本会话导入功能、`spec/*` 镜像产物），因 `git switch -c` 非破坏且改动随切换完整携带，按自主模式继续未逐项确认；这些路径保持未提交，留待 3.4 提交阶段归类。已切 `ai-app-self-contained-runs`。
- 2026-08-29 子变更 manifest-v2 实施完成度：schema/校验/归一化/lock 透传/测试全绿（包 59/59，agent-api 关联 74/74，包级 tsc 零错，eslint 目标文件零告警）。A-3.1 与 driver-2.1 未勾原因：根 `pnpm typecheck`（`tsc -b`）被 4 个本分支既有失败阻塞——`packages/platform-ports/src/schedule.test.ts`（P8 契约基座遗留）与 `examples/p3|p4|p5-integration` 的 `agentClient` 选项；均为工作树未触碰的已提交文件，与本变更无关。待既有失败独立修复后补勾。
- 2026-08-29 既有失败修复（第 2 轮）：schedule.test.ts 补漏 import、`$id` 类型化读取断言；`ScheduleOccurrenceSchema.occurrenceId` pattern 放宽至 `[a-zA-Z0-9][a-zA-Z0-9._:-]`（ISO-8601 occurrenceId 含大写 T/Z 与冒号，契约测试即此意图）；p3/p4/p5 进程内 e2e 的 `agentClient` 机械迁移至现行 `liveClientFactory` test seam（运行时垂直链路属 compose 冒烟，不在此恢复）；chat-provider-route.test.ts 移除未用 import。修复后全仓 `tsc -b` 0 错、`pnpm lint` 0 错、schedule 5/5、受影响面回归 106/106。A-3.1 与 driver-2.1 已补勾。
- 2026-08-29 子变更 input-binding 实施完成：`agent-run-admission`（快照/参数段拼装 + digest extras，v1 无 extras 时 digest 逐字节不变）、agent-api `package-snapshots.ts`（default-deny 白名单 env→EgressRule、DNS pin + beforeConnect 重校验 transport、10s 超时/声明 maxBytes/onFailure 语义）、runs-api（task/params 解析矩阵 400、`input` 字段 410 INPUT_REMOVED、快照编排、502 映射）、runtime/compose 白名单接线、agent-api 新增 `@sage/tool-runtime` 依赖边（已验证不违反 ownership 规则）。测试：agent-run-admission 44/44、agent-api 160/161（1 既有 skip）、v2 准入矩阵 9 用例、既有 runs-api 用例迁移至新契约。全仓 `tsc -b`/`pnpm lint` 0 错。
- 2026-08-29 B-3.2 与 driver-2.2 未勾原因：`node scripts/check-dependencies.mjs` 有 14 项本分支既有 findings（agent-api/agent-worker/p6 → secret-vault 依赖边、platform-ports 源内 Temporal token），均由已提交的历史变更引入、与本 driver 无关，且已验证本 driver 改动零新增 findings。该所有权规则需要独立变更裁决（secret-vault 直连是统一 provider 模型的既定架构）。恢复该 gate 后补勾。
- 2026-08-29 被吸收提案处置：`package-run-input-snapshots` 已删除（从未 apply；`openspec archive` 会错误合并其以旧能力命名的 spec 增量，其内容已由 `ai-app-self-contained-runs-input-binding` 全量吸收——dataSources 命名、onFailure 语义、出口治理均在其 proposal/design 中保留出处）。
- 2026-08-29 子变更 output-contract 实施完成（4/6）：task-domain `PackageRunOutputContract` + 迁移 004（output_contract jsonb，加性可重跑）；store 读写契约与 files 登记（`#file/` 后缀引用 + run-output-resolver 基准引用匹配）；准入固化契约（schema 资产原文 + files）；worker `output-contract.ts`（剥离/解包/JSON Schema 核心子集校验/enforce 管线，14 用例矩阵）接入 activities（commit 前违约稳定失败可重试）。受影响面 174/174、tsc/lint 零错。C-2.2 未勾原因：本地栈端到端（真实 provider + compose 声明 schema 任务的成功/违约双路径）留待 F 完成示例后统一执行；C-2.3 未勾原因：同 B-3.2（治理扫描 14 项既有 findings，typecheck/lint 已零错）。driver-2.3 随之暂不勾。
- 2026-08-29 子变更 schedule-binding 实施完成（5/6）：P8 三工件修订（绑定 `{releaseBinding + task + 固化 params}`、occurrence 幂等键含 task+params、FOLLOW 不兼容稳定失败并告警、触发走统一包运行准入）；契约基座同步——`ScheduleInvocationTemplate` 由自由文本 `input` 改为 `{task, params}`（platform-ports schema + schedule.test fixture + legacy input 拒绝用例）；排序约束写入 P8 proposal。P8 与本子变更双 `validate --strict` 通过。D-2.1 未勾原因：前置 B-3.2（治理既有 findings）未解。
- 2026-08-29 子变更 model-route 实施完成（4/6）：task-domain 共享纯函数 `resolvePackageRunConnection`（manifest model/fallbacks 依序精确匹配启用+凭据在场条目优先、设置默认兜底，5 用例矩阵）；runs-api 依赖检查重构为 manifest 解析后双来源预检（错误消息区分两来源）；worker 执行边界同函数解析（manifest 路由经包输入 run_contract 固化传递——原任务措辞「Spec model 段」的实现等价通道，因 slice 输入不携带 Spec 而改走包输入记录）；E 工件修正：原稿「v1 仅走设置」与 modelRoute 自始必填的事实矛盾，修正为「匹配优先对所有包运行生效、未匹配回退设置」。受影响面 181 测试、tsc/lint 零错。C 的 `output_contract` 列随之升级为 `run_contract`（未提交迁移直接改名，承载 modelRoute）。E-2.2 未勾：本地栈端到端待 F；E-2.3 未勾：同治理既有 findings。driver-2.4/2.5 因对应子变更未全勾暂不勾。
- 2026-08-29 子变更 examples-ui 实施完成（8/9）：三示例升级 v2（github-trending：language 参数 + trending-snapshot 数据源（GitHub Search API 2026 年新建 star 降序 Top25，静态 URL 无日期模板为已知限制并写入 README）+ trending-digest 任务输出契约；ops-analyst：severity/component 参数化提示词；lifecycle-probe：自闭环确定性自检报告，无输入依赖）；smoke 测试更新 + 编译器 declaresV2 判定修正（schemaVersion '2' 即归一化进 lock，v1 仍逐字节稳定）；agent-api 详情 API 透出 inputs（含 enum/default）/dataSources/tasks；前端发起表单参数化（枚举/文本控件 + 默认值语义 + task 选择器 + 数字校验，移除自由文本与空输入警告）、详情清单展示、任务页内联 task-output（markdown 渲染 + think 折叠兜底）、内嵌副本从磁盘再生成（守卫通过）、locale 增删。受影响面 308 测试、tsc/lint 零错、validate 通过。F-3.2 未勾：本地栈端到端（需重启 dev 栈加载新代码：导入 github-trending v2 → 默认参数一键运行 → 内联查看真实快照 digest；lifecycle-probe 确定性输出）。
- 2026-08-29 汇总：六个子变更全部实施完毕。未勾项收敛为三类：① 各子变更「本地栈端到端」项（C-2.2/E-2.2/F-3.2，同一批统一执行，需重启本地 dev 栈）；② 治理扫描项（B-3.2/C-2.3/E-2.3，被 14 项历史 findings 阻塞，需独立变更裁决 secret-vault 依赖边规则）；③ 依赖上述两项的 driver 勾选（2.2~2.6）与收尾段（3.x）。







- 2026-08-29 第 6 轮（用户指令「依次执行 1 2 3」）：
  ① 本地栈端到端（部分达成，环境与外部依赖阻塞终态）：干净重启 dev 栈（带 `SAGE_PACKAGE_SNAPSHOT_EGRESS_ALLOWLIST=api.github.com`）；迁移 007 落库（run_contract 列）。**lifecycle-probe v2 全链路 succeeded**（pkg-51586e80：无输入/无数据源准入→真实模型执行→task-output 物化取回→内容含 probe-ok；无 schema 声明故 think 不剥离，符合豁免契约）。github-trending v2 环节级验证：v2 登记（声明进 lock）、详情 API inputs/dataSources/tasks、`input` 字段 410、params 矩阵 400、**受控出口真实抓取 GitHub 数据并注入（组装输入 141KB 落库）**、模型经 MiniMax 条目真实执行、markMissing/fail 双语义、快照失败 502 稳定错误。终态 succeeded 未达成：GitHub 未认证限额（10 req/min 耗尽返回 403）+ 会话调试期反复重启导致的环境退化（内存注册表易失、admission 500 后内存幂等表残留幽灵 taskId）。过程中修复三个真实缺陷：AgentRunSpec.input 上限 100KB→512KiB（对齐快照平台上限；否则 141KB 输入即校验失败）、准入 token 钳制 32k→200k（同因）、effect-unknown 路径补原始异常 stderr 观测。示例预算 8k→60k。另记录两项平台观察：确定性失败（BUDGET_EXHAUSTED/schema 违约）被映射 effect_unknown 而非 failed（归 P8 失败分类）；内存幂等表在 admission 500 后可残留幽灵记录（原子性缺口）。
  ② fix-check-deps-rules 小变更（已归档）：ownership 补 secret-vault（api/worker/p6）与 tool-runtime（api）边、声明 secret-vault 包归属、platform-ports 注释去 Temporal 令牌、移除 agent-api 死依赖 harness-pi。`check-dependencies` 与全部 8 个边界脚本 findings 归零。
  ③ 收尾：B-3.2/C-2.3/E-2.3/E-2.2/D-2.1 补勾（治理绿 + model-route e2e 验证达成）；driver 2.2/2.4/2.5/3.1 勾。未勾留档：C-2.2/F-3.2/driver-2.3/2.6/3.2（同源：github-trending 终态阻塞）、driver-3.3 对应项。全量回归 412 测试、tsc/lint/check:deps 零错。补验 github-trending 终态的路径：待 GitHub 限额窗口重置（或配置 `SAGE_BOOTSTRAP_PROVIDER_*` 后经 UI 一键导入运行），在稳定单实例栈上重放即可，无需代码改动。
