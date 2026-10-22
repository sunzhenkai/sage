import type { ZodRawShape } from './zod-shim.js';

/**
 * ToolDef：一个 /v1/* 端点到 MCP tool 的 1:1 映射。
 * - `build`：从 tool args 构造内部 inject 请求（method/path/query/body）；
 * - `schema`：tool input 的 zod raw shape（镜像既有 TypeBox body + path/query 参数）。
 */
export interface ToolRequest {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly query?: Readonly<Record<string, string | number | boolean>> | undefined;
  /** 额外请求头（如 If-Match）；authorization 由 executor 按调用方注入。 */
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly body?: unknown;
}

export interface ToolDef {
  readonly name: string;
  readonly description: string;
  readonly schema: ZodRawShape;
  /**
   * args 已由 SDK 按 inputSchema 校验并收敛为具体值；这里用宽松 Record 取字段，
   * 避免为每个 tool 重复声明一份与 zod 并行的 TS 类型（any 是刻意的：字段值类型以 zod 为准）。
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly build: (args: Record<string, any>) => ToolRequest;
}
