const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function toISODate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function todayISO(): string {
  return toISODate(new Date())
}

function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

export function monthDay(iso: string): string {
  const date = parseISODate(iso)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

export function formatTodayLabel(date = new Date()): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 · ${WEEKDAYS[date.getDay()]}`
}

export function greeting(date = new Date()): string {
  const hour = date.getHours()
  if (hour < 6) return '凌晨好'
  if (hour < 9) return '早上好'
  if (hour < 12) return '上午好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

export function daysFromToday(iso: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = parseISODate(iso)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

export function isOverdue(iso: string): boolean {
  return daysFromToday(iso) < 0
}

export type DueTone = 'danger' | 'soon' | 'normal'

export function dueMeta(iso: string): { label: string; tone: DueTone } {
  const diff = daysFromToday(iso)
  if (diff < 0) return { label: `逾期 ${-diff} 天`, tone: 'danger' }
  if (diff === 0) return { label: '今天到期', tone: 'danger' }
  if (diff === 1) return { label: '明天到期', tone: 'soon' }
  if (diff <= 3) return { label: `${monthDay(iso)} 到期`, tone: 'soon' }
  return { label: `${monthDay(iso)} 到期`, tone: 'normal' }
}
