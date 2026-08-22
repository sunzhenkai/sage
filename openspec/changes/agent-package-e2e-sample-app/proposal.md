## Why
端到端走通需要一个真实的示例 ai app 包：既作为源规范的参照实现，也作为 registry/run-path/web 三个切片的联调对象。没有它，全链路验收无法落地。

## What Changes
- 新增示例包目录 `platform/examples/ai-apps/<theme>/`：`app.yaml` + `prompts/system.md` + `references/*.md` + `output.schema.json`，主题选取通用运维分析类（不涉及任何公司/内部信息）
- 提供编译产物与 smoke 说明（编译 → 登记 → 发起运行的完整命令序列）

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无 — 本 change 无 spec 增量，`.openspec.yaml` 已设 `skip_specs: true`）

## Non-goals
- 不含任何可执行脚本/工具（对齐源规范安全边界）
- 不做多语言/多主题示例

## 涉及面
| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | platform/examples/ai-apps/、文档 |

## 验收标准
- [ ] 示例包通过 package-schema 校验并可编译为合法 Release
- [ ] README 提供从编译到运行的完整命令序列
- [ ] 内容不含公司/内部系统信息

## 验证记录
