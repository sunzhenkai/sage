# agent-package-e2e-sample-app Tasks

## 1. 示例包内容

- [x] 1.1 创建 `platform/examples/ai-apps/<theme>/`：`app.yaml`（id/version/entry/model 要求/budgets）、`prompts/system.md`、`references/*.md`（≥2 篇通用领域资料）、`output.schema.json`
- [x] 1.2 确认内容不含公司/内部系统信息，通过 package-schema 校验器与编译器

## 2. 联调与文档

- [x] 2.1 编译产物落 examples 目录（或生成说明），smoke 走通「编译 → 登记 → 发起运行」
- [x] 2.2 README 记录完整命令序列与预期输出
- [x] 2.3 `openspec validate --strict --type change agent-package-e2e-sample-app` 通过
