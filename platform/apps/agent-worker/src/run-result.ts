import { validateJsonSchemaSubset } from './output-contract.js';

/**
 * 可校验运行结果文件（RunResult.v1）：概念见 platform/architecture/ai-app-concept.md §7。
 * 每次包运行必须产出，由 worker 在物化点生成并按内置 schema 自检；包无需声明，
 * run-result.json 为平台保留文件名，包产物中的同名文件在物化点被覆盖。
 */

export const RUN_RESULT_FILE_NAME = 'run-result.json' as const;
export const RUN_RESULT_SCHEMA_VERSION = 'RunResult.v1' as const;

export interface RunResultFileEntry {
  readonly name: string;
  readonly bytes: number;
}

export interface RunResultInput {
  readonly taskId: string;
  readonly releaseId: string;
  readonly status: 'succeeded' | 'failed';
  /** 业务产物清单（不含 run-result.json 自身）；仅成功时携带。 */
  readonly files?: readonly RunResultFileEntry[];
  readonly failureCode?: string;
  readonly failureDetail?: string;
  readonly finishedAt: string;
}

const RUN_RESULT_SCHEMA = {
  type: 'object',
  required: ['schemaVersion', 'taskId', 'releaseId', 'status', 'finishedAt'],
  properties: {
    schemaVersion: { const: RUN_RESULT_SCHEMA_VERSION },
    taskId: { type: 'string' },
    releaseId: { type: 'string' },
    status: { enum: ['succeeded', 'failed'] },
    files: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'bytes'],
        properties: { name: { type: 'string' }, bytes: { type: 'integer' } }
      }
    },
    failureCode: { type: 'string' },
    failureDetail: { type: 'string' },
    finishedAt: { type: 'string' }
  }
} as const;

/** 生成 RunResult.v1 文本；生成后按内置 schema 自检，违约抛稳定错误。 */
export function buildRunResult(input: RunResultInput): string {
  const result = {
    schemaVersion: RUN_RESULT_SCHEMA_VERSION,
    taskId: input.taskId,
    releaseId: input.releaseId,
    status: input.status,
    ...(input.files === undefined ? {} : { files: input.files.map((file) => ({ name: file.name, bytes: file.bytes })) }),
    ...(input.failureCode === undefined ? {} : { failureCode: input.failureCode }),
    ...(input.failureDetail === undefined ? {} : { failureDetail: input.failureDetail }),
    finishedAt: input.finishedAt
  };
  const violations = validateJsonSchemaSubset(result, RUN_RESULT_SCHEMA);
  if (violations.length > 0) {
    throw new Error(`RUN_RESULT_CONTRACT_VIOLATION:${violations.join('; ')}`);
  }
  return JSON.stringify(result, null, 2);
}
