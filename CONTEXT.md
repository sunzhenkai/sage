# Sage Agent Application

本地工作区控制面的用语。这里只收已经拍板的词，不写实现细节。

## Language







## Work objects

**App**:
已登记的 AI 应用。它有身份、Release 和一组 Declared Task。工作区里管理它的那一屏叫应用视图，与旧称 Packages 是同一屏。
_Avoid_: Package, AI App / Package, 包

**Session**:
一条 Chat 会话。
_Avoid_: conversation, thread, chat（当作对象时）

**会话列表**:
Chat 里用来发现、过滤、打开 Session 的清单。
_Avoid_: history sidebar, conversation rail

**Task**:
一条可暂停、恢复、取消、重试的 durable 执行实例，用 `taskId` 标识。Tasks 视图列出的就是它。
_Avoid_: Run（当说话人其实指这条实例）, Declared Task, Workflow

**Declared Task**:
App manifest 里的命名入口。它是定义，不是实例。
_Avoid_: Task（单独使用）, entry, package task

**Chat Run**:
Chat 会话里的一轮模型调用，用 `runId` 标识，失败后可以重试。时间线按它分组。
_Avoid_: Task, Run（单独使用）

**默认运行模型**:
租户级的默认 provider connection，Chat 未单独指定运行时就使用它。设置菜单里的「模型」设置项就是它；Chat 内的运行时选择是会话级覆盖，与它相对。
_Avoid_: 全局模型, 默认模型

## Settings

**设置**:
主菜单进入的设置视图。左侧是子菜单，右侧是当前选中项的设置面板。
_Avoid_: 偏好设置, Preference, 配置管理

**子菜单**:
设置视图内、内容卡片左侧的二级导航；条目视觉与主菜单条目一致（同款 hover 与选中效果）。
_Avoid_: 侧边栏, 二级 rail, tabs

**通用**:
设置子菜单的第一项，承载跨视图的用户偏好（如界面语言）。
_Avoid_: 常规, 偏好
