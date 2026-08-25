# browser-provider-profile-management Delta

## REMOVED Requirements

### Requirement: System runtime 与 Provider profile 分离
**Reason**: 浏览器本地 profile 体系被服务端受信 provider registry 统一取代；#6 已交付密封凭据治理，零托管路径的存在理由消失，双体系只剩认知与维护成本。
**Migration**: Providers 页不再展示 System runtime 区与外部 profile 区；工作区 provider 条目是唯一的 provider 配置对象。

### Requirement: Provider profile v2 storage 与 secret边界
**Reason**: localStorage 元数据 + sessionStorage 秘钥的浏览器存储模型随 profile 体系一并退役；服务端密封凭据（只写不读）承接全部凭据托管。
**Migration**: 存量 `sage.provider-profiles.*` 与 sessionStorage 秘钥不迁移，页面展示一次性弃用提示；需要 provider 的场景经 `POST /v1/provider-connections` 重建为工作区 provider。

### Requirement: Catalog-assisted provider/model selector
**Reason**: 该选择器服务于 profile 编辑器，随编辑器移除。
**Migration**: provider/model catalog API 保留（仍服务包 admission 解析）；如未来工作区 provider 表单需要目录辅助，作为独立变更重新提出。

### Requirement: Source-only base URL mapping 与 provenance
**Reason**: base URL 来源推导逻辑属于 profile 编辑器，随 profile 体系移除。
**Migration**: 工作区 provider 的 baseUrl 由用户显式输入并经公共 HTTPS 校验，不做目录推导。

### Requirement: Enabled intent 与 profile完成度
**Reason**: profile 完成度/可用性状态模型随 profile 体系移除。
**Migration**: 等价状态由注册表条目的 `enabled` 与凭据在场布尔承担。

### Requirement: 显式 create/edit/Cancel 状态机
**Reason**: profile 编辑器状态机随 profile 体系移除。
**Migration**: 工作区 provider 的创建/编辑沿用 `workspace-providers` 表单既有交互。

### Requirement: 安全且可回滚的 v1 到 v2 migration
**Reason**: 浏览器端 profile 版本迁移随 profile 体系移除，无后续版本需要迁移。
**Migration**: 存量 v1/v2 localStorage 数据随弃用提示一同淘汰，不做迁移。

### Requirement: Workspace payload 与 secret隔离
**Reason**: 「Chat 携带 ephemeral 内联 route、Task 永不携带 provider 数据」的双轨边界随内联形态移除而简化：所有 provider 数据只以 `{ connectionId }` 引用形态出现，任何 payload 均不含凭据。
**Migration**: Chat submit/retry 仅携带 connectionId；Task create/signal/cancel/retry payload 拒绝 provider 字段的既有约束保持不变。

### Requirement: Provider 新增弹窗的键盘与焦点管理
**Reason**: 新增弹窗属于 profile 编辑器，随 profile 体系移除。
**Migration**: 无直接替代需求；工作区 provider 表单的既有可访问性行为保持。

### Requirement: Provider 保存与目录同步提示的本地化
**Reason**: profile 保存与页面内目录同步操作随 profile UI 移除。
**Migration**: 工作区 provider 的保存/错误提示沿用 `web-interface-localization` 既有机制；目录同步不再有页面入口，相关 locale 键清理。
