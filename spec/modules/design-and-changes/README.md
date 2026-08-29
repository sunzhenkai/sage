# design-and-changes

架构设计、OpenSpec 变更台账、任务交付归档。本模块不写运行时代码,只提供文档与流程来源。

## 根

| 路径前缀 | 角色 |
|----------|------|
| `docs/design/` | 架构与 MVP 设计文档 |
| `openspec/` | OpenSpec 变更与 spec 演进 |
| `tasks/` | 任务交付台账与归档 |
| `.agents/` | Agent Skills(`openspec-*`、`project-spec-mirror` 等) |
| `.kimi-code/` | 本地 Kimi 任务缓存 |

## 文件(关键子集)

| 文件 / 目录 | 职责 | 核心 |
|------|------|------|
| `docs/design/README.md` | MVP 总览 | — |
| `docs/design/agent-library-mvp.md` | MVP 1:Agent Library | — |
| `docs/design/first-version-system-architecture.md` | 第一版实现架构 | — |
| `docs/design/_cross/generic-agent-platform-final-architecture.md` | 终版架构 | — |
| `docs/design/_cross/generic-agent-platform-final.system-model.json` | 终版 System Model | — |
| `docs/design/_cross/generic-agent-platform-final.runtime.dsl.yaml` | 终版 Runtime DSL | — |
| `docs/design/agent-application/` | Agent Application 子设计 | — |
| `openspec/config.yaml` | OpenSpec 配置 | — |
| `openspec/specs/` | 当前 spec 源 | — |
| `openspec/changes/` | 进行中与归档的 change | — |
| `tasks/` | 任务台账 + `archive/` | — |
| `.agents/skills/openspec-*/` | OpenSpec Skill | — |
| `.agents/skills/project-spec-mirror/` | 本镜像 Skill | — |

## 对外入口

- `openspec validate <change> --strict` — 校验 change;
- `openspec list` / `openspec show <change>` — 浏览;
- `docs/design/README.md` 是阅读入口。

## 核心符号

- 终版架构文档是长期目标态的事实描述;
- OpenSpec change 是变更的可执行契约来源;
- `tasks/archive/` 是已交付任务的归档证据。

## 依赖

- 不依赖运行时代码,只被 [examples-and-evidence](../examples-and-evidence/README.md) 引用作 evidence;
- OpenSpec 与本镜像(`spec/`)是两个独立系统,各自维护。
