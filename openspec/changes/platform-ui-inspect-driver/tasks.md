## 1. 准备
- [x] 1.1 把涉及面里角色为必须的仓（`.`，仓库根）切到任务分支 `task/platform-ui-inspect`

## 2. 实施
- [x] 2.1 完成子 change `platform-ui-inspect-check`：apply 至全部 checkbox 勾选且 validate --strict 通过
- [x] 2.2 向用户呈报检查清单（P0–Pn），取得对优雅重构范围的确认（需要用户决策）
- [x] 2.3 完成子 change `platform-ui-inspect-refine`：同上

## 3. 收尾
- [x] 3.1 全仓回归与静态检查（`corepack pnpm exec tsc -b --pretty false`、`pnpm --filter @sage/agent-web typecheck`、platform 根 `pnpm test`），命令与结果写入 proposal 验证记录
- [x] 3.2 回填 proposal 验收标准
- [ ] 3.3 提交交付仓改动
- [ ] 3.4 归档全部子 change（`platform-ui-inspect-check`、`platform-ui-inspect-refine`）
