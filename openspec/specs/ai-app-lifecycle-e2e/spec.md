# ai-app-lifecycle-e2e Specification

## Purpose

为 AI App 的「创建 → 提交 → 运行 → 产物管理」全生命周期提供随库自带的测试应用与自动化端到端验证，使链路行为可重复断言、回归可机器发现，而不依赖人工点选或真实外部模型。
## Requirements
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

### Requirement: AI App 全生命周期端到端验证

系统 SHALL 提供一条自动化端到端验证，以真实 HTTP 入口依次走通：创建 App 主体（`POST /v1/apps`）、提交源包编译并登记 Release（`POST /v1/apps/:appId/releases`）、从 Release 发起运行（`POST /v1/releases/:releaseId/runs`）、查询运行产物（`GET /v1/tasks/:taskId/artifacts` 及详情端点），并对每一阶段的响应状态与关键字段进行断言。该验证 SHALL 仅在受信测试开关下使用确定性 fake live provider，未显式配置时不得生效，且不得要求真实外部 provider 凭据。

#### Scenario: 全链路走通

- **WHEN** 在本地开发 profile（PostgreSQL、Temporal、api、worker 就绪）且 fake live provider 开启时执行端到端验证
- **THEN** 创建 App、提交 Release、发起运行均返回成功响应，运行最终到达成功终态，且产物列表端点返回该运行发布的产物引用

#### Scenario: 产物内容可断言

- **WHEN** 端到端验证查询运行产物详情
- **THEN** 产物引用可解析出运行输出内容，且内容与测试 App 的确定性期望输出一致

#### Scenario: 阶段失败可定位

- **WHEN** 链路任一阶段（创建、提交、运行、产物查询）返回非预期响应
- **THEN** 验证以标明失败阶段与响应摘要的断言错误失败，而非无差别的超时或笼统异常

