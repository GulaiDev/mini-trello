import { describe, expect, it } from 'vitest'
import type { CardDTO, MemberDTO } from '../../lib/api/types'
import {
  colorToTone,
  comparePosition,
  initialOf,
  relativeTime,
  toCard,
  toDateInput,
  toMember,
} from './mappers'

const cardDto: CardDTO = {
  id: 'c1',
  list_id: 'l1',
  title: '标题',
  description: '描述',
  position: '1536.000000000000000000',
  assignee_id: 'u2',
  due_date: '2026-03-05T00:00:00',
  archived: false,
  version: 4,
  created_by: 'u1',
  created_at: '2026-01-01T08:00:00Z',
  updated_at: '2026-01-02T08:00:00Z',
  label_ids: ['lab1', 'lab2'],
}

describe('mappers', () => {
  it('colorToTone 已知色映射，未知回退 ink', () => {
    expect(colorToTone('clay')).toBe('clay')
    expect(colorToTone('nope')).toBe('ink')
    expect(colorToTone(null)).toBe('ink')
  })

  it('comparePosition 按数值升序', () => {
    expect(comparePosition('1024', '2048')).toBe(-1)
    expect(comparePosition('2048', '1024')).toBe(1)
    expect(comparePosition('1536', '1536')).toBe(0)
    // 高精度十进制字符串仍按数值比较
    expect(comparePosition('1536.000000000000000000', '1537')).toBe(-1)
  })

  it('initialOf 取首字符并大写', () => {
    expect(initialOf('甲乙')).toBe('甲')
    expect(initialOf('alice')).toBe('A')
    expect(initialOf('  ')).toBe('?')
  })

  it('toDateInput 截取 YYYY-MM-DD', () => {
    expect(toDateInput('2026-03-05T00:00:00')).toBe('2026-03-05')
    expect(toDateInput(null)).toBeNull()
  })

  it('toCard 转换视图模型', () => {
    const card = toCard(cardDto)
    expect(card).toMatchObject({
      id: 'c1',
      listId: 'l1',
      assigneeId: 'u2',
      dueDate: '2026-03-05',
      version: 4,
      labelIds: ['lab1', 'lab2'],
    })
  })

  it('toMember 依据 id 派生稳定 tone，并带在线状态', () => {
    const dto: MemberDTO = {
      id: 'user-123',
      email: 'a@b.c',
      display_name: '张三',
      role: 'editor',
      created_at: '2026-01-01T00:00:00Z',
    }
    const a = toMember(dto, true)
    const b = toMember(dto, false)
    expect(a.initial).toBe('张')
    expect(a.online).toBe(true)
    expect(b.online).toBe(false)
    expect(a.tone).toBe(b.tone) // 稳定
  })

  it('relativeTime 刚刚 / 分钟前', () => {
    expect(relativeTime(new Date().toISOString())).toBe('刚刚')
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString()
    expect(relativeTime(fiveMinAgo)).toBe('5 分钟前')
  })
})
