## 1. Contracts 与 ordered migrations

- [x] 1.1 在 `app-contracts` 定义并测试 `SessionHistoryItem`、list query/response、status/title filter、strict `additionalProperties=false`、opaque cursor error；明确 cursor 内含 PostgreSQL 六位微秒 `sortTime`、`sessionId` 与 `filterHash`，且是 continuation consistency 而非 strict snapshot（D2、D3、D4、D19）
- [x] 1.2 实现共享 ordered PostgreSQL migration runner与 `sage_schema_migrations(component, version, checksum_sha256, applied_at)`，使用显式manifest、dedicated connection、component advisory lock和checksum drift fail-fast（D6）
- [x] 1.3 将既有Chat migration纳入不可变manifest，新增幂等Chat history migration：tenant/status keyset indexes与仅处理`NULL`/精确`Local Sage Chat`的legacy title backfill；不得修改已发布SQL（D5、D6）
- [x] 1.4 新增Catalog component migration，创建global snapshot/state/attempt表、foreign key、content-hash uniqueness、每source唯一`queued|running` partial index，并bootstrap固定`models-dev` state与`next_sync_at=now()`（D7、D8、D22）
- [x] 1.5 定义并测试Catalog status/provider/model/page/attempt schemas、safe error codes、strict query/cursor contracts及text event可选`promotionEligibility`；attempt公开schema只允许`attemptId`、`trigger`、`status`、有界lifecycle timestamps与可选safe `errorCode`，未知ID为404 `CATALOG_SYNC_ATTEMPT_NOT_FOUND`，不得包含principal/authentication/owner/audit字段；保持既有Chat/Task request bodies拒绝provider、model、profile、base URL、API key、target、endpoint、namespace、actor和roles（D9、D17、D22）
- [x] 1.6 为ordered runner添加targeted tests：空库、顺序应用、重复运行、并发component、SQL成功后ledger重试和checksum drift；为Chat/Catalog manifests增加路径与checksum assertions（D6）

## 2. Chat store 与 API

- [x] 2.1 扩展Chat store，使省略title的session以SQL `NULL`创建，在首条persisted user message事务内派生code-point-safe title；runtime只更新`NULL`，不得覆盖任何未来显式title（包括`Local Sage Chat`）；实现latest safe text/artifact-label preview和`retentionEligibleAt`，禁止读取Artifact body（D2、D5）
- [x] 2.2 实现tenant-scoped `listSessions()` keyset query：`(updated_at DESC, session_id DESC)`、先限session page再lateral latest message、PostgreSQL六位微秒cursor、多取一条生成`nextCursor`及escaped title literal search（D2、D3、D4、D19）
- [x] 2.3 注册strict `GET /v1/chat/sessions` route与400 `CHAT_INVALID_REQUEST` mapping，支持默认30/最大100、`all|open|closed`、title-only `q`，不嵌入transcript/runs/summaries/message count；同时固定`POST /v1/chat/sessions`省略`title`时向store传递`NULL`语义且不注入server占位标题（D1、D2、D4、D5）
- [x] 2.4 添加Chat PostgreSQL integration tests：tenant isolation、open/closed、同timestamp ID tie-break、同毫秒不同微秒round-trip、稳定key无重复/跳项、并发create/update首屏refresh收敛、retention语义（D2、D3、D4、D19）
- [x] 2.5 添加title/preview store/API integration tests：New Chat无title创建SQL `NULL`、首条user text与title原子提交、未来显式title（含`Local Sage Chat`）保留、artifact-only label、Unicode截断、仅一次性migration处理精确legacy placeholder的例外与Artifact body不读取（D5）

## 3. Workspace interactions

