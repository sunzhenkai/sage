## ADDED Requirements

### Requirement: PostgreSQL global Catalog snapshot 与 LKG
系统 SHALL 将Provider/Model Catalog作为deployment-global公共metadata持久化为PostgreSQL JSONB snapshot，并 SHALL以`provider_catalog_state.active_snapshot_id`作为唯一权威active revision。Snapshot SHALL保存source、ETag观察值、content SHA-256、raw tolerant payload、counts、fetched time与`first_activated_at`；state SHALL保存当前pointer的`active_activated_at`、权威`validator_etag`与同步metadata。系统 SHALL保留active + 前2个成功snapshot，并在失败时继续服务last-known-good active snapshot。

#### Scenario: 首次有效snapshot原子激活
- **WHEN**source返回通过validation且projection可构建的新content
- **THEN**snapshot、active pointer、validator、state与attempt在单一transaction中提交，read随后可服务该revision

#### Scenario: Activation rollback保留LKG
- **WHEN**snapshot activation任一步发生DB错误
- **THEN**transaction回滚，旧active snapshot、activeSince与validator保持不变

#### Scenario: Snapshot retention
- **WHEN**成功snapshot数量超过active + 前2个版本
- **THEN**GC只删除非active旧版本，且不把GC与active pointer transaction合并为不可恢复动作

#### Scenario: A到B再到A
- **WHEN**active content从A切到B后再次切回已存在的A
- **THEN**系统复用A snapshot row、保留其`first_activated_at`，并将state `active_activated_at`更新为本次pointer切换时间

### Requirement: 固定且有界的 models.dev source client
Source client SHALL只请求编译期固定的`https://models.dev/api.json`，request body为空，仅发送通用User-Agent和state validator对应的`If-None-Match`；SHALL使用`redirect:'error'`、20s timeout和解压后16MiB streaming cap，只接受2xx/304与JSON content type。Sync request SHALL NOT发送profile、secret、Chat内容或用户搜索词。

#### Scenario: Redirect被拒绝
- **WHEN**source响应redirect
- **THEN**client不跟随新host并以safe redirect error结束attempt，LKG保持可用

#### Scenario: Decoded payload超限
- **WHEN**解压后的response stream超过16MiB
- **THEN**client立即abort并记录bounded safe error，不parse或激活部分payload

#### Scenario: Timeout或HTTP错误
- **WHEN**fetch超过20s或返回不接受的HTTP/content type
- **THEN**attempt失败并进入bounded retry，active LKG与Sage readiness不变

#### Scenario: 无用户数据外发
- **WHEN**执行startup、daily或manual sync
- **THEN**outbound request不包含provider profile、API key、Chat/Task内容或browser query

### Requirement: Tolerant validation 与 whitelist projection
Ingest SHALL要求root为object，provider/model的key、id、非空name与models结构合法且相互一致；已使用字段的非法类型/长度 SHALL整批拒绝，未知字段 SHALL保留在raw JSONB但不进入public contract。只有可解析的`https:` URL SHALL进入projection；browser SHALL只接收bounded whitelist provider/model pages，不接收raw snapshot。

#### Scenario: Unknown upstream fields
- **WHEN**payload增加未知但不影响required projection的字段
- **THEN**validation接受payload、raw snapshot保留字段，public response保持schema稳定

#### Scenario: Critical schema drift
- **WHEN**provider/model required id、name、map key或类型无效
- **THEN**整批snapshot被拒绝且旧active保持不变

#### Scenario: URL projection
- **WHEN**model override URL与provider URL均存在
- **THEN**`effectiveBaseUrl`使用有效的model `provider.api`，否则使用有效provider `api`，非法或非HTTPS URL不进入projection

### Requirement: ETag validator 与 200/304 语义
`provider_catalog_state.validator_etag` SHALL是下一次conditional request的唯一权威validator。304 SHALL只更新attempt、checked/success/next-sync与failure count，不创建snapshot、不改变active pointer或snapshot fetched time。200同content hash但新ETag SHALL更新state validator与成功metadata，不复制snapshot且不改变`active_activated_at`。

#### Scenario: 304保留snapshot
- **WHEN**有active snapshot且source对当前validator返回304
- **THEN**系统标记attempt为`not_modified`、安排下一次daily check，并保留active snapshot与validator

