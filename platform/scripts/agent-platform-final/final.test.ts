import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error JavaScript CLI library intentionally has no declaration surface.
import { MANDATORY_GATE_KEYS, assertPromotionGate, buildEntryManifest, buildGateManifest, buildPreflight, diffProtectedManifests, projectRuntime, promoteBaseline, scanFixture, sha256, validateBoundaryAllowlist, validateModel, validateReview } from './lib.mjs';

describe('agent-platform-final machine gates', () => {
  it('preflight is truthfully blocked by production external evidence', async () => {
    const preflight=await buildPreflight(),entry=await buildEntryManifest();
    expect(preflight.dependencies).toHaveLength(5);
    expect(preflight.dependencies.slice(0,3).every((item:{status:string;strictValidation:string})=>item.status==='PASS'&&item.strictValidation==='PASS')).toBe(true);
    expect(preflight.dependencies[3]).toMatchObject({strictValidation:'PASS'});
    expect(preflight.dependencies[4]).toMatchObject({status:'BLOCKED'});
    expect(entry).toMatchObject({status:'BLOCKED',decision:'NO-GO',promotionToken:null});
    expect(entry.externalDeferredTaskIds).toHaveLength(9);
  },15000);
  it('detects add/delete/modify and rename in protected paths',()=>{
    const before={files:[{path:'a',digest:'1'},{path:'b',digest:'2'}]},after={files:[{path:'renamed',digest:'1'},{path:'b',digest:'3'},{path:'c',digest:'4'}]};
    const diff=diffProtectedManifests(before,after);
    expect(diff.changed).toEqual(['a','b','c','renamed']);
    expect(diff.renames).toEqual([{from:'a',to:'renamed',digest:'1'}]);
  });
  it('accepts safe fixture and rejects every leakage family',async()=>{
    expect(await scanFixture('pass')).toHaveLength(0);
    for(const name of['pi','temporal','web','db','mcp','alias','workload-internal']) expect((await scanFixture(name)).length,name).toBeGreaterThan(0);
  });
  it('rejects expired, ownerless, or core-leakage boundary exceptions',()=>{
    expect(validateBoundaryAllowlist({requirements:{finalCoreLeakageExemptible:false},exceptions:[]})).toEqual([]);
    expect(validateBoundaryAllowlist({requirements:{finalCoreLeakageExemptible:true},exceptions:[{id:'expired',expiresAt:'2020-01-01T00:00:00Z',coreLeakage:true}]})).toHaveLength(2);
  });
  it('validates authority uniqueness and metadata but preserves draft admission',async()=>{
    const valid=await validateModel();
    expect(valid).toMatchObject({status:'PASS',baselineAdmission:'BLOCKED',modelStatus:'draft',authorityCount:11});
    const model=JSON.parse(await readFile(join(process.cwd(),'../docs/design/_cross/generic-agent-platform-final.system-model.json'),'utf8'));
    model.authorities.push(model.authorities[0]);
    expect((await validateModel(model)).errors).toContain('DUPLICATE_AUTHORITY:release-spec');
    await validateModel();
  });
  it('projects reproducibly',async()=>{
    const first=await projectRuntime(),second=await projectRuntime();
    expect(first.contentDigest).toBe(second.contentDigest);
    expect(first).toMatchObject({status:'draft',admission:'blocked'});
  });
  it('rejects evidence-free accepted risk',async()=>{
    await expect(validateReview({status:'fail',findings:[{severity:'high',disposition:'accepted-risk',evidenceRefs:[]}]})).rejects.toThrow('ARCHITECTURE_ACCEPTED_RISK_WITHOUT_EVIDENCE');
  });
  it('rejects forged, incomplete, stale, WARN, verbal, and unsigned promotion manifests',()=>{
    const targetDigest=`sha256:${'a'.repeat(64)}`;
    const item=(key:string)=>({key,status:'PASS',owner:'owner',observedAt:'2026-08-17T00:00:00Z',evidenceRef:`evidence/${key}.json`,evidenceDigest:`sha256:${'b'.repeat(64)}`,freshness:'CURRENT'});
    const seal=(value:Record<string,unknown>)=>({...value,contentDigest:sha256(value)});
    const validBase={schemaVersion:'1',status:'PASS',decision:'GO',sourceRevision:'current',sourceDigest:`sha256:${'c'.repeat(64)}`,toolDigest:`sha256:${'d'.repeat(64)}`,targetBaseline:'Proposed final architecture baseline',targetRevision:targetDigest,generatedAt:'2026-08-17T00:00:00Z',items:MANDATORY_GATE_KEYS.map(item),blockers:[],overrideAttempts:[],productionEvidenceVerified:true};
    expect(()=>assertPromotionGate(seal({...validBase,items:[item('fake.local')]}),{targetDigest,sourceRevision:'current'})).toThrow('PROMOTION_GATE_MANDATORY_SET_INVALID');
    expect(()=>assertPromotionGate(seal({...validBase,sourceRevision:'stale'}),{targetDigest,sourceRevision:'current'})).toThrow('PROMOTION_SOURCE_REVISION_CHANGED');
    expect(()=>assertPromotionGate(seal({...validBase,overrideAttempts:[{kind:'verbal',signed:false}]}),{targetDigest,sourceRevision:'current'})).toThrow('PROMOTION_OVERRIDE_ATTEMPT_PRESENT');
    const warnItems=MANDATORY_GATE_KEYS.map(item);warnItems[0]={...warnItems[0],status:'WARN'};
    expect(()=>assertPromotionGate(seal({...validBase,items:warnItems}),{targetDigest,sourceRevision:'current'})).toThrow('PROMOTION_INPUT_INVALID');
  });
  it('derives the canonical gate from validated artifacts and denies all alternate promotion inputs',async()=>{
    const gate=await buildGateManifest();
    expect(gate).toMatchObject({status:'BLOCKED',decision:'NO-GO',productionEvidenceVerified:false});
    expect(gate.items.map((item:{key:string})=>item.key).sort()).toEqual([...MANDATORY_GATE_KEYS].sort());
    expect(gate.items.every((item:{status:string})=>['PASS','FAIL','BLOCKED'].includes(item.status))).toBe(true);
    await expect(promoteBaseline()).rejects.toThrow('PROMOTION_GATE_NOT_GO');
    await expect(promoteBaseline({gatePath:'/tmp/forged.json'})).rejects.toThrow('PROMOTION_NON_CANONICAL_INPUT_FORBIDDEN');
    await expect(promoteBaseline({targetPath:'/tmp/target.md'})).rejects.toThrow('PROMOTION_NON_CANONICAL_INPUT_FORBIDDEN');
    await expect(promoteBaseline({expectedRevision:'sha256:'+'0'.repeat(64),expectedSourceRevision:'stale'})).rejects.toThrow('PROMOTION_GATE_NOT_GO');
    expect(await readFile(join(process.cwd(),'../docs/design/_cross/generic-agent-platform-final.md'),'utf8')).toContain('Proposed final architecture baseline');
  });
});
