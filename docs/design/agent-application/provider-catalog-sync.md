# Provider/Model Catalog 同步设计

> 由 Sage API 固定抓取 `https://models.dev/api.json`，将成功响应原子激活为 PostgreSQL last-known-good snapshot，并通过白名单 projection API 服务浏览器；manual、daily 与 startup due 共用一个跨实例 single-flight coordinator。

## Context

- **Problem**：当前没有 catalog、持久 cache、scheduler 或同步状态；浏览器 profile 是手工字段。
- **Stakeholders**：Provider 配置用户、API/runtime维护者、数据库/安全维护者、`models.dev` 数据来源方。
- **Success criteria**：manual/daily可观测；API重启和上游失败后仍可读LKG；200/304/schema drift安全；多实例不重复抓取；不影响Sage readiness。
- **Constraints**：上游约3.7MB、185 providers/6,321 models；字段可增量变化；部分 provider 无 `api`；外部请求不得发送用户数据。
- **Out of scope**：provider execution、Sage base URL overrides、logo proxy、tenant-specific catalog、将raw upstream API公开透传。

## Current State

`createApiRuntime()` 已有 PostgreSQL migration advisory lock和显式 `close()`，local principal已有 roles但没有 catalog admin。仓库无 catalog package/table/fetch client。`models.dev` 支持 ETag/304，官方仓库为 MIT；live payload字段多于静态schema。

## Options Considered

| Option | Cost | Risk | Reversibility | Time | Complexity |
|--------|------|------|---------------|------|------------|
| A. Browser direct + IndexedDB | 低 | 高：重复下载、非workspace-wide、后台timer不可靠 | 高 | 短 | 低 |
| B. API proxy + memory only | 低 | 高：重启丢LKG/ETag、多实例漂移 | 高 | 短 | 低 |
| C. API + normalized provider/model tables | 高 | 中：6k upsert、schema耦合 | 中 | 长 | 高 |
| D. API + persisted JSONB snapshot/projection | 中 | 低：原子LKG、容忍未知字段 | 高 | 中 | 中 |

**推荐：方案 D。** Snapshot符合外部公共数据集的原子版本语义，写放大和schema耦合显著低于normalized tables。

接受的取舍：每实例需约一个active payload/projection的内存；复杂组合查询不是目标。若未来需要跨字段分析、关系查询或百万模型规模，可从raw snapshot离线构建normalized read model。

回退计划：停止scheduler/read routes即可；active JSONB和attempt审计保留，不影响Chat/Task。Browser可继续编辑已有local profile metadata。

## Architecture

```text
                         fixed HTTPS GET + If-None-Match
┌──────────────┐        timeout / decoded-size cap        ┌───────────────┐
│ models.dev   │ ◀─────────────────────────────────────── │ SourceClient  │
└──────────────┘                                           └──────┬────────┘
                                                                  │ validate/hash
┌──────────────── agent-api ───────────────────────────────────────┼───────────┐
│ startup/manual/daily -> CatalogSyncManager -> advisory lock      │           │
│           │                         │                             ▼           │
│           │                         └──────────────> CatalogStore transaction │
│           │                                      snapshot + active pointer   │
│           ▼                                                                  │
│ status/attempt routes          immutable ProjectionCache <── NOTIFY + poll   │
│ provider/model read routes ───────────────────────────────────────────┐       │
└───────────────────────────────────────────────────────────────────────┼───────┘
                                                                        ▼
                                                              Provider profile UI
```

### Ownership

- **`@sage/provider-catalog`（建议包名）**：source client、validator/projector、Postgres store、sync manager；属于Agent Application层。
- **`app-contracts`**：公开status/provider/model/attempt schemas与safe error codes。
- **`agent-api`**：auth routes、runtime lifecycle wiring；Catalog不进入Agent Library/PiHarness/Temporal。
- **PostgreSQL**：global snapshot/state/attempt权威。
- **ProjectionCache**：每进程只读派生cache，可随时从active snapshot重建，不是权威。

## Data Model

