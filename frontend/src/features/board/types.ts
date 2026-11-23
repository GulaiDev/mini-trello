/**
 * 看板 UI 视图模型。
 *
 * 这是「渲染层」使用的形状，由 lib/api 的 DTO 经 mappers.ts 转换而来。
 * 服务端状态存于 TanStack Query 缓存（SnapshotDTO），此处仅描述 UI 消费的结构。
 */

export type Tone = 'clay' | 'olive' | 'sky' | 'plum' | 'sand' | 'ink'
export type Role = 'owner' | 'editor' | 'viewer'

export interface Member {
  id: string
  name: string
  email: string
  role: Role
  /** 头像首字母 */
  initial: string
  tone: Tone
  /** 是否在线（来自看板 WS presence） */
  online: boolean
}

export interface Label {
  id: string
  name: string
  tone: Tone
}

export interface Card {
  id: string
  listId: string
  title: string
  description: string
  labelIds: string[]
  /** 单一负责人（后端 assignee_id） */
  assigneeId: string | null
  /** YYYY-MM-DD，便于 <input type="date"> */
  dueDate: string | null
  version: number
  /** 分数索引位置（字符串形式的十进制），用于列内排序 */
  position: string
  createdAt: string
}

export interface List {
  id: string
  boardId: string
  title: string
  position: string
  version: number
}

export interface Board {
  id: string
  title: string
  description: string
  role: Role | null
  updatedAt: string
}

export type CardPatch = Partial<
  Pick<Card, 'title' | 'description' | 'labelIds' | 'assigneeId' | 'dueDate'>
>
