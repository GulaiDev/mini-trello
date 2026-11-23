import { useEffect, useRef, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { PlusIcon } from '../../components/icons'
import { KanbanCard } from './KanbanCard'
import type { Card, Label, List, Member } from './types'

interface BoardColumnProps {
  list: List
  index: number
  cards: Card[]
  totalCount: number
  labelsById: Record<string, Label>
  membersById: Record<string, Member>
  onOpenCard: (cardId: string) => void
  onAddCard: (listId: string, title: string) => void
  filtering: boolean
}

export function BoardColumn({
  list,
  index,
  cards,
  totalCount,
  labelsById,
  membersById,
  onOpenCard,
  onAddCard,
  filtering,
}: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: list.id,
    data: { type: 'list' },
  })
  const [composerOpen, setComposerOpen] = useState(false)
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (composerOpen) textareaRef.current?.focus()
  }, [composerOpen])

  function submit() {
    const trimmed = text.trim()
    if (!trimmed) return
    onAddCard(list.id, trimmed)
    setText('')
    textareaRef.current?.focus()
  }

  function openComposer() {
    setComposerOpen(true)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  return (
    <section
      ref={setNodeRef}
      aria-label={`${list.title}，${totalCount} 张卡片`}
      className={[
        'flex h-full max-h-full w-[284px] shrink-0 flex-col rounded-xl border bg-paper-2/55 transition-colors',
        isOver
          ? 'border-vermilion/50 bg-vermilion-soft/35'
          : 'border-line/80',
      ].join(' ')}
    >
      <header className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span className="font-mono text-[10px] tracking-[0.1em] text-ink-3">
          {String(index + 1).padStart(2, '0')}
        </span>
        <h2 className="truncate text-[12.5px] font-semibold tracking-wide text-ink">
          {list.title}
        </h2>
        <span className="ml-0.5 inline-flex h-[18px] min-w-[20px] items-center justify-center rounded-full border border-line bg-card px-1 font-mono text-[10px] text-ink-3">
          {filtering ? `${cards.length}/${totalCount}` : totalCount}
        </span>
        <button
          type="button"
          className="icon-btn ml-auto h-6 w-6"
          onClick={openComposer}
          aria-label={`在「${list.title}」添加卡片`}
        >
          <PlusIcon className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="h-px shrink-0 bg-line/70" />

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <div className="space-y-2">
          <SortableContext
            items={cards.map((card) => card.id)}
            strategy={verticalListSortingStrategy}
          >
            {cards.map((card) => (
              <KanbanCard
                key={card.id}
                card={card}
                labels={card.labelIds
                  .map((id) => labelsById[id])
                  .filter((label): label is Label => Boolean(label))}
                assignee={card.assigneeId ? membersById[card.assigneeId] : undefined}
                onOpen={() => onOpenCard(card.id)}
              />
            ))}
          </SortableContext>

          {cards.length === 0 && (
            <div className="flex min-h-[76px] items-center justify-center rounded-lg border border-dashed border-line-2/80 px-3 text-center text-[11.5px] text-ink-3">
              {filtering
                ? '没有匹配的卡片'
                : isOver
                  ? '松开以放入此列'
                  : '把卡片拖到这里'}
            </div>
          )}
        </div>

        <div className="mt-2">
          {composerOpen ? (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                submit()
              }}
              className="rounded-lg border border-line bg-card p-1.5 shadow-paper"
            >
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    submit()
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setComposerOpen(false)
                    setText('')
                  }
                }}
                rows={2}
                placeholder="写下一张卡片…"
                aria-label="新卡片标题"
                className="field min-h-[52px] resize-none border-transparent bg-transparent px-1.5 py-1 text-[13px] focus:border-transparent focus:shadow-none"
              />
              <div className="mt-1 flex items-center gap-1">
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={!text.trim()}
                >
                  添加
                </button>
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={() => {
                    setComposerOpen(false)
                    setText('')
                  }}
                >
                  取消
                </button>
                <span className="ml-auto pr-1 font-mono text-[9.5px] text-ink-3">
                  Enter 添加
                </span>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={openComposer}
              className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12px] text-ink-3 transition-colors hover:bg-card/70 hover:text-ink"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              添加卡片
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
