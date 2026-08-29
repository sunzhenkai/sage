// 内嵌的示例 ai app 源包（与 platform/examples/ai-apps 保持一致，路径 → 内容）。
// 前端直接持有文件内容，应用页「导入示例项目」可一键完成 创建应用 → 登记 Release，
// 不依赖 agent-api 进程能否读到 examples 目录。

export interface ExampleApp {
  readonly appId: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly files: Readonly<Record<string, string>>;
}

const OPS_ANALYST = {
  [`app.yaml`]: `schemaVersion: '2'
id: ops-analyst
version: 2.0.0
description: 通用运维分析助手：按声明的告警参数（severity/component）解读监控指标并生成排查建议
entry: prompts/system.md
modelRoute:
  provider: anthropic
  model: claude-sonnet-4-5
  fallbacks:
    - claude-haiku-4-5
budgets:
  maxTokens: 8000
  maxToolCalls: 40
  maxDurationMs: 300000
skillRefs:
  - skill://ops-triage/v1
capabilityRefs:
  - capability://metric-reader/v1
inputs:
  - name: severity
    type: enum
    enum: [low, medium, high, critical]
    default: medium
  - name: component
    type: string
    default: ""
    required: false
`,
  [`output.schema.json`]: `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "OpsAnalystOutput",
  "type": "object",
  "properties": {
    "summary": { "type": "string" },
    "possibleCauses": { "type": "array", "items": { "type": "string" } },
    "nextSteps": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["summary", "possibleCauses", "nextSteps"]
}
`,
  [`prompts/system.md`]: `# ops-analyst

你是一名通用的运维分析助手。本次运行的参数见 \`--- params ---\` 分段：\`severity\`（告警级别 low/medium/high/critical，缺省 medium）与可选的 \`component\`（受影响组件/服务名，未提供则覆盖全部）。按参数界定的范围完成以下工作：

1. 先复述你认为的关键信号与缺失信息；
2. 按「现象 → 可能原因 → 排查步骤 → 缓解措施」的结构输出结论；
3. 结论必须基于参考资料中的通用运维准则，不要臆测不存在的内部系统或服务名；排查优先级与篇幅随 severity 调整（critical 聚焦止血，low 侧重归因与改进项）；提供了 component 时仅围绕该组件展开；
4. 如果信息不足，明确列出还需要补充的指标或日志维度。

始终保持简洁、结构化、可执行。
`,
  [`references/observability-basics.md`]: `# 可观测性基础

- 黄金四信号：延迟、流量、错误、饱和度（利用率）。
- 告警分级：P1 业务中断 / P2 主要功能受损 / P3 局部影响 / P4 提示。
- 延迟异常优先看 p50/p95/p99 分位，p99 突增通常指向尾部慢请求或 GC。
- 错误率与流量分离：先判断错误率上升是随流量放大还是独立事件。
- 饱和度超过阈值时，队列堆积往往先于错误出现。
`,
  [`references/runbook-conventions.md`]: `# Runbook 撰写约定

- 每个 runbook 以「触发条件」开头，明确什么信号会激活它。
- 排查步骤按成本从低到高排列，先读日志再改配置。
- 缓解措施区分为「止血」与「根治」，不要混为一谈。
- 所有命令给出预期输出样例，方便核对。
`,
  [`references/troubleshooting-playbook.md`]: `# 通用排查手册

- 资源类问题：CPU/内存/磁盘/网络，逐一确认是否触顶，触顶再判断扩容或优化。
- 数据库问题：连接数、慢查询、锁等待、复制延迟，从最接近业务的指标开始。
- 队列问题：消费速率 vs 生产速率、积压量、重试次数，确认是否有死信。
- 版本变更：最近的部署/发布/配置变更，优先回滚验证假设。
- 时间线复盘：把告警、日志、指标放在同一时间线，定位首个异常信号。
`
} as const;

