import type { ProductionReadinessGate, ReadinessDecision } from '@sage/production-governance';
export interface ReadinessHttpResult { readonly statusCode: 200|503; readonly body: ReadinessDecision & { readonly status:'ready'|'not_ready' } }
export async function productionReadinessResponse(gate: ProductionReadinessGate):Promise<ReadinessHttpResult>{const decision=await gate.evaluate();return decision.decision==='GO'?{statusCode:200,body:{...decision,status:'ready'}}:{statusCode:503,body:{...decision,status:'not_ready'}};}
