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

const FINANCE_BRIEFING = {
  [`app.yaml`]: `schemaVersion: '2'
id: finance-briefing
version: 2.0.0
description: 财经简报助手：自动获取最新外汇汇率与全球主要股指快照并产出结构化财经简报，无需任何用户输入
entry: prompts/system.md
modelRoute:
  provider: minimax-cn
  model: MiniMax-M3
budgets:
  maxTokens: 60000
  maxToolCalls: 40
  maxDurationMs: 300000
skillRefs:
  - skill://finance-brief/v1
capabilityRefs:
  - capability://web-snapshot-reader/v1
inputs:
  - name: focus
    type: string
    default: ""
    required: false
dataSources:
  - name: fx-rates
    ref: capability://web-snapshot-reader/v1
    url: https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,GBP,JPY,CNY,HKD,AUD
    maxBytes: 65536
    onFailure: markMissing
  - name: index-quotes
    ref: capability://web-snapshot-reader/v1
    url: https://query1.finance.yahoo.com/v7/finance/spark?symbols=%5EGSPC,%5EDJI,%5EIXIC,%5EGDAXI,%5EFTSE,%5EHSI,%5EN225&range=1d&interval=1d
    maxBytes: 262144
    onFailure: markMissing
tasks:
  - name: finance-brief
    entry: prompts/system.md
    output:
      schema: output.schema.json
      files: [brief.md]
`,
  [`output.schema.json`]: `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "FinanceBriefing",
  "type": "object",
  "properties": {
    "headline": { "type": "string" },
    "asOf": { "type": "string" },
    "fx": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "pair": { "type": "string" },
          "rate": { "type": "number" },
          "comment": { "type": "string" }
        },
        "required": ["pair", "rate", "comment"]
      }
    },
    "indices": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "price": { "type": "number" },
          "changePct": { "type": "number" },
          "comment": { "type": "string" }
        },
        "required": ["name", "price", "changePct", "comment"]
      }
    },
    "takeaways": { "type": "array", "items": { "type": "string" } },
    "missingData": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["headline", "fx", "indices", "takeaways", "missingData"]
}
`,
  [`prompts/system.md`]: `# finance-briefing

你是财经简报助手。本次运行的输入中已自动注入实时市场快照（\`--- snapshots ---\` 分段）与参数（\`--- params ---\` 分段，\`focus\` 为可选的关注市场/币种，默认空）。快照说明：

- \`fx-rates\`：Frankfurter API 返回的 JSON（\`base\`、\`date\`、\`rates\`）。\`rates\` 为 1 美元兑换各币种的数额，欧洲央行参考汇率口径，每个工作日更新一次，\`date\` 即汇率所属日期；
- \`index-quotes\`：Yahoo Finance spark 端点返回的 JSON，覆盖标普 500、道琼斯、纳斯达克综合、DAX、富时 100、恒生、日经 225 七个指数。每个 symbol 的 \`response[0].meta\` 含 \`shortName\`（指数名，注意去除首尾空白）、\`regularMarketPrice\`（最新点位）、\`regularMarketChangePercent\`（相对上一交易日收盘的涨跌幅百分比）、\`regularMarketTime\`（数据时点的 Unix 秒）。

按以下要求完成简报：

1. \`headline\`：用一句话概括当日全球市场基调，点明数据时点；
2. \`fx\`：对快照中的每个币种给出「USD 兑该币种汇率 + 一句点评」，只解读数据中存在的币种，不得虚构；
3. \`indices\`：对快照中的每个指数给出「名称 + 最新点位 + 涨跌幅 + 一句点评」，按美、欧、亚时区顺序排列；
4. \`takeaways\`：给出 2 至 4 条跨市场观察（如美元强弱、风险偏好、区域分化），只从快照数据推导；
5. \`missingData\`：快照标注为 unavailable 的数据源、或数据中缺失的维度，逐条列出；两个数据源都可用且维度完整时给空数组；
6. \`asOf\`：汇总两个快照中最早的数据时点，注明「汇率日期 + 指数时间」；
7. 若 \`focus\` 非空，优先围绕该市场或币种展开，并在 \`takeaways\` 中给出针对性观察；focus 无法对应快照中的标的时，在 \`missingData\` 中说明。

纪律：所有数值逐字取自快照，不换算、不外推、不预测行情；语气克制，不使用夸张修辞。输出遵循 output.schema.json 的 JSON 结构（headline / asOf / fx / indices / takeaways / missingData），并同时产出 \`brief.md\`——一份人类可读的简报（标题、各市场段落、要点、缺失数据说明），结尾固定附免责声明：本简报由自动管道基于公开参考数据生成，存在延迟，不构成投资建议。
`,
  [`references/market-data-basics.md`]: `# 市场数据口径基础

- 欧洲央行参考汇率：每个工作日约中欧时间 16:00 更新一次，周末与假日无更新；Frankfurter 的 \`date\` 字段即汇率所属日期，周末运行时拿到的是最近一个工作日的数据。
- 参考汇率是方向性的：\`rates\` 给出 1 美元兑各币种的数额，反向汇率需自行求倒数，且需在简报中注明换算口径。
- 指数行情的 \`regularMarketTime\` 是最近一次成交/收盘时点：美欧指数在其交易时段外会停留在上一收盘，简报应写「截至」该时点而非「现在」。
- 涨跌幅（\`regularMarketChangePercent\`）相对上一交易日收盘；当日盘中数据随行情波动，同一交易日不同时点取数结果不同。
- 以上均为公开参考数据，存在延迟与修正可能，不属于交易级实时行情；引用时应保留「参考数据」定位。
`,
  [`references/brief-writing-guide.md`]: `# 财经简报撰写规范

- 结论先行：headline 先给市场基调，再展开分市场细节；每段点评不超过两句。
- 数值保真：汇率、点位、涨跌幅逐字取自快照，不做四舍五入以外的任何加工；确需换算（如倒数）时必须注明。
- 交叉验证：跨市场结论（美元强弱、风险偏好）至少要有两个市场的数据支撑，单一市场信号不足以定调整体基调。
- 缺失显式化：数据源 unavailable、维度缺失、focus 无对应标的，一律写入 missingData，不得用推测补位。
- 免责声明固定：简报结尾附固定句式免责声明，说明数据来源为公开参考数据、存在延迟、不构成投资建议。
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
    appId: 'github-trending',
    name: `GitHub Trending`,
    description: `GitHub 热门项目解读助手：准入时自动获取真实快照并产出热门项目 digest，无需任何用户输入`,
    version: '2.0.0',
    files: GITHUB_TRENDING
  },
  {
    appId: 'finance-briefing',
    name: `Finance Briefing`,
    description: `财经简报助手：自动获取最新外汇汇率与全球主要股指快照并产出结构化财经简报，无需任何用户输入`,
    version: '2.0.0',
    files: FINANCE_BRIEFING
  },
  {
    appId: 'lifecycle-probe',
    name: `Lifecycle Probe`,
    description: `生命周期探针：自闭环确定性测试应用——不依赖任何用户输入，输出固定自检报告`,
    version: '2.0.0',
    files: LIFECYCLE_PROBE
  }
];
