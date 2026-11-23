/** DTO → UI 视图模型的映射，以及位置排序、时间格式化等纯函数。 */

import type {
  BoardDTO,
  CardDTO,
  LabelDTO,
  ListDTO,
  MemberDTO,
} from '../../lib/api/types'
import type { Board, Card, Label, List, Member, Tone } from './types'

const TONES: Tone[] = ['clay', 'olive', 'sky', 'plum', 'sand', 'ink']

/** 后端标签 color 可能是任意字符串，映射到已知 tone，否则回退 ink。 */
export function colorToTone(color: string | undefined | null): Tone {
  return (TONES as string[]).includes(color ?? '') ? (color as Tone) : 'ink'
}

/** 依据稳定字符串（如用户 id）派生一个 tone，保证同一用户颜色一致。 */
export function hashTone(seed: string): Tone {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  return TONES[hash % TONES.length]
}

export function initialOf(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  // 中文取首字，英文取首字母大写
  return Array.from(trimmed)[0]!.toUpperCase()
}

/** 比较两个分数索引位置字符串（十进制），返回升序比较结果。 */
export function comparePosition(a: string, b: string): number {
  const na = Number(a)
  const nb = Number(b)
  if (Number.isFinite(na) && Number.isFinite(nb)) {
    if (na !== nb) return na < nb ? -1 : 1
    return 0
  }
  // 兜底：字符串比较
  return a === b ? 0 : a < b ? -1 : 1
}

/** 把 ISO 日期时间格式化为「M月D日」。 */
export function formatMonthDay(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / M月D日。 */
export function relativeTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const diff = Date.now() - date.getTime()
  const minute = 60_000
  const hour = 60 * minute
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < 24 * hour) return `${Math.floor(diff / hour)} 小时前`
  return formatMonthDay(iso)
}

/** 把后端 datetime（可能含时间）截取为 YYYY-MM-DD。 */
export function toDateInput(iso: string | null): string | null {
  if (!iso) return null
  return iso.slice(0, 10)
}

export function toLabel(dto: LabelDTO): Label {
  return { id: dto.id, name: dto.name, tone: colorToTone(dto.color) }
}

export function toMember(dto: MemberDTO, online: boolean): Member {
  return {
    id: dto.id,
    name: dto.display_name,
    email: dto.email,
    role: dto.role,
    initial: initialOf(dto.display_name),
    tone: hashTone(dto.id),
    online,
  }
}

export function toCard(dto: CardDTO): Card {
  return {
    id: dto.id,
    listId: dto.list_id,
    title: dto.title,
    description: dto.description,
    labelIds: dto.label_ids ?? [],
    assigneeId: dto.assignee_id ?? null,
    dueDate: toDateInput(dto.due_date),
    version: dto.version,
    position: dto.position,
    createdAt: formatMonthDay(dto.created_at),
  }
}

export function toList(dto: ListDTO): List {
  return {
    id: dto.id,
    boardId: dto.board_id,
    title: dto.title,
    position: dto.position,
    version: dto.version,
  }
}

export function toBoard(dto: BoardDTO): Board {
  return {
    id: dto.id,
    title: dto.title,
    description: dto.description,
    role: dto.role,
    updatedAt: relativeTime(dto.updated_at),
  }
}
