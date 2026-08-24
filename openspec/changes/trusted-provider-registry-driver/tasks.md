# Tasks — trusted-provider-registry-driver

## 1. 准备

- [x] 1.1 把涉及面里角色为必须的仓切到任务分支（已切 `task/trusted-provider-registry`，含 run-agent-settings 归档基线提交）

## 2. 实施

- [x] 2.1 完成子 change `trusted-provider-registry-stage0-badge-scope`：apply 至全部 checkbox 勾选且 `openspec validate --strict --type change` 通过
- [x] 2.2 完成子 change `trusted-provider-registry-stage1-registry`：apply 至全部 checkbox 勾选且 `openspec validate --strict --type change` 通过
- [x] 2.3 完成子 change `trusted-provider-registry-stage2-chat`：apply 至全部 checkbox 勾选且 `openspec validate --strict --type change` 通过
- [ ] 2.4 完成子 change `trusted-provider-registry-stage3-secret-backend`：apply 至全部 checkbox 勾选且 `openspec validate --strict --type change` 通过

## 3. 收尾

- [ ] 3.1 全仓回归与静态检查（`pnpm typecheck` + 受影响包测试 + eslint 改动文件），命令与结果写入 proposal 验证记录
- [ ] 3.2 回填 proposal 验收标准
- [ ] 3.3 提交交付仓改动
- [ ] 3.4 归档全部子 change
