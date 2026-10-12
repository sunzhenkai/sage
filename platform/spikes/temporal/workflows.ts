import { defineSignal, setHandler, sleep } from '@temporalio/workflow';

export const proceedSignal = defineSignal('proceed');

export async function p0CompatibilityWorkflow(): Promise<string> {
  let proceed = false;
  setHandler(proceedSignal, () => { proceed = true; });
  await Promise.race([
    sleep('1ms'),
    (async () => {
      while (!proceed) await sleep('1ms');
    })()
  ]);
  return 'temporal-compatible';
}
