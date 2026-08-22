# agent-package-e2e-package-schema Tasks

## 1. 契约与加载

- [x] 1.1 在 `platform/packages/agent-package-release` 新增源包域模块：manifest TypeBox schema（id/version/description/entry/modelRoute/budgets/skillRefs/capabilityRefs，additionalProperties:false）与类型导出
- [x] 1.2 实现目录加载器：读取 `app.yaml`、扫描 `prompts/`、`references/`、`output.schema.json`，解析 YAML 后走 TypeBox 校验
- [x] 1.3 实现安全边界校验：未声明资产、路径穿越、可执行文件扩展名、疑似 Secret 拒绝，返回稳定错误码

## 2. 测试与验证

- [x] 2.1 fixtures：合法源包目录与多类非法样例（缺字段/未知字段/未声明资产/穿越/脚本）
- [x] 2.2 单测覆盖全部 fixtures 与错误码稳定性
- [x] 2.3 包级 lint/test 通过；`openspec validate --strict --type change agent-package-e2e-package-schema` 通过
