# agent-package-web-mgmt-web Tasks

## 1. 实现

- [x] 1.1 packages.tsx 数据源切到 apps 端点（`GET/POST /v1/apps`、`GET/DELETE /v1/apps/:id`、`POST /v1/apps/:id/releases`），类型扩展 App 元信息（name/description）
- [x] 1.2 列表页：新增「新建 App」入口与表单（appId/name/description，必填与格式校验，空态引导新建）
- [x] 1.3 详情页：新增「上传/更新版本」表单（JSON files → POST apps/:id/releases，成功后刷新）
- [x] 1.4 详情页：新增「删除 App」按钮（二次确认 + 结果反馈，删除后回列表）
- [x] 1.5 版本历史倒序展示；保留 manifest/资产/发起运行既有行为
- [x] 1.6 locale.tsx 新增中英文案与 aria 语义；styles.css 补充 task-list-heading-actions/detail-heading-actions/app-create-card 样式
- [x] 1.7 单测：列表渲染/新建（成功+非法 id 拦截）/上传（成功+缺 app.yaml 拦截）/删除确认/详情渲染/发起运行输入校验
- [x] 1.8 静态检查与回归：agent-web typecheck、build、eslint 通过；全套测试 116/116 通过
