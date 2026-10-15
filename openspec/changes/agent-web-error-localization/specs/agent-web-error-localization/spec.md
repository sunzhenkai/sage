# Spec Delta

## Purpose

定义 agent-web 控制台对 agent-api 错误响应的本地化渲染行为：按错误码选择界面文案（精确 → 族前缀 → 英文回退）、动态 detail 的保留策略，以及清单与词典的一致性约束。本能力取代一期 `agent-web-i18n` 中「服务端错误文案保持英文」的边界。

## ADDED Requirements

### Requirement: 错误码本地化
控制台 SHALL 按错误响应的 `code` 渲染本地化文案：登记在权威清单中的 code 在中文界面显示中文句子、在英文界面显示规范英文句子；未登记的 code SHALL 回退显示服务端返回的原始 `message`，不得显示为词典键名或空字符串。

#### Scenario: 中文界面已知 code
- **WHEN** 中文界面收到 `409 PROVIDER_CONNECTION_IN_USE`
- **THEN** 错误提示显示中文句子「该供应商连接正被运行智能体设置引用，请先解除引用再删除。」，并保留错误码标识

#### Scenario: 英文界面已知 code
- **WHEN** 英文界面收到同一 code
- **THEN** 显示规范英文句子（不再使用服务端原始 `message`）

#### Scenario: 未登记 code 回退
- **WHEN** 收到清单中不存在的 code（如服务端新增）
- **THEN** 显示服务端原始 `message` 原文，界面不因缺词而破损

### Requirement: 族前缀兜底
对经透传到达前端的 code（如 `SOURCE_*`、`PACKAGE_LOCK_*`、`KERNEL_*`），控制台 SHALL 按最长匹配的族前缀渲染通用本地化句子；族匹配 SHALL 长于等长的精确码优先级更低（精确码优先）。

#### Scenario: 透传 code
- **WHEN** 中文界面收到 `SOURCE_MANIFEST_MISSING`
- **THEN** 显示该族通用中文句子「发布包源码校验未通过。」

#### Scenario: 最长前缀
- **WHEN** code 同时匹配 `SOURCE_ARCHIVE` 与 `SOURCE` 两个族
- **THEN** 采用更长的 `SOURCE_ARCHIVE` 族句子

### Requirement: 动态 detail 保留
对文案含运行时信息的错误（如参数校验失败、拒绝字段列表、定时任务 id、内核失败原因），控制台 SHALL 在本地化句子旁以次要样式保留服务端原始 detail；对文案固定的错误 SHALL NOT 重复展示与之等义的英文原文。

#### Scenario: 保留 detail
- **WHEN** 中文界面收到 `PACKAGE_PARAMS_INVALID`，服务端 `message` 为 `Unknown task 'daily'; available: weekly, monthly`
- **THEN** 显示中文句子，并同时保留该英文 detail

#### Scenario: 不重复展示
- **WHEN** 中文界面收到 `RELEASE_NOT_FOUND`（文案固定）
- **THEN** 只显示中文句子与错误码，不额外展示英文原文

### Requirement: 清单与词典一致性
控制台 SHALL 维护权威错误码清单（精确码、族前缀、detail 保留码），且 SHALL 由自动测试校验清单与 en / zh-CN 词典 `errors` 命名空间键位完全一致；新增 code 未登记时测试 SHALL 失败。

#### Scenario: 新增 code 未登记
- **WHEN** 清单新增一个 code 而字典未同步
- **THEN** 一致性测试失败，阻止发布

#### Scenario: 词典多余键
- **WHEN** 词典 `errors` 含清单之外的键
- **THEN** 一致性测试失败（无死条目）
