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

export const AgentSourceManifestSchema = Type.Object(
  {
    schemaVersion: Type.Optional(Type.Literal('1')),
    id: AgentSourcePackageIdSchema,
    version: AgentSourcePackageVersionSchema,
    description: Type.String({ minLength: 1, maxLength: 2_048 }),
    entry: AgentSourceEntryRefSchema,
    modelRoute: AgentSourceModelRouteSchema,
    budgets: Type.Optional(AgentSourceBudgetSchema),
    skillRefs: Type.Optional(Type.Array(Type.String({ pattern: '^skill://[a-z0-9-]+/v[0-9]+$' }), { uniqueItems: true })),
    capabilityRefs: Type.Optional(Type.Array(Type.String({ pattern: '^capability://[a-z0-9-]+/v[0-9]+$' }), { uniqueItems: true })),
  },
  { additionalProperties: false, $id: 'AgentSourceManifest.v1' }
);
export type AgentSourceManifest = Static<typeof AgentSourceManifestSchema>;

export type AgentSourceManifestValidationError = {
  readonly code: string;
  readonly path: string;
};

export function validateAgentSourceManifest(value: unknown): AgentSourceManifest {
  const result = Value.Check(AgentSourceManifestSchema, value);
  if (!result) {
    const details = Value.Errors(AgentSourceManifestSchema, value)[0];
    if (details !== undefined) {
      throw new TypeError(`SOURCE_MANIFEST_INVALID:${details.instancePath || '/'}`);
    }
    throw new TypeError('SOURCE_MANIFEST_INVALID:/');
  }
  return value as AgentSourceManifest;
}

export const isAgentSourceManifest = (value: unknown): value is AgentSourceManifest =>
  Value.Check(AgentSourceManifestSchema, value);
