## ADDED Requirements

### Requirement: Promotion 成功反馈提供任务入口

Web 在 promote to Task 成功受理后展示的成功反馈 SHALL 包含到达所创建/关联任务的操作入口（链接或按钮），使无需离开当前会话即可查看任务执行情况。该入口 SHALL 指向本次 promotion 返回的任务标识对应的任务详情；后端响应未携带任务标识时，SHALL 至少提供到达该会话关联任务工作台的入口。此要求不改变 promotion 的授权与创建语义。

#### Scenario: 成功提示可跳转任务详情

- **WHEN** 用户对一个 `promotionEligibility='explicit'` 的消息执行 Promote to Task 且后端受理成功
- **THEN** 成功提示中提供指向新建任务详情的操作入口，点击后到达该任务的详情视图

#### Scenario: 与既有运行入口模式一致

- **WHEN** 同一页面中 Start run 成功提示提供 "View run" 入口
- **THEN** promotion 成功提示的任务入口在形态与位置上与之一致，不引入新的交互范式
