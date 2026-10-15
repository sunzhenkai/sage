# Tasks

## 1. 准备

- [x] 1.1 （可选）把涉及面里角色为必须的修改仓切到任务分支：干净则从默认分支最新代码切；dirty 则列出路径，由用户在不切直接改 / 带脏切换 / git worktree 独立工作树中三选一（sage 为唯一修改仓；当前 main 干净，不切亦可）
  - 2026-10-15 用户确认：不切分支，直接在 main 实现。
- [x] 1.2 证据与依赖前置：axe-core 就绪（agent-web devDependency 或 `ui_evidence_check --axe-path`）、`platform/evidence/agent-web-i18n/ui-manifest.json` 落地；验证：`ui_evidence_check.py --validate-only` 对该 manifest 通过

## 2. 实施

- [x] 2.1 完成子 change `agent-web-i18n-implement`：apply 至全部 checkbox 勾选且 `openspec validate agent-web-i18n-implement --strict` 通过（adopt-only 降级已确认：直接消费现有组件库 / 样式体系，不建 Active Instance）

## 3. 收尾

- [x] 3.1 全仓回归与静态检查（typecheck / build（含 check:design）/ lint / test），命令与结果写入 proposal 验证记录
  - 2026-10-15：w7 全量四门 + w8 受影响层复跑全绿，见 proposal 验证记录。
- [ ] 3.2 回填 proposal 验收标准
- [ ] 3.3 提交交付仓改动（taskrail 硬边界：须用户逐字授权后执行；未授权前保持未勾并在验证记录注明）
- [ ] 3.4 归档前置校核：子 change 全勾且 validate 通过、降级无 `pending`、findings 全有 disposition（见「收尾机械校核」）
- [ ] 3.5 归档全部子 change

## Workflow follow-up

- driver 自身归档：由 taskrail `archive` 阶段（stock `openspec-archive-change`）执行，不在此 change 内勾选。
- 探索侧任务 `tasks/ongoing/agent-web-i18n/` 的收尾按 taskrail / task-explore 流程处理。
