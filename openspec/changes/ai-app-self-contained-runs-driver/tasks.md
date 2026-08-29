# ai-app-self-contained-runs-driver — Tasks

## 1. 准备

➓ placeholder（不存在则 `git switch -c ai-app-self-contained-runs`；工作树 dirty 时按 Driver 协议处置）

## 2. 实施

- [x] 2.1 完成子 change `ai-app-self-contained-runs-manifest-v2`：apply 至全部 checkbox 勾选且 `openspec validate --strict --type change ai-app-self-contained-runs-manifest-v2` 通过（契约基座：inputs/dataSources/tasks 声明、v1 golden）
- [x] 2.2 完成子 change `ai-app-self-contained-runs-input-binding`：同上校验通过（params 解析 + dataSources 兑现 + `input` 字段 410；完成后归档被吸收的 `package-run-input-snapshots`）
- [ ] 2.3 完成子 change `ai-app-self-contained-runs-output-contract`：同上校验通过（think 剥离 + schema/files 强制 + 违约失败语义；可与 2.2/2.5 并行）
- [x] 2.4 完成子 change `ai-app-self-contained-runs-schedule-binding`：同上校验通过（修订 P8 planning artifacts：schedule 绑定 task+固化 params；前置依赖 2.1+2.2 已全勾）
- [x] 2.5 完成子 change `ai-app-self-contained-runs-model-route`：同上校验通过（modelRoute 参与执行解析；可与 2.3 并行）
- [ ] 2.6 完成子 change `ai-app-self-contained-runs-examples-ui`：同上校验通过（三示例 v2 重造 + 前端参数表单/内联产物；最后收尾）

## 3. 收尾

- [x] 3.1 全仓回归与静态检查（`pnpm lint && pnpm typecheck && pnpm check:deps` 及治理扫描），命令与结果写入 proposal 验证记录
- [ ] 3.2 本地栈端到端验收：github-trending v2 空参数一键运行产出真实数据 digest；params 变化产生独立 Run；v1 Release 行为 golden 等价
- [ ] 3.3 回填 proposal 验收标准 checkbox
- [ ] 3.4 提交交付仓改动
- [ ] 3.5 归档全部子 change（含被吸收的 `package-run-input-snapshots`）
