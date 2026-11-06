import { describe, expect, it } from 'vitest';
import type { AgentSliceResult, AgentTaskWorkflowInput } from '@sage/task-domain';
import { nextStatusAfterSlice, projectionOfState } from './workflows.js';

const sliceResult = (overrides: Partial<AgentSliceResult>): AgentSliceResult => ({
  schemaVersion: '1', taskId: 'task-state', sliceNumber: 1, outcome: 'committed', done: false, duplicate: false, ...overrides
});

const input: AgentTaskWorkflowInput = {
  schemaVersion: '1', taskType: 'sage.agent-task.v1', taskId: 'task-state', tenantId: 'tenant-state',
  workflowId: 'workflow-state', targetId: 'target-state', inputRef: 'task-input://task-state/input' as never,
  attempt: 1, maxSlices: 2, sliceDelayMs: 1, slice: { maxTurns: 1, maxToolCalls: 1, maxTokens: 1, timeoutMs: 1_000 }
};

describe('workflow slice status transitions', () => {
  it('never reports a failed slice result as success', () => {
    expect(nextStatusAfterSlice('running', sliceResult({ outcome: 'failed', done: true }))).toBe('failed');
    expect(nextStatusAfterSlice('failed', sliceResult({ outcome: 'failed', done: true }))).toBe('failed');
  });

  it('keeps effect_unknown terminal', () => {
    expect(nextStatusAfterSlice('running', sliceResult({ outcome: 'effect_unknown', done: false }))).toBe('effect_unknown');
  });

  it('does not let an in-flight slice completion override pause', () => {
    expect(nextStatusAfterSlice('paused', sliceResult({ done: false }))).toBe('paused');
  });

  it('lets completion win over a pause that arrived during the final slice', () => {
    expect(nextStatusAfterSlice('paused', sliceResult({ done: true }))).toBe('succeeded');
  });

  it('advances committed slices to running or succeeded', () => {
    expect(nextStatusAfterSlice('running', sliceResult({ done: false }))).toBe('running');
    expect(nextStatusAfterSlice('running', sliceResult({ done: true }))).toBe('succeeded');
  });
});

describe('terminal projection shape', () => {
  it('uses committed slices as revision and carries failure code', () => {
    expect(projectionOfState(input, {
      schemaVersion: '1', taskType: 'sage.agent-task.v1', taskId: 'task-state', workflowId: 'workflow-state',
      targetId: 'target-state', attempt: 1, status: 'failed', committedSlices: 0, manualRetries: 1,
      failureCode: 'SLICE_FAILED'
    })).toMatchObject({ status: 'failed', revision: 0, failureCode: 'SLICE_FAILED', projectionSource: 'writer' });
  });
});
