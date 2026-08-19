import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const root=new URL('..',import.meta.url).pathname;const read=(path)=>readFile(join(root,path),'utf8');
const [promotion,chat,chatMigration,pgImmutability,task,taskMigration,store,routing,api,ui,observability,e2e,worker,dashboard,alerts,agentDoc,appDoc,exit,manifest,workspace]=await Promise.all([
  read('apps/agent-api/src/promotion.ts'),read('packages/chat-domain/src/index.ts'),read('packages/chat-domain/migrations/001_chat.sql'),read('packages/chat-domain/src/p6-immutability.integration.test.ts'),
  read('packages/task-domain/src/index.ts'),read('packages/task-domain/migrations/001_task_store.sql'),read('packages/task-store-postgres/src/index.ts'),
  read('packages/temporal-routing/src/index.ts'),read('apps/agent-api/src/task-api.ts'),read('apps/agent-web/src/tasks.tsx'),read('packages/observability/src/index.ts'),
  read('examples/p6-integration/src/p6.e2e.test.tsx'),read('apps/agent-worker/src/activities.ts'),read('observability/grafana/sage-p6-cross-chain.json'),read('observability/prometheus/sage-p6-alerts.yaml'),read('../docs/design/agent-library-mvp.md'),read('../docs/design/long-running-agent-app-mvp.md'),
  read('docs/p6-exit-review.md'),read('examples/p6-integration/package.json').then(JSON.parse),read('package.json').then(JSON.parse)
]);
const failures=[];const require=(condition,message)=>{if(!condition)failures.push(message);};
require(promotion.includes('PromotionPrincipalAuthenticator')&&promotion.includes('authenticateRequest'),'promotion must use server-authenticated request principal');
require(!/request\.body\.(actor|roles)/.test(promotion),'promotion must never trust body actor/roles');
require(promotion.includes('PROMOTION_RULE_DISABLED')&&promotion.includes('rule.reason'),'restricted rules must be disableable and explainable');
require(chatMigration.includes('CHAT_TASK_ASSOCIATION_IMMUTABLE')&&chat.includes('reservePromotion'),'immutable Message-to-Task association missing');
require(chatMigration.includes('BEFORE UPDATE OR DELETE ON chat_task_associations')&&chatMigration.includes('CHAT_TASK_ASSOCIATION_DELETE_FORBIDDEN')&&chatMigration.includes('BEFORE UPDATE OR DELETE ON chat_promotion_audit')&&chatMigration.includes('CHAT_PROMOTION_AUDIT_APPEND_ONLY'),'PostgreSQL append-only/delete-deny triggers missing');
require(pgImmutability.includes("inspector.query('UPDATE chat_promotion_audit")&&pgImmutability.includes("inspector.query('DELETE FROM chat_promotion_audit")&&pgImmutability.includes("inspector.query('DELETE FROM chat_task_associations")&&pgImmutability.includes('task-retry-must-not-win'),'real PostgreSQL immutability/retry integration missing');
require(workspace.scripts['test:p6:e2e'].includes('p6-immutability.integration.test.ts'),'real PostgreSQL immutability test is not wired into test:p6:e2e');
require(promotion.includes('reserved.association.taskId')&&promotion.includes('reserved.association.inputRef'),'ambiguous retries must reuse association identity');
require(!/endpoint|namespace|taskQueue/.test(promotion.split('controller.create')[1]?.split(');')[0]??''),'promotion handoff must not send raw target');
for(const name of ['task_event_projection','task_projection_repair_audit','task_artifact_reference'])require(taskMigration.includes(name),`missing ${name}`);
require(task.includes('DEFAULT_PROJECTION_FRESHNESS_THRESHOLD_MS')&&store.includes('age_threshold_exceeded'),'freshness threshold/stale classification missing');
require(routing.includes('TaskProjectionReconciler')&&routing.includes('record.snapshot')&&routing.includes('fetchHistory'),'snapshot-bound History reconciler missing');
require(routing.includes('firstCursor===secondCursor')&&routing.includes('TEMPORAL_HISTORY_OBSERVATION_UNSTABLE'),'bounded stable H1/state/H2 observation missing');
require(observability.includes("'tenant_id','message_id','session_id','run_id','task_id','workflow_id','target_id'")&&routing.includes('message_id:input.messageId'),'complete tenant/message P6 correlation missing');
require(task.includes('historyEventId')&&task.includes('projectionSource')&&taskMigration.includes('history_event_id')&&store.includes("EXCLUDED.projection_source='history'"),'History cursor/authority monotonic projection CAS missing');
require(api.includes('TASK_HTTP_AUTH_CONFIGURATION_REQUIRED')&&api.includes('authenticateRequest'),'Task HTTP auth must fail closed and support verified session principal');
require(routing.includes('batchSize>500')&&store.includes('ON CONFLICT (tenant_id,task_id,source_event_id) DO NOTHING'),'bounded/idempotent reconciliation missing');
require(api.includes("'/v1/tasks'")&&api.includes("'/v1/tasks/:taskId/events'")&&api.includes('ARTIFACT_STORE_UNAVAILABLE'),'Task read/artifact APIs missing');
require(ui.includes('ProjectionFreshness')&&ui.includes('TaskList')&&ui.includes('controlAllowed'),'Task UI incomplete');
require(observability.includes('P6_CROSS_CHAIN_DASHBOARD')&&observability.includes('target-unavailable'),'Dashboard/alerts missing');
for(const scenario of ['NativeConnection.connect','Worker.create','createAgentTaskActivities','TemporalTaskHistorySource','reader.read()','INJECTED_P6_WORKER_RESTART_AFTER_COMMIT','setProjectionWritesEnabled(false)','artifactDown','127.0.0.1:1'])require(e2e.includes(scenario),`P6 real E2E scenario missing: ${scenario}`);
require(!e2e.includes('FakeTemporalTarget'),'P6 E2E must not use a fake Temporal target');
for(const metric of ['sage_chat_task_promotions_total','sage_task_route_decisions_total','sage_task_worker_attempt_total','sage_task_projection_lag_ms','sage_task_reconcile_retryable_failure_total','sage_artifact_store_unavailable_total','sage_temporal_target_unavailable_total'])require([promotion,routing,api,worker].some((source)=>source.includes(metric)),`P6 metric is not emitted by a business path: ${metric}`);
require(dashboard.includes('sage_task_projection_lag_ms')&&dashboard.includes('tenant_id,message_id')&&alerts.includes('SageTemporalTargetUnavailable')&&alerts.includes('tenant_id, message_id'),'deployable P6 dashboard/alerts with tenant/message correlation missing');
require(agentDoc.includes('P6 Requirements Traceability Matrix')&&appDoc.includes('P6 Requirements Traceability Matrix'),'product traceability matrices missing');
require(exit.includes('AI review')&&exit.includes('human production approval'),'AI review governance statement missing');
require(workspace.scripts['test:p6:e2e']&&workspace.scripts['check-p6-boundaries'],'root P6 scripts missing');
for(const [name,version] of Object.entries(manifest.dependencies))require(name.startsWith('@sage/')?version==='workspace:*':/^\d+\.\d+\.\d+$/.test(version),`P6 dependency not exact/workspace: ${name}@${version}`);
if(failures.length){console.error(failures.join('\n'));process.exit(1);}console.log('P6 promotion/projection/reconciliation/E2E/governance boundaries: OK');
