import { HealthResponseSchema, type HealthResponse } from './health'

export type ApiClientOptions = {
  baseUrl?: string
  fetchImpl?: typeof fetch
}

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = options.baseUrl ?? ''
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)

  async function request(path: string, init?: RequestInit): Promise<Response> {
    return fetchImpl(`${baseUrl}${path}`, {
      credentials: 'include',
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.headers ?? {}),
      },
    })
  }

  async function getHealth(): Promise<HealthResponse> {
    const res = await request('/api/health')
    if (!res.ok) {
      throw new ApiError(res.status, `health check failed: ${res.status}`)
    }
    const json: unknown = await res.json()
    return HealthResponseSchema.parse(json)
  }

  return { request, getHealth }
}

export type ApiClient = ReturnType<typeof createApiClient>
