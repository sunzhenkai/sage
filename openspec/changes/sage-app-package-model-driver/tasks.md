# Tasks

## 1. 准备

- [x] 1.1 （可选）把涉及面中角色为必须的 `repos/github/sunzhenkai/sage` 切到任务分支：干净则从默认分支最新提交 `git switch -c`（分支已存在则 `git switch`）；dirty 则带着未提交改动切换并在 `TASK.md` 记录；与本任务文件重叠时停下说明。验证：`git -C repos/github/sunzhenkai/sage status --short --branch` 显示当前分支与干净/已知改动
- [x] 1.2 记录基线：在 `platform` 下运行 `corepack pnpm typecheck`，以及 `@sage/agent-release-registry`、`@sage/agent-package-release`、受影响的 agent-api 测试和 agent-web 构建；把既有失败写入 proposal 验证记录。验证：命令、exit code 与失败摘要已记录

## 2. 实施

- [x] 2.1 完成子 change `sage-app-package-model-domain`：apply 至全部 checkbox 勾选且 `openspec validate sage-app-package-model-domain --strict` 通过
- [x] 2.2 完成子 change `sage-app-package-model-api`：apply 至全部 checkbox 勾选且 `openspec validate sage-app-package-model-api --strict` 通过
- [x] 2.3 完成子 change `sage-app-package-model-runtime`：apply 至全部 checkbox 勾选且 `openspec validate sage-app-package-model-runtime --strict` 通过
- [x] 2.4 完成子 change `sage-app-package-model-tools`：apply 至全部 checkbox 勾选且 `openspec validate sage-app-package-model-tools --strict` 通过
- [x] 2.5 完成子 change `sage-app-package-model-web`：apply 至全部 checkbox 勾选且 `openspec validate sage-app-package-model-web --strict` 通过
- [x] 2.6 完成子 change `sage-app-package-model-docs`：apply 至全部 checkbox 勾选且 `openspec validate sage-app-package-model-docs --strict` 通过

## 3. 收尾

- [x] 3.1 全仓回归与静态检查：`corepack pnpm typecheck`、受影响包与 agent-api 测试、`corepack pnpm --filter @sage/agent-web build`、`corepack pnpm lint`；把命令与结果写入 proposal 验证记录。验证：全部 exit 0，或既有失败已单列并说明与本任务无关
- [x] 3.2 按 criterion 在本地控制台/API 逐条走查并回填 proposal 验收标准；验证：每条有命令输出、截图或观察记录
- [ ] 3.3 提交交付仓改动（taskrail 硬边界：须用户逐字授权后执行；未授权前保持未勾并在验证记录注明）。验证：`git log -1 --stat` 包含本任务改动
- [x] 3.4 归档前置校核：6 个子 change 全勾且 `validate --strict` 通过。验证：逐个 `openspec status --change <name> --json` 为 complete
- [x] 3.5 归档全部子 change。验证：`openspec list` 中不再出现六个子 change

## Workflow follow-up

- driver 自身归档由 taskrail `archive` 阶段（stock `openspec-archive-change`）执行，不在此 change 内勾选。
- 任务台账 `tasks/ongoing/sage-app-package-model/` 的收尾按 taskrail / task-explore 流程处理。
