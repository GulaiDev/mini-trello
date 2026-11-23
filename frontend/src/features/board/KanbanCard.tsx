import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Avatar } from '../../components/Avatar'
import { CalendarIcon } from '../../components/icons'
import { dueMeta } from '../../lib/format'
import { toneSoft } from './tone'
import type { Card, Label, Member } from './types'

const dueToneClass = {
  danger: 'bg-clay-soft text-clay-deep',
  soon: 'bg-sand-soft text-sand-deep',
  normal: 'bg-paper-2 text-ink-3',
} as const

interface CardShellProps {
  card: Card
  labels: Label[]
  assignee?: Member
  onOpen?: () => void
  overlay?: boolean
  dragging?: boolean
}

export function CardShell({
  card,
  labels,
  assignee,
  overlay = false,
  dragging = false,
}: CardShellProps) {
  const due = card.dueDate ? dueMeta(card.dueDate) : null

  return (
    <article
      className={[
        'relative rounded-[10px] border bg-card px-3 py-2.5 text-left transition',
        overlay
          ? 'rotate-2 border-line-2 shadow-drag'
          : 'border-line shadow-[0_1px_0_rgba(60,45,30,0.03)]',
        dragging ? 'opacity-40' : '',
        !overlay ? 'group-hover:border-line-2 group-hover:shadow-paper' : '',
      ].join(' ')}
    >
      {labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {labels.map((label) => (
            <span key={label.id} className={`label-pill ${toneSoft[label.tone]}`}>
              {label.name}
            </span>
          ))}
        </div>
      )}

      <h3 className="mt-1.5 text-[13.5px] font-medium leading-snug text-ink">{card.title}</h3>

      {card.description && (
        <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-ink-3">
          {card.description}
        </p>
      )}

      {(due || assignee) && (
        <div className="mt-2.5 flex items-center justify-between gap-2">
          {due ? (
            <span
              className={`inline-flex h-[18px] items-center gap-1 rounded px-1.5 text-[10.5px] font-medium ${dueToneClass[due.tone]}`}
            >
              <CalendarIcon className="h-2.5 w-2.5" />
              {due.label}
            </span>
          ) : (
            <span />
          )}
          {assignee && <Avatar member={assignee} size="xs" showStatus />}
        </div>
      )}
    </article>
  )
}

interface KanbanCardProps {
  card: Card
  labels: Label[]
  assignee?: Member
  onOpen: () => void
}

export function KanbanCard({ card, labels, assignee, onOpen }: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: card.id,
      data: { type: 'card', listId: card.listId },
    })

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    touchAction: 'manipulation' as const,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group cursor-grab rounded-[10px] outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-vermilion focus-visible:ring-offset-2 focus-visible:ring-offset-paper-2"
      {...attributes}
      {...listeners}
      onClick={onOpen}
      aria-label={`打开卡片：${card.title}`}
    >
      <CardShell card={card} labels={labels} assignee={assignee} dragging={isDragging} />
    </div>
  )
}
