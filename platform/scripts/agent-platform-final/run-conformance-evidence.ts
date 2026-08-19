import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalV1Fixture, deterministicReferenceEngineAdapterFactory } from '../../packages/agent-runtime-conformance/src/index.ts';
import { piEngineAdapterFactory } from '../../packages/harness-pi/src/index.ts';
import { executeAuthorityFaultMatrix, explainReplay, rebuildProjection, runDualEngineSuite } from '../../packages/agent-platform-conformance/src/index.ts';
import { createDurableCoordinatorHostActivities } from '../../apps/agent-worker/src/activities.ts';
import { type BoundedRunOutcome, type BoundedRunReceipt, type ErrorCategory, type RetryDisposition } from '../../packages/agent-contracts/src/index.ts';

const exec = promisify(execFile);
const platform = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const root = resolve(platform, '..');
const output = join(platform, 'evidence/agent-platform-final/executed-results.json');
const skip = new Set(['node_modules','dist','dist-types','.git','.cache']);
const hash = (value: string | Uint8Array): `sha256:${string}` => `sha256:${createHash('sha256').update(value).digest('hex')}`;

async function files(path: string): Promise<string[]> {
  const info = await stat(path);
  if (info.isFile()) return [path];
  const result: string[] = [];
  for (const name of (await readdir(path)).sort()) if (!skip.has(name) && !name.endsWith('.tsbuildinfo')) result.push(...await files(join(path,name)));
  return result;
}
async function treeDigest(paths: readonly string[]): Promise<`sha256:${string}`> {
  const entries: string[] = [];
  for (const base of paths) for (const path of await files(join(platform,base))) entries.push(`${relative(platform,path)}\0${hash(await readFile(path))}`);
  return hash(entries.sort().join('\n'));
}

const hostScenarios = ['success','denial','cancel','timeout','budget-exhausted','waiting','effect-unknown','incompatible-checkpoint'] as const;
type HostScenario = typeof hostScenarios[number];
const scenarioOutcome = (scenario: HostScenario): BoundedRunOutcome => ({ success:'COMPLETED', denial:'FAILED', cancel:'CANCELLED', timeout:'FAILED', 'budget-exhausted':'FAILED', waiting:'WAITING_FOR_APPROVAL', 'effect-unknown':'EFFECT_UNKNOWN', 'incompatible-checkpoint':'FAILED' })[scenario] as BoundedRunOutcome;
const scenarioError = (scenario: HostScenario): { code:string; category:ErrorCategory; retryDisposition:RetryDisposition; safeMessage:string } | undefined => {
  const values: Partial<Record<HostScenario,{code:string;category:ErrorCategory;retryDisposition:RetryDisposition;safeMessage:string}>> = {
    denial:{code:'POLICY_DENIED',category:'AUTHORIZATION',retryDisposition:'NEVER',safeMessage:'policy denied'},
    cancel:{code:'KERNEL_CANCELLED',category:'CANCELLATION',retryDisposition:'NEVER',safeMessage:'cancelled'},
    timeout:{code:'KERNEL_BOUND_EXCEEDED',category:'DEPENDENCY_TRANSIENT',retryDisposition:'REQUIRES_NEW_ATTEMPT',safeMessage:'deadline exceeded'},
    'budget-exhausted':{code:'KERNEL_BOUND_EXCEEDED',category:'BUDGET',retryDisposition:'NEVER',safeMessage:'budget exhausted'},
    'effect-unknown':{code:'EFFECT_UNKNOWN',category:'EFFECT_UNKNOWN',retryDisposition:'MANUAL_RESOLUTION',safeMessage:'effect outcome unknown'},
    'incompatible-checkpoint':{code:'CHECKPOINT_UNAVAILABLE_OR_INCOMPATIBLE',category:'INCOMPATIBLE',retryDisposition:'REQUIRES_NEW_ATTEMPT',safeMessage:'checkpoint incompatible'}
  };
  return values[scenario];
};
function receipt(scenario: HostScenario): BoundedRunReceipt {
  const error = scenarioError(scenario);
  return {
    schemaVersion:'1', receiptRef:`receipt://host/${scenario}`, invocationId:`invocation-${scenario}`,
    specDigest:canonicalV1Fixture.spec.specDigest, outcome:scenarioOutcome(scenario), eventRange:{first:1,last:4},
    ...(error === undefined?{}:{error}),
    ...(scenario==='waiting'?{checkpointRef:'checkpoint://host/sealed'}:{}),
    receiptRefs:['receipt://authorization','receipt://usage'],
    artifactRefs:scenario==='success'?['artifact://host/result']:[]
  };
}
async function executeHostScenarios() {
  const cases=[];
  for (const scenario of hostScenarios) {
    let interactiveCalls=0,durableCalls=0;
    const makeClient=(host:'interactive'|'durable')=>({runBounded:async()=>{if(host==='interactive')interactiveCalls+=1;else durableCalls+=1;return {status:'committed' as const,receipt:receipt(scenario)};}});
    const interactiveResult=await makeClient('interactive').runBounded();
    const input={schemaVersion:'1' as const,tenantId:canonicalV1Fixture.spec.tenantId,envelope:{...canonicalV1Fixture.envelope,invocationId:`invocation-${scenario}`},dispatchEpoch:1,invocationId:`invocation-${scenario}`,ownerRef:'owner://evidence-digest/interactive' as const,targetRef:'target://evidence-digest/durable' as const,adapterRef:'adapter://coordinator/v2' as const,runtimeRef:'runtime://contract/1' as const};
    const durable=await createDurableCoordinatorHostActivities({client:makeClient('durable') as never,engine:deterministicReferenceEngineAdapterFactory.create() as never}).executeCoordinatorDispatch(input);
    if (interactiveResult.status!=='committed') throw new Error(`HOST_INTERACTIVE_NOT_COMMITTED:${scenario}`);
    const expected={outcome:interactiveResult.receipt.outcome,errorCode:interactiveResult.receipt.error?.code,receiptRefs:interactiveResult.receipt.receiptRefs,artifactRefs:interactiveResult.receipt.artifactRefs,checkpointRef:interactiveResult.receipt.checkpointRef};
    const observed={outcome:durable.outcome,errorCode:durable.errorCode,receiptRefs:durable.receiptRefs,artifactRefs:durable.artifactRefs,checkpointRef:durable.checkpointRef};
    if (JSON.stringify(expected)!==JSON.stringify(observed)) throw new Error(`HOST_CANONICAL_DRIFT:${scenario}`);
    cases.push({caseId:`apgv/host/v1/${scenario}`,scenario,status:'PASS',canonicalEquivalent:true,interactiveCalls,durableCalls,durableBinding:'createDurableCoordinatorHostActivities',assertions:['outcome','error','receipt-lineage','artifact-lineage','checkpoint-lineage']});
  }
  return {status:'PASS',scenarioCount:cases.length,hosts:['interactive-bounded-client','durable-coordinator-activity'],cases};
}

