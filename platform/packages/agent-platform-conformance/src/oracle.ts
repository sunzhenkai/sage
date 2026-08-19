import type { AdapterResult, CanonicalObservation } from './contracts.js';
export interface OracleDifference { readonly code: string; readonly path: string; readonly expected?: unknown; readonly actual?: unknown; }
export interface OracleReport { readonly status: 'PASS' | 'FAIL'; readonly differences: readonly OracleDifference[]; readonly nonExactReasons: readonly string[]; }
const byId = (items: readonly CanonicalObservation[]) => new Map(items.map((item) => [item.id, item]));
const canonical = (item: CanonicalObservation) => ({ type:item.type, authority:item.authority, parents:[...item.parents].sort(), outcome:item.outcome, errorCode:item.errorCode, receiptRefs:[...(item.receiptRefs ?? [])].sort(), artifactRefs:[...(item.artifactRefs ?? [])].sort(), checkpointRefs:[...(item.checkpointRefs ?? [])].sort(), budget:item.budget });
export function evaluateOracle(expected: AdapterResult, actual: AdapterResult): OracleReport {
  const differences: OracleDifference[] = []; const nonExactReasons: string[] = [];
  if (expected.outcome !== actual.outcome) differences.push({ code:'OUTCOME_DRIFT', path:'outcome', expected:expected.outcome, actual:actual.outcome });
  if (expected.errorCode !== actual.errorCode) differences.push({ code:'ERROR_TAXONOMY_DRIFT', path:'errorCode', expected:expected.errorCode, actual:actual.errorCode });
  const left=byId(expected.observations), right=byId(actual.observations);
  for (const [id, item] of left) { const candidate=right.get(id); if (!candidate) { differences.push({code:'OBSERVATION_MISSING',path:id}); continue; }
    if (JSON.stringify(canonical(item)) !== JSON.stringify(canonical(candidate))) differences.push({code:'CANONICAL_SEMANTIC_DRIFT',path:id,expected:canonical(item),actual:canonical(candidate)});
    const nonExactKeys=new Set([...Object.keys(item.nonExact ?? {}),...Object.keys(candidate.nonExact ?? {})]); for(const key of nonExactKeys) if(item.nonExact?.[key]!==candidate.nonExact?.[key]) nonExactReasons.push(`${id}:${key}`);
  }
  for(const id of right.keys()) if(!left.has(id)) differences.push({code:'UNEXPECTED_CANONICAL_OBSERVATION',path:id});
  for(const item of actual.observations) for(const parent of item.parents) if(!right.has(parent)) differences.push({code:'DANGLING_CAUSAL_EDGE',path:`${parent}->${item.id}`});
  const receipts=actual.observations.flatMap((item)=>item.receiptRefs ?? []); if(new Set(receipts).size!==receipts.length) differences.push({code:'DUPLICATE_SETTLEMENT',path:'receiptRefs'});
  return {status:differences.length===0?'PASS':'FAIL',differences,nonExactReasons:[...new Set(nonExactReasons)].sort()};
}