const GITHUB_TRENDING = {
  [`app.yaml`]: `schemaVersion: '2'
id: github-trending
version: 2.0.0
description: GitHub 热门项目解读助手：准入时自动获取真实快照并产出热门项目 digest，无需任何用户输入
entry: prompts/system.md
modelRoute:
  provider: minimax-cn
  model: MiniMax-M3
budgets:
  maxTokens: 60000
  maxToolCalls: 40
  maxDurationMs: 300000
skillRefs:
  - skill://repo-digest/v1
capabilityRefs:
  - capability://web-snapshot-reader/v1
inputs:
  - name: language
    type: string
    default: ""
    required: false
dataSources:
  - name: trending-snapshot
    ref: capability://web-snapshot-reader/v1
    url: https://api.github.com/search/repositories?q=created%3A%3E2026-01-01&sort=stars&order=desc&per_page=25
    maxBytes: 262144
    onFailure: fail
tasks:
  - name: trending-digest
    entry: prompts/system.md
    output:
      schema: output.schema.json
      files: [report.md]
`,
  [`output.schema.json`]: `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "GithubTrendingDigest",
  "type": "object",
  "properties": {
    "overview": { "type": "string" },
    "repos": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "positioning": { "type": "string" },
          "highlight": { "type": "string" },
          "trendSignal": { "type": "string" }
        },
        "required": ["name", "positioning", "highlight", "trendSignal"]
      }
    },
    "insights": { "type": "array", "items": { "type": "string" } },
    "missingData": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["overview", "repos", "insights"]
}
`,
  [`prompts/system.md`]: `# github-trending

你是 GitHub 热门项目解读助手。本次运行的输入中已自动注入真实快照（\`--- snapshots ---\` 分段，来源 \`trending-snapshot\`）：GitHub Search API 返回的 **2026 年新建、star 数降序的 Top 25 仓库**（含全名、star/fork 数、语言、简介）。完成以下工作：

1. 概述这批项目的整体画像：主导语言/领域分布、热度量级与最突出的增长信号；
2. 对快照中的每个仓库给出「一句话定位 → 亮点 → 趋势信号」三段式解读；若提供了 \`language\` 参数（见 \`--- params ---\` 分段），只解读该语言的仓库；
3. 只解读快照数据中存在的仓库，不虚构 repo 或指标；数据缺失的维度明确指出；
4. 给出去同质化的总结：这批新项目反映了什么方向，哪些可能只是短期噪声。

输出遵循 output.schema.json 的 digest JSON 结构（overview / repos / insights / missingData），保持简洁、结构化、可引用。
`,
  [`references/repo-evaluation.md`]: `# 项目评估维度

- 定位清晰度：README 首屏能否一句话说清解决什么问题；一句话定位优先引用其自述再作压缩。
- 工程质量信号：CI 配置、测试目录、语义化版本 release、CHANGELOG。
- 生态位：与既有主流项目的关系（替代/互补/桥接），避免只看 star 排名。
- 许可证与治理：License 类型、是否接受外部 PR、有没有贡献指南。
- 可采用性：文档完整度、快速上手成本、运行依赖复杂度；热度高不等于可采用。
`,
  [`references/trending-signals.md`]: `# Trending 信号框架

- star 速率比总量更有信息：日增/周增 star 与历史总量的比值高，说明是新增热度而非存量积累。
- fork 数高 + issue 少：偏「拿来用」的工具型项目；fork 低 + issue/discussion 活跃：偏「围观学习」型项目。
- contributors 近 90 天有提交是持续维护的最低信号；单一贡献者 + 高 star 需要标注风险。
- release/commit 节奏稳定（周级）优于脉冲式爆发；长期无提交的高星项目按「休眠」标注。
- star 突增通常由外部事件驱动（Hacker News / Reddit / 大 V 转发），解读时应区分事件驱动与自然增长。
`
} as const;

const LIFECYCLE_PROBE = {
  [`app.yaml`]: `schemaVersion: '2'
id: lifecycle-probe
version: 2.0.0
description: 生命周期探针：自闭环确定性测试应用——不依赖任何用户输入，输出固定自检报告，专用于创建/提交/运行/产物管理全链路端到端验证
entry: prompts/system.md
modelRoute:
  provider: minimax-cn
  model: MiniMax-M3
budgets:
  maxTokens: 2000
  maxToolCalls: 0
  maxDurationMs: 60000
`,
  [`prompts/system.md`]: `你是 lifecycle-probe，一个专用于验证 AI App 全生命周期链路（创建 → 提交 → 运行 → 产物管理）的自闭环测试应用。

不依赖任何用户输入或外部数据。无论收到什么内容，始终输出以下固定自检报告（逐字一致，不增补、不总结、不格式变化）：

# lifecycle-probe self-check

- id: lifecycle-probe
- version: 2.0.0
- mode: self-contained
- input-dependencies: none
- sections: [manifest, prompt, run, artifact]

probe-ok
`
} as const;

export const EXAMPLE_APPS: readonly ExampleApp[] = [
  {
    appId: 'ops-analyst',
    name: `Ops Analyst`,
    description: `通用运维分析助手：按声明的告警参数（severity/component）解读监控指标并生成排查建议`,
    version: '2.0.0',
    files: OPS_ANALYST
  },
  {
    appId: 'github-trending',
    name: `GitHub Trending`,
    description: `GitHub 热门项目解读助手：准入时自动获取真实快照并产出热门项目 digest，无需任何用户输入`,
    version: '2.0.0',
    files: GITHUB_TRENDING
  },
  {
    appId: 'lifecycle-probe',
    name: `Lifecycle Probe`,
    description: `生命周期探针：自闭环确定性测试应用——不依赖任何用户输入，输出固定自检报告`,
    version: '2.0.0',
    files: LIFECYCLE_PROBE
  }
];
