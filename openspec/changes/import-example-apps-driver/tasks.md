# Tasks

## 1. 准备

- [x] 1.1 （可选）把涉及面里角色为必须的修改仓切到任务分支：已切到 `feat/import-example-apps`；仓库当前有用户未提交的 `platform/compose.yaml`，与本任务文件不重叠，按协议带着改动 `git switch -c`；切换后 `git status --short` 仍显示该改动且文件内容不变
- [x] 1.2 子 change `import-example-apps-import-flow` 建好且 artifacts 通过 `openspec validate import-example-apps-import-flow --strict`

## 2. 实施

- [x] 2.1 完成子 change `import-example-apps-import-flow`：apply 至全部 checkbox 勾选且 `openspec validate import-example-apps-import-flow --strict` 通过

## 3. 收尾

- [x] 3.1 全仓回归与静态检查（agent-web typecheck、build、lib 测试；agent-api apps 测试），命令与结果写入 proposal 验证记录
- [x] 3.2 回填 proposal 验收标准
- [ ] 3.3 提交交付仓改动（未获用户逐字授权，保持未勾）（须用户逐字授权后执行；未授权前保持未勾并在验证记录注明）
- [x] 3.4 归档前置校核：子 change 全勾且 validate 通过、findings 全有处置
- [x] 3.5 归档全部子 change

## Workflow follow-up

- driver 自身归档由 taskrail `archive` 阶段执行。