- [x] 3.1 以T0001已同步主spec为依赖基线，删除`ensureChatSession()`首访自动创建；保留Vite dev/preview、可配置`/v1` proxy与built app entrypoint，实现裸`/` landing/history、分页/筛选/refresh，断言无session时零POST、显式New Chat恰好一次POST且request body不含`title`后canonical navigation；不得改变生产部署、API/Worker或其他runtime边界（D1）
- [x] 3.2 实现stale/deleted session recovery与closed session read-only；session 404不得静默替换、创建或reopen（D1、D4）
- [x] 3.3 从canonical session URL按“detail/status → persisted events → latest durable sequence SSE”恢复timeline并按sequence去重，覆盖history link、direct、refresh与Back/Forward（D1）
- [x] 3.4 生成user/assistant `promotionEligibility`，UI仅对`explicit` persisted user text显示CTA，历史缺字段fail-closed；server authorization、immutable association与strict promotion payload保持权威（D17）
- [x] 3.5 实现单一`workspaceHref()`和native full-page links，在Chat、Tasks、Providers、Task Card与All tasks间保留session，Task detail使用`?view=tasks&task=<id>`且不引入Router/popstate store（D16）
- [x] 3.6 将Task row改为唯一native anchor；每个Task URL以单一request token/AbortController加载一组detail/events/artifacts，旧task response不得commit，control成功只启动一个新group并防重复操作（D16）
- [x] 3.7 实现Composer Enter、Shift+Enter、IME composition、empty/submitting no-op、失败保留draft与StrictMode重复提交保护，并补targeted component tests
- [x] 3.8 将shell/Chat/Task状态文案改为中性且有作用域的事实，移除`API + Worker online`、`All systems operational`；Catalog状态不升级为Sage readiness，Task保留execution status与projection freshness（D18）
- [x] 3.9 修正responsive/a11y：`390×844` Task row持续显示Task ID、execution status、projection freshness且无横向溢出；history/native links/Composer具备focus、ARIA与reduced-motion可用性（D16）
- [x] 3.10 添加Workspace request-body与e2e targeted tests：URL组合/encoding/session preservation、Vite dev/preview及built app通过可配置`/v1` proxy工作、landing不POST、New Chat一次POST且无`title`字段、API/store创建`NULL` title、首条persisted user text后派生title、显式`Local Sage Chat`不覆盖、404 recovery、closed read-only、SSE resume、promotion fail-closed、Task单activation与竞态、IME和中性health文案（D1、D5、D16、D17、D18）

## 4. Catalog store、source 与 projection

- [x] 4.1 新建`@sage/provider-catalog`模块及PostgreSQL store，实现deployment-global snapshot/state/attempt访问、active pointer权威读取与authenticated workspace read边界（D7、D8）
- [x] 4.2 实现tolerant payload validator、SHA-256/counts与immutable whitelist projection：严格critical provider/model字段和map key、容忍unknown fields、只投影合法HTTPS URL，browser不可获取raw JSONB（D9）
- [x] 4.3 实现provider/model搜索排序、strict filters、snapshot/filter-bound cursor和每request DB active revision检查；cache mismatch同步重建并atomic swap，失败返回503 `CATALOG_PROJECTION_UNAVAILABLE`而不服务旧cache，补`NOTIFY`与60s revision poll（D21）
- [x] 4.4 实现activation transaction、LKG与GC：active + 前2、304不建snapshot、same-hash/new-ETag只更新state validator、失败保留旧validator/pointer、A→B→A更新state `active_activated_at`但保留snapshot `first_activated_at`（D11、D20、D26）
- [x] 4.5 实现固定`https://models.dev/api.json` source client：空body、state `If-None-Match`、通用User-Agent、`redirect:'error'`、20s timeout、解压stream 16MiB cap、2xx/304和JSON content type校验，绝不发送用户数据
- [x] 4.6 添加deterministic source/validator/projection tests：200、304、无ETag、same hash/new ETag、unknown field、missing/mismatched required field、invalid JSON/URL、timeout、oversize、redirect、HTTP/content-type错误和model URL覆盖provider URL（D9、D13、D20）
- [x] 4.7 添加Catalog PostgreSQL integration tests：bootstrap、atomic pointer+validator、rollback LKG、snapshot dedupe/GC、A→B→A activeSince、active-only cache mismatch/rebuild failure、snapshot cursor 409、no-snapshot与stale LKG（D7、D8、D11、D20、D21、D26）

## 5. Catalog sync、routes 与 runtime lifecycle

- [x] 5.1 实现persisted enqueue与single-flight coordinator：state row lock、existing attempt复用、partial unique constraint、dedicated advisory connection、CAS `queued→running` owner/start/deadline claim（D22）
- [x] 5.2 实现orphan recovery：queued超过60s可重试claim；running超过deadline仅在取得同一advisory lock后标`cancelled/SYNC_OWNER_LOST`并通过正常enqueue建立retry（D22）
- [x] 5.3 实现startup/no-snapshot/stale/due后台enqueue、成功后24h加source-derived±15分钟jitter、5m→30m→2h→6h retry chain、成功/304清零和`stale>26h`语义（D10）
- [x] 5.4 注册authenticated status/providers/models/sync-attempt routes与strict query/error mapping；attempt status对authenticated read principal返回有界safe projection，unknown ID稳定404，序列化层明确排除`principal_id`、`authentication_id`、`owner_id`及内部audit字段；read只服务DB active page，cursor revision变化409，无snapshot/重建失败503，有stale LKG仍200（D9、D21、D22）
- [x] 5.5 注册manual sync POST和独立`provider-catalog-admin` authorization，local principal显式加入该role；复用running attempt，最近completed check不足60s返回429与bounded retry，禁止复用`task-operator`（D12、D22）
- [x] 5.6 按唯一顺序接入`createApiRuntime()`：migrate/load projection → manager/routes/background due；shutdown严格执行`manager.beginShutdown()` abort/拒绝manual → `app.close()` → `manager.close()` settle/cancel/release → Temporal clients → `Promise.allSettled` stores/pools，Catalog不得进入`/readyz`（D23）
- [x] 5.7 添加sync manager/API/runtime targeted tests：多实例同一attempt与单fetch、CAS失败、queued/running orphan、manual 60s/admin/read auth、authenticated attempt read、bounded safe response、unknown attempt 404、principal/authentication/owner/audit字段零泄露、24h+jitter/retry、200/304/LKG、safe status、startup不阻塞ready、closing 503、abort与固定shutdown调用顺序（D10、D12、D20、D22、D23）
- [x] 5.8 运行双manager PostgreSQL integration，验证partial unique + advisory lock跨实例single-flight、owner crash/deadline recovery、NOTIFY丢失poll和无detached timer/listener/promise（D21、D22、D23）

