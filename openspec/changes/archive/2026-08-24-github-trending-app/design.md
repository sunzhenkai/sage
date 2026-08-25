# Design — github-trending-app

## Context

- ai app 源包格式为纯声明式「目录即包」（AgentSourceManifest.v1）：`app.yaml` + `prompts/*.md` + `references/*.md` + 可选 `output.schema.json`；安全边界拒绝脚本/可执行扩展名/疑似 Secret/符号链接，顶层目录白名单固定。
- 现有唯一示例 `ops-analyst`（运维分析主题）已走通「编译 → 登记 → 发起运行 → web 展示」全链；本 change 复用该链路，不新增平台能力。
- 仓库已有静态 HTML 先例 `docs/pretty-view-html/sage/`（文档站），证明静态 HTML 页可独立于平台前端存在。

## Goals

- 第二个示例 ai app：主题「GitHub 热门项目分析」，与 ops-analyst 同构但领域不同，验证源包格式对多主题的可复用性
- 一个自包含 HTML 展示页：面向「介绍这个 app」的展示物，设计上刻意区别于模板化默认（由 frontend-design skill 流程驱动）

## Non-Goals

- 不抓取实时 GitHub 数据、不接入 GitHub API；不新增工具/capability
- 不修改 agent-web（packages 视图已覆盖管理面）

## Decisions

### D1. app 行为定义：输入快照、输出结构化 digest

app 定位为「GitHub 热门项目解读助手」：运行时 userInput 提供项目清单或主题描述（例如某语言/某领域的一批 repo 快照数据），entry prompt 指导模型产出结构化 digest：排名解读、每个项目的亮点与趋势信号、领域趋势总结。输出约束由 `output.schema.json` 固定为 digest JSON（sections: overview / repos[] / insights[]）。模型路由复用 ops-analyst 的 anthropic claude-sonnet-4-5（haiku 兜底），本地栈已具备该 provider 配置。

### D2. 展示页路线：单文件自包含静态 HTML，放 `docs/showcase/`

- 位置：`docs/showcase/github-trending.html`，与 `docs/pretty-view-html/`（pretty-view-html skill 产物）区分，本页由 frontend-design skill 流程产出
- 单文件内联 CSS（无外部依赖、无构建步骤），可直接 file:// 打开或任意静态服务托管，降低「测试环境跑通」的验证成本
- 内容骨架：app 是什么 → 包结构（app.yaml/prompts/references/output.schema）→ 运行链路（编译→登记→运行→web 查看）→ 示例 digest 输出片段
- 设计流程遵循 frontend-design skill：先出 token 系统（色板 4–6 个命名色、2+ 字体角色、布局概念、签名元素），对照三大 AI 默认样式自我评审后再编码；响应式到移动端、可见键盘焦点、respects prefers-reduced-motion

### D3. 验证路线：三层证据

1. **编译层**：vitest smoke（`github-trending.smoke.test.ts`）断言加载资产数、Release 合法性、编译确定性 — 对齐 ops-analyst 先例
2. **平台层**：本地 dev 栈（agent-api 9610 已运行）`register-package` CLI 登记，`GET /v1/apps` 断言含 `github-trending`，web（9612）packages 视图确认详情页可打开
3. **展示层**：浏览器打开 HTML 展示页，桌面 + 移动宽度截图留证

registry 为内存态（agent-api 重启即丢），登记验证只要求当前进程内可见，不做持久化断言。

## Risks / Trade-offs

- 登记是内存态：验收依赖「当场登记当场验证」，README 中已有说明，不额外处理
- HTML 展示页与 agent-web 风格无关是刻意选择：展示页是独立展示物，不承诺与平台 UI 视觉一致
