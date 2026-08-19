# Provider profile 与 Catalog UX 设计

> 将 Local Pi 固定显示为System runtime，把外部Provider profile改为catalog-assisted browser metadata；选择provider/model自动填ID、名称和可验证base URL，同时保存provenance且绝不暗示已切换真实runtime。

## Context

- **Problem**：当前`ProviderProfile`将Local Pi和外部profile混在一起，`enabled`显示为Active；create sentinel会被首个profile回填；provider/model需手工输入。
- **Stakeholders**：配置本地Workspace的用户、Web维护者、未来provider adapter维护者、安全维护者。
- **Success criteria**：185+/6,000+条目可搜索；create/edit/Cancel稳定；source字段自动填充；缺base URL诚实可保存；secret边界不回退。
- **Constraints**：当前执行固定`createLocalAgentClient()`/PiHarness；`models.dev.npm`不等于Sage adapter；API key只在当前tab/session。
- **Out of scope**：live provider validation、provider-backed execution、OAuth、server-side profile/secret sync、Sage endpoint overrides、logo/trademark再分发。

## Current State

`providers.tsx`使用`localStorage` key `sage.provider-profiles.v1`与`sessionStorage` secret；profile含`kind/baseUrl/model/apiKeyConfigured/enabled`。默认Local Pi与OpenAI Compatible都作为profile，selected ID同时承担editor selection和“active”暗示。Catalog不存在。

## Options Considered

| Option | Cost | Risk | Reversibility | Time | Complexity |
|--------|------|------|---------------|------|------------|
| A. 保持free-form输入，仅加catalog旁栏 | 低 | 中：字段漂移、create状态仍复杂 | 高 | 短 | 低 |
| B. Catalog选择直接切换runtime/adapter | 高 | 高：当前执行链不支持且边界错误 | 低 | 长 | 高 |
| C. Catalog-assisted metadata，与runtime解耦 | 中 | 低：provenance清晰、可渐进演进 | 高 | 中 | 中 |

**推荐：方案 C。** Catalog只帮助创建可解释profile，不推断adapter或改变执行。

接受的取舍：部分native SDK provider没有base URL；profile可以metadata-complete但不是URL-adapter-complete。未来runtime支持必须另立capability并显式消费profile。

回退计划：v2 migration保留v1 storage不删除；UI可回退free-form读取，System runtime和Catalog snapshot不受影响。

## Architecture

```text
┌──────────────── Providers page ──────────────────────────┐
│ System runtime card: Local Pi (read-only, in use)        │
│                                                         │
│ Profile list (browser metadata; available/disabled)      │
│   └─ editor state: create | edit(profileId)              │
│        ├─ Provider combobox ──GET catalog/providers      │
│        ├─ Model combobox ─────GET catalog/models         │
│        ├─ mapped metadata + provenance                   │
│        └─ optional API key ───sessionStorage only        │
└───────────────┬──────────────────────────┬───────────────┘
                │ localStorage v2          │ never forwarded
                ▼                          ╳
       Browser profile metadata       Chat/Task/PiHarness
```

## State and terminology

必须分开三维状态：

1. **Editing**：`idle | creating | editing(profileId) | saving`，只描述form lifecycle。
2. **Availability intent**：profile的`enabled`是用户明确选择的“可供未来profile picker选择”意图，不代表执行中。派生展示状态为`Disabled | Incomplete | Available metadata`：URL-based adapter缺合法base URL时为Incomplete并拒绝以`enabled=true`保存；用户仍可保存`enabled=false` draft。文案禁止Active/Running。
3. **Runtime use**：本任务固定`Local Pi runtime · In use`；外部profile永不显示In use。

```text
idle --Add provider--> creating --Save--> editing(newId)
  │                         └--Cancel--> previous selection/idle
  └--select profile--> editing(id) --Save--> editing(id)
                               └--Cancel--> persisted draft
```

Create state使用显式discriminated state，不再用`activeId='new-provider'` sentinel。`Cancel`在create时丢弃draft，在edit时恢复最后persisted profile。

## Profile v2

