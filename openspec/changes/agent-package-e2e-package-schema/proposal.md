## Why
终版架构要求 AgentPackage 是声明式交付源，但仓库内没有任何源包格式：作者无法用「目录 + manifest」描述一个 ai app，后续编译/登记/运行都无从谈起。本切片定义源包目录规范与 manifest 契约，是整条链路的第一环。

## What Changes
- 在 `platform/packages/agent-package-release` 新增源包域（source manifest TypeBox 契约 + 目录加载/校验器）
- 定义源目录规范：`app.yaml` manifest + `prompts/` + `references/` + 可选 `output.schema.json`
- 提供合法/非法 fixtures 与单测（含安全边界：拒绝未声明资产、路径穿越、可执行脚本）

## Capabilities

### New Capabilities

（无）

### Modified Capabilities
- `agent-package-release` — ADDED「源包目录规范与 manifest 契约」requirement（现有 requirements 只覆盖编译后的 Release，不覆盖源格式）

## Non-goals
- 不实现编译/lock/digest（下一切片）
- 不引入模板引擎或包内脚本能力

## 涉及面
| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | platform/packages/agent-package-release、openspec specs |

## 验收标准
- [ ] manifest 契约（TypeBox）覆盖 id/version/entry prompt/model 要求/budgets/skillRefs/capabilityRefs，additionalProperties 收紧
- [ ] 目录校验器：合法 fixtures 通过；缺 manifest、未知字段、未声明资产、路径穿越、可执行文件均稳定拒绝
- [ ] 单测与静态检查通过

## 验证记录
