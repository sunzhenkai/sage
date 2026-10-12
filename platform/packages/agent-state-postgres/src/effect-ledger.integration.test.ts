import { describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { sha256Digest, type EffectClaim, type EffectReceipt, type EffectResolution } from '@sage/agent-contracts';
import { PostgresAgentStateAdapter, PostgresToolEffectLedger } from './index.js';
const url = process.env.PHASE4_POSTGRES_URL;
const makeClaim = (suffix: string): EffectClaim => { const binding = sha256Digest(`binding-${suffix}`); return { schemaVersion: '1', tenantId: `effect-${suffix}`, semanticActionId: sha256Digest(`action-${suffix}`), taskId: 'task', attemptCompatibleActionKey: 'once', toolRef: 'tool://write/v1', toolVersion: '1', providerRef: 'provider://p', providerBuildDigest: binding, canonicalInputDigest: binding, invocationId: `inv-${suffix}`, leaseOwner: 'principal://executor', leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() }; };
const receipt = (claim: EffectClaim, state: EffectReceipt['state'], marker: string): EffectReceipt => ({ schemaVersion: '1', receiptRef: `effect-receipt://${claim.semanticActionId.slice(7)}/${marker}`, receiptDigest: sha256Digest([claim.semanticActionId, state, marker]), tenantId: claim.tenantId, semanticActionId: claim.semanticActionId, state, canonicalInputDigest: claim.canonicalInputDigest, toolVersion: claim.toolVersion, providerBuildDigest: claim.providerBuildDigest, fenceEpoch: 1, outcomeDigest: sha256Digest(marker), normalizedResult: state === 'COMMITTED' ? { status: 'succeeded', output: { marker } } : { status: 'effect_unknown', code: 'EFFECT_UNKNOWN', retryable: false }, committedAt: new Date().toISOString() });
describe.skipIf(!url)('PostgreSQL Tool Effect Ledger', () => {
  it('claims once, commits immutably, replays, and rejects digest drift', async () => { const migration = new PostgresAgentStateAdapter({ connectionString: url! }); await migration.migrate(); const ledger = new PostgresToolEffectLedger({ connectionString: url! }); const claim = makeClaim(String(Date.now())); expect((await ledger.claim(claim)).status).toBe('claimed'); const committed = receipt(claim, 'COMMITTED', 'ok'); expect(await ledger.commit({ claim, fenceEpoch: 1, receipt: committed })).toMatchObject({ status: 'committed' }); expect(await ledger.claim(claim)).toMatchObject({ status: 'replay', receipt: committed }); expect(await ledger.claim({ ...claim, canonicalInputDigest: sha256Digest('drift') })).toEqual({ status: 'conflict', code: 'EFFECT_CONFLICT' }); await migration.close(); });
  it('serializes concurrent human decisions and keeps an immutable audit receipt', async () => { const migration = new PostgresAgentStateAdapter({ connectionString: url! }); await migration.migrate(); const ledger = new PostgresToolEffectLedger({ connectionString: url! }); const claim = makeClaim(`resolution-${Date.now()}`); await ledger.claim(claim); await ledger.markUnknown({ claim, fenceEpoch: 1, receipt: receipt(claim, 'EFFECT_UNKNOWN', 'unknown') }); const resolution: EffectResolution = { schemaVersion: '1', resolutionRef: `effect-resolution://${claim.semanticActionId.slice(7)}/resolver`, tenantId: claim.tenantId, semanticActionId: claim.semanticActionId, decision: 'ABANDONED', evidenceDigest: sha256Digest('evidence'), resolverRef: 'principal://resolver', originalExecutorRef: claim.leaseOwner, reason: 'provider cannot prove outcome', policyVersion: 'p1', resolvedAt: new Date().toISOString() }; const results = await Promise.all([ledger.resolve({ resolution, resolverScopes: ['effect:resolve'] }), ledger.resolve({ resolution, resolverScopes: ['effect:resolve'] })]); expect(new Set(results.map(result => result.status))).toEqual(new Set(['resolved', 'existing'])); const pool = new Pool({ connectionString: url! }); expect(Number((await pool.query('SELECT count(*) AS count FROM agent_effect_resolutions WHERE tenant_id=$1 AND semantic_action_id=$2', [claim.tenantId, claim.semanticActionId])).rows[0].count)).toBe(1); await pool.end(); await migration.close(); });
  it('accepts only a fence-matched late committed receipt and preserves both receipts', async () => { const migration = new PostgresAgentStateAdapter({ connectionString: url! }); await migration.migrate(); const ledger = new PostgresToolEffectLedger({ connectionString: url! }); const claim = makeClaim(`late-${Date.now()}`); await ledger.claim(claim); await ledger.markUnknown({ claim, fenceEpoch: 1, receipt: receipt(claim, 'EFFECT_UNKNOWN', 'unknown') }); const late = receipt(claim, 'COMMITTED', 'late'); expect(await ledger.recordLateReceipt({ claim, fenceEpoch: 1, receipt: late, evidenceDigest: sha256Digest('provider-proof') })).toEqual({ status: 'committed' }); expect(await ledger.claim(claim)).toMatchObject({ status: 'replay', receipt: late }); expect((await ledger.recordLateReceipt({ claim, fenceEpoch: 2, receipt: { ...late, fenceEpoch: 2 }, evidenceDigest: sha256Digest('bad-fence') })).status).toBe('conflict'); const pool = new Pool({ connectionString: url! }); expect(Number((await pool.query('SELECT count(*) AS count FROM agent_effect_receipts WHERE tenant_id=$1 AND semantic_action_id=$2', [claim.tenantId, claim.semanticActionId])).rows[0].count)).toBe(2); await pool.end(); await migration.close(); });
});


describe.skipIf(!url)('PostgreSQL Effect audit atomicity', () => {
  it('rolls back an Effect claim when its security-audit insert fails', async () => {
    const migration = new PostgresAgentStateAdapter({ connectionString: url! });
    const pool = new Pool({ connectionString: url! });
    await migration.migrate();
    await pool.query(`
      CREATE OR REPLACE FUNCTION sage_test_reject_effect_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.tenant_id LIKE 'effect-audit-failure-%' THEN
          RAISE EXCEPTION 'forced effect audit outage';
        END IF;
        RETURN NEW;
      END $$;
      DROP TRIGGER IF EXISTS sage_test_reject_effect_audit ON agent_security_audit;
      CREATE TRIGGER sage_test_reject_effect_audit
      BEFORE INSERT ON agent_security_audit
      FOR EACH ROW EXECUTE FUNCTION sage_test_reject_effect_audit();
    `);
    const ledger = new PostgresToolEffectLedger({ connectionString: url! });
    const claim = makeClaim(`audit-failure-${Date.now()}`);
    try {
      await expect(ledger.claim(claim)).rejects.toThrow('forced effect audit outage');
      const count = await pool.query(
        'SELECT count(*) AS count FROM agent_effect_ledger WHERE tenant_id=$1 AND semantic_action_id=$2',
        [claim.tenantId, claim.semanticActionId],
      );
      expect(Number(count.rows[0].count)).toBe(0);
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS sage_test_reject_effect_audit ON agent_security_audit');
      await pool.query('DROP FUNCTION IF EXISTS sage_test_reject_effect_audit()');
      await pool.end();
      await migration.close();
    }
  });
});