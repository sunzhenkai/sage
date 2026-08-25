## ADDED Requirements

### Requirement: 条目管理弹窗与同 provider 重复添加
工作区 provider 条目的创建与编辑 SHALL 以 modal dialog 承载：条目列表页 SHALL NOT 展开内联创建/编辑表单。弹窗提交 SHALL 复用既有条目 API（`POST /v1/provider-connections`、`PUT /v1/provider-connections/:id`）与服务端校验边界（公共 HTTPS baseUrl、字段白名单、凭据只写），任何预填或缺省 SHALL NOT 放宽服务端校验。UI SHALL 允许同一 provider 重复添加：不因已存在同 provider 条目而阻止、去重或覆盖，多次添加各自产生独立条目（独立 `id`、独立凭据、可独立编辑与删除）；条目列表 SHALL 以条目显示名结合 provider/model 元数据区分同 provider 的多个条目。

#### Scenario: 重复添加同一 provider
- **WHEN** 已认证主体在弹窗中为同一 provider 先后添加两个条目（不同 key 或不同 model）
- **THEN** 两个条目独立并存于列表，各自可被编辑、删除与选为默认，互不影响

#### Scenario: 弹窗内校验失败呈现
- **WHEN** 弹窗提交被服务端拒绝（非法 baseUrl、缺必填字段或未知字段）
- **THEN** 弹窗保持打开并呈现稳定错误信息，已填内容不丢失，条目不产生

#### Scenario: 编辑既有条目也在弹窗
- **WHEN** 用户从条目列表发起编辑
- **THEN** 编辑表单在 modal dialog 中打开并预填既有元数据（不含任何凭据值），保存走既有 PUT 契约
