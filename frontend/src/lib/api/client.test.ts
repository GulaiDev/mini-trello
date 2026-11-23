import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, request, setUnauthorizedHandler } from './client'

/** 构造最小可用的 Response 桩，仅覆盖 client 用到的字段。 */
function mockResponse(status: number, body: unknown): Response {
  const ok = status >= 200 && status < 300
  const text = body === null || body === undefined ? '' : JSON.stringify(body)
  return {
    status,
    ok,
    text: () => Promise.resolve(text),
  } as unknown as Response
}

describe('api client', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    setUnauthorizedHandler(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GET 带 CSRF 头与 cookie 凭证', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { ok: true }))
    const data = await request<{ ok: boolean }>('/boards')
    expect(data).toEqual({ ok: true })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toBe('/api/boards')
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('include')
    expect(init.headers['X-Requested-With']).toBe('fetch')
  })

  it('POST 序列化 body 并设置 Content-Type', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { id: 'b1' }))
    await request('/boards', { method: 'POST', body: { title: '看板' } })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.body).toBe(JSON.stringify({ title: '看板' }))
  })

  it('query 参数拼接到 URL，undefined 被忽略', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, null))
    await request('/boards', { query: { page: 1, size: 20, q: undefined } })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/boards?page=1&size=20')
  })

  it('204 返回 null', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(204, null))
    const data = await request('/cards/c1', { method: 'DELETE' })
    expect(data).toBeNull()
  })

  it('401 触发刷新并重放一次', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(401, { detail: { code: 'unauthorized' } })) // 原始请求
      .mockResolvedValueOnce(mockResponse(200, null)) // refresh 成功
      .mockResolvedValueOnce(mockResponse(200, { ok: true })) // 重放

    const data = await request<{ ok: boolean }>('/boards')
    expect(data).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/refresh')
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe('POST')
    expect(fetchMock.mock.calls[2][0]).toBe('/api/boards')
  })

  it('刷新仍失败时回调 onUnauthorized 并抛 ApiError', async () => {
    const onUnauthorized = vi.fn()
    setUnauthorizedHandler(onUnauthorized)
    fetchMock
      .mockResolvedValueOnce(mockResponse(401, { detail: { code: 'unauthorized' } }))
      .mockResolvedValueOnce(mockResponse(401, null)) // refresh 也 401

    await expect(request('/boards')).rejects.toBeInstanceOf(ApiError)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('skipAuthRetry 时 401 不触发刷新', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(401, { detail: { code: 'unauthorized' } }))
    await expect(
      request('/auth/login', { method: 'POST', body: {}, skipAuthRetry: true }),
    ).rejects.toBeInstanceOf(ApiError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('409 解析 latest 字段用于乐观对齐', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse(409, { detail: { code: 'conflict', latest: { id: 'c1', version: 9 } } }),
    )

    const err = await request('/cards/c1/move', { method: 'POST', body: {} }).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    const apiErr = err as ApiError
    expect(apiErr.status).toBe(409)
    expect(apiErr.code).toBe('conflict')
    expect(apiErr.latest).toEqual({ id: 'c1', version: 9 })
  })

  it('非 JSON 错误体退化为 message', async () => {
    const res = { status: 500, ok: false, text: () => Promise.resolve('boom') } as unknown as Response
    fetchMock.mockResolvedValueOnce(res)
    const err = (await request('/boards').catch((e) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(500)
  })
})
