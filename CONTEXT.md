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
