# Sage Agent Application

本地工作区控制面的用户可见用语。这里只收已经拍板的词，不写实现细节。

**适用范围：** Avoid 只约束 `agent-web` 用户可见文案和界面称呼；不约束代码标识、API 路径、query 参数、manifest 字段、规格字段、领域对象和英文语法中的普通名词。

## Language







## Work objects

**App**:
已登记的 AI 应用。它有身份、Release 和一组 Declared Task。工作区里管理它的那一屏叫应用视图，与旧称 Packages 是同一屏。
_Avoid_: Package, AI App / Package, 包

**Session**:
一条 Chat 会话。
_Avoid_: conversation, thread, chat（仅当用户可见对象应称为 Session 时）

**会话列表**:
Chat 里用来发现、过滤、打开 Session 的清单。
_Avoid_: history sidebar, conversation rail

**Task**:
一条可暂停、恢复、取消、重试的 durable 执行实例，用 `taskId` 标识。Tasks 视图列出的就是它。
_Avoid_: Run（当说话人其实指 Task 实例时）, Declared Task, Workflow

**Declared Task**:
App manifest 里的命名入口。它是定义，不是实例。
_Avoid_: Task（仅当用户可见对象应称为 Declared Task 时）, entry（仅限用户可见标签）, package task

**Chat Run**:
Chat 会话里的一轮模型调用，用 `runId` 标识，失败后可以重试。时间线按它分组。
_Avoid_: Task, Run（仅限用户可见对象称呼）

**默认运行模型**:
租户级的默认 provider connection，Chat 未单独指定运行时就使用它。设置菜单里的「模型」设置项就是它；Chat 内的运行时选择是会话级覆盖，与它相对。
_Avoid_: 全局模型, 默认模型（仅限用户可见称呼）

## Settings

**设置**:
主菜单进入的设置视图。左侧列表栏同一时刻只呈现一类列表：通用下是子菜单，模型与连接下是连接条目列表；右侧是当前选中项的设置面板。
_Avoid_: 偏好设置, Preference, 配置管理

**子菜单**:
设置视图内、内容卡片左侧的二级导航；条目视觉与主菜单条目一致（同款 hover 与选中效果）。
_Avoid_: 侧边栏, 二级 rail, tabs（仅限用户可见称呼）

**通用**:
设置子菜单的第一项，承载跨视图的用户偏好（如界面语言）。
_Avoid_: 常规, 偏好（仅限用户可见称呼）
