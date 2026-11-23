/** API 端点函数：按后端路由组织，返回强类型 DTO。 */

import { request } from './client'
import type {
  BoardDTO,
  CardDTO,
  CardMoveResultDTO,
  LabelDTO,
  ListDTO,
  MeDTO,
  MemberDTO,
  PageDTO,
  Role,
  SnapshotDTO,
  UserDTO,
} from './types'

export * from './types'
export { ApiError, setUnauthorizedHandler } from './client'

// --- 认证 ---
export const auth = {
  register: (input: { email: string; password: string; display_name: string }) =>
    request<UserDTO>('/auth/register', { method: 'POST', body: input, skipAuthRetry: true }),
  login: (input: { email: string; password: string }) =>
    request<UserDTO>('/auth/login', { method: 'POST', body: input, skipAuthRetry: true }),
  logout: () => request<void>('/auth/logout', { method: 'POST', body: {}, skipAuthRetry: true }),
  // 会话探测：跳过客户端自动刷新与 401 回调，避免未登录时
  // me → refresh → onUnauthorized → removeQueries → 重拉 的死循环。
  // 令牌续期由 useMe 显式发起一次 refresh（见 features/auth/useAuth.ts）。
  me: () => request<MeDTO>('/auth/me', { skipAuthRetry: true }),
  // 显式刷新：成功 true / 失败 false，不抛出也不触发 401 回调。
  refresh: async (): Promise<boolean> => {
    try {
      await request<unknown>('/auth/refresh', { method: 'POST', body: {}, skipAuthRetry: true })
      return true
    } catch {
      return false
    }
  },
}

// --- 看板 ---
export const boards = {
  list: (params: { page?: number; size?: number; q?: string } = {}) =>
    request<PageDTO<BoardDTO>>('/boards', { query: { ...params } }),
  create: (input: { title: string; description?: string }) =>
    request<BoardDTO>('/boards', { method: 'POST', body: input }),
  get: (boardId: string) => request<BoardDTO>(`/boards/${boardId}`),
  update: (boardId: string, input: { title?: string; description?: string }) =>
    request<BoardDTO>(`/boards/${boardId}`, { method: 'PATCH', body: input }),
  remove: (boardId: string) =>
    request<void>(`/boards/${boardId}`, { method: 'DELETE' }),
  snapshot: (boardId: string) => request<SnapshotDTO>(`/boards/${boardId}/snapshot`),
}

// --- 成员 ---
export const members = {
  list: (boardId: string) => request<MemberDTO[]>(`/boards/${boardId}/members`),
  add: (boardId: string, input: { email: string; role: Role }) =>
    request<MemberDTO>(`/boards/${boardId}/members`, { method: 'POST', body: input }),
  changeRole: (boardId: string, userId: string, role: Role) =>
    request<MemberDTO>(`/boards/${boardId}/members/${userId}`, {
      method: 'PATCH',
      body: { role },
    }),
  remove: (boardId: string, userId: string) =>
    request<void>(`/boards/${boardId}/members/${userId}`, { method: 'DELETE' }),
}

// --- 列表 ---
export const lists = {
  create: (boardId: string, input: { title: string }) =>
    request<ListDTO>(`/boards/${boardId}/lists`, { method: 'POST', body: input }),
  update: (listId: string, input: { title?: string; expected_version?: number }) =>
    request<ListDTO>(`/lists/${listId}`, { method: 'PATCH', body: input }),
  remove: (listId: string) => request<void>(`/lists/${listId}`, { method: 'DELETE' }),
  move: (
    listId: string,
    input: { prev_list_id?: string | null; next_list_id?: string | null; client_move_id?: string },
  ) => request<ListDTO>(`/lists/${listId}/move`, { method: 'PATCH', body: input }),
}

// --- 卡片 ---
export const cards = {
  create: (
    listId: string,
    input: { title: string; description?: string; prev_card_id?: string | null; next_card_id?: string | null; client_move_id?: string },
  ) => request<CardDTO>(`/lists/${listId}/cards`, { method: 'POST', body: input }),
  update: (
    cardId: string,
    input: {
      title?: string
      description?: string
      assignee_id?: string | null
      due_date?: string | null
      archived?: boolean
      expected_version?: number
    },
  ) => request<CardDTO>(`/cards/${cardId}`, { method: 'PATCH', body: input }),
  remove: (cardId: string) => request<void>(`/cards/${cardId}`, { method: 'DELETE' }),
  move: (
    cardId: string,
    input: { to_list_id: string; prev_card_id?: string | null; next_card_id?: string | null; client_move_id?: string },
  ) => request<CardMoveResultDTO>(`/cards/${cardId}/move`, { method: 'POST', body: input }),
  setLabels: (cardId: string, labelIds: string[]) =>
    request<CardDTO>(`/cards/${cardId}/labels`, { method: 'PUT', body: { label_ids: labelIds } }),
}

// --- 标签 ---
export const labels = {
  create: (boardId: string, input: { name: string; color?: string }) =>
    request<LabelDTO>(`/boards/${boardId}/labels`, { method: 'POST', body: input }),
  update: (boardId: string, labelId: string, input: { name?: string; color?: string }) =>
    request<LabelDTO>(`/boards/${boardId}/labels/${labelId}`, { method: 'PATCH', body: input }),
  remove: (boardId: string, labelId: string) =>
    request<void>(`/boards/${boardId}/labels/${labelId}`, { method: 'DELETE' }),
}