```sql
provider_catalog_snapshots(
  snapshot_id text PRIMARY KEY,
  source_id text NOT NULL,
  source_url text NOT NULL,
  etag text,
  content_sha256 text NOT NULL,
  payload jsonb NOT NULL,
  provider_count integer NOT NULL,
  model_count integer NOT NULL,
  fetched_at timestamptz NOT NULL,
  first_activated_at timestamptz NOT NULL,
  UNIQUE(source_id, content_sha256)
);

provider_catalog_state(
  source_id text PRIMARY KEY,
  active_snapshot_id text REFERENCES provider_catalog_snapshots,
  active_activated_at timestamptz,
  validator_etag text,
  last_checked_at timestamptz,
  last_successful_check_at timestamptz,
  next_sync_at timestamptz NOT NULL,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_error_code text,
  updated_at timestamptz NOT NULL
);

provider_catalog_sync_attempts(
  attempt_id text PRIMARY KEY,
  source_id text NOT NULL,
  trigger text NOT NULL CHECK (trigger IN ('startup','manual','daily','retry')),
  status text NOT NULL CHECK (status IN
    ('queued','running','succeeded','not_modified','failed','cancelled','skipped')),
  principal_id text,
  authentication_id text,
  owner_id text,
  queued_at timestamptz NOT NULL,
  started_at timestamptz,
  deadline_at timestamptz,
  completed_at timestamptz,
  http_status integer,
  bytes integer,
  error_code text
);
CREATE UNIQUE INDEX provider_catalog_one_active_attempt
  ON provider_catalog_sync_attempts(source_id)
  WHERE status IN ('queued','running');
```

Migration幂等upsert固定source row `models-dev`，首次`next_sync_at=now()`；因此新安装在API ready后立即形成startup due。`validator_etag`是下一次conditional request的权威validator，snapshot上的`etag`只记录该payload被观测时的来源元数据。

- Catalog无`tenant_id`：它是同一deployment共享的公共source snapshot；读取仍需authenticated workspace principal。
- Attempt只保存stable safe code，不保存response body、stack、API key或用户query。
- 保留active + 前2个成功snapshot。GC只删除非active旧snapshot，不能与active pointer transaction混为一个不可恢复动作。
- Migration使用[`session-history-and-navigation.md`](./session-history-and-navigation.md)定义的ordered runner，component=`provider-catalog`。

## Upstream validation and projection

### Fetch policy

- URL编译期固定为 `https://models.dev/api.json`；request body为空，只带通用User-Agent和`provider_catalog_state.validator_etag`对应的`If-None-Match`。
- `redirect: 'error'`：v1不跟随redirect，避免host绕过。若上游以后必须redirect，先以reviewed allowlist变更更新。
- timeout默认20s；按解压后的stream累计最大16MiB；超限立即abort。
- 只接受2xx/304和JSON content type；ETag长度有界，日志不记录完整headers/body。

### Tolerant ingest

- Root必须是object；每个provider必须有合法key/id、非空name和models object；每个model必须有合法id/name。
- 使用字段的类型/长度非法时整批拒绝；未知字段保留在raw JSONB但不参与公开contract。
- provider/model ID与root/map key不一致时拒绝，避免歧义。
- `api/doc`等URL只在parse成功且scheme为`https:`时进入projection；不渲染upstream HTML。
- 计算decoded bytes、SHA-256和counts后才能开始activation transaction。

### Public projection

```ts
type ProviderCatalogItem = {
  schemaVersion: '1'; snapshotId: string;
  providerId: string; providerName: string;
  npm?: string; env: string[]; docUrl?: string;
  providerBaseUrl?: string; modelCount: number;
};

type ModelCatalogItem = {
  schemaVersion: '1'; snapshotId: string;
  providerId: string; providerName: string;
  modelId: string; modelName: string;
  status?: string;
  capabilities: string[];
  providerBaseUrl?: string;
  modelBaseUrl?: string;
  effectiveBaseUrl?: string;
  baseUrlSource: 'model' | 'provider' | 'none';
};
type CatalogPage<T> = {
  schemaVersion: '1';
  snapshotId: string;
  activeSince: string;
  items: T[];
  nextCursor?: string;
};
```

`effectiveBaseUrl = validHttps(model.provider.api) ?? validHttps(provider.api)`。无值是正常数据，不推断native SDK endpoint。Provider/model endpoints都返回`CatalogPage<T>`；Profile直接保存同一response中的`snapshotId/activeSince`，不另行拼接status response。`activeSince`来自`provider_catalog_state.active_activated_at`，表示当前pointer自何时指向该snapshot；snapshot row的`first_activated_at`只用于审计首次激活。

## APIs

```http
GET  /v1/provider-catalog/status
GET  /v1/provider-catalog/providers?q=&limit=&cursor=
GET  /v1/provider-catalog/models?providerId=&q=&status=&capability=&limit=&cursor=
POST /v1/provider-catalog/sync
GET  /v1/provider-catalog/sync/:attemptId
```

