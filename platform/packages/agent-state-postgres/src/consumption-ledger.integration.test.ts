import { describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { sha256Digest, type UsageReceiptV1 } from '@sage/agent-contracts';
import { PostgresAgentStateAdapter, PostgresConsumptionLedger } from './index.js';
const url = process.env.PHASE4_POSTGRES_URL;
const receipt = (base: Omit<UsageReceiptV1, 'receiptDigest'>): UsageReceiptV1 => ({ ...base, receiptDigest: sha256Digest(base) });
async function setup(suffix: string) { const migration = new PostgresAgentStateAdapter({ connectionString: url! }); await migration.migrate(); const pool = new Pool({ connectionString: url! }); const tenant = `usage-${suffix}-${Date.now()}`; await pool.query(`INSERT INTO agent_usage_accounts(tenant_id,account_ref,balance) VALUES($1,'acct',$2)`, [tenant, { tokens: 100 }]); await pool.end(); const ledger = new PostgresConsumptionLedger({ connectionString: url! }); const reservation = await ledger.reserve({ schemaVersion: '1', tenantId: tenant, accountRef: 'acct', invocationId: 'inv', ownerRef: 'principal://worker', taskId: 'task', runId: 'run', attemptId: 'attempt', specRef: 'spec://1', upperBound: { tokens: 20 }, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() }); return { migration, ledger, tenant, reservation }; }
describe.skipIf(!url)('PostgreSQL Consumption Ledger', () => {
  it('never double settles, accepts noncanonical fields, or overwrites a conflicting receipt', async () => { const { migration, ledger, tenant, reservation } = await setup('canonical'); const usage = receipt({ schemaVersion: '1', receiptRef: 'usage-receipt://1', tenantId: tenant, accountRef: 'acct', invocationId: 'inv', reservationRef: reservation.reservationRef, actual: { tokens: 7 }, cost: 0, committedAt: new Date().toISOString() }); expect(await ledger.commit({ reservation, receipt: usage })).toMatchObject({ status: 'committed' }); expect(await ledger.commit({ reservation, receipt: usage })).toMatchObject({ status: 'existing' }); expect(await ledger.commit({ reservation, receipt: { ...usage, receiptDigest: sha256Digest('different') } })).toEqual({ status: 'conflict', code: 'USAGE_CONFLICT' }); expect(await ledger.commit({ reservation, receipt: { ...usage, actual: { tokens: -1 }, receiptDigest: sha256Digest({ ...usage, actual: { tokens: -1 } }, { excludeKeys: ['receiptDigest'] }) } })).toEqual({ status: 'conflict', code: 'USAGE_CONFLICT' }); expect(await ledger.getAuthoritativeBalance({ tenantId: tenant, accountRef: 'acct' })).toMatchObject({ available: { tokens: 93 }, reserved: { tokens: 0 } }); await migration.close(); });
  it('fences orphan/commit races and settles a late receipt after safe recovery without minting budget', async () => { const { migration, ledger, tenant, reservation } = await setup('race'); const usage = receipt({ schemaVersion: '1', receiptRef: 'usage-receipt://race', tenantId: tenant, accountRef: 'acct', invocationId: 'inv', reservationRef: reservation.reservationRef, actual: { tokens: 7 }, cost: 0, committedAt: new Date().toISOString() }); const future = new Date(Date.parse(reservation.leaseExpiresAt) + 1).toISOString(); const [commitResult, recoveryResult] = await Promise.all([ledger.commit({ reservation, receipt: usage }), ledger.recoverOrphan({ reservation, now: future, evidenceDigest: sha256Digest('no-active-execution') })]); expect(['committed', 'existing']).toContain(commitResult.status); expect(['expired', 'conflict']).toContain(recoveryResult); expect(await ledger.commit({ reservation, receipt: usage })).toMatchObject({ status: 'existing' }); expect(await ledger.getAuthoritativeBalance({ tenantId: tenant, accountRef: 'acct' })).toMatchObject({ available: { tokens: 93 }, reserved: { tokens: 0 } }); await migration.close(); });
  it('settles an authenticated late receipt after an orphan was fenced expired', async () => { const { migration, ledger, tenant, reservation } = await setup('late'); const future = new Date(Date.parse(reservation.leaseExpiresAt) + 1).toISOString(); expect(await ledger.recoverOrphan({ reservation, now: future, evidenceDigest: sha256Digest('orphan-proof') })).toBe('expired'); expect(await ledger.getAuthoritativeBalance({ tenantId: tenant, accountRef: 'acct' })).toMatchObject({ available: { tokens: 100 }, reserved: { tokens: 0 } }); const usage = receipt({ schemaVersion: '1', receiptRef: 'usage-receipt://late', tenantId: tenant, accountRef: 'acct', invocationId: 'inv', reservationRef: reservation.reservationRef, actual: { tokens: 7 }, cost: 0, committedAt: future }); expect(await ledger.commit({ reservation, receipt: usage })).toMatchObject({ status: 'committed' }); expect(await ledger.getAuthoritativeBalance({ tenantId: tenant, accountRef: 'acct' })).toMatchObject({ available: { tokens: 93 }, reserved: { tokens: 0 } }); await migration.close(); });
});


describe.skipIf(!url)('PostgreSQL Usage audit atomicity', () => {
  it('rolls back a Usage reservation and budget debit when its security-audit insert fails', async () => {
    const migration = new PostgresAgentStateAdapter({ connectionString: url! });
    const pool = new Pool({ connectionString: url! });
    await migration.migrate();
    const tenant = `usage-audit-failure-${Date.now()}`;
    await pool.query(
      `INSERT INTO agent_usage_accounts(tenant_id,account_ref,balance) VALUES($1,'acct',$2)`,
      [tenant, { tokens: 100 }],
    );
    await pool.query(`
      CREATE OR REPLACE FUNCTION sage_test_reject_usage_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.tenant_id LIKE 'usage-audit-failure-%' THEN
          RAISE EXCEPTION 'forced usage audit outage';
        END IF;
        RETURN NEW;
      END $$;
      DROP TRIGGER IF EXISTS sage_test_reject_usage_audit ON agent_security_audit;
      CREATE TRIGGER sage_test_reject_usage_audit
      BEFORE INSERT ON agent_security_audit
      FOR EACH ROW EXECUTE FUNCTION sage_test_reject_usage_audit();
    `);
    const ledger = new PostgresConsumptionLedger({ connectionString: url! });
    try {
      await expect(ledger.reserve({
        schemaVersion: '1',
        tenantId: tenant,
        accountRef: 'acct',
        invocationId: 'inv-audit-failure',
        ownerRef: 'principal://worker',
        taskId: 'task',
        runId: 'run',
        attemptId: 'attempt',
        specRef: 'spec://1',
        upperBound: { tokens: 20 },
        leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      })).rejects.toThrow('forced usage audit outage');
      const reservationCount = await pool.query(
        'SELECT count(*) AS count FROM agent_usage_reservations WHERE tenant_id=$1 AND invocation_id=$2',
        [tenant, 'inv-audit-failure'],
      );
      expect(Number(reservationCount.rows[0].count)).toBe(0);
      expect(await ledger.getAuthoritativeBalance({ tenantId: tenant, accountRef: 'acct' })).toMatchObject({
        available: { tokens: 100 },
        reserved: {},
      });
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS sage_test_reject_usage_audit ON agent_security_audit');
      await pool.query('DROP FUNCTION IF EXISTS sage_test_reject_usage_audit()');
      await pool.end();
      await migration.close();
    }
  });
});