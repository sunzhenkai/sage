import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

/**
 * 源包域：ai app 源包的 manifest（app.yaml）契约。
 * 与编译后的 AgentPackageRelease.v1 不同，这里描述的是「目录即包」的声明式源格式。
 */

export const AgentSourcePackageIdSchema = Type.String({
  pattern: '^[a-z0-9][a-z0-9-]{1,127}$',
  description: '包 id：小写字母数字与连字符，以字母数字开头',
});
export type AgentSourcePackageId = Static<typeof AgentSourcePackageIdSchema>;

export const AgentSourcePackageVersionSchema = Type.String({
  pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$',
  description: '语义化版本',
});
export type AgentSourcePackageVersion = Static<typeof AgentSourcePackageVersionSchema>;

export const AgentSourceEntryRefSchema = Type.String({
  pattern: '^prompts/[a-zA-Z0-9._-]+\\.md$',
  description: 'entry prompt 的相对路径，必须位于 prompts/ 且以 .md 结尾',
});
export type AgentSourceEntryRef = Static<typeof AgentSourceEntryRefSchema>;

export const AgentSourceBudgetSchema = Type.Object(
  {
    maxTokens: Type.Optional(Type.Integer({ minimum: 1 })),
    maxToolCalls: Type.Optional(Type.Integer({ minimum: 0 })),
    maxTurns: Type.Optional(Type.Integer({ minimum: 1 })),
    maxDurationMs: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false }
);
export type AgentSourceBudget = Static<typeof AgentSourceBudgetSchema>;

export const AgentSourceModelRouteSchema = Type.Object(
  {
    provider: Type.String({ pattern: '^[a-z][a-z0-9-]{0,63}$' }),
    model: Type.String({ minLength: 1, maxLength: 256 }),
    fallbacks: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { uniqueItems: true })),
  },
  { additionalProperties: false }
);
export type AgentSourceModelRoute = Static<typeof AgentSourceModelRouteSchema>;

/** v2 声明块界限：与 spec「源包目录规范与 manifest 契约」增量一致。 */
export const MAX_SOURCE_INPUTS = 8;
export const MAX_SOURCE_DATA_SOURCES = 8;
export const MAX_SOURCE_TASKS = 16;
export const MAX_SOURCE_OUTPUT_FILES = 8;
export const MAX_SOURCE_DATA_SOURCE_BYTES = 512 * 1024;

export const AgentSourceParamNameSchema = Type.String({
  pattern: '^[a-z][a-z0-9-]{0,63}$',
  description: '参数/数据源/任务名：小写字母数字与连字符',
});
export type AgentSourceParamName = Static<typeof AgentSourceParamNameSchema>;

export const AgentSourceInputParamSchema = Type.Object(
  {
    name: AgentSourceParamNameSchema,
    type: Type.Union([Type.Literal('string'), Type.Literal('enum'), Type.Literal('number')]),
    enum: Type.Optional(
      Type.Array(Type.Union([Type.String({ maxLength: 256 }), Type.Number()]), { minItems: 1, maxItems: 32, uniqueItems: true })
    ),
    default: Type.Optional(Type.Union([Type.String({ maxLength: 2_048 }), Type.Number()])),
    required: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false }
);
export type AgentSourceInputParam = Static<typeof AgentSourceInputParamSchema>;

export const AgentSourceDataSourceSchema = Type.Object(
  {
    name: AgentSourceParamNameSchema,
    ref: Type.String({ pattern: '^capability://[a-z0-9-]+/v[0-9]+$' }),
    url: Type.String({ minLength: 8, maxLength: 2_048 }),
    maxBytes: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_SOURCE_DATA_SOURCE_BYTES })),
    onFailure: Type.Optional(Type.Union([Type.Literal('fail'), Type.Literal('markMissing')])),
  },
  { additionalProperties: false }
);
export type AgentSourceDataSource = Static<typeof AgentSourceDataSourceSchema>;

export const AgentSourceTaskOutputSchema = Type.Object(
  {
    schema: Type.Optional(Type.String({ pattern: '^[A-Za-z0-9._/-]+\\.json$' })),
    files: Type.Optional(
      Type.Array(Type.String({ pattern: '^[A-Za-z0-9._-]+$', minLength: 1, maxLength: 128 }), {
        minItems: 1,
        maxItems: MAX_SOURCE_OUTPUT_FILES,
        uniqueItems: true,
      })
    ),
  },
  { additionalProperties: false }
);
export type AgentSourceTaskOutput = Static<typeof AgentSourceTaskOutputSchema>;

export const AgentSourceTaskSchema = Type.Object(
  {
    name: AgentSourceParamNameSchema,
    entry: Type.Optional(AgentSourceEntryRefSchema),
    params: Type.Optional(
      Type.Record(AgentSourceParamNameSchema, Type.Union([Type.String({ maxLength: 2_048 }), Type.Number()]))
    ),
    output: Type.Optional(AgentSourceTaskOutputSchema),
  },
  { additionalProperties: false }
);
export type AgentSourceTask = Static<typeof AgentSourceTaskSchema>;

