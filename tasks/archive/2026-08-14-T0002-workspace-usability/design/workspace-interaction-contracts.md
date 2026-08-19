# Workspace 交互契约设计

> 用统一native URL builder和资源级capability修复Chat、Tasks、Providers之间的上下文、键盘、竞态与状态表达；不引入Router，也不扩大后端payload或真实runtime能力。

## Context

- **Problem**：nav丢session；Task row的article/button双handler产生重复请求；Composer提示Enter发送但未实现IME-safe行为；assistant text也显示必败promotion；shell静态声称全局健康。
- **Stakeholders**：桌面/移动Workspace用户、Chat/Task API维护者、无障碍与测试维护者。
- **Success criteria**：URL刷新/Back/Forward一致；一次语义激活只触发一次详情加载；promotion CTA不骗人；390px保留关键状态；状态文案不超出证据。
- **Constraints**：原生full-page navigation已确认；Local Pi固定；不得向request添加target/provider/actor/roles。
- **Out of scope**：SPA Router、跨页面共享client store、API+Worker health aggregation、通知中心/账号菜单实现。

## Options Considered

| Option | Cost | Risk | Reversibility | Time | Complexity |
|--------|------|------|---------------|------|------------|
| A. 保持组件state + click handler | 低 | 高：URL漂移、重复激活、不可分享 | 高 | 短 | 低 |
| B. 引入React Router与SPA data router | 中 | 中：当前小应用迁移面扩大 | 高 | 中 | 中 |
| C. 统一URL builder + native links/full reload | 低 | 低：浏览器语义可靠 | 高 | 短 | 低 |

**推荐：方案 C。** 它满足用户已确认决策，并让刷新、直接链接和Back/Forward自然一致。

接受的取舍：workspace切换会重新加载页面和数据；T0002不优化SPA缓存。回退只需恢复旧href，但不建议撤回canonical URL契约。

## Architecture

```text
                  canonical URL is source of truth
┌───────────────┐ native <a>  ┌───────────────┐ native <a>  ┌──────────────┐
│ Chat          │─────────────>│ Tasks         │─────────────>│ Providers    │
│ ?session=s    │              │ ?view=tasks   │              │ ?view=...    │
│ timeline/SSE  │<─────────────│ &task=t       │<─────────────│ &session=s   │
└──────┬────────┘ preserve s   └──────┬────────┘ preserve s   └──────────────┘
       │                              │
       ▼                              ▼
promotionEligibility           request token/abort
IME-safe submit                 one detail load group
```

## Canonical URL model

```ts
type WorkspaceLocation = {
  view: 'chat' | 'tasks' | 'providers';
  sessionId?: string;
  taskId?: string;
};
```

Canonical forms：

- Chat landing：`/`
- Chat session：`/?session=<sessionId>`
- Task list：`/?view=tasks[&session=<sessionId>]`
- Task detail：`/?view=tasks&task=<taskId>[&session=<sessionId>]`
- Providers：`/?view=providers[&session=<sessionId>]`

统一`workspaceHref()`负责encode与合法组合：

- 非tasks view丢弃`task`。
- 进入Tasks/Providers时保留当前`session`；没有session的direct URL仍可用。
- Brand/Home默认到landing `/`，不能隐式创建session。
- Chat nav在有session时回到该session；无session时到landing。
- Task detail的“All tasks”和Chat Task Card保留session。
- 参数顺序固定便于测试，但语义不依赖顺序。

不注册`popstate`监听：full-page navigation由浏览器重新boot并从URL恢复。

## Chat promotion eligibility

扩展text timeline payload：

```ts
type TextTimelinePayload = {
  kind: 'text';
  text: string;
  messageId?: string;
  promotionEligibility?: 'explicit' | 'none';
};
```

- 新persisted user text event：`explicit`。
- assistant text event：`none`。
- artifact/tool/error/run/task：无该字段。
- 历史event缺字段按`none`，fail-closed。
- UI只有`messageId && promotionEligibility==='explicit'`时显示Promote。
- 这是展示capability，不替代server authorization；后端仍验证persisted user message与principal。
- Promotion body仍严格只有`mode/taskType/ruleId`；actor、roles、provider、model、target、endpoint、namespace全部拒绝。

若同一user message已有关联Task，可由现有task event替代CTA或使CTA进入idempotent结果；不在客户端伪造关联状态。

## Composer state machine

```text
idle(empty) ──type──> ready
ready ──Enter(non-composing) / click──> submitting
ready ──Shift+Enter / composing Enter──> ready(with newline/IME input)
submitting ──success──> idle(empty)
submitting ──failure──> ready(text retained + error)
```

Keyboard contract：

- `keydown Enter`且`!shiftKey && !nativeEvent.isComposing`：`preventDefault()`并请求一次form submit。
- `Shift+Enter`：不拦截，插入换行。
- `isComposing`或composition lifecycle未结束：Enter不提交。
- empty/whitespace、submitting时click与Enter均no-op；button disabled只是辅助，handler仍检查。
- 成功后清空；失败保留原文供重试。
- quick prompt只填draft并focus，不自动发送。

需测试React StrictMode下不会因effect或event路径重复POST。

## Task activation and request consistency

### Semantic markup

Task row只保留一个原生`<a href="canonical task URL">`作为详情激活；移除article`onClick`和嵌套button。这样鼠标、键盘、open-in-new-tab共用浏览器语义且一次activation只发生一次navigation。

