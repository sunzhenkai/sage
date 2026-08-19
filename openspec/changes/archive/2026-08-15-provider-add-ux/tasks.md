## 1. Contracts 与 connection-check API

- [x] 1.1 在 `@sage/app-contracts` 定义 strict Provider connection check request/response schema、adapter/status union，并补充边界测试
- [x] 1.2 在 `catalog-api.ts` 增加 authenticated `POST /v1/provider-catalog/check-connection` route、TypeBox unknown-field/HTTPS/长度校验与稳定错误映射
- [x] 1.3 实现有界 Provider model-list probe：adapter 认证 header、8 秒 timeout、`redirect:'error'`、拒绝 localhost/环回/私网目标、不读取 response body、不记录/回显 key
- [x] 1.4 补 API route/probe tests：connected、unauthorized、unavailable、timeout/redirect、匿名、未知字段、非法 URL、私网目标、敏感信息不泄露

## 2. Provider 添加 modal 与字段自动填充

- [x] 2.1 将 creating 状态渲染为 accessible dialog modal，Provider combobox 置于首个选择步骤，Cancel/Escape 丢弃 draft
- [x] 2.2 Provider 选择时自动填充 Provider name、清理旧 model/source URL 和 provenance；Model 选择继续按 snapshot-safe Catalog 映射 Base URL
- [x] 2.3 调整名称规则：名称默认 Provider name，用户编辑后 selector 不覆盖；Base URL、adapter、model、API key 仍可编辑并保持 metadata/secret 隔离
- [x] 2.4 创建保存成功后关闭 modal、列表显示新 profile；编辑保存和既有 enabled/validation 语义保持不变
- [x] 2.5 增加 modal responsive/a11y 样式，不引入新增依赖且保留移动端可滚动表单

## 3. 列表连接检测交互

- [x] 3.1 为每个已保存 profile 增加独立连接检测图标按钮和 profile-id keyed idle/checking/connected/unauthorized/unavailable 状态
- [x] 3.2 点击图标只从当前 tab 读取 secret，调用 connection-check API；无 key、loading、成功和失败均提供稳定 aria/title/短文案且不泄露敏感数据
- [x] 3.3 补 Web tests：dialog 顺序、Provider name/Base URL/model 自动填充、名称/Base URL 可编辑、Cancel/save、secret isolation、检测状态与请求 body 边界

## 4. 验证与交付记录

- [x] 4.1 运行 Provider API/Web targeted tests，修复失败并确认 Catalog selection 不自动触发 connection check
- [x] 4.2 运行 `pnpm typecheck`、受影响 package build 和必要 lint，确认 Chat/Task payload/runtime boundary 回归通过
- [x] 4.3 更新 T0003 task 验收 checkbox 与 progress checkpoint，记录具体测试/构建证据
