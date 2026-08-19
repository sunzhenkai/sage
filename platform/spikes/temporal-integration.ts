import { randomUUID } from 'node:crypto';
import { Client, Connection } from '@temporalio/client';
import { bundleWorkflowCode, NativeConnection, Worker } from '@temporalio/worker';
import { fileURLToPath } from 'node:url';

const address = process.env.SAGE_TEMPORAL_ADDRESS ?? 'localhost:17233';
const namespace = 'sage-dev';
const taskQueue = `sage-p0-${randomUUID()}`;
const workflowId = `sage-p0-${randomUUID()}`;
const buildId = 'sage-p0-build-1';
const workflowsPath = fileURLToPath(new URL('./temporal/workflows.ts', import.meta.url));
const workflowBundle = await bundleWorkflowCode({ workflowsPath });
const nativeConnection = await NativeConnection.connect({ address });
const clientConnection = await Connection.connect({ address });

try {
  const worker = await Worker.create({
    connection: nativeConnection,
    namespace,
    taskQueue,
    workflowBundle,
    buildId
  });
  const client = new Client({ connection: clientConnection, namespace });
  const handle = await client.workflow.start('p0CompatibilityWorkflow', {
    workflowId,
    taskQueue,
    args: []
  });
  const result = await worker.runUntil(handle.result());
  if (result !== 'temporal-compatible') throw new Error(`Unexpected Workflow result: ${String(result)}`);

  const history = await handle.fetchHistory();
  await Worker.runReplayHistory({ workflowBundle }, history, workflowId);
  const stampedBuildIds = history.events
    ?.map((event) => event.workflowTaskCompletedEventAttributes?.workerVersion?.buildId)
    .filter((value): value is string => value !== undefined) ?? [];
  if (!stampedBuildIds.includes(buildId)) throw new Error(`History did not contain Build ID ${buildId}`);

  console.log(JSON.stringify({ namespace, workflowId, buildId, historyEvents: history.events?.length, replay: 'passed' }));
} finally {
  await nativeConnection.close();
  await clientConnection.close();
}
