/**
 * JSON API helper implementing the workspace call rules (spec §5):
 * - non-GET defaults to `content-type: application/json` (never for FormData);
 * - all requests carry `credentials: "include"`;
 * - non-2xx parses `{ error: { code, message, retryable } }`;
 * - user-facing message prefers error.message, then error.code, then HTTP status;
 * - empty bodies are only accepted for explicit 204 semantics.
 */

export interface ApiErrorBody {
  code?: string;
  message?: string;
  retryable?: boolean;
  /** Catalog sync 429 hint (spec §8.3). */
  retryAfterSeconds?: number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | undefined;

  constructor(status: number, body: ApiErrorBody | undefined) {
    super(body?.message ?? body?.code ?? `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = body?.code;
    this.retryable = body?.retryable === true;
    this.retryAfterSeconds = typeof body?.retryAfterSeconds === "number" ? body.retryAfterSeconds : undefined;
  }
}

export interface ApiClientOptions {
  /** Defaults to the same-origin relative "/v1". */
  apiBase?: string;
  /** Injectable for tests/embedding. */
  fetchImpl?: typeof fetch;
}

export interface ApiRequestInit extends Omit<RequestInit, "body" | "method"> {
  method?: string;
  /** Plain objects/arrays are JSON-stringified; FormData passes through. */
  body?: unknown;
}

export interface ApiClient {
  request<T>(path: string, init?: ApiRequestInit): Promise<T>;
}

function isFormData(value: unknown): value is FormData {
  return typeof FormData !== "undefined" && value instanceof FormData;
}

async function parseErrorBody(response: Response): Promise<ApiErrorBody | undefined> {
  try {
    const text = await response.text();
    if (!text) return undefined;
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
      const error = (parsed as { error: unknown }).error;
      if (typeof error === "object" && error !== null) {
        return error as ApiErrorBody;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const apiBase = options.apiBase ?? "/v1";
  const fetchImpl = options.fetchImpl ?? fetch.bind(window);

  async function request<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    let body: BodyInit | null = null;

    if (init.body !== undefined && init.body !== null) {
      if (isFormData(init.body)) {
        body = init.body;
        // FormData sets its own multipart boundary; never set content-type.
        headers.delete("content-type");
      } else {
        body = JSON.stringify(init.body);
        if (!headers.has("content-type")) {
          headers.set("content-type", "application/json");
        }
      }
    } else if (method !== "GET" && method !== "HEAD" && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const response = await fetchImpl(`${apiBase}${path}`, {
      ...init,
      method,
      headers,
      body,
      credentials: "include",
      signal: init.signal ?? null,
    });

    if (!response.ok) {
      throw new ApiError(response.status, await parseErrorBody(response));
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  return { request };
}

/** Default same-origin client for production use. */
export const apiClient = createApiClient();
