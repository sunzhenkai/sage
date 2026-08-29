import type { TaskArtifactReference } from '@sage/task-domain';
import type { TaskArtifactResolver } from './task-api.js';

export interface RunOutputLookup {
  getRunOutput(tenantId: string, taskId: string): Promise<{
    readonly artifactRef: string;
    readonly output: string;
  } | undefined>;
}

/**
 * local 通道的 artifact 内容解析：run 输出物化在 task_run_output，
 * 命中（且 artifactRef 一致）则随引用返回内容；未命中返回引用本体，不抛错。
 */
export function createRunOutputArtifactResolver(options: {
  readonly tenantId: string;
  readonly lookup: RunOutputLookup;
}): TaskArtifactResolver {
  return {
    async resolve(reference: TaskArtifactReference): Promise<TaskArtifactReference> {
      const output = await options.lookup.getRunOutput(options.tenantId, reference.taskId).catch(() => undefined);
      // `#file/{name}` 后缀引用是声明产物名清单的登记形态，内容仍取基准 run 输出。
      const baseRef = reference.artifactRef.split('#file/')[0]!;
      if (output === undefined || output.artifactRef !== baseRef) return reference;
      return { ...reference, content: output.output, encoding: 'utf-8' };
    }
  };
}
