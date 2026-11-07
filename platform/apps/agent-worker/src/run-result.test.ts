import { describe, expect, it } from 'vitest';
import { buildRunResult, RUN_RESULT_FILE_NAME, RUN_RESULT_SCHEMA_VERSION } from './run-result.js';

describe('buildRunResult', () => {
  it('builds a succeeded result with the business file manifest', () => {
    const text = buildRunResult({
      taskId: 'pkg-1', releaseId: 'sha256:rel', status: 'succeeded',
      files: [{ name: 'brief.json', bytes: 42 }, { name: 'notes.md', bytes: 7 }],
      finishedAt: '2026-11-07T02:00:00.000Z'
    });
    expect(JSON.parse(text)).toEqual({
      schemaVersion: RUN_RESULT_SCHEMA_VERSION,
      taskId: 'pkg-1',
      releaseId: 'sha256:rel',
      status: 'succeeded',
      files: [{ name: 'brief.json', bytes: 42 }, { name: 'notes.md', bytes: 7 }],
      finishedAt: '2026-11-07T02:00:00.000Z'
    });
  });

  it('builds a failed result without files and with failure fields', () => {
    const text = buildRunResult({
      taskId: 'pkg-2', releaseId: 'sha256:rel', status: 'failed',
      failureCode: 'PACKAGE_OUTPUT_CONTRACT_VIOLATION', failureDetail: 'output is not valid JSON',
      finishedAt: '2026-11-07T02:01:00.000Z'
    });
    expect(JSON.parse(text)).toEqual({
      schemaVersion: RUN_RESULT_SCHEMA_VERSION,
      taskId: 'pkg-2',
      releaseId: 'sha256:rel',
      status: 'failed',
      failureCode: 'PACKAGE_OUTPUT_CONTRACT_VIOLATION',
      failureDetail: 'output is not valid JSON',
      finishedAt: '2026-11-07T02:01:00.000Z'
    });
  });

  it('rejects results that violate the built-in schema', () => {
    expect(() => buildRunResult({
      taskId: 'pkg-3', releaseId: 'sha256:rel',
      status: 'unknown' as never,
      finishedAt: '2026-11-07T02:02:00.000Z'
    })).toThrow(/RUN_RESULT_CONTRACT_VIOLATION/);
  });

  it('uses the platform-reserved file name', () => {
    expect(RUN_RESULT_FILE_NAME).toBe('run-result.json');
  });
});
