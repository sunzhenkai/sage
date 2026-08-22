# agent-package-e2e-web Tasks

## 1. API client 与路由

- [x] 1.1 agent-web API client 扩展：packages 列表/详情、releases、发起 runs 三组调用与类型
- [x] 1.2 新增 `/packages`、`/packages/:id` 路由与导航入口

## 2. 页面实现

- [x] 2.1 包列表页（摘要卡片/表格、空态引导）
- [x] 2.2 包详情页：manifest 摘要、资产只读预览、release 历史与 digest
- [x] 2.3 发起运行表单：必填输入校验、提交后跳转运行 task 视图
- [x] 2.4 运行追踪复用/衔接既有 task 视图与 artifact 查看组件

## 3. 验证

- [x] 3.1 本地栈 smoke：登记示例包 → UI 浏览 → 发起运行 → 追踪终态 → 查看 artifact
- [x] 3.2 lint/build 通过；`openspec validate --strict --type change agent-package-e2e-web` 通过
