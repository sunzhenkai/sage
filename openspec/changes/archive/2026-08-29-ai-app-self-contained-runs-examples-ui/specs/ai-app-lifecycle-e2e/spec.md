# ai-app-lifecycle-e2e

## MODIFIED Requirements

### Requirement: 测试 AI App 源包随库提供

代码库 SHALL 在 `platform/examples/ai-apps/` 下提供一个专用于生命周期验证的测试 AI App 源包（lifecycle-probe），其目录即包结构 SHALL 符合源包 manifest 契约（含 v2 声明：合法 `id`/`version`/`entry`，`entry` 指向包内 `prompts/*.md`，可声明 `tasks`/`inputs`），且其运行 SHALL 是自闭环的：SHALL NOT 依赖运行时用户输入或外部数据源，输出 SHALL 是确定性的、可精确断言的（不依赖外部网络与当前时间等不稳定因素；模型调用经受信注册表，确定性断言在注入确定性 provider 条目的集成环境执行）。

#### Scenario: 测试 App 通过编译校验

- **WHEN** 对测试 AI App 源包执行源包编译（`compileSourcePackage`）
- **THEN** 编译成功并产出不可变 Release，且无清单契约校验错误

#### Scenario: 测试 App 自闭环运行

- **WHEN** 以空 params 对测试 App 发起运行（无用户输入、无数据源声明）
- **THEN** 准入照常、组装输入仅含 entry prompt（及声明默认参数段），不因缺少人工输入产生空跑

#### Scenario: 测试 App 输出确定性

- **WHEN** 在受信注册表注入确定性 provider 条目的集成环境下多次运行该测试 App
- **THEN** 各次运行的输出内容一致，且与测试断言中硬编码的期望内容完全匹配
