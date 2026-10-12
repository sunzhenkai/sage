import type { PackageRunContract } from '@sage/task-domain';

/**
 * 包运行输出契约强制（物化点管线）：剥离 <think> 段 → JSON 围栏解包 →
 * 按 JSON Schema 核心子集校验。未声明 schema 的 Task 不进入本管线（行为零变化）。
 * 支持的关键字子集：type / properties / required / items / enum / const（嵌套）。
 * 未知关键字宽松跳过（fail-open on unknown keywords），已知关键字严格判定。
 */

export const OUTPUT_CONTRACT_VIOLATION_CODE = 'PACKAGE_OUTPUT_CONTRACT_VIOLATION' as const;

export class OutputContractViolation extends Error {
  constructor(detail: string) {
    super(`${OUTPUT_CONTRACT_VIOLATION_CODE}:${detail}`);
    this.name = 'OutputContractViolation';
  }
}

/** 剥离内联 <think>…</think> 段（大小写不敏感；未闭合的开标签视为思考至结尾，全部剥离）。 */
export function stripThinkSegments(text: string): string {
  let result = '';
  let cursor = 0;
  let thinking = false;
  const pattern = /<think>|<\/think>/gi;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (!thinking) result += text.slice(cursor, index);
    thinking = match[0].toLowerCase() === '<think>';
    cursor = index + match[0].length;
  }
  if (!thinking) result += text.slice(cursor);
  return result.trim();
}

/** 单一 ```json 围栏块解包；其余形态返回原文。 */
export function unwrapJsonFence(text: string): string {
  const match = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?\s*```\s*$/.exec(text);
  return match === null ? text : match[1]!;
}

type JsonValue = null | boolean | number | string | JsonValue[] | { readonly [key: string]: JsonValue };

const jsonTypeOf = (value: JsonValue): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return typeof value;
};

/** JSON Schema 核心子集校验：返回违规定义（instance path → 原因）；空数组即通过。 */
export function validateJsonSchemaSubset(value: JsonValue, schema: unknown, path = '$'): string[] {
  if (schema === true || schema === undefined) return [];
  if (schema === false) return [`${path}: schema forbids any value`];
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return [];
  const node = schema as Readonly<Record<string, unknown>>;
  const violations: string[] = [];
  if (typeof node.type === 'string') {
    const actual = jsonTypeOf(value);
    const expected = node.type === 'integer' ? 'number' : node.type;
    if (actual !== expected || (node.type === 'integer' && typeof value === 'number' && !Number.isInteger(value))) {
      violations.push(`${path}: expected ${String(node.type)}, got ${actual}`);
    }
  }
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    if (!node.enum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) {
      violations.push(`${path}: value not in enum`);
    }
  }
  if (node.const !== undefined && JSON.stringify(node.const) !== JSON.stringify(value)) {
    violations.push(`${path}: value does not match const`);
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const properties = typeof node.properties === 'object' && node.properties !== null && !Array.isArray(node.properties)
      ? node.properties as Readonly<Record<string, unknown>>
      : {};
    for (const key of Array.isArray(node.required) ? node.required : []) {
      if (typeof key === 'string' && !(key in value)) violations.push(`${path}: missing required property '${key}'`);
    }
    for (const [key, child] of Object.entries(properties)) {
      if (key in value) violations.push(...validateJsonSchemaSubset((value as Readonly<Record<string, JsonValue>>)[key]!, child, `${path}.${key}`));
    }
  }
  if (Array.isArray(value) && node.items !== undefined) {
    value.forEach((item, index) => { violations.push(...validateJsonSchemaSubset(item, node.items, `${path}[${index}]`)); });
  }
  return violations;
}

/**
 * 强制管线：剥离 →（声明 schema 时）解包 + JSON 解析 + 子集校验。
 * 返回应物化的输出（声明 schema 时为解包后的 JSON 文本；剥离失败解包即空文本为违约）。
 * 任何违约抛 OutputContractViolation（slice 以稳定错误码失败，可重试）。
 */
export function enforceOutputContract(rawOutput: string, contract: PackageRunContract): string {
  if (contract.schema === undefined) return rawOutput;
  const stripped = stripThinkSegments(rawOutput);
  if (stripped.length === 0) throw new OutputContractViolation('output is empty after stripping reasoning segments');
  const unwrapped = unwrapJsonFence(stripped);
  let instance: JsonValue;
  try {
    instance = JSON.parse(unwrapped) as JsonValue;
  } catch {
    throw new OutputContractViolation('output is not valid JSON while the task declares an output schema');
  }
  let schema: unknown;
  try {
    schema = JSON.parse(contract.schema);
  } catch {
    throw new OutputContractViolation('declared output schema is not valid JSON');
  }
  const violations = validateJsonSchemaSubset(instance, schema);
  if (violations.length > 0) throw new OutputContractViolation(violations.join('; '));
  return JSON.stringify(instance, null, 2);
}
