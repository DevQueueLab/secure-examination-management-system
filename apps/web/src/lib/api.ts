import type { ApiErrorBody } from '@athena/shared';

/** Every endpoint lives under this prefix, on the same origin (dev rewrite or production gateway). */
export const API_BASE = '/api/v1';

/** Error codes the client adds on top of the API's own. */
export const CLIENT_ERROR_CODES = {
  NETWORK: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  BAD_RESPONSE: 'BAD_RESPONSE',
  ABORTED: 'ABORTED',
} as const;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;
  readonly requestId?: string;

  constructor(init: { status: number; code: string; message: string; fields?: Record<string, string>; requestId?: string }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.fields = init.fields ?? {};
    this.requestId = init.requestId;
  }

  /** The request never reached the API (offline, DNS, API down behind the dev rewrite). */
  get isNetwork(): boolean {
    return this.status === 0 || this.code === CLIENT_ERROR_CODES.NETWORK || this.code === CLIENT_ERROR_CODES.TIMEOUT;
  }
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
  get isForbidden(): boolean {
    return this.status === 403;
  }
  get isNotFound(): boolean {
    return this.status === 404;
  }
  get isValidation(): boolean {
    return this.status === 422 || this.code === 'VALIDATION_ERROR';
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** A sentence a person can act on, for any thrown value. */
export function errorMessage(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (isApiError(error)) {
    if (error.isNetwork) return 'Can’t reach Athena. Check your connection and try again.';
    return error.message || fallback;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions extends Omit<RequestInit, 'body' | 'method'> {
  /** JSON-serialisable body, FormData, Blob or a string. */
  body?: unknown;
  query?: Query;
  /** Abort after this many milliseconds. Default 30s. */
  timeoutMs?: number;
  /** Retries for idempotent requests on network failure. Default 2 for GET/HEAD, 0 otherwise. */
  retries?: number;
}

let unauthenticatedHandler: ((path: string) => void) | null = null;

/** The auth provider registers this to react when a session expires mid-use. */
export function onUnauthenticated(handler: ((path: string) => void) | null): void {
  unauthenticatedHandler = handler;
}

function buildUrl(path: string, query?: Query): string {
  const url = path.startsWith('http') ? path : `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}${url.includes('?') ? '&' : '?'}${qs}` : url;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function parseError(response: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> | null = null;
  try {
    const text = await response.text();
    body = text ? (JSON.parse(text) as Partial<ApiErrorBody>) : null;
  } catch {
    body = null;
  }
  const err = body?.error;
  if (err && typeof err.message === 'string') {
    return new ApiError({
      status: response.status,
      code: err.code ?? 'UNKNOWN',
      message: err.message,
      fields: err.fields,
      requestId: err.requestId,
    });
  }
  // No JSON envelope: usually the dev rewrite answering for an API that isn't running.
  if (response.status >= 500 || response.status === 404) {
    return new ApiError({
      status: response.status === 404 ? 404 : 0,
      code: response.status === 404 ? 'NOT_FOUND' : CLIENT_ERROR_CODES.NETWORK,
      message: response.status === 404 ? 'Not found' : 'Can’t reach Athena right now. Try again in a moment.',
    });
  }
  return new ApiError({
    status: response.status,
    code: CLIENT_ERROR_CODES.BAD_RESPONSE,
    message: response.statusText || 'Unexpected response from the server',
  });
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, timeoutMs = 30_000, retries, headers, signal, ...init } = options;
  const idempotent = method === 'GET' || method === 'HEAD';
  const maxRetries = retries ?? (idempotent ? 2 : 0);

  const finalHeaders = new Headers(headers);
  finalHeaders.set('Accept', 'application/json');
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    if (body instanceof FormData || body instanceof Blob || typeof body === 'string' || body instanceof URLSearchParams) {
      payload = body as BodyInit;
    } else {
      finalHeaders.set('Content-Type', 'application/json');
      payload = JSON.stringify(body);
    }
  }

  const url = buildUrl(path, query);

  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), timeoutMs);
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', onAbort, { once: true });

    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        method,
        headers: finalHeaders,
        body: payload,
        credentials: 'include',
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) {
        throw new ApiError({ status: 0, code: CLIENT_ERROR_CODES.ABORTED, message: 'Request cancelled' });
      }
      const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
      if (idempotent && attempt < maxRetries) {
        await sleep(300 * 2 ** attempt);
        continue;
      }
      throw new ApiError({
        status: 0,
        code: timedOut ? CLIENT_ERROR_CODES.TIMEOUT : CLIENT_ERROR_CODES.NETWORK,
        message: timedOut ? 'The server took too long to respond.' : 'Can’t reach Athena. Check your connection and try again.',
      });
    }
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);

    if (!response.ok) {
      // Gateways answering for a restarting API: retry idempotent reads once or twice.
      if (idempotent && attempt < maxRetries && (response.status === 502 || response.status === 503 || response.status === 504)) {
        await sleep(300 * 2 ** attempt);
        continue;
      }
      const error = await parseError(response);
      // A 401 on sign-in is a form error, not an expired session.
      if (error.status === 401 && !path.startsWith('/auth/login')) unauthenticatedHandler?.(path);
      throw error;
    }

    if (response.status === 204 || response.headers.get('content-length') === '0') return undefined as T;
    const type = response.headers.get('content-type') ?? '';
    if (type.includes('application/json')) return (await response.json()) as T;
    if (type.startsWith('text/')) return (await response.text()) as T;
    return (await response.blob()) as T;
  }
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('POST', path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PUT', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PATCH', path, { ...options, body }),
  del: <T = void>(path: string, options?: RequestOptions) => request<T>('DELETE', path, options),
  request,
};
