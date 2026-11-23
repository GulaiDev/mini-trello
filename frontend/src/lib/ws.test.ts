import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Server, WebSocket as MockWebSocket } from 'mock-socket'
import type { EventEnvelope } from './api/types'
import { BoardSocket, getClientId, readLastSeq, writeLastSeq } from './ws'

/** 镜像 BoardSocket.buildUrl，确保与 jsdom 的 location 一致。 */
function urlFor(boardId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/api/ws/boards/${boardId}`
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(predicate: () => boolean, timeout = 1500): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('waitFor 超时')
    await delay(5)
  }
}

describe('BoardSocket', () => {
  let originalWebSocket: unknown
  const servers: Server[] = []

  function track(server: Server) {
    servers.push(server)
    return server
  }

  beforeEach(() => {
    originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket
    ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    for (const server of servers.splice(0)) {
      try {
        server.stop()
      } catch {
        /* 忽略重复停止 */
      }
    }
    ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = originalWebSocket
  })

  it('连接后发送 hello 首帧，携带已存 seq 与 client_id', async () => {
    const boardId = 'b1'
    writeLastSeq(boardId, 42)
    const server = track(new Server(urlFor(boardId)))
    const firstMessage = new Promise<string>((resolve) => {
      server.on('connection', (socket) => {
        socket.on('message', (data) => resolve(String(data)))
      })
    })

    const sock = new BoardSocket(boardId)
    sock.connect()

    const hello = JSON.parse(await firstMessage)
    expect(hello.type).toBe('hello')
    expect(hello.since_seq).toBe(42)
    expect(hello.client_id).toBe(getClientId())
    sock.close()
  })

  it('收到 ready 回调并持久化 seq', async () => {
    const boardId = 'b2'
    const server = track(new Server(urlFor(boardId)))
    server.on('connection', (socket) => {
      socket.send(JSON.stringify({ type: 'ready', seq: 100, role: 'editor', presence: ['u1', 'u2'] }))
    })

    const onReady = vi.fn()
    const sock = new BoardSocket(boardId, { onReady })
    sock.connect()

    await waitFor(() => onReady.mock.calls.length > 0)
    expect(onReady).toHaveBeenCalledWith({ seq: 100, role: 'editor', presence: ['u1', 'u2'] })
    expect(readLastSeq(boardId)).toBe(100)
    sock.close()
  })

  it('收到事件信封后派发 onEvent 并推进 seq', async () => {
    const boardId = 'b3'
    const event: EventEnvelope = {
      board_id: boardId,
      seq: 7,
      type: 'card.created',
      payload: { card: { id: 'c1' } },
      occurred_at: '2026-01-02T00:00:00Z',
    }
    const server = track(new Server(urlFor(boardId)))
    server.on('connection', (socket) => socket.send(JSON.stringify(event)))

    const onEvent = vi.fn()
    const sock = new BoardSocket(boardId, { onEvent })
    sock.connect()

    await waitFor(() => onEvent.mock.calls.length > 0)
    expect(onEvent).toHaveBeenCalledWith(event)
    expect(readLastSeq(boardId)).toBe(7)
    sock.close()
  })

  it('收到 presence.join 派发 onPresence', async () => {
    const boardId = 'b4'
    const server = track(new Server(urlFor(boardId)))
    server.on('connection', (socket) => {
      socket.send(JSON.stringify({ type: 'presence.join', board_id: boardId, user_id: 'u9' }))
    })

    const onPresence = vi.fn()
    const sock = new BoardSocket(boardId, { onPresence })
    sock.connect()

    await waitFor(() => onPresence.mock.calls.length > 0)
    expect(onPresence).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'presence.join', user_id: 'u9' }),
    )
    sock.close()
  })

  it('收到 resync 派发 onResync 并重置 seq', async () => {
    const boardId = 'b5'
    const server = track(new Server(urlFor(boardId)))
    server.on('connection', (socket) => socket.send(JSON.stringify({ type: 'resync', seq: 5 })))

    const onResync = vi.fn()
    const sock = new BoardSocket(boardId, { onResync })
    sock.connect()

    await waitFor(() => onResync.mock.calls.length > 0)
    expect(onResync).toHaveBeenCalledWith({ seq: 5 })
    expect(readLastSeq(boardId)).toBe(5)
    sock.close()
  })

  it('致命关闭码 4401 不触发重连', async () => {
    const boardId = 'b6'
    const server = track(new Server(urlFor(boardId)))
    let connections = 0
    server.on('connection', (socket) => {
      connections += 1
      socket.close({ code: 4401, reason: 'unauthorized', wasClean: true })
    })

    const onStatusChange = vi.fn()
    const sock = new BoardSocket(boardId, { onStatusChange })
    sock.connect()

    await waitFor(() => onStatusChange.mock.calls.some(([s]) => s === 'closed'))
    // 等待潜在重连窗口，确认没有第二次连接
    await delay(120)
    expect(connections).toBe(1)
    expect(onStatusChange).toHaveBeenLastCalledWith('closed')
    sock.close()
  })
})