### Detail loading

每次boot到task URL，生成`requestToken`和一个AbortController，并行加载：

```text
GET /v1/tasks/:id
GET /v1/tasks/:id/events
GET /v1/tasks/:id/artifacts
```

只有token仍是current且三项属于同一taskId时commit UI。新selection/refresh/unmount abort旧group；不能让旧response覆盖新URL。若一项失败，保留当前已提交详情，显示有作用域的error并允许整组retry；不拼接不同revision的半旧数据。

Control成功后发起一个新的detail group加list refresh；busy期间同一control no-op。不得因control refresh再绑定第二个row click。

## Chat resumption

打开session URL时：

1. 先确认session detail存在并读取status。
2. 加载persisted events `afterSequence=0`。
3. 以最后durable sequence连接SSE。
4. event按sequence deduplicate。
5. detail/events为404时进入recovery，不创建替代session。

现有`chat-event-resumption`的“strictly after afterSequence”保持不变；history只改变如何选session。

## Mobile and accessibility

在`390×844`：

- Task row必须可见Task ID、execution status、projection freshness；target/namespace可降级到detail，不得隐藏status。
- History/Provider selector不产生横向滚动；主要action有至少可用touch target。
- Native links可获得focus、上下文菜单和新tab能力；不可用div模拟。
- Composer label、combobox/listbox、status/error使用适当ARIA；动态timeline保持`aria-live`但避免重复announce。
- reduced-motion设置下不依赖动画表达loading/status。

## Status vocabulary

| Surface | Allowed | Forbidden claim |
|---------|---------|-----------------|
| Sidebar | `Local runtime`、`Development mode` | `API + Worker online`（无聚合证据） |
| Topbar | `Local workspace`或移除全局状态 | `All systems operational` |
| Chat | `Connecting / Live stream connected / Reconnecting` | 把SSE连接称为系统健康 |
| Provider | `Local Pi runtime · In use`、profile Available/Disabled | 外部profile Active/Running |
| Catalog | available/stale/unavailable + last checked | 把catalog stale升级为Sage not ready |
| Task | persisted status + projection freshness | 用target/profile状态替代execution status |

## Interfaces and payload invariants

```text
Chat submit:    { parts }
Chat promotion: { mode, taskType?, ruleId? }
Task signal:    { kind }
Task cancel:    {}
Task retry:     {}
```

所有schema保持`additionalProperties=false`。Provider/catalog/profile只影响配置页面，不加入这些body。Local principal identity来自server-verified session/runtime config，不从body接收。

## Failure Modes

| Failure | Likelihood | Impact | Mitigation |
|---------|------------|--------|------------|
| link漏传session | 中 | 返回Chat上下文丢失 | 单一`workspaceHref`及全链接contract tests |
| Task双handler | 高（现状） | 重复3请求/竞态 | 单一native anchor，无父级click |
| 旧detail response覆盖 | 中 | URL与内容不一致 | abort + requestToken + taskId commit guard |
| IME Enter误提交 | 中 | 文本截断/误发 | composition-aware keydown tests |
| 双击/StrictMode重复POST | 中 | 重复消息/操作 | submitting/busy guard与调用次数断言 |
| assistant promotion必败 | 高（现状） | 死路 | eligibility explicit-only，历史fail-closed |
| 全局health虚假 | 高（现状） | 用户误判 | 中性、有作用域的状态词汇表 |
| stale session静默替换 | 中 | 用户以为数据丢失 | recovery state，不POST create |

## Rollout / Migration

1. 增加URL builder与contract tests；将所有nav/task links替换为native canonical href。
2. Task row语义化并增加request group token/abort。
3. Contract/store产生`promotionEligibility`，UI历史fail-closed。
4. Composer keyboard/IME/submitting状态机。
5. Shell/Provider/Task mobile文案和布局修正。
6. Browser smoke覆盖直接URL、refresh、Back/Forward、390×844和console。

这些改变可分片上线，但在删除auto-create前必须先有history landing；在隐藏旧promotion CTA前server eligibility需可用或客户端按缺失fail-closed。

## Verification Matrix

| Area | Required checks |
|------|-----------------|
| URL | 每个view/session/task组合、encode、brand/home、direct、refresh、Back/Forward |
| Composer | Enter、Shift+Enter、IME、empty、double click、failure retains text |
| Promotion | user explicit显示；assistant/legacy隐藏；strict body；server auth仍拒绝非法source |
| Tasks | single anchor activation、恰好一组3请求、abort/old response、control refresh |
| Status | 禁止旧全局claim；SSE/catalog/task状态作用域正确 |
| Mobile/a11y | 390×844 status+freshness、无overflow、keyboard/focus/ARIA |
| Boundary | Chat/Task payload无provider/model/baseUrl/apiKey/target override |

## Open Questions

无阻塞问题。若未来希望SPA切换，应另行评估Router/data cache并保持本文canonical URL，不应回退到隐藏组件state。

## Cross-References

- [`session-history-and-navigation.md`](./session-history-and-navigation.md)
- [`provider-profile-catalog-ux.md`](./provider-profile-catalog-ux.md)
- 主规格：`openspec/specs/chat-event-resumption/spec.md`、`openspec/specs/chat-to-task-promotion/spec.md`
- 下游：`/task-propose T0002`
