import { describe, expect, it } from 'vitest';
import type { ScheduleDefinition } from '@sage/platform-ports';
import { runScheduleLifecycleConformance, TemporalScheduleAdapter } from './index.js';

// 真实 Temporal 垂直链路可选 gate（对齐 p4 惯例）：默认跳过；本地 compose 栈可用时以
// SAGE_TEMPORAL_ADDRESS=127.0.0.1:17233 运行（pnpm test:p8:integration）。
const address = process.env.SAGE_TEMPORAL_ADDRESS;
const namespace = process.env.SAGE_TEMPORAL_NAMESPACE ?? 'sage-dev';

describe.skipIf(!address)('TemporalScheduleAdapter vertical integration', () => {
  const unique = `conf${Date.now().toString(36)}`;
  const baseDefinition: ScheduleDefinition = {
    schemaVersion: '1' as const,
    scheduleId: `${unique}-daily`,
    tenantId: `tenant-${unique}`,
    trigger: { kind: 'interval', everyMs: 60_000 },
    overlapPolicy: 'SKIP',
    misfirePolicy: 'SKIP',
    releaseBinding: { strategy: 'FIXED', releaseId: 'release-1', contentDigest: `sha256:${'a'.repeat(64)}` },
    targetConstraints: { allowedEnvironments: ['local'] },
    budget: { limits: [{ dimension: 'runs', limit: 100 }] },
    invocation: { task: 'daily', params: { window: 7 } }
  };

  it('passes the lifecycle conformance battery against the real facility', async () => {
    const adapter = await TemporalScheduleAdapter.connect({ address: address!, namespace });
    try {
      const report = await runScheduleLifecycleConformance(
        { port: adapter, fireOccurrence: async () => undefined, settleRunning: async () => undefined, events: async () => [] },
        { tenantId: baseDefinition.tenantId, definition: baseDefinition }
      );
      expect(report.passed, JSON.stringify(report.cases)).toBe(true);
    } finally {
      await adapter.remove({ tenantId: baseDefinition.tenantId, scheduleId: `${unique}-daily-pause` }).catch(() => undefined);
      await adapter.remove({ tenantId: baseDefinition.tenantId, scheduleId: `${unique}-daily-remove` }).catch(() => undefined);
    }
  });

  it('reports a facility next fire time and mirrors pause state', async () => {
    const adapter = await TemporalScheduleAdapter.connect({ address: address!, namespace });
    const definition = { ...baseDefinition, scheduleId: `${unique}-nextfire` };
    try {
      const snapshot = await adapter.create(definition);
      expect(snapshot.state).toBe('ACTIVE');
      const ref = { tenantId: definition.tenantId, scheduleId: definition.scheduleId };
      const next = await adapter.nextFireAtMs!(ref);
      expect(next).toBeDefined();
      expect(next! - Date.now()).toBeLessThanOrEqual(61_000);
      const paused = await adapter.pause(ref);
      expect(paused.state).toBe('PAUSED');
      expect(await adapter.nextFireAtMs!(ref)).toBeUndefined();
      const resumed = await adapter.resume(ref);
      expect(resumed.state).toBe('ACTIVE');
      expect(await adapter.nextFireAtMs!(ref)).toBeDefined();
    } finally {
      await adapter.remove({ tenantId: definition.tenantId, scheduleId: definition.scheduleId }).catch(() => undefined);
    }
  });
});
