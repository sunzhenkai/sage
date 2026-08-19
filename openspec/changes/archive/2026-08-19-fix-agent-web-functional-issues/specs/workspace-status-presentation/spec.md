## ADDED Requirements

### Requirement: Workspace 错误态与空状态互斥呈现

Workspace 的列表类页面（Chat history、Tasks list）在数据请求失败时 SHALL仅展示有作用域的错误状态；SHALL NOT在错误状态下同时展示「无数据」空状态、表格或加载更多控件。空状态只在请求成功且结果为空时呈现。

#### Scenario: Chat history 失败
- **WHEN** Chat landing 的 history 请求失败
- **THEN** 仅展示错误横幅，不展示空状态、历史列表或 Load more

#### Scenario: Tasks list 失败
- **WHEN** Tasks 页面的 task list 请求失败
- **THEN** 仅展示错误横幅，不展示「No Tasks yet」空状态或任务表格

#### Scenario: 成功且为空
- **WHEN** 请求成功返回空数组
- **THEN** 正常展示对应空状态，不展示错误横幅

#### Scenario: 成功且筛选为空
- **WHEN** 请求成功但当前筛选条件无匹配
- **THEN** 展示筛选空提示，不展示加载错误