```ts
type ProviderAdapterKind =
  | 'unassigned'
  | 'openai-compatible'
  | 'anthropic';

type BaseUrlSource = 'model' | 'provider' | 'manual' | 'none';

type ProviderProfileV2 = {
  schemaVersion: '2';
  id: string;                 // stable browser profile ID
  name: string;               // editable display name
  enabled: boolean;           // availability only
  adapterKind: ProviderAdapterKind;
  providerId?: string;
  providerName?: string;
  modelId?: string;
  modelName?: string;
  baseUrl?: string;
  baseUrlSource: BaseUrlSource;
  catalogSnapshotId?: string;
  catalogActiveSince?: string;
  updatedAt: string;
};
```

不持久化`apiKeyConfigured`。Secret presence在当前tab中通过
`sessionStorage.getItem('sage.provider-secret.v1:<profile-id>')`实时派生；tab关闭后UI不得继续声称key存在。

建议storage：

- `sage.provider-profiles.v2`：profile数组。
- `sage.selected-provider-profile.v2`：纯editor selection，不称active provider。
- secret prefix可暂时复用v1以保持同tab兼容；不得复制到localStorage。

Local Pi不属于`ProviderProfileV2`，由静态System runtime view model生成。

## Catalog selector

### Provider combobox

- 打开时加载第一页；输入按provider ID/name搜索。
- 250ms debounce；每次新query abort前一个request；response需匹配request token与active snapshot。
- 支持键盘上下/Enter/Escape、ARIA combobox/listbox/option；展示name、ID、model count。

### Model combobox

- 未选provider时disabled。
- Provider变化时清空旧model及来自source的base URL；manual URL只在用户明确确认保留时保留，默认清空避免跨provider污染。
- 按model ID/name搜索，可筛capability；deprecated/legacy默认隐藏，提供`Include deprecated`。
- Response item必须与当前provider和snapshot一致，否则丢弃。

### Snapshot change

Cursor返回409或status显示新snapshot时，列表重载。已选择值不在后台静默改写；显示“Catalog updated”并允许用户重新选择。保存的profile保留旧snapshot provenance，即使当前catalog已移除该model。

## Field mapping and provenance

```text
select provider
  -> providerId, providerName
  -> clear modelId/modelName
  -> suggested provider base URL (if valid)

select model
  -> modelId, modelName
  -> name defaults to "<providerName> / <modelName>" only if untouched
  -> baseUrl = modelBaseUrl ?? providerBaseUrl
  -> baseUrlSource = model | provider | none
  -> catalogSnapshotId/catalogActiveSince = 同一CatalogPage response metadata
```

- Display name一旦用户编辑即不再被selector覆盖。
- Catalog提供的URL仅接受`https:`；source值不存在/非法时不猜测OpenAI、Anthropic、Google等endpoint。
- 用户编辑base URL后`baseUrlSource='manual'`；清空后为`none`。
- 已保存profile不会因daily sync自动变更base URL。Edit页可比较current catalog并提供显式`Use catalog value`。
- `npm/env/doc/capabilities`可展示为辅助信息，但不批量复制到localStorage；`env`只是upstream提示，不读取本机环境变量。

## Base URL policy

**选择：source-only + optional manual。** 不在T0002维护Sage overrides。

派生状态：

```ts
metadataComplete = Boolean(providerId && modelId);
urlAdapterComplete = adapterKind === 'unassigned'
  ? false
  : Boolean(validHttps(baseUrl));
canSaveEnabled = metadataComplete &&
  (adapterKind === 'unassigned' || urlAdapterComplete);
availabilityStatus = !enabled
  ? 'disabled'
  : canSaveEnabled ? 'available-metadata' : 'incomplete';
executionAvailable = false; // T0002固定；Local Pi另行显示in use
```

`enabled`保存的是用户意图，不由catalog在后台改写。缺base URL时允许保存profile并标`baseUrlSource='none'`，提示“models.dev does not publish a base URL for this provider”。若选择`openai-compatible`或`anthropic`等URL-based adapter，则`enabled=true`且URL缺失/非法时Save必须失败并聚焦Base URL；切回disabled后可保存draft。`unassigned`可保存为Available metadata，但仍明确不是executable。Manual URL只做shape validation，不发送live request。

Catalog metadata不用于自动推断`adapterKind`：`models.dev.npm`描述其生态provider package，不证明Sage实现了对应adapter。

## Storage migration

首次加载：

