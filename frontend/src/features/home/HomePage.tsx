import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PlusIcon, XIcon } from '../../components/icons'
import { toast } from '../../components/toast-store'
import { formatTodayLabel, greeting, todayISO } from '../../lib/format'
import { boards as boardsApi, ApiError } from '../../lib/api'
import type { Role } from '../../lib/api/types'
import { toBoard } from '../board/mappers'
import type { Board } from '../board/types'
import { useLogout, useMe } from '../auth/useAuth'

const boardsKey = ['boards'] as const

const roleLabel: Record<Role, string> = {
  owner: '拥有者',
  editor: '可编辑',
  viewer: '只读',
}

const roleTone: Record<Role, string> = {
  owner: 'bg-clay-soft text-clay-deep',
  editor: 'bg-olive-soft text-olive-deep',
  viewer: 'bg-paper-3 text-ink-3',
}

export default function HomePage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { data: me } = useMe()
  const logout = useLogout()

  const { data, isLoading, isError } = useQuery({
    queryKey: boardsKey,
    queryFn: () => boardsApi.list({ size: 100 }),
  })

  const createBoard = useMutation({
    mutationFn: (input: { title: string; description: string }) => boardsApi.create(input),
    onSuccess: (dto) => {
      queryClient.invalidateQueries({ queryKey: boardsKey })
      toast(`看板「${dto.title}」已创建`)
      navigate(`/boards/${dto.id}`)
    },
    onError: (error) =>
      toast(error instanceof ApiError ? error.message : '创建看板失败'),
  })

  const [creating, setCreating] = useState(false)
  const items: Board[] = (data?.items ?? []).map(toBoard)
  const user = me?.user

  async function handleLogout() {
    await logout.mutateAsync()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-paper">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-7 px-6 md:px-10">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="stamp">M</span>
            <span className="flex flex-col leading-none">
              <span className="font-serif text-[17px] font-semibold tracking-tight text-ink">
                Mini Trello
              </span>
              <span className="mt-1 font-mono text-[8.5px] uppercase tracking-[0.2em] text-ink-3">
                Realtime Boards
              </span>
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3 sm:inline">
              {todayISO().replace(/-/g, ' / ')}
            </span>
            {user && (
              <span className="hidden text-[12px] text-ink-2 sm:inline">
                {user.display_name}
              </span>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={handleLogout}>
              退出登录
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-6 pb-16 pt-10 md:px-10 md:pt-14">
        <section className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-3">
              {formatTodayLabel()}
            </p>
            <h1 className="mt-3 text-[34px] leading-[1.08] text-ink sm:text-[44px]">
              {greeting()}，{user?.display_name ?? '伙伴'}
            </h1>
            <p className="mt-2.5 max-w-[560px] text-[13.5px] leading-relaxed text-ink-2">
              你参与了{' '}
              <span className="font-medium text-vermilion">{data?.total ?? 0} 个看板</span>
              ，选一个继续，或新建一个。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              <PlusIcon className="h-4 w-4" />
              新建看板
            </button>
          </div>
        </section>

        <section className="mt-10">
          <SectionHeading index="01" title="我的看板" meta={`${items.length} BOARDS`} />

          {isLoading && (
            <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-3">
              加载中…
            </p>
          )}
          {isError && (
            <p className="mt-6 text-[13px] text-vermilion">看板加载失败，请稍后重试。</p>
          )}

          <div id="boards" className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((board) => (
              <BoardCard key={board.id} board={board} />
            ))}

            <button
              type="button"
              onClick={() => setCreating(true)}
              className="group flex min-h-[168px] flex-col items-start justify-center gap-2 rounded-[12px] border border-dashed border-line-2 bg-card/35 px-5 py-6 text-left transition-colors hover:border-vermilion/50 hover:bg-card"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-line-2 text-ink-3 transition-colors group-hover:border-vermilion/50 group-hover:text-vermilion">
                <PlusIcon className="h-4 w-4" />
              </span>
              <span className="mt-1 font-serif text-[17px] text-ink">新建看板</span>
              <span className="text-[11.5px] leading-relaxed text-ink-3">
                从空白看板开始，先建列，再放第一张卡片。
              </span>
            </button>
          </div>
        </section>

        <footer className="mt-16 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-6 font-mono text-[10px] text-ink-3">
          <span className="uppercase tracking-[0.14em]">Mini Trello · 实时协作</span>
          <span className="normal-case tracking-normal">数据保存在服务端 MySQL</span>
        </footer>
      </main>

      {creating && (
        <CreateBoardDialog
          onClose={() => setCreating(false)}
          onSubmit={(input) => createBoard.mutate(input)}
          pending={createBoard.isPending}
        />
      )}
    </div>
  )
}

