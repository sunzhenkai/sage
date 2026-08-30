## ADDED Requirements

### Requirement: 模态形态统一与错误态一致性

应用的创建/编辑类弹窗 SHALL 复用同一模态原语：面包屑式上下文标题、Esc 关闭、焦点圈定、取消在左主按钮在右的操作顺序。页面级错误横幅 SHALL 统一由全局 Banner 组件呈现；任何视图 SHALL NOT 以无样式类名（如未登记的 banner 组合）渲染裸文本错误态。

#### Scenario: provider 弹窗按钮主序
- **WHEN** 打开服务商弹窗（添加/编辑工作区 provider）
- **THEN** 操作区为「取消在左、保存在右」，与新建应用弹窗一致

#### Scenario: 定时任务错误态与全局一致
- **WHEN** 定时任务列表请求失败
- **THEN** 错误以全局 Banner 组件呈现（边框、图标、语义角色），而非裸文本
