import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { Avatar, AvatarStack } from '../../components/Avatar'
import { ArrowLeftIcon, PlusIcon, SearchIcon, UsersIcon, XIcon } from '../../components/icons'
import { isOverdue } from '../../lib/format'
import { ApiError } from '../../lib/api'
import type { Role } from '../../lib/api/types'
import { useMe } from '../auth/useAuth'
import { BoardColumn } from './BoardColumn'
import { CardDrawer } from './CardDrawer'
import { CardShell } from './KanbanCard'
import {
  useAddMember,
  useBoardRealtime,
  useBoardView,
  useChangeMemberRole,
  useCreateCard,
  useCreateList,
  useMoveCard,
  useRemoveMember,
  useSnapshot,
} from './hooks'
import { useRealtimeStore } from './store'
import type { Card, Label, Member } from './types'

export default function BoardPage() {
  const { boardId = '' } = useParams()
  const { data: me } = useMe()
  const currentUserId = me?.user.id ?? ''

  const { isLoading, isError } = useSnapshot(boardId)
  const view = useBoardView(boardId)
  useBoardRealtime(boardId)
  const socketStatus = useRealtimeStore((s) => s.status[boardId])

  const moveCard = useMoveCard(boardId)
  const createCard = useCreateCard(boardId)

  const [query, setQuery] = useState('')
  const [mineOnly, setMineOnly] = useState(false)
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [membersOpen, setMembersOpen] = useState(false)
  const [activeCardId, setActiveCardId] = useState<string | null>(null)

  const suppressClick = useRef(false)
  const canEdit = view.role === 'owner' || view.role === 'editor'

  const matches = useCallback(
    (card: Card) => {
      if (mineOnly && card.assigneeId !== currentUserId) return false
      if (overdueOnly && !(card.dueDate && isOverdue(card.dueDate))) return false
      const q = query.trim().toLowerCase()
      if (q) {
        const labelText = card.labelIds
          .map((id) => view.labelsById[id]?.name ?? '')
          .join(' ')
        const haystack = `${card.title} ${card.description} ${labelText}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    },
    [currentUserId, mineOnly, overdueOnly, query, view.labelsById],
  )

  const columnCards = useMemo(() => {
    const map: Record<string, Card[]> = {}
    for (const list of view.lists) {
      map[list.id] = (view.cardsByList[list.id] ?? []).filter(matches)
    }
    return map
  }, [view.lists, view.cardsByList, matches])

  const totalCards = useMemo(
    () => Object.values(view.cardsById).length,
    [view.cardsById],
  )
  const visibleTotal = useMemo(
    () => view.lists.reduce((sum, list) => sum + (columnCards[list.id]?.length ?? 0), 0),
    [view.lists, columnCards],
  )
  const filtering = query.trim().length > 0 || mineOnly || overdueOnly
  const onlineCount = view.members.filter((m) => m.online).length
  const activeCard = activeCardId ? view.cardsById[activeCardId] : undefined

  const closeDrawer = useCallback(() => setSelectedCardId(null), [])
  const openCard = useCallback(
    (cardId: string) => {
      if (suppressClick.current) return
      setSelectedCardId(cardId)
    },
    [],
  )

  function blockClickAfterDrag() {
    suppressClick.current = true
    window.setTimeout(() => {
      suppressClick.current = false
    }, 150)
  }

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function findListIdForDroppable(id: string): string | undefined {
    if (view.lists.some((list) => list.id === id)) return id
    return view.cardsById[id]?.listId
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveCardId(String(event.active.id))
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveCardId(null)
    blockClickAfterDrag()
    if (!canEdit || !over) return

    const activeId = String(active.id)
    const card = view.cardsById[activeId]
    if (!card) return
    const overId = String(over.id)
    const toListId = findListIdForDroppable(overId)
    if (!toListId) return

    const targetIds = (view.cardsByList[toListId] ?? []).map((c) => c.id)
    const { prev, next, changed } = computeNeighbors(
      targetIds,
      activeId,
      overId,
      toListId,
      card.listId,
    )
    if (!changed) return
    moveCard.mutate({ cardId: activeId, toListId, prevCardId: prev, nextCardId: next })
  }

  function handleAddCard(listId: string, title: string) {
    createCard.mutate({ listId, title })
  }

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-paper">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-3">
          加载看板…
        </span>
      </div>
    )
  }

  if (isError || !view.board) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-ink-3">
          Board unavailable
        </span>
        <h1 className="text-[26px]">无法打开这个看板</h1>
        <p className="max-w-[320px] text-[13px] text-ink-3">
          它可能已被删除，或者你没有访问权限。
        </p>
        <Link to="/" className="btn btn-ghost mt-2">
          <ArrowLeftIcon className="h-4 w-4" />
          返回工作台
        </Link>
      </div>
    )
  }

  const board = view.board

  return (
    <div className="flex h-dvh flex-col">
      <header className="shrink-0 border-b border-line bg-paper/80">
        <div className="mx-auto max-w-[1480px] px-5 pt-4 md:px-8">
          <div className="flex flex-wrap items-center gap-2.5">
            <Link to="/" className="btn btn-quiet btn-sm -ml-1.5">
              <ArrowLeftIcon className="h-3.5 w-3.5" />
              工作台
            </Link>
            <span className="text-[12px] text-line-2">/</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">
              看板
            </span>
            <ConnectionDot status={socketStatus} />
            <div className="ml-auto flex items-center gap-2.5">
              <AvatarStack members={view.members} max={4} size="sm" showStatus />
              <span className="hidden font-mono text-[10px] text-ink-3 sm:inline">
                {onlineCount} 人在线
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setMembersOpen(true)}
              >
                <UsersIcon className="h-3.5 w-3.5" />
                成员
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-4">
            <div className="min-w-0">
              <h1 className="truncate text-[26px] leading-tight text-ink md:text-[32px]">
                {board.title}
              </h1>
              <p className="mt-1.5 max-w-[600px] text-[12.5px] text-ink-3">
                {board.description || '暂无描述'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="relative block">
                <span className="sr-only">搜索卡片</span>
                <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索卡片或标签…"
                  className="field h-8 w-[196px] pl-8 text-[12px]"
                />
              </label>
              <button
                type="button"
                className="chip"
                data-active={mineOnly}
                aria-pressed={mineOnly}
                onClick={() => setMineOnly((value) => !value)}
              >
                只看我的
              </button>
              <button
                type="button"
                className="chip"
                data-active={overdueOnly}
                aria-pressed={overdueOnly}
                onClick={() => setOverdueOnly((value) => !value)}
              >
                已逾期
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line/70 px-5 py-2 md:px-8">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
          {filtering ? `${visibleTotal} / ${totalCards}` : totalCards} 张卡片
        </span>
        <span className="hidden items-center gap-1.5 text-[11px] text-ink-3 sm:flex">
          <span className="h-1 w-1 rounded-full bg-vermilion" />
          {canEdit ? '拖动卡片调整阶段，顺序会自动保存' : '你是只读成员，无法编辑'}
        </span>
        <span className="ml-auto hidden font-mono text-[10px] tracking-wide text-ink-3 md:inline">
          TAB 选中 · 空格拖动 · ENTER 打开
        </span>
      </div>

      <main className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => {
            setActiveCardId(null)
            blockClickAfterDrag()
          }}
        >
          <div className="flex h-full items-stretch gap-3 px-5 py-4 md:px-8">
            {view.lists.length === 0 && (
              <div className="w-[300px] shrink-0 self-start rounded-xl border border-dashed border-line-2 bg-card/50 p-5">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">
                  Empty board
                </span>
                <h2 className="mt-2 font-serif text-[19px] leading-snug">从第一个列表开始</h2>
                <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">
                  列表代表工作阶段，例如「待排期 / 进行中 / 待评审」。
                </p>
              </div>
            )}

            {view.lists.map((list, index) => (
              <BoardColumn
                key={list.id}
                list={list}
                index={index}
                cards={columnCards[list.id] ?? []}
                totalCount={(view.cardsByList[list.id] ?? []).length}
                labelsById={view.labelsById}
                membersById={view.membersById}
                onOpenCard={openCard}
                onAddCard={canEdit ? handleAddCard : () => {}}
                filtering={filtering}
              />
            ))}

            {canEdit && <AddListTile boardId={boardId} />}
          </div>

          <DragOverlay dropAnimation={null}>
            {activeCard ? (
              <div className="w-[268px] cursor-grabbing">
                <CardShell
                  card={activeCard}
                  labels={activeCard.labelIds
                    .map((id) => view.labelsById[id])
                    .filter((label): label is Label => Boolean(label))}
                  assignee={
                    activeCard.assigneeId ? view.membersById[activeCard.assigneeId] : undefined
                  }
                  overlay
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </main>

      {selectedCardId && (
        <CardDrawer
          key={selectedCardId}
          boardId={boardId}
          cardId={selectedCardId}
          onClose={closeDrawer}
        />
      )}

      {membersOpen && (
        <MembersDialog boardId={boardId} onClose={() => setMembersOpen(false)} />
      )}
    </div>
  )
}

/** 计算拖拽落点的左右邻居 id（基于目标列的完整顺序，不含被拖卡片）。 */
function computeNeighbors(
  targetIds: string[],
  activeId: string,
  overId: string,
  toListId: string,
  fromListId: string,
): { prev: string | null; next: string | null; changed: boolean } {
  const without = targetIds.filter((id) => id !== activeId)
  let insertAt: number
  if (overId === toListId) {
    insertAt = without.length // 落在空白区 → 末尾
  } else {
    const idx = without.indexOf(overId)
    if (idx === -1) {
      insertAt = without.length
    } else {
      const originalIndex = targetIds.indexOf(activeId)
      const overIndexOriginal = targetIds.indexOf(overId)
      // 同列向下拖动 → 放到目标之后；否则放到目标之前
      insertAt =
        originalIndex !== -1 && originalIndex < overIndexOriginal ? idx + 1 : idx
    }
  }
  const prev = insertAt > 0 ? without[insertAt - 1]! : null
  const next = insertAt < without.length ? without[insertAt]! : null

  // 判断是否真的发生了变化
  const wasInTarget = fromListId === toListId
  if (wasInTarget) {
    const currentIndex = targetIds.indexOf(activeId)
    const neighborBefore = currentIndex > 0 ? targetIds[currentIndex - 1]! : null
    const neighborAfter =
      currentIndex < targetIds.length - 1 ? targetIds[currentIndex + 1]! : null
    if (neighborBefore === prev && neighborAfter === next) {
      return { prev, next, changed: false }
    }
  }
  return { prev, next, changed: true }
}

function ConnectionDot({ status }: { status?: string }) {
  const map: Record<string, { label: string; className: string }> = {
    open: { label: '实时已连接', className: 'bg-moss' },
    connecting: { label: '连接中', className: 'bg-sand' },
    closed: { label: '连接断开', className: 'bg-clay' },
    idle: { label: '未连接', className: 'bg-line-2' },
  }
  const info = map[status ?? 'idle'] ?? map.idle!
  return (
    <span className="ml-1 hidden items-center gap-1.5 font-mono text-[10px] text-ink-3 sm:flex">
      <span className={`h-1.5 w-1.5 rounded-full ${info.className}`} />
      {info.label}
    </span>
  )
}

function AddListTile({ boardId }: { boardId: string }) {
  const createList = useCreateList(boardId)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-[284px] shrink-0 items-center gap-2 self-start rounded-xl border border-dashed border-line-2 bg-card/40 px-3 py-3 text-left text-[12.5px] text-ink-3 transition-colors hover:border-vermilion/50 hover:bg-card hover:text-ink"
      >
        <PlusIcon className="h-4 w-4" />
        新建列表
      </button>
    )
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!title.trim()) return
        createList.mutate(title.trim())
        setTitle('')
        setOpen(false)
      }}
      className="w-[284px] shrink-0 self-start rounded-xl border border-line bg-card p-2 shadow-paper"
    >
      <input
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false)
            setTitle('')
          }
        }}
        placeholder="列表名称，例如「进行中」"
        aria-label="新列表名称"
        className="field text-[13px]"
      />
      <div className="mt-1.5 flex items-center gap-1">
        <button type="submit" className="btn btn-primary btn-sm" disabled={!title.trim()}>
          创建列表
        </button>
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          onClick={() => {
            setOpen(false)
            setTitle('')
          }}
        >
          取消
        </button>
      </div>
    </form>
  )
}

const assignableRoles: Role[] = ['editor', 'viewer']
const roleText: Record<Role, string> = { owner: '拥有者', editor: '可编辑', viewer: '只读' }

function MembersDialog({ boardId, onClose }: { boardId: string; onClose: () => void }) {
  const view = useBoardView(boardId)
  const isOwner = view.role === 'owner'
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('editor')
  const [error, setError] = useState('')

  const addMember = useAddMember(boardId)
  const changeRole = useChangeMemberRole(boardId)
  const removeMember = useRemoveMember(boardId)

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

  async function submitAdd() {
    setError('')
    if (!email.trim()) {
      setError('请输入邮箱')
      return
    }
    try {
      await addMember.mutateAsync({ email: email.trim(), role })
      setEmail('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '添加成员失败')
    }
  }

  return (
    <div
      className="animate-fade fixed inset-0 z-[60] flex items-center justify-center bg-ink/25 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="members-title"
        onClick={(event) => event.stopPropagation()}
        className="animate-rise flex max-h-[80vh] w-full max-w-[460px] flex-col rounded-[14px] border border-line bg-card p-5 shadow-lift"
      >
        <div className="flex items-start gap-2">
          <div>
            <h2 id="members-title" className="font-serif text-[20px]">
              看板成员
            </h2>
            <p className="mt-1 text-[12px] text-ink-3">
              {isOwner ? '按邮箱邀请已注册用户，并分配角色。' : '只有拥有者可以管理成员。'}
            </p>
          </div>
          <button
            type="button"
            className="icon-btn ml-auto shrink-0"
            onClick={onClose}
            aria-label="关闭成员弹窗"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <ul className="mt-4 max-h-[38vh] space-y-1.5 overflow-y-auto">
          {view.members.map((member: Member) => (
            <li key={member.id} className="flex items-center gap-2.5 rounded-lg px-1 py-1">
              <Avatar member={member} size="sm" showStatus />
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] text-ink-2">{member.name}</span>
                <span className="block truncate font-mono text-[10px] text-ink-3">
                  {member.email}
                </span>
              </span>
              {isOwner && member.role !== 'owner' ? (
                <select
                  value={member.role}
                  onChange={(event) =>
                    changeRole.mutate({ userId: member.id, role: event.target.value as Role })
                  }
                  className="field ml-auto h-7 w-auto px-1.5 text-[11px]"
                  aria-label={`${member.name} 的角色`}
                >
                  {assignableRoles.map((r) => (
                    <option key={r} value={r}>
                      {roleText[r]}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="ml-auto font-mono text-[10px] text-ink-3">
                  {roleText[member.role]}
                </span>
              )}
              {isOwner && member.role !== 'owner' && (
                <button
                  type="button"
                  className="icon-btn h-7 w-7 text-clay-deep"
                  onClick={() => removeMember.mutate(member.id)}
                  aria-label={`移除 ${member.name}`}
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>

        {isOwner && (
          <div className="mt-4 border-t border-line/80 pt-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
              邀请成员
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                aria-label="被邀请人邮箱"
                className="field h-9 flex-1 text-[12px]"
              />
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as Role)}
                className="field h-9 w-auto px-2 text-[12px]"
                aria-label="邀请角色"
              >
                {assignableRoles.map((r) => (
                  <option key={r} value={r}>
                    {roleText[r]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-primary btn-sm shrink-0"
                onClick={submitAdd}
                disabled={addMember.isPending}
              >
                添加
              </button>
            </div>
            {error && (
              <p role="alert" className="mt-1.5 text-[11px] text-vermilion">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
