import { sleep } from '@temporalio/workflow';
import type { AgentTaskWorkflowInput, TaskWorkflowState } from '@sage/task-domain';

export async function AgentTaskWorkflow(input: AgentTaskWorkflowInput): Promise<TaskWorkflowState> {
  await sleep('1 hour');
  return {
    schemaVersion: '1', taskType: input.taskType, taskId: input.taskId, workflowId: input.workflowId,
    targetId: input.targetId, attempt: input.attempt, status: 'failed', committedSlices: 0,
    manualRetries: 0, failureCode: 'INTENTIONAL_NONDETERMINISM_FIXTURE'
  };
}
