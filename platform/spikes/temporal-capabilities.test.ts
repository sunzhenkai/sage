import { describe, expect, it } from 'vitest';
import { bundleWorkflowCode, type WorkerOptions } from '@temporalio/worker';
import type { ConnectionOptions } from '@temporalio/client';
import { fileURLToPath } from 'node:url';

const workflowsPath = fileURLToPath(new URL('./temporal/workflows.ts', import.meta.url));

describe('Temporal SDK 1.22.0 capability spike', () => {
  it('bundles deterministic Workflow code without application dependencies', async () => {
    const bundle = await bundleWorkflowCode({ workflowsPath });
    expect(bundle.code.length).toBeGreaterThan(100_000);
    expect(bundle.code).not.toContain('@sage/agent-lib');
    expect(bundle.code).not.toContain('node:fs');
  }, 30_000);

  it('type-checks explicit Namespace, Task Queue and Build ID worker identity', () => {
    const workerIdentity = {
      namespace: 'sage-dev',
      taskQueue: 'sage-p0-spike',
      buildId: 'sage-p0-1'
    } satisfies Pick<WorkerOptions, 'namespace' | 'taskQueue' | 'buildId'>;
    expect(workerIdentity).toEqual({ namespace: 'sage-dev', taskQueue: 'sage-p0-spike', buildId: 'sage-p0-1' });
  });

  it('type-checks complete mTLS client material without embedding credentials', () => {
    const tls = {
      serverNameOverride: 'temporal.internal',
      serverRootCACertificate: new Uint8Array([1]),
      clientCertPair: { crt: new Uint8Array([2]), key: new Uint8Array([3]) }
    } satisfies NonNullable<ConnectionOptions['tls']>;
    expect(tls.clientCertPair.crt).toHaveLength(1);
    expect(tls.clientCertPair.key).toHaveLength(1);
  });
});
