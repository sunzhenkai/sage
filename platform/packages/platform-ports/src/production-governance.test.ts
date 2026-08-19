import { describe, expect, it } from 'vitest';
import type { ProductionReadinessRecordProvider, SecretLease, ToolEffectLedgerPort, WorkloadIdentityExchangePort } from './production-governance.js';
describe('production governance ports',()=>{it('expose provider-neutral lifecycle methods',()=>{const methods:keyof ToolEffectLedgerPort='claim';const exchange:keyof WorkloadIdentityExchangePort='exchange';const load:keyof ProductionReadinessRecordProvider='load';const destroy:keyof SecretLease='destroy';expect([methods,exchange,load,destroy]).toEqual(['claim','exchange','load','destroy']);});});
