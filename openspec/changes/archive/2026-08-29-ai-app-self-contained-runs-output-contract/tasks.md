# ai-app-self-contained-runs-output-contract — Tasks

## 1. 处理管线

- [x] 1.1 think 剥离工具（状态机实现 + 嵌套/未闭合/多段用例矩阵）与 JSON 围栏解包
- [x] 1.2 `activities.ts` 物化前接入管线：声明 schema 的 Task 剥离→解包→校验，违约映射 `PACKAGE_OUTPUT_CONTRACT_VIOLATION`（可重试）
- [x] 1.3 `output.files` 登记进产物名清单；未声明 Task 路径零改动

## 2. 测试与验证

- [x] 2.1 worker 单测：剥离矩阵、解包、schema 违约（缺字段/类型）、files 登记、未声明豁免 golden
- [x] 2.2 本地栈端到端：声明 schema 的示例 Task 输出合规成功 / 构造违约输出任务失败且无 task-output（2026-08-29 补验于 driver：github-trending trending-digest 真实快照+真实模型 succeeded、schema 校验通过、task-output/report.md 双产物；/tmp 违约探针（schema 声明 array 而提示词要求对象输出）稳定 PACKAGE_OUTPUT_CONTRACT_VIOLATION 且 artifacts 为空。证据见 driver proposal 验证记录）
- [x] 2.3 根 `pnpm typecheck && pnpm lint` 与治理扫描通过
