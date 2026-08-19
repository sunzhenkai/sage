#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const evidenceDirectory=resolve('evidence/p7/latest');await mkdir(evidenceDirectory,{recursive:true});
const startedAt=new Date().toISOString();const results=[];
const run=(exerciseId,command,args,env={})=>{
  const started=new Date().toISOString();
  const value=spawnSync(command,args,{encoding:'utf8',env:{...process.env,...env},stdio:['ignore','pipe','pipe'],maxBuffer:64*1024*1024});
  const result={exercise_id:exerciseId,command:[command,...args].join(' '),started_at:started,completed_at:new Date().toISOString(),exit_code:value.status??-1,outcome:value.status===0?'passed':'failed',stdout:value.stdout.slice(-4000),stderr:value.stderr.slice(-4000),production_evidence:false};results.push(result);
  if(value.status!==0)throw Object.assign(new Error(`${exerciseId} failed\n${value.stdout}\n${value.stderr}`),{result});
};
let failure;
try{
  run('compose-prerequisites','docker',['compose','up','-d','--wait','postgres','temporal']);
  run('postgres-backup-restore',process.execPath,['scripts/p7/postgres-exercise.mjs'],{SAGE_P7_ALLOW_ISOLATED_EXERCISE:'YES'});
  run('artifact-backup-restore',process.execPath,['scripts/p7/artifact-exercise.mjs'],{SAGE_P7_ALLOW_ISOLATED_EXERCISE:'YES'});
  run('admission-and-secret-controls','corepack',['pnpm','vitest','run','apps/agent-api/src/pilot-admission.p7.test.ts','scripts/p7/fixture-scanner.p7.test.ts']);
  run('tenant-isolation-deletion-audit','corepack',['pnpm','vitest','run','examples/p6-integration/src/p7-data-controls.integration.test.ts'],{P7_POSTGRES_URL:'postgres://sage:sage-local-only@127.0.0.1:15432/sage'});
  run('worker-compatible-rollout-rollback','corepack',['pnpm','vitest','run','examples/p4-integration/src/p4.integration.test.ts','-t','P7 rolls a long Workflow'],{P4_POSTGRES_URL:'postgres://sage:sage-local-only@127.0.0.1:15432/sage',SAGE_TEMPORAL_ADDRESS:'127.0.0.1:17233'});
  run('control-plane-failure','corepack',['pnpm','vitest','run','examples/p4-integration/src/p4.integration.test.ts','-t','keeps Temporal query/control/completion available'],{P4_POSTGRES_URL:'postgres://sage:sage-local-only@127.0.0.1:15432/sage',SAGE_TEMPORAL_ADDRESS:'127.0.0.1:17233'});
  run('target-cluster-unavailable-no-duplicate','corepack',['pnpm','vitest','run','examples/p6-integration/src/p6.e2e.test.tsx','packages/temporal-routing/src/p5-controller.test.ts','-t','binds an unreachable selected target|serializes concurrent create/reconcile'],{P6_POSTGRES_URL:'postgres://sage:sage-local-only@127.0.0.1:15432/sage',SAGE_TEMPORAL_ADDRESS:'127.0.0.1:17233'});
}catch(cause){failure=cause;}
const evidence={schema_version:'1',suite:'sage-p7-controlled-exercises',environment:'isolated-local-compose-and-filesystem',production_evidence:false,started_at:startedAt,completed_at:new Date().toISOString(),outcome:failure?'failed':'passed',results};
await writeFile(`${evidenceDirectory}/exercise-suite.json`,`${JSON.stringify(evidence,null,2)}\n`);
if(failure)throw failure;console.log('P7 controlled exercise suite: PASS');