#### Scenario: 无active时收到304
- **WHEN**数据库没有active snapshot但source返回304
- **THEN**系统将其视为protocol failure，清除state validator并安排retry

#### Scenario: Same hash with new ETag
- **WHEN**source返回200、content hash等于current active但ETag变化
- **THEN**系统不插入payload副本、不移动active pointer，只更新`validator_etag`并记`succeeded`

### Requirement: Active-only projection 与 snapshot-bound pagination
Provider/model read API SHALL只服务与DB active revision一致的immutable ProjectionCache。每个request SHALL先比较cache与DB revision；不一致时同步重建并atomic swap，重建失败 SHALL返回retryable 503 `CATALOG_PROJECTION_UNAVAILABLE`且不得返回旧cache。Page SHALL包含`schemaVersion`、`snapshotId`、state `activeSince`、items和可选cursor；cursor SHALL绑定snapshot、sort key与filter hash，active变化后 SHALL返回409 `CATALOG_CURSOR_SNAPSHOT_CHANGED`。

#### Scenario: Cache revision mismatch成功重建
- **WHEN**read发现cache snapshotId与DB active不同且active payload可构建
- **THEN**request同步重建并只返回DB active revision的page

#### Scenario: Cache rebuild失败
- **WHEN**active payload的projection重建失败
- **THEN**API返回503 `CATALOG_PROJECTION_UNAVAILABLE`，旧cache仅保留供恢复且不作为response

#### Scenario: 无snapshot与stale LKG
- **WHEN**无active snapshot
- **THEN**read返回503 `CATALOG_UNAVAILABLE`；有matching LKG但last success超过26h时仍返回200并标记stale

#### Scenario: Snapshot变化后的旧cursor
- **WHEN**client在active snapshot变化后继续使用旧cursor
- **THEN**API返回409，browser从新snapshot第一页重新加载而不混合两个revision

### Requirement: Catalog read 与 status API
系统 SHALL提供authenticated `GET /v1/provider-catalog/status`、`GET /v1/provider-catalog/providers`、`GET /v1/provider-catalog/models`与`GET /v1/provider-catalog/sync/:attemptId` routes。Read query SHALL默认`limit=30`、最大100，`q`最多100 code points，并严格校验filter与额外字段；provider SHALL按normalized name/id排序，model SHALL按status rank/normalized name/id排序。Status SHALL只返回safe source、counts、checked/success/stale/attempt/error与本实例projection诊断。已知attempt SHALL返回有界公开projection，且只包含`attemptId`、`trigger`、`status`、有界lifecycle timestamps与可选safe `errorCode`；response SHALL NOT包含principal、authentication、owner、response body、stack或内部audit字段。未知attempt ID SHALL返回404 `CATALOG_SYNC_ATTEMPT_NOT_FOUND`，不得以空对象、其他attempt或权限错误掩盖not-found语义。

#### Scenario: Authenticated global read
- **WHEN**authenticated workspace principal读取Catalog
- **THEN**API返回global active snapshot的whitelist page，不因global数据而允许匿名访问

#### Scenario: Model filter与默认隐藏状态
- **WHEN**client按provider、query、status或capability请求models
- **THEN**API严格应用filter；UI可默认排除deprecated/legacy并通过显式filter包含它们

#### Scenario: Safe status
- **WHEN**最近sync失败但LKG存在
- **THEN**status返回safe error code与stale/check metadata，不回显response body、stack、secret或不必要attempt identity

#### Scenario: Authenticated attempt status read
- **WHEN**authenticated workspace principal读取一个已知sync attempt
- **THEN**API返回bounded safe attempt projection，且不泄露`principal_id`、`authentication_id`、`owner_id`、response body、stack或内部audit字段

#### Scenario: Unknown attempt ID
- **WHEN**authenticated workspace principal读取不存在或格式合法但未知的attempt ID
- **THEN**API返回404 `CATALOG_SYNC_ATTEMPT_NOT_FOUND`，且response不包含任何其他attempt或内部identity/audit信息

### Requirement: Persisted single-flight attempt coordination
数据库 SHALL以partial unique constraint保证每个source最多一个`queued|running` attempt。Enqueue SHALL在transaction中bootstrap/锁定source state、复用existing active attempt或插入唯一queued attempt；coordinator SHALL使用dedicated PG advisory lock与compare-and-set claim为running。Queued orphan与running deadline recovery SHALL持久化，且running attempt只有取得同一advisory lock后才能标记`cancelled/SYNC_OWNER_LOST`。

