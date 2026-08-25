## 1. 移除外置 profile 弃用提示

- [x] 1.1 删除 `platform/apps/agent-web/src/providers.tsx` 中 `LEGACY_PROFILE_KEYS`/`LEGACY_PROFILE_DISMISSED_KEY` 探测、`legacyProfiles` 状态、dismiss 处理与横幅渲染分支
- [x] 1.2 从 `locale.tsx` 移除 `legacyProfilesTitle`、`legacyProfilesNotice`、`dismissNoticeText` 键（zh-CN/en 同步），确认无残留引用

## 2. 添加/编辑弹窗与 Catalog 辅助选择

- [x] 2.1 新增 modal 基础样式（`.modal-overlay`/`.modal-card`）与可复用弹窗骨架：Escape/取消关闭、打开时聚焦首字段、关闭丢弃草稿
- [x] 2.2 将 `workspace-providers.tsx` 的内联表单迁移为创建/编辑共用的弹窗组件（字段与提交逻辑不变，仍走既有 POST/PUT），列表页只保留「+ 添加」与条目行
- [x] 2.3 在弹窗内实现 Catalog 选择器：打开时拉取 `/v1/provider-catalog/providers` 首页（limit=100，`nextCursor` 翻页/加载更多），选中 provider 后按 `provider=` + 防抖 `q` 拉取 `/v1/provider-catalog/models`
- [x] 2.4 处理快照变化：model/provider 分页收到 409 `CATALOG_CURSOR_SNAPSHOT_CHANGED` 时清空已加载页并从新快照第一页重载，不混合两代选项
- [x] 2.5 选定 provider+model 后预填表单（`baseUrl ← effectiveBaseUrl`、`modelId`、`providerName`、`modelName`、显示名建议 `{provider} · {model}`、adapter 缺省：`providerId === 'anthropic'` → anthropic 否则 openai-compatible），全部字段保持可改写
- [x] 2.6 Catalog 不可用（请求失败/503/空快照）时展示作用域化提示并降级为完整手工录入，不阻塞添加、无界重试

## 3. 同 provider 多条目

- [x] 3.1 验证弹窗允许同一 provider 重复添加（不去重、不覆盖），多次添加产生独立条目可独立编辑/删除
- [x] 3.2 条目列表与默认模型下拉以「条目名 · provider/model 元数据」呈现，确保同 provider 条目可区分

## 4. 工作区默认模型

- [x] 4.1 Providers 页设置面：下拉 label 改为「默认模型」，选项展示 `{条目名} · {modelName ?? modelId}`（GET/PUT 契约不变）
- [x] 4.2 `chat.tsx` 运行时选择初始化：无 browser-local 选择时取 `/v1/run-agent/settings` 的默认条目为可见初始选中；显式选择优先；默认条目失效按既有规则阻止发送并引导；settings 请求失败静默保持 ''（不阻塞会话）

## 5. 文案与测试

- [x] 5.1 `locale.tsx` 新增弹窗/目录辅助/降级/默认模型相关键（zh-CN/en 键集一致），所有新文案经 `t(key, values)` 呈现
- [x] 5.2 更新/新增 `providers.test.tsx`、`workspace-providers` 相关测试：弃用横幅移除、弹窗创建/编辑、Catalog 预填与 409 重载、不可用降级、同 provider 重复添加、默认模型选择与保存
- [x] 5.3 更新 chat 侧测试：默认模型初始化、显式选择优先、失效阻止发送
- [x] 5.4 运行 agent-web 全量测试 + typecheck/build，人工冒烟 Providers 页弹窗全流程与 Chat 默认模型路径
