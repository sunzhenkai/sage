import { describe, expect, it } from 'vitest';
import { ActivityFailure, ApplicationFailure, TimeoutFailure } from '@temporalio/workflow';
import type { AgentSliceResult, AgentTaskWorkflowInput } from '@sage/task-domain';
import { extractActivityFailure, nextStatusAfterSlice, projectionOfState } from './workflows.js';

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
  it('uses committed slices as revision and carries failure code and detail', () => {
    expect(projectionOfState(input, {
      schemaVersion: '1', taskType: 'sage.agent-task.v1', taskId: 'task-state', workflowId: 'workflow-state',
      targetId: 'target-state', attempt: 1, status: 'failed', committedSlices: 0, manualRetries: 1,
      failureCode: 'SLICE_FAILED', failureDetail: 'upstream model timed out'
    })).toMatchObject({
      status: 'failed', revision: 0, failureCode: 'SLICE_FAILED',
      failureDetail: 'upstream model timed out', projectionSource: 'writer'
    });
  });
});

describe('extractActivityFailure', () => {
  it('unwraps ActivityFailure wrapping a typed ApplicationFailure', () => {
    const inner = ApplicationFailure.nonRetryable('bad schema output', 'OUTPUT_CONTRACT_VIOLATION');
    const wrapped = new ActivityFailure('Activity task failed', 'executeAgentSlice', '1', undefined, undefined, inner);
    expect(extractActivityFailure(wrapped)).toEqual({
      failureCode: 'OUTPUT_CONTRACT_VIOLATION',
      failureDetail: 'bad schema output'
    });
  });

  it('falls back to ACTIVITY_RETRIES_EXHAUSTED for generic Error type while preserving message', () => {
    const inner = ApplicationFailure.retryable('TASK_SLICE_ALREADY_IN_PROGRESS', 'Error');
    const wrapped = new ActivityFailure('Activity task failed', 'executeAgentSlice', '1', undefined, undefined, inner);
    expect(extractActivityFailure(wrapped)).toEqual({
      failureCode: 'ACTIVITY_RETRIES_EXHAUSTED',
      failureDetail: 'TASK_SLICE_ALREADY_IN_PROGRESS'
    });
  });

  it('maps TimeoutFailure to ACTIVITY_TIMED_OUT with readable detail', () => {
    const inner = new TimeoutFailure('', undefined, 1 as unknown as TimeoutFailure['timeoutType']);
    const wrapped = new ActivityFailure('Activity task timed out', 'executeAgentSlice', '1', undefined, undefined, inner);
    expect(extractActivityFailure(wrapped)).toEqual({
      failureCode: 'ACTIVITY_TIMED_OUT',
      failureDetail: 'Activity task timed out'
    });
    expect(extractActivityFailure(inner)).toEqual({
      failureCode: 'ACTIVITY_TIMED_OUT',
      failureDetail: 'Activity timed out (1)'
    });
  });

  it('extracts message from plain Error', () => {
    expect(extractActivityFailure(new Error('network reset'))).toEqual({
      failureCode: 'ACTIVITY_RETRIES_EXHAUSTED',
      failureDetail: 'network reset'
    });
  });
});