#### Scenario: 并发manual与daily enqueue
- **WHEN**多个实例同时对同一source触发manual、startup或daily
- **THEN**所有调用观察或返回同一queued/running attempt，只有一个owner执行fetch

#### Scenario: CAS claim
- **WHEN**coordinator取得source advisory lock并claim queued attempt
- **THEN**它仅在status仍为queued时写入owner、started/deadline并转为running

#### Scenario: Queued orphan recovery
- **WHEN**queued attempt超过60s仍无人claim
- **THEN**任一scheduler可重试claim，但不创建平行active attempt

#### Scenario: Running orphan recovery
- **WHEN**running attempt超过deadline
- **THEN**只有成功取得同一advisory lock的实例可将其cancelled并通过正常enqueue创建retry，不能仅凭时间终止活owner

### Requirement: Startup、daily、retry 与 manual policy
Migration SHALL bootstrap固定`models-dev` source并令首次`next_sync_at=now()`。Startup在no snapshot、due或last successful check超过24h时 SHALL后台enqueue且不阻塞listen/readiness。成功/304后 SHALL按24h加source-derived确定性±15分钟jitter安排下一次；失败 SHALL按5m、30m、2h、6h cap retry。Manual SHALL与daily共用single-flight；无active attempt且距最近completed check不足60s时 SHALL返回429与bounded `retryAfterSeconds`。

#### Scenario: Startup due后台执行
- **WHEN**API启动且source no snapshot或due
- **THEN**manager在后台enqueue attempt，API可先完成listen/readiness

#### Scenario: 24小时加jitter
- **WHEN**sync成功或304
- **THEN**`next_sync_at`被设置为successful check后24h加由source ID稳定决定的±15分钟jitter，并清零failure count

#### Scenario: Bounded retry chain
- **WHEN**连续sync失败
- **THEN**系统依次安排5m、30m、2h、6h cap且不创建平行retry链，成功后重置

#### Scenario: Manual 60秒限流
- **WHEN**没有active attempt但最近completed check距当前不足60s
- **THEN**manual route返回429 `CATALOG_SYNC_RATE_LIMITED`与bounded `retryAfterSeconds`

### Requirement: Manual sync 独立授权
Manual sync SHALL只允许具有`provider-catalog-admin` role的principal，local runtime principal SHALL显式拥有该role且不得复用`task-operator`。Authorized POST SHALL返回202 `{attemptId,status}`并复用existing attempt；attempt route SHALL避免回显不必要identity/audit字段。

#### Scenario: 非admin手动同步
- **WHEN**authenticated read principal缺少`provider-catalog-admin`并POST sync
- **THEN**API拒绝请求且不enqueue attempt

#### Scenario: Local admin手动同步
- **WHEN**local principal以显式`provider-catalog-admin`执行manual sync
- **THEN**API返回202与唯一attempt id，但此能力不被描述为production authentication完成

### Requirement: Catalog lifecycle 与 readiness隔离
Catalog source可用性 SHALL NOT进入`/readyz`。Shutdown SHALL严格执行：`manager.beginShutdown()`进入closing、clear timer、拒绝manual并abort在途fetch；`app.close()`停止HTTP并等待request/SSE hooks；`manager.close()` bounded settle、cancel本owner attempt并释放advisory/NOTIFY connection；然后关闭Temporal clients并以`Promise.allSettled`关闭Chat/Task/Catalog stores/pools。该流程 SHALL幂等并用于异常启动清理。

#### Scenario: Catalog上游不可用不影响readyz
- **WHEN**models.dev timeout或Catalog无snapshot
- **THEN**Catalog status/read反映unavailable，但Sage `/readyz`不因外部source失败

#### Scenario: Closing期间manual sync
- **WHEN**`beginShutdown()`后收到manual sync request
- **THEN**route返回503 `CATALOG_SHUTTING_DOWN`且不创建attempt

#### Scenario: 固定shutdown顺序
- **WHEN**API收到shutdown signal
- **THEN**manager closing/abort先于Fastify close，manager settle/release先于其余stores/pools关闭，且无detached timer、listener或promise
