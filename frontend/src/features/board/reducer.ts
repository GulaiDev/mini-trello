/**
 * 把 WS 事件信封应用到看板快照（SnapshotDTO）上，返回新的不可变快照。
 *
 * 设计原则：能确定性应用的增量事件就地更新缓存；无法识别或缺字段的事件返回
 * null，调用方据此触发一次全量重拉（invalidate），保证最终一致。
 * seq 空洞检测由调用方（hooks）负责：若 event.seq !== snapshot.seq + 1 则重拉。
 */

import type {
  CardDTO,
  EventEnvelope,
  LabelDTO,
  ListDTO,
  MemberDTO,
  SnapshotDTO,
} from '../../lib/api/types'

type Payload = Record<string, unknown>

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}
function strOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function replaceCard(snapshot: SnapshotDTO, cardId: string, patch: Partial<CardDTO>): SnapshotDTO {
  // 剔除 undefined 字段，避免把已有值覆盖成 undefined
  const clean = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  ) as Partial<CardDTO>
  return {
    ...snapshot,
    cards: snapshot.cards.map((c) => (c.id === cardId ? { ...c, ...clean } : c)),
  }
}

/**
 * 应用单个事件。返回新快照；若事件无法确定性应用则返回 null（应触发重拉）。
 */
export function applyEvent(snapshot: SnapshotDTO, event: EventEnvelope): SnapshotDTO | null {
  const payload = (event.payload ?? {}) as Payload
  const occurredAt = event.occurred_at ?? new Date().toISOString()

  switch (event.type) {
    case 'board.updated': {
      const changed = (payload.changed ?? {}) as Payload
      return {
        ...snapshot,
        board: {
          ...snapshot.board,
          title: str(changed.title) ?? snapshot.board.title,
          description: str(changed.description) ?? snapshot.board.description,
        },
      }
    }

    case 'list.created': {
      const list = (payload.list ?? {}) as Payload
      const id = str(list.id)
      if (!id) return null
      const dto: ListDTO = {
        id,
        board_id: str(list.board_id) ?? snapshot.board.id,
        title: str(list.title) ?? '',
        position: str(list.position) ?? '0',
        archived: false,
        version: num(list.version) ?? 1,
        created_at: occurredAt,
        updated_at: occurredAt,
      }
      if (snapshot.lists.some((l) => l.id === id)) return snapshot
      return { ...snapshot, lists: [...snapshot.lists, dto] }
    }

    case 'list.updated': {
      const listId = str(payload.list_id)
      if (!listId) return null
      const changed = (payload.changed ?? {}) as Payload
      return {
        ...snapshot,
        lists: snapshot.lists.map((l) =>
          l.id === listId
            ? {
                ...l,
                title: str(changed.title) ?? l.title,
                version: num(payload.version) ?? l.version,
              }
            : l,
        ),
      }
    }

    case 'list.moved': {
      const listId = str(payload.list_id)
      if (!listId) return null
      return {
        ...snapshot,
        lists: snapshot.lists.map((l) =>
          l.id === listId
            ? { ...l, position: str(payload.position) ?? l.position, version: num(payload.version) ?? l.version }
            : l,
        ),
      }
    }

    case 'list.deleted': {
      const listId = str(payload.list_id)
      if (!listId) return null
      return {
        ...snapshot,
        lists: snapshot.lists.filter((l) => l.id !== listId),
        cards: snapshot.cards.filter((c) => c.list_id !== listId),
      }
    }

    case 'card.created': {
      const card = (payload.card ?? {}) as Payload
      const id = str(card.id)
      if (!id) return null
      const dto: CardDTO = {
        id,
        list_id: str(card.list_id) ?? '',
        title: str(card.title) ?? '',
        description: str(card.description) ?? '',
        position: str(card.position) ?? '0',
        assignee_id: strOrNull(card.assignee_id),
        due_date: strOrNull(card.due_date),
        archived: false,
        version: num(card.version) ?? 1,
        created_by: strOrNull(card.created_by),
        created_at: occurredAt,
        updated_at: occurredAt,
        label_ids: strArray(card.label_ids),
      }
      if (snapshot.cards.some((c) => c.id === id)) return snapshot
      return { ...snapshot, cards: [...snapshot.cards, dto] }
    }

    case 'card.updated': {
      const cardId = str(payload.card_id)
      if (!cardId) return null
      const changed = (payload.changed ?? {}) as Payload
      // archived=true 等价于删除（软删除）
      if (changed.archived === true) {
        return { ...snapshot, cards: snapshot.cards.filter((c) => c.id !== cardId) }
      }
      const version = num(payload.version)
      const patch: Partial<CardDTO> = {}
      if (str(changed.title) !== undefined) patch.title = str(changed.title)
      if (str(changed.description) !== undefined) patch.description = str(changed.description)
      if ('assignee_id' in changed) patch.assignee_id = strOrNull(changed.assignee_id)
      if ('due_date' in changed) patch.due_date = strOrNull(changed.due_date)
      if (version !== undefined) patch.version = version
      patch.updated_at = occurredAt
      return replaceCard(snapshot, cardId, patch)
    }

    case 'card.moved': {
      const cardId = str(payload.card_id)
      if (!cardId) return null
      return replaceCard(snapshot, cardId, {
        list_id: str(payload.to_list_id) ?? '',
        position: str(payload.position) ?? '0',
        version: num(payload.version),
        updated_at: occurredAt,
      } as Partial<CardDTO>)
    }

    case 'card.deleted': {
      const cardId = str(payload.card_id)
      if (!cardId) return null
      return { ...snapshot, cards: snapshot.cards.filter((c) => c.id !== cardId) }
    }

    case 'card_labels.changed': {
      const cardId = str(payload.card_id)
      if (!cardId) return null
      return replaceCard(snapshot, cardId, {
        label_ids: strArray(payload.label_ids),
        version: num(payload.version),
      } as Partial<CardDTO>)
    }

    case 'label.created': {
      const label = (payload.label ?? {}) as Payload
      const id = str(label.id)
      if (!id) return null
      const dto: LabelDTO = {
        id,
        board_id: str(label.board_id) ?? snapshot.board.id,
        name: str(label.name) ?? '',
        color: str(label.color) ?? 'clay',
      }
      if (snapshot.labels.some((l) => l.id === id)) return snapshot
      return { ...snapshot, labels: [...snapshot.labels, dto] }
    }

    case 'label.updated': {
      const labelId = str(payload.label_id)
      if (!labelId) return null
      return {
        ...snapshot,
        labels: snapshot.labels.map((l) =>
          l.id === labelId
            ? { ...l, name: str(payload.name) ?? l.name, color: str(payload.color) ?? l.color }
            : l,
        ),
      }
    }

    case 'label.deleted': {
      const labelId = str(payload.label_id)
      if (!labelId) return null
      return {
        ...snapshot,
        labels: snapshot.labels.filter((l) => l.id !== labelId),
        // 同步移除卡片上的该标签引用
        cards: snapshot.cards.map((c) =>
          c.label_ids.includes(labelId)
            ? { ...c, label_ids: c.label_ids.filter((id) => id !== labelId) }
            : c,
        ),
      }
    }

    case 'member.added': {
      const userId = str(payload.user_id)
      if (!userId) return null
      if (snapshot.members.some((m) => m.id === userId)) return snapshot
      const dto: MemberDTO = {
        id: userId,
        email: str(payload.email) ?? '',
        display_name: str(payload.display_name) ?? '',
        role: (str(payload.role) as MemberDTO['role']) ?? 'viewer',
        created_at: occurredAt,
      }
      return { ...snapshot, members: [...snapshot.members, dto] }
    }

    case 'member.role_changed': {
      const userId = str(payload.user_id)
      if (!userId) return null
      const to = str(payload.to) as MemberDTO['role'] | undefined
      return {
        ...snapshot,
        members: snapshot.members.map((m) => (m.id === userId && to ? { ...m, role: to } : m)),
      }
    }

    case 'member.removed': {
      const userId = str(payload.user_id)
      if (!userId) return null
      return { ...snapshot, members: snapshot.members.filter((m) => m.id !== userId) }
    }

    default:
      // 未知事件：交由调用方重拉
      return null
  }
}