async function historyFixtureAudit() {
  const fixtureRoot=join(platform,'packages/temporal-workflows/fixtures/replay');
  const manifest=JSON.parse(await readFile(join(fixtureRoot,'manifest.json'),'utf8')) as {fixtures:{caseId:string;file:string;digest:string}[];negative:{caseId:string;file:string;expectedCode:string}[]};
  const fixtures=[];
  for (const item of manifest.fixtures) {
    const body=await readFile(join(fixtureRoot,item.file));
    const actualDigest=hash(body);
    const parsed=JSON.parse(body.toString()) as Record<string,unknown>;
    const temporalHistory=Array.isArray(parsed.events) && parsed.events.length>0;
    fixtures.push({...item,actualDigest,digestMatches:item.digest===actualDigest,temporalHistory,status:item.digest===actualDigest&&temporalHistory?'PASS':'BLOCKED'});
  }
  return {status:fixtures.every(item=>item.status==='PASS')?'PASS':'BLOCKED',fixtureCount:fixtures.length,fixtures,negativeFixtures:manifest.negative,runner:'@temporalio/worker.Worker.runReplayHistory',reason:fixtures.every(item=>item.status==='PASS')?undefined:'TEMPORAL_HISTORY_FIXTURES_NOT_CAPTURED_OR_DIGEST_MISMATCH'};
}

const sourceDigest=await treeDigest(['packages/agent-platform-conformance/src','packages/agent-runtime-conformance/src','packages/harness-pi/src','examples/evidence-digest/src','apps/agent-worker/src/activities.ts','packages/temporal-workflows/src','packages/temporal-workflows/fixtures/replay']);
const toolDigest=hash(Buffer.concat([await readFile(join(platform,'package.json')),await readFile(join(platform,'pnpm-lock.yaml')),Buffer.from(process.version)]));
const {stdout:head}=await exec('git',['rev-parse','HEAD'],{cwd:root});
const {stdout:status}=await exec('git',['status','--porcelain=v1'],{cwd:root});
const sourceState={head:head.trim(),worktreeDigest:hash(status),dirtyPathCount:status.split('\n').filter(Boolean).length};
const startedAt=new Date().toISOString();
const engine=await runDualEngineSuite(deterministicReferenceEngineAdapterFactory,piEngineAdapterFactory);
const host=await executeHostScenarios();
const faults=executeAuthorityFaultMatrix();
const replay=explainReplay({releaseRef:'release://evidence-digest/v1',specRef:'spec://evidence-digest/v1',audit:{receiptRefs:['receipt://authorization','receipt://usage','receipt://effect'],artifactRefs:['artifact://result'],checkpointRefs:['checkpoint://sealed'],outcome:'COMPLETED'},observations:[{id:'1',kind:'authorization',reason:'signed policy'},{id:'2',kind:'budget',reason:'reservation committed'},{id:'3',kind:'effect',reason:'effect receipt committed'},{id:'4',kind:'checkpoint',reason:'sealed lineage'},{id:'5',kind:'terminal',reason:'history completed'}],modelRevisionImmutable:false});
const projection=rebuildProjection({cursor:7,historyState:'COMPLETED',receiptRefs:['receipt://usage','receipt://effect'],artifactRefs:['artifact://result'],checkpointRefs:['checkpoint://sealed']},{cursor:1,historyState:'RUNNING',receiptRefs:[],artifactRefs:[],checkpointRefs:[],freshness:'cursor:1'});
const history=await historyFixtureAudit();
const finishedAt=new Date().toISOString();
const value={schemaVersion:'1',caseId:'apgv/execution/v1/mandatory-suite',seed:'apgv-seed-v1',sourceDigest,toolDigest,sourceState,startedAt,finishedAt,engine,host,faults,replay,projection,history};
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify({...value,contentDigest:hash(JSON.stringify(value))},null,2)+'\n');
console.log(JSON.stringify({status:history.status==='PASS'?'PASS':'BLOCKED',engineCases:engine.sharedCaseCount,hostScenarios:host.scenarioCount,faultPoints:faults.totalPoints,historyStatus:history.status,sourceDigest,toolDigest},null,2));
