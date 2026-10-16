import type { ZodRawShape } from 'zod';

/**
 * zod-shim：tool inputSchema 的 zod 形状类型。
 * SDK 的 ZodRawShapeCompat 与 zod raw shape 结构一致（Record<string, zod schema>）。
 */
export type { ZodRawShape };
