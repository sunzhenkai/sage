export const AUTHORITY_FAULT_POINTS=Object.freeze([
'consumption.before-reserve','consumption.after-reserve','consumption.commit-response-loss','consumption.redelivery','consumption.orphan-reclaim',
'effect.before-provider','effect.before-commit','effect.after-commit-response-loss','effect.unknown',
'artifact.temporary-body','artifact.before-metadata','artifact.before-finalize','artifact.after-finalize-response-loss',
'checkpoint.body','checkpoint.metadata','checkpoint.lineage','checkpoint.before-seal','checkpoint.resume-tenant','checkpoint.resume-sequence','checkpoint.resume-codec','checkpoint.resume-runtime',
'coordinator.lost-dispatch','coordinator.duplicate-dispatch','coordinator.history-unavailable','coordinator.pause-cancel-race','coordinator.continue-as-new','coordinator.projection-lag',
'policy.unavailable','policy.deny','policy.live-revocation','approval.digest-mismatch','approval.expired','secret.service-unavailable','secret.lease-expired',
'model.timeout','model.rate-limit','model.invalid-output','model.response-loss','tool.timeout','tool.duplicate-delivery'
] as const);
export type AuthorityFaultPoint=typeof AUTHORITY_FAULT_POINTS[number];
export interface FaultEvidence{readonly point:AuthorityFaultPoint;readonly caseId:string;readonly status:'PASS'|'FAIL'|'BLOCKED';readonly authority:string;readonly recovery:string;}
export function evaluateFaultCoverage(evidence:readonly FaultEvidence[]){const missing=AUTHORITY_FAULT_POINTS.filter((point)=>!evidence.some((item)=>item.point===point&&item.status==='PASS'));return {status:missing.length===0?'PASS' as const:'BLOCKED' as const,totalPoints:AUTHORITY_FAULT_POINTS.length,passedPoints:AUTHORITY_FAULT_POINTS.length-missing.length,missing};}
