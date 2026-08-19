## ADDED Requirements

### Requirement: Provider 相关提示文案纳入统一翻译资源

`web-interface-localization` 资源 SHALL为 Provider 保存成功提示与 Catalog 同步状态提示提供 message key，且 `zh-CN` 与 `en` 的 key 集保持一致。所有 Web 代码中呈现该类提示时 SHALL通过 `t(key, values)` 调用，不得直接拼接英文句子。

#### Scenario: 新增 savedMetadata 翻译键
- **WHEN** 系统需要展示 profile 保存成功
- **THEN** 使用 `t('savedMetadata', { name })` 而非硬编码字符串

#### Scenario: 新增 catalogSyncStatus / catalogSyncAttempt 翻译键
- **WHEN** 系统需要展示 catalog sync 结果
- **THEN** 使用 `t('catalogSyncStatus', { status })` 与 `t('catalogSyncAttempt', { attemptId })` 组合，支持中文与英文

#### Scenario: key 完整性检查
- **WHEN** 构建或测试检查翻译资源
- **THEN** `savedMetadata`、`catalogSyncStatus`、`catalogSyncAttempt` 在 `zh-CN` 与 `en` 中均存在且非空
