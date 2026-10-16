# Tasks

## 1. 准备

- [x] 1.1 （可选）把涉及面里角色为必须的修改仓切到任务分支：干净则先 fetch 默认分支再从其最新提交 `git switch -c`；dirty 则带着用户改动切（不动改动），文件重叠才停（sage 为唯一修改仓）
  - 2026-10-16：fetch 后 main = origin/main = 14adb10（干净），按 i18n 先例直接在 main 实现，不切分支（用户全程「继续」未要求切分支）。
- [x] 1.2 依赖前置：`@modelcontextprotocol/sdk@1.29.0` 加入 `platform/apps/agent-api` dependencies 并 `pnpm install`；验证：`pnpm check:deps` 通过（app 层不受 forbiddenExternalPrefixes 约束，若命中边界规则则按 design §1 处理并记录）
  - 2026-10-16：SDK 1.29.0 + zod@^3.25 装好；`pnpm check:deps` 4 边界脚本全 OK。

## 2. 实施

- [x] 2.1 完成子 change `mcp-server-implement`：apply 至全部 checkbox 勾选且 `openspec validate mcp-server-implement --strict` 通过（含未决项处置：task `/events` 游标形态确认，缺口按 design §3 替代方案记录）
  - 2026-10-16：子 change 13 项全勾，`openspec validate mcp-server-implement --strict` 通过。未决项处置：task `/events` 为 JSON（非 SSE，无缺口）；run-logs 有 `fromSequence` 游标——无需替代方案。

## 3. 收尾

- [x] 3.1 全仓回归与静态检查（typecheck / build / lint / test），命令与结果写入 proposal 验证记录
  - 2026-10-16：typecheck 0 错 / build Done / lint 0 问题 / test 158 files·975 tests 通过 / check:deps 4 边界 OK，见 proposal 验证记录。
- [x] 3.2 回填 proposal 验收标准
- [ ] 3.3 提交交付仓改动（taskrail 硬边界：须用户逐字授权后执行；未授权前保持未勾并在验证记录注明）
- [ ] 3.4 归档前置校核：子 change 全勾且 validate 通过、findings 全有处置（见 execution-discipline「收尾校核」）
- [ ] 3.5 归档全部子 change

## Workflow follow-up

- driver 自身归档：由 taskrail `archive` 阶段（stock `openspec-archive-change`）执行，不在此 change 内勾选。
- 探索侧任务 `tasks/ongoing/mcp-server/` 的收尾按 taskrail / task-explore 流程处理。
