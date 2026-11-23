import { describe, expect, it } from 'vitest'
import type { EventEnvelope, SnapshotDTO } from '../../lib/api/types'
import { applyEvent } from './reducer'

function baseSnapshot(): SnapshotDTO {
  return {
    board: {
      id: 'b1',
      title: '看板',
      description: '',
      owner_id: 'u1',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      role: 'owner',
    },
    role: 'owner',
    seq: 1,
    lists: [
      {
        id: 'l1',
        board_id: 'b1',
        title: '待办',
        position: '1024',
        archived: false,
        version: 1,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'l2',
        board_id: 'b1',
        title: '进行',
        position: '2048',
        archived: false,
        version: 1,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ],
    cards: [
      {
        id: 'c1',
        list_id: 'l1',
        title: '卡片一',
        description: '',
        position: '1024',
        assignee_id: null,
        due_date: null,
        archived: false,
        version: 1,
        created_by: 'u1',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        label_ids: ['lab1'],
      },
    ],
    labels: [{ id: 'lab1', board_id: 'b1', name: '紧急', color: 'clay' }],
    members: [
      {
        id: 'u1',
        email: 'a@b.c',
        display_name: '甲',
        role: 'owner',
        created_at: '2026-01-01T00:00:00Z',
      },
    ],
    truncated: false,
  }
}

function event(type: string, payload: Record<string, unknown>, seq = 2): EventEnvelope {
  return { board_id: 'b1', seq, type, payload, occurred_at: '2026-01-02T00:00:00Z' }
}

describe('applyEvent', () => {
  it('card.created 追加新卡片', () => {
    const next = applyEvent(
      baseSnapshot(),
      event('card.created', {
        card: { id: 'c2', list_id: 'l1', title: '卡片二', position: '1536', version: 1, label_ids: [] },
      }),
    )
    expect(next).not.toBeNull()
    expect(next!.cards).toHaveLength(2)
    expect(next!.cards.find((c) => c.id === 'c2')?.title).toBe('卡片二')
  })

  it('card.created 对已存在卡片幂等', () => {
    const snap = baseSnapshot()
    const next = applyEvent(
      snap,
      event('card.created', { card: { id: 'c1', list_id: 'l1', title: '重复', position: '1' } }),
    )
    expect(next!.cards).toHaveLength(1)
  })

  it('card.moved 更新所属列与位置', () => {
    const next = applyEvent(
      baseSnapshot(),
      event('card.moved', { card_id: 'c1', from_list_id: 'l1', to_list_id: 'l2', position: '2100', version: 3 }),
    )
    const moved = next!.cards.find((c) => c.id === 'c1')!
    expect(moved.list_id).toBe('l2')
    expect(moved.position).toBe('2100')
    expect(moved.version).toBe(3)
  })

  it('card.updated archived=true 视为删除', () => {
    const next = applyEvent(
      baseSnapshot(),
      event('card.updated', { card_id: 'c1', list_id: 'l1', version: 2, changed: { archived: true } }),
    )
    expect(next!.cards).toHaveLength(0)
  })

  it('card.updated 更新标题与版本，保留其它字段', () => {
    const next = applyEvent(
      baseSnapshot(),
      event('card.updated', { card_id: 'c1', list_id: 'l1', version: 5, changed: { title: '改名' } }),
    )
    const card = next!.cards[0]!
    expect(card.title).toBe('改名')
    expect(card.version).toBe(5)
    expect(card.label_ids).toEqual(['lab1'])
  })

  it('card.deleted 移除卡片', () => {
    const next = applyEvent(baseSnapshot(), event('card.deleted', { card_id: 'c1', list_id: 'l1' }))
    expect(next!.cards).toHaveLength(0)
  })

  it('list.created 追加列表', () => {
    const next = applyEvent(
      baseSnapshot(),
      event('list.created', { list: { id: 'l3', board_id: 'b1', title: '完成', position: '3072', version: 1 } }),
    )
    expect(next!.lists.map((l) => l.id)).toContain('l3')
  })

  it('list.deleted 同时移除其下卡片', () => {
    const next = applyEvent(baseSnapshot(), event('list.deleted', { list_id: 'l1', board_id: 'b1' }))
    expect(next!.lists.map((l) => l.id)).not.toContain('l1')
    expect(next!.cards).toHaveLength(0)
  })

  it('card_labels.changed 覆盖标签集合', () => {
    const next = applyEvent(
      baseSnapshot(),
      event('card_labels.changed', { card_id: 'c1', label_ids: [], version: 4 }),
    )
    expect(next!.cards[0]!.label_ids).toEqual([])
  })

  it('label.deleted 移除标签并清理卡片引用', () => {
    const next = applyEvent(baseSnapshot(), event('label.deleted', { label_id: 'lab1' }))
    expect(next!.labels).toHaveLength(0)
    expect(next!.cards[0]!.label_ids).toEqual([])
  })

  it('member.role_changed 更新角色', () => {
    const next = applyEvent(
      baseSnapshot(),
      event('member.role_changed', { user_id: 'u1', from: 'owner', to: 'editor' }),
    )
    expect(next!.members[0]!.role).toBe('editor')
  })

  it('未知事件返回 null（触发重拉）', () => {
    expect(applyEvent(baseSnapshot(), event('something.new', {}))).toBeNull()
  })

  it('不修改原快照（不可变）', () => {
    const snap = baseSnapshot()
    applyEvent(snap, event('card.deleted', { card_id: 'c1', list_id: 'l1' }))
    expect(snap.cards).toHaveLength(1)
  })
})
