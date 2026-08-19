import { describe, expect, it } from 'vitest';
import {
  findReferenceWorkloadBoundaryViolations,
  findReferenceWorkloadSourceViolations,
} from './check-reference-workload-boundaries.mjs';

describe('reference workload ownership gate', () => {
  it('allows only declaration-owned reference workload files', () => {
    expect(findReferenceWorkloadBoundaryViolations([
      'platform/fixtures/reference-workload/controlled-summary/agent-package.json',
      'platform/fixtures/reference-workload/controlled-summary/controlled-summary.integration.test.ts',
    ])).toEqual([]);
  });

  it('rejects protected runtime and canonical API changes', () => {
    expect(findReferenceWorkloadBoundaryViolations([
      'platform/packages/agent-lib/src/kernel.ts',
      'platform/apps/agent-api/src/routes.ts',
      'platform/packages/task-domain/src/task.ts',
    ])).toHaveLength(3);
  });

  it('rejects unrelated changes and runtime authority source in the workload root', () => {
    expect(findReferenceWorkloadBoundaryViolations(['platform/packages/other/src/index.ts'])).toHaveLength(1);
    expect(findReferenceWorkloadSourceViolations([
      ['platform/fixtures/reference-workload/controlled-summary/skill.ts',
        "import { AgentRuntimeKernel } from '@sage/agent-lib';\nnew AgentRuntimeKernel();"],
      ['platform/fixtures/reference-workload/controlled-summary/route.ts',
        'if (taskType === "custom") return true;'],
    ])).toHaveLength(2);
  });
});
