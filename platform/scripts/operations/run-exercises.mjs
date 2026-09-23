#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const evidenceDirectory=resolve('evidence/operations/latest');await mkdir(evidenceDirectory,{recursive:true});
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
  run('postgres-backup-restore',process.execPath,['scripts/operations/postgres-exercise.mjs'],{SAGE_P7_ALLOW_ISOLATED_EXERCISE:'YES'});
  run('artifact-backup-restore',process.execPath,['scripts/operations/artifact-exercise.mjs'],{SAGE_P7_ALLOW_ISOLATED_EXERCISE:'YES'});
  run('admission-and-secret-controls','corepack',['pnpm','vitest','run','apps/agent-api/src/pilot-admission.test.ts','scripts/operations/fixture-scanner.test.ts']);
  run('tenant-isolation-deletion-audit','corepack',['pnpm','vitest','run','examples/cross-chain-e2e/src/data-controls.integration.test.ts'],{DATA_CONTROLS_POSTGRES_URL:'postgres://sage:sage-local-only@127.0.0.1:15432/sage'});
  run('worker-compatible-rollout-rollback','corepack',['pnpm','vitest','run','examples/workflow-durability-integration/src/workflow-durability.integration.test.ts','-t','rolls a long Workflow'],{WORKFLOW_DURABILITY_POSTGRES_URL:'postgres://sage:sage-local-only@127.0.0.1:15432/sage',SAGE_TEMPORAL_ADDRESS:'127.0.0.1:17233'});
  run('control-plane-failure','corepack',['pnpm','vitest','run','examples/workflow-durability-integration/src/workflow-durability.integration.test.ts','-t','keeps Temporal query/control/completion available'],{WORKFLOW_DURABILITY_POSTGRES_URL:'postgres://sage:sage-local-only@127.0.0.1:15432/sage',SAGE_TEMPORAL_ADDRESS:'127.0.0.1:17233'});
  run('target-cluster-unavailable-no-duplicate','corepack',['pnpm','vitest','run','examples/cross-chain-e2e/src/cross-chain.e2e.test.tsx','packages/temporal-routing/src/controller.test.ts','-t','binds an unreachable selected target|serializes concurrent create/reconcile'],{CROSS_CHAIN_POSTGRES_URL:'postgres://sage:sage-local-only@127.0.0.1:15432/sage',SAGE_TEMPORAL_ADDRESS:'127.0.0.1:17233'});
}catch(cause){failure=cause;}
const evidence={schema_version:'1',suite:'controlled-exercises',environment:'isolated-local-compose-and-filesystem',production_evidence:false,started_at:startedAt,completed_at:new Date().toISOString(),outcome:failure?'failed':'passed',results};
await writeFile(`${evidenceDirectory}/exercise-suite.json`,`${JSON.stringify(evidence,null,2)}\n`);
if(failure)throw failure;console.log('Controlled exercise suite: PASS');