- Read query `limit`默认30、最大100；q最大100 code points；enum/filter严格且`additionalProperties=false`。
- Provider按normalized name + id排序；model按status rank、normalized name、id排序。
- Read cursor包含version、active `snapshotId`、sort key和filterHash。DB active snapshot变化后旧cursor返回409 `CATALOG_CURSOR_SNAPSHOT_CHANGED`，浏览器清空列表并从第一页重载。
- Response使用`CatalogPage<T>`返回snapshot ID与activation time，浏览器不得混合不同snapshot的provider/model选择。
- 每个read request先比较ProjectionCache revision与DB active revision；不一致时从active snapshot同步重建并原子swap。重建失败返回retryable 503 `CATALOG_PROJECTION_UNAVAILABLE`，不得继续返回旧revision。
- 无active snapshot：read返回503 `CATALOG_UNAVAILABLE`和safe status；有active LKG且projection可构建时，即使stale仍返回200。
- Manual POST返回202 `{attemptId,status}`；已有queued/running attempt时返回同一attempt。若最近一次completed check距当前不足60s且无active attempt，返回429 `CATALOG_SYNC_RATE_LIMITED`及bounded `retryAfterSeconds`。

### Authorization

- Read：authenticated workspace principal；数据global不意味着匿名公开。
- Manual sync：role `provider-catalog-admin`。Local runtime principal显式加入该role；不复用`task-operator`。
- Status可由read principal查看safe code；attempt identity/audit字段不回显不必要细节。
- 当前local `authenticateRequest()`是开发装配，不声明production auth已完成。

## Sync State Machine

```text
trigger(startup/manual/daily/retry)
  │ DB tx: bootstrap state; return existing queued/running,
  │ or insert one queued attempt (partial unique index)
  ▼
queued ──coordinator acquires advisory lock + claims owner──> running
  │               └─other contenders observe same attempt
  │
  ├─304────────────────────> not_modified ──schedule 24h+jitter
  ├─200 same hash/new ETag─> succeeded ─────update validator, no snapshot copy
  ├─200 new valid snapshot─> succeeded ─────atomic activate + schedule
  ├─shutdown abort─────────> cancelled
  └─timeout/http/size/schema/db ─> failed ──schedule backoff
```

### Trigger and scheduling

- **bootstrap/startup**：migration upsert固定source state；API先从DB加载active snapshot。`next_sync_at<=now()`、no snapshot或距last successful check超过24h时后台enqueue，不阻塞listen/readiness。
- **enqueue事务**：lock source state row；若partial unique index对应queued/running attempt已存在，直接返回该attempt；否则插入唯一queued attempt并commit。所有实例可观察同一attempt。
- **claim**：coordinator对queued attempt尝试dedicated connection advisory lock；获得者以compare-and-set把`queued -> running`并写owner/start/deadline。未获得lock的实例不新建attempt，只返回/观察同一ID。
- **orphan recovery**：queued超过60s仍无人claim时任一scheduler可重试claim；running超过deadline时，只有成功取得同一advisory lock的实例可将其标`cancelled/SYNC_OWNER_LOST`，再由正常enqueue创建retry attempt。
- **daily**：`next_sync_at`为DB权威；每实例timer/poll due，但attempt partial unique + advisory lock共同保证一个owner和一个fetch。
- **manual**：与daily共用enqueue、lock、limits和source；不能绕过single-flight。距last completed check不足60s时429；成功/304按正常24h+jitter重算daily due，失败进入同一backoff链。
- 正常下一次检查：successful check + 24h + source ID确定的±15分钟jitter。
- failure retry：5m → 30m → 2h → 6h cap；成功/304清零，不创建平行retry链。
- `stale=true`：有active snapshot且last successful check超过26h；无snapshot使用`available=false`而非stale。

### 200 activation

先在事务外从已验证payload构建immutable projection，保证该payload可服务。Activation事务：lock state row → 按content hash insert/deduplicate snapshot → 若active pointer切到不同snapshot（包括A→B→已存在A）则同时写`active_snapshot_id`与`active_activated_at=now()` → 把response ETag写入`state.validator_etag` → 更新checked/success/next/error/failure count → 完成attempt。若content hash与当前active相同但ETag改变，active pointer和`active_activated_at`均不变，只更新state validator并记`succeeded`；以后conditional request使用新ETag，避免重复200下载。任一步失败rollback，旧active/activeSince/validator不变。Commit后若active revision改变，`NOTIFY sage_provider_catalog_changed,<snapshotId>`。

### 304

更新attempt、last checked、last successful、next sync与failure count；保留active snapshot并继续使用已发送的`state.validator_etag`，不改变snapshot `fetched_at`且不插入大对象。若无active snapshot却收到304，视为protocol failure，清空state validator后进入retry。

### Multi-instance/cache

