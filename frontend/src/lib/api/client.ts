/**
 * HTTP 客户端：统一封装 fetch，处理 cookie 凭证、CSRF 头、错误体与令牌刷新。
 *
 * 约定：
 * - 凭证走 httpOnly cookie，故所有请求 credentials: 'include'。
 * - 状态变更请求需带 `X-Requested-With: fetch`（后端 CSRF 中间件校验）。
 * - 收到 401 时先尝试 /auth/refresh 轮换一次并重放；仍失败则回调 onUnauthorized。
 * - 409 冲突携带 `latest`，供乐观更新回滚后对齐服务端权威数据。
 */

const BASE = '/api'

export interface ApiErrorBody {
  code?: string
  message?: string
  [key: string]: unknown
}

export class ApiError extends Error {
  status: number
  code: string
  detail: ApiErrorBody
  /** 409 时服务端返回的最新实体（如卡片），用于覆盖本地预演。 */
  latest: unknown

  constructor(status: number, detail: ApiErrorBody) {
    super(detail.message ?? `请求失败（${status}）`)
    this.name = 'ApiError'
    this.status = status
    this.code = detail.code ?? 'error'
    this.detail = detail
    this.latest = detail.latest ?? null
  }
}

/** 401 且刷新失败时触发（由应用层注入，通常跳转登录页）。 */
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
  /** 跳过 401 自动刷新（登录/刷新等接口自身使用）。 */
  skipAuthRetry?: boolean
  query?: Record<string, string | number | undefined>
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${BASE}${path}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

async function parseResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return null
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function rawRequest(path: string, options: RequestOptions): Promise<Response> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = {
    'X-Requested-With': 'fetch',
  }
  let body: string | undefined
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }
  return fetch(buildUrl(path, options.query), {
    method,
    headers,
    body,
    credentials: 'include',
    signal: options.signal,
  })
}

async function refreshTokens(): Promise<boolean> {
  try {
    const response = await rawRequest('/auth/refresh', {
      method: 'POST',
      body: {},
      skipAuthRetry: true,
    })
    return response.ok
  } catch {
    return false
  }
}

/** 发起请求并返回解析后的 JSON；失败抛 ApiError。 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await rawRequest(path, options)

  if (response.status === 401 && !options.skipAuthRetry) {
    const refreshed = await refreshTokens()
    if (refreshed) {
      response = await rawRequest(path, options)
    }
    if (response.status === 401) {
      onUnauthorized?.()
    }
  }

  const data = await parseResponse(response)
  if (!response.ok) {
    const detail =
      data && typeof data === 'object' && 'detail' in data
        ? (data as { detail: ApiErrorBody }).detail
        : { message: typeof data === 'string' ? data : undefined }
    throw new ApiError(response.status, detail ?? {})
  }
  return data as T
}
