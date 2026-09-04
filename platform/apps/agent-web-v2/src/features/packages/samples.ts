import type { MessageKey } from "@/lib/i18n";

/**
 * Built-in sample apps (spec §9.5). Each sample carries its app id, a version,
 * localized name/description message keys, and the full `files` record
 * (path → source content) posted to `POST /v1/apps/:appId/releases`.
 */

export interface SampleAppDefinition {
  appId: string;
  version: string;
  nameKey: MessageKey;
  descriptionKey: MessageKey;
  files: Record<string, string>;
}

const GITHUB_TRENDING_MANIFEST = `schemaVersion: '2'
id: github-trending
version: 2.0.0
description: GitHub 热门项目解读助手：读取真实 GitHub trending 快照并产出解读报告
entry: prompts/system.md
modelRoute:
  provider: minimax-cn
  model: MiniMax-M3
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
`;

const GITHUB_TRENDING_PROMPT = `# github-trending

你是 GitHub 热门项目解读助手。运行输入中已注入真实快照（\`--- snapshots ---\` 分段，来源 \`trending-snapshot\`）：GitHub Search API 返回的新建高 star 仓库列表。

要求：

1. 概述这批项目的整体画像：主导语言、领域分布与热度量级；
2. 对每个仓库给出「一句话定位 → 亮点 → 趋势信号」三段式解读；若提供了 \`language\` 参数（见 \`--- params ---\` 分段），只解读该语言的仓库；
3. 只解读快照中存在的仓库，不虚构 repo 或指标；缺失的维度明确指出；
4. 把解读写入输出目录中的 \`report.md\`，保持简洁、结构化、可引用。不要把回复本身当成最终产物。
`;

const GITHUB_TRENDING_SCHEMA = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["overview", "repositories"],
  "properties": {
    "overview": { "type": "string" },
    "repositories": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "positioning", "highlights", "signal"],
        "properties": {
          "name": { "type": "string" },
          "positioning": { "type": "string" },
          "highlights": { "type": "string" },
          "signal": { "type": "string" }
        }
      }
    },
    "missingData": { "type": "array", "items": { "type": "string" } }
  }
}
`;

const FINANCE_BRIEFING_MANIFEST = `schemaVersion: '2'
id: finance-briefing
version: 2.0.0
description: 财经简报助手：读取汇率和股指快照并产出结构化财经简报
entry: prompts/system.md
modelRoute:
  provider: minimax-cn
  model: MiniMax-M3
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
`;

const FINANCE_BRIEFING_PROMPT = `# finance-briefing

你是财经简报助手。运行输入中已注入市场快照（\`--- snapshots ---\` 分段）与参数（\`--- params ---\` 分段，\`focus\` 为可选关注市场/币种）。

- \`fx-rates\`：Frankfurter API 的美元参考汇率 JSON；
- \`index-quotes\`：Yahoo Finance spark 端点的主要股指 JSON（标普 500、道琼斯、纳斯达克、DAX、富时 100、恒生、日经 225）。

要求：

1. 用一句话概括当日全球市场基调并点明数据时点；
2. 对快照中的每个币种、每个指数给出「数值 + 一句点评」，只解读存在的数据，不虚构；
3. 给出 2 至 4 条跨市场观察；\`focus\` 非空时优先围绕它展开；
4. 标注为 unavailable 的数据源或缺失维度逐条列入 missingData；
5. 把简报写入输出目录中的 \`brief.md\`，结尾固定附免责声明：本简报由自动管道基于公开参考数据生成，存在延迟，不构成投资建议。不要把回复本身当成最终产物。
`;

const FINANCE_BRIEFING_SCHEMA = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["headline", "fx", "indices", "takeaways", "missingData", "asOf"],
  "properties": {
    "headline": { "type": "string" },
    "fx": { "type": "array", "items": { "type": "object" } },
    "indices": { "type": "array", "items": { "type": "object" } },
    "takeaways": { "type": "array", "items": { "type": "string" } },
    "missingData": { "type": "array", "items": { "type": "string" } },
    "asOf": { "type": "string" }
  }
}
`;

const LIFECYCLE_PROBE_MANIFEST = `schemaVersion: '2'
id: lifecycle-probe
version: 2.0.0
description: 生命周期链路探针：无输入、固定输出，用于创建/提交/运行/产物管理全链路端到端验证
entry: prompts/system.md
modelRoute:
  provider: minimax-cn
  model: MiniMax-M3
budgets:
  maxTokens: 2000
  maxToolCalls: 0
  maxDurationMs: 60000
`;

const LIFECYCLE_PROBE_PROMPT = `你是 lifecycle-probe，一个专用于验证 AI App 全生命周期链路（创建 → 提交 → 运行 → 产物管理）的自闭环测试应用。

不依赖任何用户输入或外部数据。无论收到什么内容，始终输出以下固定自检报告（逐字一致，不增补、不总结、不格式变化）：

# lifecycle-probe self-check

- id: lifecycle-probe
- version: 2.0.0
- mode: self-contained
- input-dependencies: none
- sections: [manifest, prompt, run, artifact]

probe-ok
`;

export const SAMPLE_APPS: readonly SampleAppDefinition[] = [
  {
    appId: "github-trending",
    version: "2.0.0",
    nameKey: "packages.samples.githubTrending.name",
    descriptionKey: "packages.samples.githubTrending.description",
    files: {
      "app.yaml": GITHUB_TRENDING_MANIFEST,
      "prompts/system.md": GITHUB_TRENDING_PROMPT,
      "output.schema.json": GITHUB_TRENDING_SCHEMA,
    },
  },
  {
    appId: "finance-briefing",
    version: "2.0.0",
    nameKey: "packages.samples.financeBriefing.name",
    descriptionKey: "packages.samples.financeBriefing.description",
    files: {
      "app.yaml": FINANCE_BRIEFING_MANIFEST,
      "prompts/system.md": FINANCE_BRIEFING_PROMPT,
      "output.schema.json": FINANCE_BRIEFING_SCHEMA,
    },
  },
  {
    appId: "lifecycle-probe",
    version: "2.0.0",
    nameKey: "packages.samples.lifecycleProbe.name",
    descriptionKey: "packages.samples.lifecycleProbe.description",
    files: {
      "app.yaml": LIFECYCLE_PROBE_MANIFEST,
      "prompts/system.md": LIFECYCLE_PROBE_PROMPT,
    },
  },
];
