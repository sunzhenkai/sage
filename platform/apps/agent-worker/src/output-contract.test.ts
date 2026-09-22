import { describe, expect, it } from 'vitest';
import { ApplicationFailure } from '@temporalio/activity';
import {
  stripThinkSegments,
  unwrapJsonFence,
  validateJsonSchemaSubset,
  enforceOutputContract
} from './output-contract.js';
import { classifySliceFailure } from './activities.js';

describe('stripThinkSegments', () => {
  it('removes paired think segments and trims', () => {
    expect(stripThinkSegments('<think>reasoning</think>\n\n# Answer\n\nbody')).toBe('# Answer\n\nbody');
    expect(stripThinkSegments('before<think>r</think>after')).toBe('beforeafter');
  });
  it('is case-insensitive and handles multiple segments', () => {
    expect(stripThinkSegments('<THINK>a</THINK>x<think>b</think>y')).toBe('xy');
  });
  it('strips to the end on an unclosed opening tag', () => {
    expect(stripThinkSegments('visible<think>never closed')).toBe('visible');
  });
  it('keeps text after a stray closing tag', () => {
    expect(stripThinkSegments('</think>kept')).toBe('kept');
  });
  it('returns plain text unchanged', () => {
    expect(stripThinkSegments('# report\n\n- item')).toBe('# report\n\n- item');
    expect(stripThinkSegments('')).toBe('');
  });
});

describe('unwrapJsonFence', () => {
  it('unwraps a single fenced json block', () => {
    expect(unwrapJsonFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(unwrapJsonFence('```\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it('keeps non-fenced and multi-block text as-is', () => {
    expect(unwrapJsonFence('{"a":1}')).toBe('{"a":1}');
    expect(unwrapJsonFence('```json\n{"a":1}\n```\ntail')).toBe('```json\n{"a":1}\n```\ntail');
  });
});

describe('validateJsonSchemaSubset', () => {
  const schema = {
    type: 'object',
    required: ['overview', 'repos'],
    properties: {
      overview: { type: 'string' },
      repos: { type: 'array', items: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, stars: { type: 'integer' } } } },
      level: { enum: ['low', 'high'] }
    }
  };

  it('accepts a conforming instance', () => {
    expect(validateJsonSchemaSubset({ overview: 'x', repos: [{ name: 'a', stars: 3 }], level: 'low' }, schema)).toEqual([]);
  });

  it('reports missing required, wrong types, bad enum, and nested item violations', () => {
    const violations = validateJsonSchemaSubset({ repos: [{ stars: 'many' }], level: 'mid' }, schema);
    expect(violations.some((item) => item.includes("missing required property 'overview'"))).toBe(true);
    expect(violations.some((item) => item.includes('$.repos[0]: missing required property \'name\''))).toBe(true);
    expect(violations.some((item) => item.includes('$.repos[0].stars: expected integer'))).toBe(true);
    expect(violations.some((item) => item.includes('$.level: value not in enum'))).toBe(true);
  });
});

describe('enforceOutputContract remains a deterministic-artifact helper', () => {
  it('still validates JSON when invoked directly, but worker no longer calls it on model text', () => {
    const schema = JSON.stringify({ type: 'object', required: ['overview'], properties: { overview: { type: 'string' } } });
    expect(enforceOutputContract('```json\n{"overview":"ok"}\n```', { schema })).toContain('overview');
    expect(enforceOutputContract('plain markdown', { files: ['brief.md'] })).toBe('plain markdown');
  });

  it('treats schema-present and schema-absent text as equivalent for materialization (no body gate)', () => {
    const body = 'not json at all';
    expect(enforceOutputContract(body, { files: ['brief.md'] })).toBe(body);
    expect(enforceOutputContract(body, { files: ['brief.md'], ...({ schema: undefined } as unknown as { schema?: string }) })).toBe(body);
  });
});

describe('classifySliceFailure', () => {
  it('marks non-retryable ApplicationFailure as failed', () => {
    const failure = ApplicationFailure.nonRetryable('missing provider', 'PROVIDER_DEPENDENCY_MISSING');
    expect(classifySliceFailure(failure, 1)).toEqual({
      kind: 'failed', failureCode: 'PROVIDER_DEPENDENCY_MISSING', detail: 'missing provider'
    });
  });

  it('retries retryable errors before the last attempt', () => {
    expect(classifySliceFailure(new Error('timeout'), 2)).toEqual({ kind: 'retry' });
  });

  it('marks the last retryable attempt as ACTIVITY_FAILED', () => {
    expect(classifySliceFailure(new Error('timeout'), 5)).toEqual({
      kind: 'failed', failureCode: 'ACTIVITY_FAILED', detail: 'timeout'
    });
  });
});