1. 若v2存在且schema合法，使用v2；非法时显示recoverable error，不覆盖原值。
2. v2不存在时读取v1数组。
3. 所有legacy `kind='local'`记录（不只`id='local-pi'`）都不迁移为外部profile；Local Pi由唯一System runtime接管。非标准local记录保留在v1并显示一次安全migration warning，不伪造第二个local runtime。
4. 其他profile迁移：`openai-compatible|anthropic`映射同名`adapterKind`；`modelId/modelName=legacy model`；有合法URL则`baseUrlSource='manual'`；provider catalog字段留空；保留id/name/enabled/updatedAt。
5. 写入v2前完整校验；若legacy `enabled=true`但映射后不满足新的enabled保存规则，则迁移为`enabled=false`并记录非敏感warning。保留v1 key供rollback，不自动删除。
6. v1默认profile仅在浏览器真实持久化过时迁移；全新browser从空external profile list开始。

`apiKeyConfigured`不迁移。仍在同tab的secret可按stable profile ID被读取；新tab不显示存在。

## Validation and trust boundaries

- Profile ID稳定、不可由provider/model name直接重写；新ID用本地UUID或bounded slug+random suffix。
- name/provider/model/base URL均有长度上限；URL只允许`https:`，不渲染upstream HTML。
- `localStorage`是untrusted input：每次load做strict schema validation，未知/非法item隔离而非让整页崩溃。
- API key input `autocomplete=off`，保存后立即从React draft清空；错误/日志/notice不回显secret。
- Chat submit、retry、promotion、Task create/signal/cancel/retry request必须有negative tests，断言无profile/provider/model/baseUrl/apiKey字段。

## Failure Modes

| Failure | Likelihood | Impact | Mitigation |
|---------|------------|--------|------------|
| Catalog unavailable且无snapshot | 低 | 不能搜索新metadata | 展示unavailable；已有profile仍可编辑/手工保存 |
| LKG stale | 中 | metadata可能旧 | 显示last success/stale；保存记录snapshot provenance |
| 快速query旧响应覆盖 | 中 | 选择错误 | AbortController + request token + snapshot check |
| provider切换保留旧model/URL | 中 | profile污染 | 原子clear dependent fields；manual值需显式保留 |
| v1 malformed | 中 | migration失败 | 不覆盖原key；隔离错误；允许从空draft恢复 |
| secret状态跨tab误报 | 高（现状） | 用户误判 | v2不持久化configured flag，只读sessionStorage |
| upstream URL/文案恶意 | 低 | XSS/SSRF误导 | React escaping、https parse、无HTML、无浏览器直连 |
| 用户误认为profile在执行 | 中 | 产品误导 | System runtime独立；外部profile不显示Active/In use |

## Rollout / Migration

1. 先交付catalog read/status client types与System runtime/profile术语。
2. 引入v2 loader/migration与显式create/edit/Cancel state，保持free-form fallback。
3. 接入provider/model combobox、debounce/abort/filter。
4. 接入mapping/provenance/missing URL状态与snapshot change处理。
5. 删除默认外部profile和旧Active文案；保留v1 key供一个release rollback窗口。

回滚时旧v1仍存在；v2新增profile不会自动反写v1，以免丢失provenance。必要时提供显式export，而不是静默降级。

## Verification

- Loader：无storage、valid/invalid v1/v2、所有legacy local kind隔离、manual URL迁移、incomplete enabled降级、v1保留。
- State：create/edit/Cancel/provider change/name dirty、enabled intent、URL-adapter incomplete拒绝enabled save、disabled draft可保存。
- Selector：debounce、abort、keyboard/ARIA、snapshot 409、deprecated toggle、missing provider/model。
- Mapping：model URL覆盖provider URL、none/manual、daily sync不自动改profile。
- Secret：刷新同tab/新tab、draft清空、localStorage无key/flag。
- Payload boundary：Chat/Task requests不含catalog/profile字段；PiHarness装配不变。
- Browser：desktop和390×844无横向溢出，error/stale/unavailable可理解。

## Open Questions

无阻塞问题。未来若实现provider-backed runtime，应新建设计定义adapter registry、server-side secret、live verification与profile consumption；不得在T0002中用catalog metadata偷渡。

## Cross-References

- [`provider-catalog-sync.md`](./provider-catalog-sync.md)
- [`workspace-interaction-contracts.md`](./workspace-interaction-contracts.md)
- 下游：`/task-propose T0002`
