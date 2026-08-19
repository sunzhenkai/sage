import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (path) => readFile(join(root, path), 'utf8');
const [domain, registry, routing, api, migration, manifest] = await Promise.all([
  read('packages/task-domain/src/index.ts'), read('packages/temporal-registry/src/index.ts'),
  read('packages/temporal-routing/src/index.ts'), read('apps/agent-api/src/task-api.ts'),
  read('packages/task-domain/migrations/001_task_store.sql'), read('packages/temporal-routing/package.json').then(JSON.parse)
]);
const failures = [];
if (!/additionalProperties: false, \$id: 'CreateTaskRequest\.v1'/.test(domain)) failures.push('CreateTaskRequest must reject raw/unknown target overrides');
for (const field of ['endpoint', 'namespace', 'taskQueue', 'targetId', 'credentialRef', 'clusterId']) {
  if (!routing.includes(`'${field.toLowerCase()}'`) && !routing.includes(`'${field}'`)) failures.push(`Router override deny-list missing ${field}`);
}
if (!routing.includes("readonly code = 'ROUTING_UNAVAILABLE'")) failures.push('ROUTING_UNAVAILABLE is missing');
if (!routing.includes("readonly code = 'TARGET_CLUSTER_UNAVAILABLE'")) failures.push('target-unavailable semantics are missing');
if (!routing.includes("readonly code = 'WORKFLOW_START_OUTCOME_UNKNOWN'")) failures.push('ambiguous Workflow start state is missing');
if (!routing.includes("cause instanceof WorkflowNotFoundError") || !routing.includes("isDefinitiveStartRejection(cause)")) failures.push('start reconciliation must distinguish not-found from transient failure');
if (!/clientFactory\.forSnapshot\((?:record|activeRecord)\.snapshot\);[\s\S]{0,400}catch \{[\s\S]{0,400}throw new WorkflowStartOutcomeUnknownError/.test(routing)
  || /clientFactory\.forSnapshot\((?:record|activeRecord)\.snapshot\);[\s\S]{0,400}catch \{[\s\S]{0,400}#markUnavailable/.test(routing)) {
  failures.push('client/provider/connector failures must stay start_pending and return outcome-unknown');
}
if (!api.includes('rejectedTaskCreateFields') || !api.includes('normalizeUntrustedField') || !api.includes("path[0] === 'slice'")
  || !api.includes("'connection'") || !api.includes("code: 'TARGET_OVERRIDE_REJECTED'")) {
  failures.push('Task create HTTP boundary must recursively reject unknown/raw target aliases before AJV');
}
if (/LocalAgentClient|@sage\/agent-client|@sage\/agent-lib|@sage\/harness-pi/.test(routing + api)) failures.push('API/routing must not execute Agent locally');
if (!routing.includes('credential = lease.value') || !routing.includes('credential?.fill(0)')) failures.push('Provider-owned credential lease bytes are not zeroed');
if (/TargetClusterUnavailableError\([^)]*,\s*\{\s*cause/.test(routing)) failures.push('Credential/client errors must not retain untrusted causes');
if (/credential(Value|Bytes)|secret(Value|Bytes)/i.test(migration)) failures.push('Persistent schema appears to contain credential values');
if (!domain.includes('clusterId: Id, isolationKey: Id')) failures.push('WorkflowTargetSnapshot must include isolationKey');
if (!domain.includes('WorkflowStartEnvelopeSchema') || !migration.includes('start_envelope jsonb')) failures.push('Immutable Workflow start envelope is missing');
if (!/NEW\.start_envelope IS DISTINCT FROM OLD\.start_envelope/.test(migration) || !/reject_task_routing_immutable_update/.test(migration)) failures.push('Immutable snapshot/envelope trigger is missing');
if (!registry.includes('RegistryApprovalAuthorizationSchema') || !registry.includes('RegistryApprovalSchema') || !registry.includes('approvalAuthorizer')) failures.push('Registry approval must use authenticated authorization and strict runtime schemas');
if (/approvalKind/.test(registry)) failures.push('Caller-supplied approvalKind must not be accepted');
if (!registry.includes("roles.includes('temporal-registry-approver')") || !registry.includes('REGISTRY_SEPARATION_OF_DUTIES_REQUIRED')) failures.push('Registry approver role and separation of duties are missing');
if (!registry.includes('#artifactCatalog') || !registry.includes('REGISTRY_ARTIFACT_VERSION_IMMUTABLE')) failures.push('Cross-publication artifact version immutability is missing');
if (!registry.includes('bundle.registryId !== this.#registryId')) failures.push('Registry ID must be fixed by the Registry instance');
if (!routing.includes('task-type-residency-not-allowed')) failures.push('TaskType residency control is not enforced');
for (const cacheField of ['targetProfileVersion', 'clusterId', 'endpoint', 'namespace', 'credentialRef']) {
  if (!routing.includes(`snapshot.${cacheField}`)) failures.push(`Client cache key/binding missing ${cacheField}`);
}
const allowed = new Set(['@sage/observability', '@sage/platform-ports', '@sage/task-domain', '@sage/temporal-registry', '@temporalio/client', '@temporalio/common']);
for (const dependency of Object.keys(manifest.dependencies ?? {})) if (!allowed.has(dependency)) failures.push(`temporal-routing dependency forbidden: ${dependency}`);
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('P5 trusted routing/credential/snapshot/reconciliation boundaries: OK');
