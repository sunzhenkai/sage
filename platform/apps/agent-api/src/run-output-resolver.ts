import { extractOutputFile, isTextMediaType, mediaTypeForName } from '@sage/agent-package-release';
import type { TaskArtifactReference, TaskRunOutputRecord } from '@sage/task-domain';
import type { TaskArtifactResolver } from './task-api.js';

export interface RunOutputLookup {
  getRunOutput(tenantId: string, taskId: string): Promise<Pick<TaskRunOutputRecord, 'artifactRef' | 'output' | 'packageBytes' | 'mediaType'> | undefined>;
}

function textFromBytes(bytes: Uint8Array, mediaType: string): { readonly content: string; readonly encoding: 'utf-8' | 'base64' } {
  if (isTextMediaType(mediaType)) return { content: Buffer.from(bytes).toString('utf8'), encoding: 'utf-8' };
  return { content: Buffer.from(bytes).toString('base64'), encoding: 'base64' };
}

/**
 * local 通道的 artifact 内容解析：run 输出物化在 task_run_output。
 * package 行返回 gzip 字节；`#file/` 从 package 解出单条目。
 */
export function createRunOutputArtifactResolver(options: {
  readonly tenantId: string;
  readonly lookup: RunOutputLookup;
}): TaskArtifactResolver {
  return {
    async resolve(reference: TaskArtifactReference): Promise<TaskArtifactReference> {
      const output = await options.lookup.getRunOutput(options.tenantId, reference.taskId).catch(() => undefined);
      const [baseRef, fileName] = reference.artifactRef.split('#file/');
      if (output === undefined || output.artifactRef !== baseRef) return reference;
      if (fileName !== undefined && fileName.length > 0) {
        if (output.packageBytes !== undefined) {
          const bytes = extractOutputFile(output.packageBytes, fileName);
          if (bytes === undefined) return reference;
          const mediaType = mediaTypeForName(fileName);
          return { ...reference, mediaType, ...textFromBytes(bytes, mediaType) };
        }
        if (output.output !== undefined) return { ...reference, content: output.output, encoding: 'utf-8' };
        return reference;
      }
      if (output.packageBytes !== undefined) {
        return { ...reference, mediaType: 'application/gzip', content: Buffer.from(output.packageBytes).toString('base64'), encoding: 'base64' };
      }
      if (output.output !== undefined) return { ...reference, content: output.output, encoding: 'utf-8' };
      return reference;
    }
  };
}
