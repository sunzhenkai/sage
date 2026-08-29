# Spec 镜像 — sage

给人读的孪生规格，不是源码、不是 OpenSpec。验收：只凭本镜像能重建可运行系统。

| 项 | 值 |
|----|-----|
| 粒度 | concise |
| 分支 | main |
| 同步 commit | 尚未同步 |
| 源 | （见 `.mirror.json`） |

## 怎么读

1. [overview.md](overview.md)
2. [上下文](context/INDEX.md) · [表面](surface/INDEX.md) · [数据](data/INDEX.md) · [运行时](runtime/INDEX.md) · [构建](build/INDEX.md)
3. [切面](facets/INDEX.md) · [概念](concepts/INDEX.md) · [实体](entities/INDEX.md) · [处理线](flows/INDEX.md)
4. 需要看代码承载时再进 [模块](modules/INDEX.md)；看图进 [diagrams/INDEX.md](diagrams/INDEX.md)

## 地图

| 层 | 路径 | 回答什么 |
|----|------|----------|
| 总览 | overview.md | 这是什么、边界在哪 |
| 上下文 | context/ | 系统在环境里的位置 |
| 表面 | surface/ | 对外接口与配置键 |
| 数据 | data/ | 持久化与一致性 |
| 运行时 | runtime/ | 进程、部署、拓扑 |
| 构建 | build/ | 如何构建、迁移、启动 |
| 切面 | facets/ | 来源、契约、切片、如何验证与放量 |
| 概念 | concepts/ | 领域用语 |
| 实体 | entities/ | 关键对象及其关系 |
| 处理线 | flows/ | 一次业务怎么走完 |
| 模块 | modules/ | 代码如何落地 |
| 图 | diagrams/ | 结构 / 流程 / 时序 / 数据流 / 状态 |