function SectionHeading({ index, title, meta }: { index: string; title: string; meta: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-[10px] tracking-[0.2em] text-ink-3">{index}</span>
      <h2 className="text-[17px] text-ink">{title}</h2>
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
      <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-ink-3">
        {meta}
      </span>
    </div>
  )
}

function BoardCard({ board }: { board: Board }) {
  const role = board.role ?? 'viewer'
  return (
    <Link
      to={`/boards/${board.id}`}
      className="group flex min-h-[168px] flex-col overflow-hidden rounded-[12px] border border-line bg-card shadow-paper transition duration-200 hover:-translate-y-0.5 hover:border-line-2 hover:shadow-lift"
    >
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start gap-2">
          <h3 className="font-serif text-[19px] leading-snug text-ink">{board.title}</h3>
          <span className={`label-pill ml-auto shrink-0 ${roleTone[role]}`}>
            {roleLabel[role]}
          </span>
        </div>
        <p className="mt-2 line-clamp-3 text-[12px] leading-relaxed text-ink-3">
          {board.description || '暂无描述'}
        </p>
        <div className="mt-auto flex items-center justify-between pt-4">
          <span className="font-mono text-[9.5px] text-ink-3">更新于 {board.updatedAt}</span>
        </div>
      </div>
    </Link>
  )
}

function CreateBoardDialog({
  onClose,
  onSubmit,
  pending,
}: {
  onClose: () => void
  onSubmit: (input: { title: string; description: string }) => void
  pending: boolean
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
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

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) {
      setError('给看板起一个名字吧')
      inputRef.current?.focus()
      return
    }
    onSubmit({ title: title.trim(), description: description.trim() })
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
        aria-labelledby="create-board-title"
        onClick={(event) => event.stopPropagation()}
        className="animate-rise w-full max-w-[460px] rounded-[14px] border border-line bg-card p-6 shadow-lift"
      >
        <div className="flex items-start gap-3">
          <div>
            <h2 id="create-board-title" className="font-serif text-[21px]">
              新建看板
            </h2>
            <p className="mt-1 text-[12px] text-ink-3">一个看板对应一件事，比如「产品发布计划」。</p>
          </div>
          <button
            type="button"
            className="icon-btn ml-auto shrink-0"
            onClick={onClose}
            aria-label="关闭新建看板弹窗"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="board-title"
              className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3"
            >
              看板名称
            </label>
            <input
              id="board-title"
              ref={inputRef}
              value={title}
              onChange={(event) => {
                setTitle(event.target.value)
                if (error) setError('')
              }}
              placeholder="例如：产品发布计划"
              aria-invalid={Boolean(error)}
              className="field"
            />
            {error && (
              <p role="alert" className="mt-1.5 text-[11px] text-vermilion">
                {error}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="board-desc"
              className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3"
            >
              一句话目标
              <span className="ml-1.5 normal-case tracking-normal text-ink-3">可选</span>
            </label>
            <textarea
              id="board-desc"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              placeholder="这个阶段要达成什么？"
              className="field resize-none"
            />
          </div>

          <div className="flex items-center gap-2 border-t border-line/80 pt-4">
            <span className="text-[10.5px] text-ink-3">创建后会进入空白看板</span>
            <button type="button" className="btn btn-quiet btn-sm ml-auto" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
              {pending ? '创建中…' : '创建看板'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
