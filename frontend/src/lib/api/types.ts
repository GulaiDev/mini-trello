/**
 * 后端 API 的数据传输类型（与 OpenAPI 契约一一对应，字段保持 snake_case）。
 *
 * 说明：这些是「服务端状态」的原始形状；UI 层使用的视图模型见
 * features/board/types.ts，两者通过 mappers.ts 转换。
 */

export type Role = 'owner' | 'editor' | 'viewer'

export interface UserDTO {
  id: string
  email: string
  display_name: string
}

export interface MeDTO {
  user: UserDTO
  board_count: number
}

export interface BoardDTO {
  id: string
  title: string
  description: string
  owner_id: string
  created_at: string
  updated_at: string
  role: Role | null
}

export interface ListDTO {
  id: string
  board_id: string
  title: string
  position: string
  archived: boolean
  version: number
  created_at: string
  updated_at: string
}

export interface CardDTO {
  id: string
  list_id: string
  title: string
  description: string
  position: string
  assignee_id: string | null
  due_date: string | null
  archived: boolean
  version: number
  created_by: string | null
  created_at: string
  updated_at: string
  label_ids: string[]
}

export interface LabelDTO {
  id: string
  board_id: string
  name: string
  color: string
}

export interface MemberDTO {
  id: string
  email: string
  display_name: string
  role: Role
  created_at: string
}

export interface SnapshotDTO {
  board: BoardDTO
  role: Role
  seq: number
  lists: ListDTO[]
  cards: CardDTO[]
  labels: LabelDTO[]
  members: MemberDTO[]
  truncated: boolean
}

export interface PageDTO<T> {
  items: T[]
  total: number
  page: number
  size: number
}

export interface CardMoveResultDTO {
  card: CardDTO
  position: string
  version: number
}

/** WS 事件信封（见 backend/app/realtime/events.py event_envelope）。 */
export interface EventEnvelope {
  event_id?: string
  board_id: string
  seq?: number
  type: string
  actor_id?: string | null
  client_id?: string | null
  client_move_id?: string | null
  occurred_at?: string
  payload?: Record<string, unknown>
}

/** presence 广播（无 seq、不持久化）。 */
export interface PresenceMessage {
  type: 'presence.sync' | 'presence.join' | 'presence.leave'
  board_id: string
  user_id?: string
  presence: string[]
}

export type ServerMessage =
  | ({ type: 'ready'; seq: number; role: Role; presence: string[] })
  | ({ type: 'resync'; seq: number })
  | ({ type: 'pong' })
  | PresenceMessage
  | EventEnvelope