export const AgentSourceManifestSchema = Type.Object(
  {
    schemaVersion: Type.Optional(Type.Union([Type.Literal('1'), Type.Literal('2')])),
    id: AgentSourcePackageIdSchema,
    version: AgentSourcePackageVersionSchema,
    description: Type.String({ minLength: 1, maxLength: 2_048 }),
    entry: AgentSourceEntryRefSchema,
    modelRoute: AgentSourceModelRouteSchema,
    budgets: Type.Optional(AgentSourceBudgetSchema),
    skillRefs: Type.Optional(Type.Array(Type.String({ pattern: '^skill://[a-z0-9-]+/v[0-9]+$' }), { uniqueItems: true })),
    capabilityRefs: Type.Optional(Type.Array(Type.String({ pattern: '^capability://[a-z0-9-]+/v[0-9]+$' }), { uniqueItems: true })),
    inputs: Type.Optional(Type.Array(AgentSourceInputParamSchema, { maxItems: MAX_SOURCE_INPUTS })),
    dataSources: Type.Optional(Type.Array(AgentSourceDataSourceSchema, { maxItems: MAX_SOURCE_DATA_SOURCES })),
    tasks: Type.Optional(Type.Array(AgentSourceTaskSchema, { maxItems: MAX_SOURCE_TASKS })),
  },
  { additionalProperties: false, $id: 'AgentSourceManifest.v1' }
);
export type AgentSourceManifest = Static<typeof AgentSourceManifestSchema>;

export type AgentSourceManifestValidationError = {
  readonly code: string;
  readonly path: string;
};

const PARAM_BINDING_PATTERN = /^\$\{inputs\.([a-z][a-z0-9-]{0,63})\}$/;

function invalid(path: string): never {
  throw new TypeError(`SOURCE_MANIFEST_INVALID:${path}`);
}

/** v2 声明块的语义校验（结构校验之后）：唯一性、URL 安全形、绑定引用与字面量类型。 */
function validateManifestSemantics(manifest: AgentSourceManifest): void {
  const declaredInputs = new Map<string, AgentSourceInputParam>();
  for (const [index, input] of (manifest.inputs ?? []).entries()) {
    if (declaredInputs.has(input.name)) invalid(`/inputs/${index}/name`);
    if (input.type === 'enum') {
      if (input.enum === undefined || input.enum.length === 0) invalid(`/inputs/${index}/enum`);
      if (input.default !== undefined && !input.enum.includes(input.default)) invalid(`/inputs/${index}/default`);
    } else if (input.default !== undefined) {
      if (typeof input.default !== input.type) invalid(`/inputs/${index}/default`);
    }
    declaredInputs.set(input.name, input);
  }

  const dataSourceNames = new Set<string>();
  for (const [index, source] of (manifest.dataSources ?? []).entries()) {
    if (dataSourceNames.has(source.name)) invalid(`/dataSources/${index}/name`);
    dataSourceNames.add(source.name);
    let url: URL;
    try {
      url = new URL(source.url);
    } catch {
      invalid(`/dataSources/${index}/url`);
    }
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hash !== '') {
      invalid(`/dataSources/${index}/url`);
    }
  }

  const taskNames = new Set<string>();
  for (const [index, task] of (manifest.tasks ?? []).entries()) {
    if (taskNames.has(task.name)) invalid(`/tasks/${index}/name`);
    taskNames.add(task.name);
    for (const [paramName, value] of Object.entries(task.params ?? {})) {
      const input = declaredInputs.get(paramName);
      if (input === undefined) invalid(`/tasks/${index}/params/${paramName}`);
      const path = `/tasks/${index}/params/${paramName}`;
      const binding = typeof value === 'string' ? value.match(PARAM_BINDING_PATTERN) : null;
      if (binding !== null) {
        if (!declaredInputs.has(binding[1] ?? '')) invalid(`${path}:binding`);
      } else if (input.type === 'enum') {
        if (!input.enum?.includes(value)) invalid(path);
      } else if (typeof value !== input.type) {
        invalid(path);
      }
    }
  }
}

export function validateAgentSourceManifest(value: unknown): AgentSourceManifest {
  const result = Value.Check(AgentSourceManifestSchema, value);
  if (!result) {
    const details = Value.Errors(AgentSourceManifestSchema, value)[0];
    if (details !== undefined) {
      throw new TypeError(`SOURCE_MANIFEST_INVALID:${details.instancePath || '/'}`);
    }
    throw new TypeError('SOURCE_MANIFEST_INVALID:/');
  }
  const manifest = value as AgentSourceManifest;
  validateManifestSemantics(manifest);
  return manifest;
}

export const isAgentSourceManifest = (value: unknown): value is AgentSourceManifest =>
  Value.Check(AgentSourceManifestSchema, value);
