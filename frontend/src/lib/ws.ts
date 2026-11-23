/**
 * WebSocket 管理器：连接 /api/ws/boards/{boardId}，处理握手、补发、
 * presence、心跳与断线重连（指数退避 + 抖动）。
 *
 * 协议（见 backend/app/routers/ws.py）：
 * 1. 连接后发送首帧 hello {type, since_seq, client_id}。
 * 2. 服务端可能先补发若干事件（seq > since_seq），再发 ready；
 *    若落后超出保留窗口则发 resync（客户端应全量重拉快照）。
 * 3. 之后持续接收事件信封与 presence.join/leave。
 * 4. 客户端每 25s 发一次 ping，服务端回 pong；超时服务端断开。
 * 5. 关闭码 4401（未登录）/4403（无权限）不重连。
 */

import type { EventEnvelope, PresenceMessage } from './api/types'

export type SocketStatus = 'idle' | 'connecting' | 'open' | 'closed'

export interface BoardSocketHandlers {
  onEvent?: (event: EventEnvelope) => void
  onPresence?: (message: PresenceMessage) => void
  onReady?: (info: { seq: number; role: string; presence: string[] }) => void
  onResync?: (info: { seq: number }) => void
  onStatusChange?: (status: SocketStatus) => void
}

const HEARTBEAT_INTERVAL = 25_000
const MAX_BACKOFF = 15_000
/** 这些关闭码表示鉴权/权限问题，重连无意义。 */
const FATAL_CODES = new Set([4401, 4403])

function seqStorageKey(boardId: string) {
  return `mini-trello:seq:${boardId}`
}

/** 每个标签页稳定的 client_id，便于服务端事件对账。 */
export function getClientId(): string {
  const key = 'mini-trello:client-id'
  let id = sessionStorage.getItem(key)
  if (!id) {
    id = `tab-${Math.random().toString(36).slice(2, 10)}`
    sessionStorage.setItem(key, id)
  }
  return id
}

export function readLastSeq(boardId: string): number {
  const raw = localStorage.getItem(seqStorageKey(boardId))
  const value = raw ? Number(raw) : 0
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function writeLastSeq(boardId: string, seq: number) {
  if (Number.isFinite(seq) && seq > 0) {
    localStorage.setItem(seqStorageKey(boardId), String(seq))
  }
}

export class BoardSocket {
  private boardId: string
  private handlers: BoardSocketHandlers
  private ws: WebSocket | null = null
  private status: SocketStatus = 'idle'
  private attempt = 0
  private closedByCaller = false
  private reconnectTimer: number | null = null
  private heartbeatTimer: number | null = null
  private lastSeq: number

  constructor(boardId: string, handlers: BoardSocketHandlers = {}) {
    this.boardId = boardId
    this.handlers = handlers
    this.lastSeq = readLastSeq(boardId)
  }

  connect() {
    this.closedByCaller = false
    this.openSocket()
  }

  close() {
    this.closedByCaller = true
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer)
    if (this.heartbeatTimer) window.clearInterval(this.heartbeatTimer)
    this.reconnectTimer = null
    this.heartbeatTimer = null
    this.ws?.close(1000)
    this.ws = null
    this.setStatus('closed')
  }

  /** 更新处理回调（React 重渲染时保持最新闭包）。 */
  setHandlers(handlers: BoardSocketHandlers) {
    this.handlers = { ...this.handlers, ...handlers }
  }

  private setStatus(status: SocketStatus) {
    if (this.status === status) return
    this.status = status
    this.handlers.onStatusChange?.(status)
  }

  private buildUrl(): string {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${window.location.host}/api/ws/boards/${this.boardId}`
  }

  private openSocket() {
    this.setStatus('connecting')
    const ws = new WebSocket(this.buildUrl())
    this.ws = ws

    ws.onopen = () => {
      this.attempt = 0
      this.setStatus('open')
      ws.send(
        JSON.stringify({
          type: 'hello',
          since_seq: this.lastSeq,
          client_id: getClientId(),
        }),
      )
      this.startHeartbeat()
    }

    ws.onmessage = (raw) => this.handleMessage(raw.data)

    ws.onclose = (event) => {
      this.stopHeartbeat()
      this.ws = null
      if (this.closedByCaller) {
        this.setStatus('closed')
        return
      }
      if (FATAL_CODES.has(event.code)) {
        this.setStatus('closed')
        return
      }
      this.scheduleReconnect()
    }

    ws.onerror = () => {
      // onclose 随后触发，统一在 onclose 处理重连
      ws.close()
    }
  }

  private handleMessage(data: unknown) {
    let message: { type: string; [key: string]: unknown }
    try {
      message = JSON.parse(typeof data === 'string' ? data : String(data))
    } catch {
      return
    }
    switch (message.type) {
      case 'ready': {
        const seq = Number(message.seq ?? 0)
        this.lastSeq = Math.max(this.lastSeq, seq)
        writeLastSeq(this.boardId, this.lastSeq)
        this.handlers.onReady?.({
          seq,
          role: String(message.role ?? 'viewer'),
          presence: (message.presence as string[]) ?? [],
        })
        break
      }
      case 'resync': {
        const seq = Number(message.seq ?? 0)
        this.lastSeq = seq
        writeLastSeq(this.boardId, this.lastSeq)
        this.handlers.onResync?.({ seq })
        break
      }
      case 'pong':
        break
      case 'presence.sync':
      case 'presence.join':
      case 'presence.leave':
        this.handlers.onPresence?.({
          type: message.type as PresenceMessage['type'],
          board_id: String(message.board_id ?? this.boardId),
          user_id: message.user_id as string | undefined,
          presence: (message.presence as string[]) ?? [],
        })
        break
      default: {
        const event = message as unknown as EventEnvelope
        if (typeof event.seq === 'number') {
          this.lastSeq = Math.max(this.lastSeq, event.seq)
          writeLastSeq(this.boardId, this.lastSeq)
        }
        this.handlers.onEvent?.(event)
      }
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeatTimer = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, HEARTBEAT_INTERVAL)
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) window.clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  private scheduleReconnect() {
    this.setStatus('connecting')
    const backoff = Math.min(MAX_BACKOFF, 500 * 2 ** this.attempt)
    const jitter = Math.random() * 300
    this.attempt += 1
    this.reconnectTimer = window.setTimeout(() => this.openSocket(), backoff + jitter)
  }
}
