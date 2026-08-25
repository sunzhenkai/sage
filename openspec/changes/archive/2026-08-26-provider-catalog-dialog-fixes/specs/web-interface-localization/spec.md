## MODIFIED Requirements

### Requirement: Provider 相关提示文案纳入统一翻译资源

`web-interface-localization` 资源 SHALL为工作区 provider 保存/删除/失败提示、provider 必需引导、provider 添加/编辑弹窗（含 Catalog 辅助选择、不可用降级、同 provider 重复添加与目录手动刷新）、工作区默认模型相关文案以及目录刷新状态（进行中、完成重载、限流/授权/失败提示）提供 message key，且 `zh-CN` 与 `en` 的 key 集保持一致。资源 SHALL NOT 再保留存量外部配置（browser-local profile）弃用提示相关键。所有 Web 代码中呈现该类提示时 SHALL通过 `t(key, values)` 调用，不得直接拼接英文句子。

#### Scenario: 工作区 provider 保存提示
- **WHEN** 系统需要展示工作区 provider 保存成功
- **THEN** 使用 `t('workspaceProviderSaved')` 而非硬编码字符串

#### Scenario: 零 provider 引导与弃用提示
- **WHEN** Chat 无可用工作区 provider
- **THEN** 使用 `t('chatNeedsProvider')` 等既有键，zh/en 语义一致；外部配置弃用提示相关键已移除，不再被任何视图读取或渲染

#### Scenario: 弹窗与默认模型文案入资源
- **WHEN** 弹窗呈现 Catalog 加载/降级状态、重复添加同 provider 的条目，或设置面呈现默认模型选择
- **THEN** 文案均来自统一翻译资源的对应 key（zh/en 键集一致），不得硬编码

#### Scenario: 目录刷新文案入资源
- **WHEN** 弹窗呈现刷新目录按钮、同步进行中状态，或 429 限流/403 授权/请求失败提示
- **THEN** 文案均来自统一翻译资源的对应 key（zh/en 键集一致），不得硬编码

#### Scenario: 弃用提示键移除
- **WHEN** 构建或测试检查翻译资源与 Providers 页渲染
- **THEN** 不存在外部配置弃用提示相关键，Providers 页不再读取或渲染任何 browser-local profile 探测提示

#### Scenario: key 完整性检查
- **WHEN** 构建或测试检查翻译资源
- **THEN** `savedMetadata`、`catalogSyncStatus`、`catalogSyncAttempt` 在 `zh-CN` 与 `en` 中均存在且非空
