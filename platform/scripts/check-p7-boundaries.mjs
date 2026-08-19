import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
const root=new URL('..',import.meta.url).pathname;const read=(path)=>readFile(join(root,path),'utf8');
const [admission,api,admissionTest,ports,fakes,toolRuntime,routing,worker,chatSql,taskSql,scanner,alerts,dashboard,decisions,dataOps,workerRunbook,incident,goNoGo,trace,workspace]=await Promise.all([
  read('apps/agent-api/src/pilot-admission.ts'),read('apps/agent-api/src/task-api.ts'),read('apps/agent-api/src/pilot-admission.p7.test.ts'),read('packages/platform-ports/src/index.ts'),read('packages/local-fakes/src/index.ts'),read('packages/tool-runtime/src/index.ts'),read('packages/temporal-routing/src/index.ts'),read('apps/agent-worker/src/activities.ts'),read('packages/chat-domain/migrations/001_chat.sql'),read('packages/task-domain/migrations/001_task_store.sql'),read('scripts/p7/fixture-scanner.mjs'),read('observability/prometheus/sage-p7-alerts.yaml'),read('observability/grafana/sage-p7-production-pilot.json'),read('docs/p7-production-readiness-decisions.md'),read('docs/p7-data-operations.md'),read('docs/p7-worker-versioning-runbook.md'),read('docs/p7-incident-runbooks.md'),read('docs/p7-go-no-go.md'),read('docs/p7-traceability.md'),read('package.json').then(JSON.parse)
]);
const failures=[];const require=(condition,message)=>{if(!condition)failures.push(message);};
for(const token of ['ExternalPilotApprovalProvider','ExternalHumanApprovalVerifier','identityType !== \'human\'','approver_separation_required','REQUIRED_P7_EXERCISES','approval_record_missing'])require(admission.includes(token),`admission verification missing: ${token}`);
require(api.includes("deploymentMode==='pilot'")&&api.includes('pilotAdmissionGate.assertApproved()')&&api.includes('TASK_ACCESS_AUDIT_UNAVAILABLE'),'pilot Task create is not admission/audit fail-closed');
require(admissionTest.includes('creates).toBe(0)')&&admissionTest.includes("identityType: 'service'")&&admissionTest.includes('preserves development routes'),'pilot admission adversarial tests missing');
require(ports.includes('CredentialProvider')&&routing.includes('resolveCredential')&&worker.includes('sage_task_effect_unknown_total'),'provider-only credentials or effect_unknown metric missing');
require(toolRuntime.includes("'sage_tool_effect_unknown_total'")&&toolRuntime.includes("{ component: 'tool-runtime', outcome: 'unknown', duplicate: result.duplicate === true }")&&toolRuntime.includes('correlation: call.correlation')&&alerts.includes('increase(sage_tool_effect_unknown_total[5m]) or increase(sage_task_effect_unknown_total[5m])'),'Tool effect_unknown bounded metric/event correlation or single-source alert union missing');
require(fakes.includes('stored.value.slice()')&&fakes.includes('environment: Environment'),'credential rotation/scope fake missing');
require(chatSql.includes('sage.tenant_deletion_request_id')&&taskSql.includes('tenant_deletion_audit')&&taskSql.includes('TENANT_DELETION_AUDIT_APPEND_ONLY'),'controlled tenant deletion/audit missing');
require(scanner.includes('malformed reference')&&scanner.includes('secret-like value'),'fixture scanner controls missing');
for(const alert of ['SagePilotRoutingFailure','SagePilotTargetClusterUnavailable','SagePilotTaskQueueBacklog','SagePilotActivityRetry','SagePilotProjectionLag','SagePilotEffectUnknown','SagePilotProjectionDrift'])require(alerts.includes(alert),`missing alert ${alert}`);
for(const field of ['task_id','workflow_id','target_id','attempt','run_id','tool_call_id'])require(alerts.includes(field)&&dashboard.includes(field),`alert/dashboard correlation missing ${field}`);
require((alerts.match(/responder_service: sage-pilot-primary-oncall/g)??[]).length===7&&(alerts.match(/runbook_url:/g)??[]).length===7,'every alert must route to responder service and runbook');
require(decisions.includes('UNFILLED — HUMAN INPUT REQUIRED')&&decisions.includes('BLOCKED — neither remediated nor accepted'),'honest SPOF/RTO/RPO ledger missing');
require(dataOps.includes('postgres-tenant-delete.sh')&&dataOps.includes('CredentialProvider')&&dataOps.includes('RLS'),'data/tenant/credential procedure incomplete');
require(workerRunbook.includes('v1')&&workerRunbook.includes('v2')&&workerRunbook.includes('patched(')&&workerRunbook.includes('nondeterminism'),'Worker compatibility/determinism procedure incomplete');
require(incident.includes('tool_call_id')&&incident.toLowerCase().includes('never create the same workflow/task on another cluster'),'incident correlation/no-duplicate runbook incomplete');
require(goNoGo.includes('NO-GO / PILOT ADMISSION BLOCKED')&&goNoGo.includes('UNFILLED — HUMAN SIGNATURE REQUIRED'),'No-Go/human signature record missing');
require(trace.includes('tasks 1.1, 4.1 and 4.2 as incomplete'),'P7 traceability must preserve human blockers');
for(const file of ['postgres-backup.sh','postgres-restore.sh','postgres-tenant-delete.sh','artifact-backup.sh','artifact-restore.sh','artifact-retention-delete.sh','postgres-exercise.mjs','artifact-exercise.mjs']){try{await access(join(root,'scripts/p7',file),constants.X_OK);}catch{failures.push(`script is not executable: ${file}`);}}
require(workspace.scripts['check-p7-boundaries']&&workspace.scripts['test:p7:exercises']&&workspace.scripts['scan:p7:fixtures'],'root P7 commands missing');
if(failures.length){console.error(failures.join('\n'));process.exit(1);}console.log('P7 production readiness/admission/data/alerts/runbook boundaries: OK');
