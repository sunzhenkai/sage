// 通用 API 行为：credentials、content-type、错误契约解析优先级、注入 fetch / apiBase。

export interface ApiOptions {
  /** 可注入自定义 fetch（测试 / 嵌入）。默认 window.fetch。 */
  fetch?: typeof fetch
  /** API base。默认同源相对路径 `/v1`。 */
  apiBase?: string
}

export interface ApiCtx {
  fetch: typeof fetch
  apiBase: string
}

export function createCtx(options?: ApiOptions): ApiCtx {
  return {
    fetch: options?.fetch ?? ((...args) => window.fetch(...args)),
    apiBase: options?.apiBase ?? '/v1',
  }
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string | null
  readonly retryable: boolean
  readonly retryAfterSeconds: number | null

  constructor(args: { status: number; code: string | null; message: string; retryable: boolean; retryAfterSeconds?: number | null }) {
    super(args.message)
    this.name = 'ApiError'
    this.status = args.status
    this.code = args.code
    this.retryable = args.retryable
    this.retryAfterSeconds = args.retryAfterSeconds ?? null
  }
}

interface ErrorContract {
  error?: {
    code?: unknown
    message?: unknown
    retryable?: unknown
    retryAfterSeconds?: unknown
  }
}

export interface RequestInitLite {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** JSON 序列化并默认设置 content-type: application/json。 */
  body?: unknown
  /** multipart 提交：不设置 content-type，浏览器自带 boundary。 */
  formData?: FormData
  signal?: AbortSignal
}

function errorMessage(contract: ErrorContract, status: number): { message: string; code: string | null; retryable: boolean; retryAfterSeconds: number | null } {
  const error = contract.error
  const message = typeof error?.message === 'string' && error.message ? error.message
    : typeof error?.code === 'string' && error.code ? error.code
      : `HTTP ${status}`
  const retryAfter = typeof error?.retryAfterSeconds === 'number' && Number.isFinite(error.retryAfterSeconds) ? error.retryAfterSeconds : null
  return {
    message,
    code: typeof error?.code === 'string' ? error.code : null,
    retryable: error?.retryable === true,
    retryAfterSeconds: retryAfter,
  }
}

async function parseErrorBody(response: Response): Promise<ErrorContract> {
  try {
    const parsed: unknown = await response.json()
    if (parsed && typeof parsed === 'object') return parsed as ErrorContract
  } catch {
    // 非 JSON 错误体：回落到 HTTP 状态文案。
  }
  return {}
}

export async function apiFetch(ctx: ApiCtx, path: string, init: RequestInitLite = {}): Promise<Response> {
  const headers = new Headers()
  let body: BodyInit | undefined
  if (init.formData) {
    body = init.formData
  } else if (init.body !== undefined) {
    headers.set('content-type', 'application/json')
    body = JSON.stringify(init.body)
  }
  const response = await ctx.fetch(`${ctx.apiBase}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body,
    credentials: 'include',
    signal: init.signal,
  })
  if (!response.ok) {
    const contract = await parseErrorBody(response)
    const parsed = errorMessage(contract, response.status)
    throw new ApiError({ status: response.status, ...parsed })
  }
  return response
}

/** JSON 响应；明确 204/空体返回 null。错误已按契约解析为 ApiError。 */
export async function fetchJson<T>(ctx: ApiCtx, path: string, init: RequestInitLite = {}): Promise<T | null> {
  const response = await apiFetch(ctx, path, init)
  if (response.status === 204) return null
  const text = await response.text()
  if (!text) return null
  return JSON.parse(text) as T
}

export function toUserMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error && error.message) return error.message
  return 'HTTP 500'
}
