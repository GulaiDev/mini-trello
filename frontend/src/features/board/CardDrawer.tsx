import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Avatar } from '../../components/Avatar'
import { CalendarIcon, TrashIcon, XIcon } from '../../components/icons'
import { toast } from '../../components/toast-store'
import { toneSoft } from './tone'
import { useBoardView, useDeleteCard, useSetCardLabels, useUpdateCard } from './hooks'
import type { Member } from './types'

function Section({
  title,
  aside,
  children,
}: {
  title: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="border-t border-line/80 pt-4">
      <div className="mb-2.5 flex items-center gap-2">
        <h3 className="font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function CardDrawer({
  boardId,
  cardId,
  onClose,
}: {
  boardId: string
  cardId: string
  onClose: () => void
}) {
  const view = useBoardView(boardId)
  const updateCard = useUpdateCard(boardId)
  const deleteCard = useDeleteCard(boardId)
  const setLabels = useSetCardLabels(boardId)

  const card = view.cardsById[cardId]
  const list = view.lists.find((l) => l.id === card?.listId)
  const canEdit = view.role === 'owner' || view.role === 'editor'

  const [titleDraft, setTitleDraft] = useState(card?.title ?? '')
  const [descDraft, setDescDraft] = useState(card?.description ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const panelRef = useRef<HTMLElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const descRef = useRef<HTMLTextAreaElement>(null)

  // 当服务端（或他人）更新了内容且当前未在编辑该字段时，同步草稿
  useEffect(() => {
    if (card && document.activeElement !== titleRef.current) setTitleDraft(card.title)
  }, [card?.title]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (card && document.activeElement !== descRef.current) setDescDraft(card.description)
  }, [card?.description]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previous
    }
  }, [onClose])

  if (!card) return null

  const assignee = card.assigneeId ? view.membersById[card.assigneeId] : undefined

  function commitTitle() {
    if (!card) return
    const next = titleDraft.trim()
    if (!next || next === card.title) {
      setTitleDraft(card.title)
      return
    }
    updateCard.mutate({ cardId: card.id, version: card.version, patch: { title: next } })
  }

  function commitDescription() {
    if (!card || descDraft === card.description) return
    updateCard.mutate({
      cardId: card.id,
      version: card.version,
      patch: { description: descDraft },
    })
  }

  function toggleLabel(labelId: string) {
    if (!card || !canEdit) return
    const next = card.labelIds.includes(labelId)
      ? card.labelIds.filter((id) => id !== labelId)
      : [...card.labelIds, labelId]
    setLabels.mutate({ cardId: card.id, labelIds: next })
  }

  function selectAssignee(memberId: string) {
    if (!card || !canEdit) return
    const next = card.assigneeId === memberId ? null : memberId
    updateCard.mutate({
      cardId: card.id,
      version: card.version,
      patch: { assignee_id: next },
    })
  }

  function changeDueDate(value: string) {
    if (!card || !canEdit) return
    updateCard.mutate({
      cardId: card.id,
      version: card.version,
      patch: { due_date: value ? `${value}T00:00:00` : null },
    })
  }

  function handleDelete() {
    if (!card) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    deleteCard.mutate(card.id)
    toast('卡片已删除')
    onClose()
  }

  return (
    <>
      <div
        className="animate-fade fixed inset-0 z-40 bg-ink/20"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-drawer-title"
        tabIndex={-1}
        className="animate-drawer fixed inset-y-0 right-0 z-50 flex w-full max-w-[540px] flex-col border-l border-line bg-card shadow-lift focus:outline-none"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
            {list?.title ?? '卡片'}
          </span>
          <span className="text-line-2">/</span>
          <span className="font-mono text-[10px] text-ink-3">DETAIL</span>
          <button
            type="button"
            className="icon-btn ml-auto"
            onClick={onClose}
            aria-label="关闭卡片详情"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <div>
            <label htmlFor="card-drawer-title" className="sr-only">
              卡片标题
            </label>
            <input
              id="card-drawer-title"
              ref={titleRef}
              value={titleDraft}
              disabled={!canEdit}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={commitTitle}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  ;(event.target as HTMLInputElement).blur()
                }
              }}
              className="-mx-1 w-full rounded-md border-none bg-transparent px-1 py-1 font-serif text-[23px] font-semibold leading-tight text-ink transition-colors hover:bg-paper-2/40 focus:bg-paper-2/50 focus:outline-none focus:ring-2 focus:ring-vermilion/25 disabled:opacity-70"
            />
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-ink-3">
              <span className="font-mono">创建于 {card.createdAt}</span>
              <span className="font-mono">版本 v{card.version}</span>
            </div>
          </div>

          <Section
            title="标签"
            aside={
              <span className="ml-auto font-mono text-[10px] text-ink-3">
                {card.labelIds.length} / {view.labels.length}
              </span>
            }
          >
            {view.labels.length === 0 ? (
              <p className="text-[12px] text-ink-3">这个看板还没有标签。</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {view.labels.map((label) => {
                  const active = card.labelIds.includes(label.id)
                  return (
                    <button
                      key={label.id}
                      type="button"
                      aria-pressed={active}
                      disabled={!canEdit}
                      onClick={() => toggleLabel(label.id)}
                      className={`label-pill h-[24px] px-2 transition disabled:opacity-60 ${
                        active
                          ? `${toneSoft[label.tone]} ring-1 ring-inset ring-current`
                          : 'bg-paper-2 text-ink-3 hover:text-ink-2'
                      }`}
                    >
                      {label.name}
                    </button>
                  )
                })}
              </div>
            )}
          </Section>

          <Section title="负责人">
            <div className="grid grid-cols-2 gap-1.5">
              {view.members.map((member: Member) => {
                const active = card.assigneeId === member.id
                return (
                  <button
                    key={member.id}
                    type="button"
                    aria-pressed={active}
                    disabled={!canEdit}
                    onClick={() => selectAssignee(member.id)}
                    className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-[12px] transition disabled:opacity-60 ${
                      active
                        ? 'border-vermilion/50 bg-vermilion-soft/40'
                        : 'border-line bg-card hover:border-line-2'
                    }`}
                  >
                    <Avatar member={member} size="sm" showStatus />
                    <span className="truncate text-ink-2">{member.name}</span>
                    <span
                      className={`ml-auto h-1.5 w-1.5 rounded-full ${
                        active ? 'bg-vermilion' : 'bg-line-2'
                      }`}
                    />
                  </button>
                )
              })}
            </div>
            {assignee && (
              <p className="mt-2 text-[11px] text-ink-3">
                当前负责人：{assignee.name}
              </p>
            )}
          </Section>

          <Section title="截止日期">
            <div className="flex items-center gap-2">
              <CalendarIcon className="h-3.5 w-3.5 text-ink-3" />
              <input
                type="date"
                value={card.dueDate ?? ''}
                disabled={!canEdit}
                onChange={(event) => changeDueDate(event.target.value)}
                aria-label="截止日期"
                className="field h-9 w-auto px-2 text-[12px]"
              />
              {card.dueDate && canEdit && (
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={() => changeDueDate('')}
                >
                  清除
                </button>
              )}
            </div>
          </Section>

          <Section title="描述">
            <textarea
              ref={descRef}
              value={descDraft}
              disabled={!canEdit}
              onChange={(event) => setDescDraft(event.target.value)}
              onBlur={commitDescription}
              rows={4}
              placeholder="补充背景、验收标准或相关链接…"
              aria-label="卡片描述"
              className="field min-h-[104px] resize-y leading-relaxed disabled:opacity-70"
            />
          </Section>
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-3">
          {canEdit && (
            <button
              type="button"
              className={`btn btn-sm ${
                confirmDelete
                  ? 'bg-clay text-card hover:bg-clay-deep'
                  : 'text-clay-deep hover:bg-clay-soft'
              }`}
              onClick={handleDelete}
              onBlur={() => setConfirmDelete(false)}
            >
              <TrashIcon className="h-3.5 w-3.5" />
              {confirmDelete ? '再次点击确认删除' : '删除卡片'}
            </button>
          )}
          <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-ink-3">
            <span className="h-1.5 w-1.5 rounded-full bg-moss" />
            {updateCard.isPending ? '保存中…' : '更改自动保存'}
          </span>
        </footer>
      </aside>
    </>
  )
}
