import { describe, expect, it } from 'vitest';
import { Value } from 'typebox/value';
import { CapabilityGrantSchema, EffectResolutionSchema, ProductionGovernanceErrorCodeSchema, ProductionReadinessRecordSchema } from './production-governance.js';

describe('production governance contracts', () => {
  it('accepts stable error taxonomy and rejects unknown codes', () => { expect(Value.Check(ProductionGovernanceErrorCodeSchema, 'EFFECT_UNKNOWN')).toBe(true); expect(Value.Check(ProductionGovernanceErrorCodeSchema, 'ALLOW_ANYWAY')).toBe(false); });
  it('requires separated effect resolver evidence', () => { const value={schemaVersion:'1',resolutionRef:'resolution://1',tenantId:'t',semanticActionId:`sha256:${'a'.repeat(64)}`,decision:'ABANDONED',evidenceDigest:`sha256:${'b'.repeat(64)}`,resolverRef:'principal://resolver',originalExecutorRef:'principal://executor',reason:'verified external evidence',policyVersion:'p1',resolvedAt:'2026-08-16T00:00:00.000Z'}; expect(Value.Check(EffectResolutionSchema,value)).toBe(true); expect(Value.Check(EffectResolutionSchema,{...value,evidenceDigest:'fixture'})).toBe(false); });
  it('keeps Grant and readiness records closed to unknown authority fields', () => { expect((CapabilityGrantSchema as unknown as {additionalProperties:boolean}).additionalProperties).toBe(false); expect((ProductionReadinessRecordSchema as unknown as {additionalProperties:boolean}).additionalProperties).toBe(false); });
});
