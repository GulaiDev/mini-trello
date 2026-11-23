/**
 * 仅存放「UI / 临时」状态：看板 WS 的在线成员（presence）与连接状态。
 *
 * 遵循文档约定——服务端状态（看板内容）由 TanStack Query 管理，Zustand 只保留
 * 与渲染相关、非权威的临时状态。presence 不持久化、断线即清空。
 */

import { create } from 'zustand'
import type { SocketStatus } from '../../lib/ws'

interface RealtimeState {
  /** boardId -> 在线用户 id 列表 */
  presence: Record<string, string[]>
  /** boardId -> 连接状态 */
  status: Record<string, SocketStatus>
  setPresence: (boardId: string, userIds: string[]) => void
  setStatus: (boardId: string, status: SocketStatus) => void
  clearBoard: (boardId: string) => void
}

export const useRealtimeStore = create<RealtimeState>((set) => ({
  presence: {},
  status: {},
  setPresence: (boardId, userIds) =>
    set((state) => ({ presence: { ...state.presence, [boardId]: userIds } })),
  setStatus: (boardId, status) =>
    set((state) => ({ status: { ...state.status, [boardId]: status } })),
  clearBoard: (boardId) =>
    set((state) => {
      const presence = { ...state.presence }
      const status = { ...state.status }
      delete presence[boardId]
      delete status[boardId]
      return { presence, status }
    }),
}))