## 6. Provider profile UX

- [x] 6.1 将Local Pi从profile list移出并只读呈现为唯一`System runtime · In use`；external profile只使用Disabled/Incomplete/Available metadata且不改变Local PiHarness assembly（D14）
- [x] 6.2 定义严格`ProviderProfileV2` loader/writer与`sage.provider-profiles.v2`，metadata只进`localStorage`；API key和presence只由当前tab `sessionStorage`实时派生，禁止持久化`apiKeyConfigured`并在保存后清空secret draft（D15）
- [x] 6.3 实现v1→v2安全migration：优先合法v2、保留v1 rollback key、非法storage不覆盖、所有legacy `kind='local'`隔离、incomplete enabled降级、fresh browser无默认external profile（D25）
- [x] 6.4 实现provider/model combobox：250ms debounce、abort/token/snapshot guard、keyboard/ARIA、provider-scoped model、deprecated/legacy默认隐藏、409 reload和catalog unavailable/stale状态（D13）
- [x] 6.5 实现source-only mapping与provenance：provider/model ID/name、同page snapshot/activeSince、`model.provider.api ?? provider.api`、manual/none、不猜endpoint、不从`npm`推断adapter、不由daily sync改写已保存profile（D13）
- [x] 6.6 实现`idle|creating|editing|saving`状态机与Cancel/name-dirty规则；`enabled`仅为availability intent，URL adapter缺合法HTTPS URL时拒绝enabled save但允许disabled draft，`unassigned`明确不可执行（D24）
- [x] 6.7 添加profile targeted tests：valid/invalid v1/v2、所有legacy local隔离、secret同tab/新tab、create/edit/Cancel、provider change清理、debounce/abort/ARIA、snapshot 409、URL precedence/none/manual、enabled规则与daily不自动改写（D13、D14、D15、D24、D25）
- [x] 6.8 添加payload/assembly negative tests，断言选择任意profile后Chat submit/retry/promotion与Task create/signal/cancel/retry均不含provider、model、profile、base URL、API key、target、actor或roles，且执行仍装配Local PiHarness

## 7. Attribution、集成验证与 browser smoke

- [x] 7.1 在允许的实现阶段资产中补充`sst/models.dev` MIT license/source attribution；每个裁剪fixture注明来源与裁剪/改写，不提交完整约3.7MiB live payload，若项目已有SBOM则同步登记
- [x] 7.2 运行并修复本变更全部targeted contract/store/API/runtime/Web tests及相关既有Chat、promotion、Task regression suites
- [x] 7.3 在真实PostgreSQL运行ordered migration、Chat history/title/preview和Catalog snapshot/single-flight/cache/shutdown integration suites，记录通过结果
- [x] 7.4 运行workspace typecheck与build并修复所有受影响package错误；确认本地Web仍支持Vite dev/preview、可配置`/v1` proxy与built app，生产/runtime边界未扩张，且Catalog失败不改变`/livez`或`/readyz`
- [x] 7.5 执行desktop browser smoke：landing/history分页、New Chat、session-preserving Chat↔Tasks↔Providers、direct/refresh/Back/Forward、IME/promotion、Task controls、Catalog manual/status和profile selector；确认无console error
- [x] 7.6 执行`390×844` browser smoke：history、Task ID/status/freshness、Provider selectors/editor、error/stale/unavailable状态、keyboard/focus与无横向溢出；保存验证证据
- [x] 7.7 提供显式opt-in live `models.dev` smoke，验证固定URL、counts、ETag/304和projection但不作为deterministic CI gate；默认CI只运行小型fixtures
