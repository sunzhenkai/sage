import { describe, expect, it } from 'vitest';
import {
  enforceOutputContract,
  OutputContractViolation,
  stripThinkSegments,
  unwrapJsonFence,
  validateJsonSchemaSubset,
} from './output-contract.js';

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

describe('enforceOutputContract', () => {
  const contract = { task: 'digest', schema: JSON.stringify({ type: 'object', required: ['overview'], properties: { overview: { type: 'string' } } }), files: ['report.md'] };

  it('strips reasoning, unwraps the fence, validates, and returns pretty JSON', () => {
    const output = enforceOutputContract('<think>chain</think>\n\n```json\n{"overview":"ok"}\n```', contract);
    expect(output).toBe(JSON.stringify({ overview: 'ok' }, null, 2));
  });

  it('violates on missing required fields with actionable detail', () => {
    expect(() => enforceOutputContract('```json\n{"other":1}\n```', contract)).toThrow(OutputContractViolation);
    expect(() => enforceOutputContract('```json\n{"other":1}\n```', contract)).toThrow(/missing required property 'overview'/);
  });

  it('violates when output is empty after stripping or not JSON at all', () => {
    expect(() => enforceOutputContract('<think>only reasoning</think>', contract)).toThrow(/empty after stripping/);
    expect(() => enforceOutputContract('plain markdown report', contract)).toThrow(/not valid JSON/);
  });

  it('violates when the declared schema itself is malformed', () => {
    expect(() => enforceOutputContract('{"overview":"x"}', { schema: '{not-json' })).toThrow(/declared output schema is not valid JSON/);
  });

  it('returns the raw output untouched when no schema is declared', () => {
    const raw = '<think>r</think>anything';
    expect(enforceOutputContract(raw, { files: ['report.md'] })).toBe(raw);
  });
});
