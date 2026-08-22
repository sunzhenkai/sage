## ADDED Requirements

### Requirement: 源包目录规范与 manifest 契约
系统 SHALL 定义 ai app 源包的目录规范与 manifest 契约：根目录必含 `app.yaml`（package id、version、description、entry prompt 引用、模型路由要求、budgets、skillRefs、capabilityRefs），可选包含 `prompts/*.md`、`references/*.md`、`output.schema.json`；manifest 校验 SHALL 拒绝未知字段与缺失必填字段，目录校验 SHALL 拒绝未声明资产与路径穿越。源包 SHALL NOT 包含可执行脚本、动态 include 或 Secret。

#### Scenario: 合法源包通过校验
- **WHEN** 校验器加载一个由 `app.yaml` 与若干 prompts/references/output schema 组成的源包目录
- **THEN** 校验通过并返回结构化的包描述（资产相对路径、digest、manifest 内容）

#### Scenario: manifest 违反契约
- **WHEN** manifest 缺少必填字段、包含未知字段，或字段值越界（如 budgets 为负、entry prompt 不存在）
- **THEN** 校验器返回稳定的结构化错误并列出违规路径，不产生部分结果

#### Scenario: 目录包含未声明或危险资产
- **WHEN** 目录中出现 manifest 未声明的文件、跨出包根的路径引用、可执行脚本或疑似 Secret
- **THEN** 校验器拒绝该源包并返回稳定错误码，不读取资产内容进结果