- Advisory lock用dedicated PG connection覆盖claim、完整fetch和activation，释放连接即自动解锁。
- Orphan recovery遵循deadline + successful lock；不能仅凭时间修改仍由活owner持有的attempt。
- DB `active_snapshot_id`是read/status唯一权威revision；ProjectionCache必须标注自己的snapshot ID。
- Activation前本owner已证明projection可构建；其他实例收到`NOTIFY`后从DB构建并原子swap，60s revision poll处理通知丢失。
- Read发现cache revision与DB active不一致时同步重建；成功后服务active，失败则503 `CATALOG_PROJECTION_UNAVAILABLE`并保留旧cache仅供后续恢复尝试，绝不把旧cache作为active response。Status返回DB active revision及本实例`projectionAvailable/projectionSnapshotId`，便于诊断。
- Snapshot GC不依赖旧cache；由于read不服务旧revision，删除active+前2之外版本不会破坏合法cursor，旧cursor会按active mismatch得到409。

## Runtime and readiness

`models.dev`不加入`/readyz`。Runtime生命周期：

1. migrate stores；load DB active snapshot并构建matching projection cache。
2. 创建manager/routes；启动background due check，不等待外部fetch。
3. shutdown第一步调用`manager.beginShutdown()`：原子进入closing、clear timer、拒绝manual并abort在途fetch。
4. 调用`app.close()`停止接受HTTP并等待现有request/SSE hook结束；closing窗口中的catalog manual route返回503 `CATALOG_SHUTTING_DOWN`。
5. 调用`manager.close()`：等待fetch settle、把本owner未完成attempt标`cancelled`、释放advisory/NOTIFY connection；该操作幂等且有bounded wait。
6. 关闭Temporal clients，再`Promise.allSettled`关闭Chat/Task/Catalog stores/pools。

实现和测试必须使用以上唯一顺序；异常启动清理走同一close helper，不留下detached timer、listener或promise。

## Failure Modes

| Failure | Likelihood | Impact | Mitigation |
|---------|------------|--------|------------|
| models.dev timeout/5xx | 中 | catalog变旧 | LKG、backoff、safe status；readiness不受影响 |
| decoded payload >16MiB | 低 | 内存/压缩炸弹 | streaming计数后abort，旧active不变 |
| schema drift/invalid JSON | 中 | 新snapshot拒绝 | tolerant unknown fields + strict required projection，整批rollback |
| redirect/host变化 | 低 | sync失败 | v1拒绝redirect；reviewed allowlist后再改 |
| 多实例同时due/manual | 中 | 重复下载/状态竞态 | partial unique active-attempt、state row、advisory lock、同一attempt复用 |
| process crash留下queued/running | 低 | UI误报/停止同步 | queued reclaim；deadline后取得lock才cancel running并retry |
| cache通知丢失/重建失败 | 中 | 单实例暂不可读catalog | 60s revision poll；request mismatch同步重建；失败503而非旧revision |
| 上游恶意文字/URL | 低 | XSS/误导 | React escaping、长度限制、https URL parse、不渲染HTML |
| DB activation失败 | 低 | sync attempt失败 | 单事务，保留LKG与旧validator |
| manual sync滥用 | 中 | 上游压力 | admin role、single-flight、completed check后60s最小间隔与429 |

## Rollout / Migration

1. Contracts + ordered migration + store integration tests。
2. Source client/validator with deterministic fixtures；不接live CI。
3. Snapshot store/projection/read APIs，先以manual启动验证LKG。
4. Sync manager、ETag/304、daily/startup/backoff、multi-instance lock。
5. Runtime shutdown/auth/status UI；最后开启automatic due scheduler。
6. 新增`platform/THIRD_PARTY_NOTICES.md`记录`sst/models.dev` MIT license/source URL；每个deterministic fixture header注明来源与裁剪/改写，若项目引入SBOM则同步登记。完整3.7MB payload不提交Git。

回滚automatic scheduler不删除active snapshot；read API可继续服务。Schema只additive，不drop old snapshot tables。

## Verification

- Fixture：200、304、无ETag、相同content hash但新ETag、unknown field、missing required field、invalid URL/JSON、oversize、timeout、redirect、HTTP错误。
- PostgreSQL：source bootstrap、partial unique queued/running、claim/orphan recovery、atomic pointer+validator、rollback、snapshot GC、two-manager lock。
- API：strict query/cursor/snapshot change、cache revision mismatch/build failure、no-snapshot、stale LKG、read/admin auth、queued/running manual幂等、60s rate limit、safe errors。
- Runtime：startup不阻塞ready、固定shutdown顺序、abort无dangling timer/promise。
- Live `models.dev`仅opt-in smoke并记录counts/ETag，不成为deterministic CI gate。

## Open Questions

无阻塞问题。Package名、jitter seed和safe error枚举可在proposal/tasks中固定，但不得改变global snapshot、LKG、fixed source、admin sync和readiness边界。

## Cross-References

- [`provider-profile-catalog-ux.md`](./provider-profile-catalog-ux.md)
- [`session-history-and-navigation.md`](./session-history-and-navigation.md)
- 下游：`/task-propose T0002`
