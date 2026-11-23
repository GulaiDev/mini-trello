/**
 * 看板数据层 hooks：
 * - useSnapshot：服务端状态（TanStack Query 缓存 SnapshotDTO）。
 * - useBoardRealtime：建立 WS，把事件增量应用到缓存，维护 presence 与 seq 空洞检测。
 * - useBoardView：把 DTO 派生为渲染所需的视图模型（有序列表/分组卡片/成员在线）。
 * - 各类 mutation：乐观更新 + 失败回滚 + 409 对齐服务端权威数据。
 */

import { useEffect, useMemo, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '../../components/toast-store'
import { ApiError, boards, cards, labels as labelsApi, lists, members as membersApi } from '../../lib/api'
import type { CardDTO, Role, SnapshotDTO } from '../../lib/api/types'
import { BoardSocket, getClientId } from '../../lib/ws'
import { comparePosition, toBoard, toCard, toLabel, toList, toMember } from './mappers'
import { applyEvent } from './reducer'
import { useRealtimeStore } from './store'
import type { Board, Card, Label, List, Member } from './types'

export const snapshotKey = (boardId: string) => ['snapshot', boardId] as const

// --- 查询 ---
export function useSnapshot(boardId: string) {
  return useQuery({
    queryKey: snapshotKey(boardId),
    queryFn: () => boards.snapshot(boardId),
    enabled: Boolean(boardId),
    staleTime: Infinity, // 由 WS 增量维护，无需轮询
    refetchOnWindowFocus: false,
  })
}

function updateSnapshot(
  queryClient: ReturnType<typeof useQueryClient>,
  boardId: string,
  updater: (snapshot: SnapshotDTO) => SnapshotDTO | null,
) {
  queryClient.setQueryData<SnapshotDTO>(snapshotKey(boardId), (current) => {
    if (!current) return current
    const next = updater(current)
    return next ?? current
  })
}

// --- 实时 ---
export function useBoardRealtime(boardId: string) {
  const queryClient = useQueryClient()
  const setPresence = useRealtimeStore((s) => s.setPresence)
  const setStatus = useRealtimeStore((s) => s.setStatus)
  const clearBoard = useRealtimeStore((s) => s.clearBoard)
  const socketRef = useRef<BoardSocket | null>(null)

  useEffect(() => {
    if (!boardId) return
    const socket = new BoardSocket(boardId, {
      onStatusChange: (status) => setStatus(boardId, status),
      onReady: ({ presence }) => setPresence(boardId, presence),
      onPresence: (message) => setPresence(boardId, message.presence),
      onResync: () => {
        queryClient.invalidateQueries({ queryKey: snapshotKey(boardId) })
      },
      onEvent: (event) => {
        const current = queryClient.getQueryData<SnapshotDTO>(snapshotKey(boardId))
        if (!current) return
        const seq = typeof event.seq === 'number' ? event.seq : undefined
        // 已应用过的旧事件（含自身回显的重复）跳过
        if (seq !== undefined && seq <= current.seq) {
          return
        }
        // seq 空洞：缺失中间事件，全量重拉保证一致
        if (seq !== undefined && seq > current.seq + 1) {
          queryClient.invalidateQueries({ queryKey: snapshotKey(boardId) })
          return
        }
        const next = applyEvent(current, event)
        if (next === null) {
          queryClient.invalidateQueries({ queryKey: snapshotKey(boardId) })
          return
        }
        queryClient.setQueryData<SnapshotDTO>(snapshotKey(boardId), {
          ...next,
          seq: seq ?? next.seq,
        })
      },
    })
    socketRef.current = socket
    socket.connect()
    return () => {
      socket.close()
      socketRef.current = null
      clearBoard(boardId)
    }
  }, [boardId, queryClient, setPresence, setStatus, clearBoard])

  return socketRef
}

// --- 派生视图 ---
export interface BoardView {
  board: Board | null
  role: Role
  seq: number
  lists: List[]
  /** listId -> 已按 position 升序排列的卡片 */
  cardsByList: Record<string, Card[]>
  /** cardId -> Card */
  cardsById: Record<string, Card>
  labels: Label[]
  labelsById: Record<string, Label>
  members: Member[]
  membersById: Record<string, Member>
  truncated: boolean
}

export function useBoardView(boardId: string): BoardView {
  const { data } = useSnapshot(boardId)
  const presence = useRealtimeStore((s) => s.presence[boardId])

  return useMemo(() => {
    if (!data) {
      return {
        board: null,
        role: 'viewer',
        seq: 0,
        lists: [],
        cardsByList: {},
        cardsById: {},
        labels: [],
        labelsById: {},
        members: [],
        membersById: {},
        truncated: false,
      }
    }
    const online = new Set(presence ?? [])
    const lists = data.lists
      .map(toList)
      .sort((a, b) => comparePosition(a.position, b.position))
    const cardsById: Record<string, Card> = {}
    const cardsByList: Record<string, Card[]> = {}
    for (const list of lists) cardsByList[list.id] = []
    for (const dto of data.cards) {
      const card = toCard(dto)
      cardsById[card.id] = card
      ;(cardsByList[card.listId] ??= []).push(card)
    }
    for (const listId of Object.keys(cardsByList)) {
      cardsByList[listId]!.sort((a, b) => comparePosition(a.position, b.position))
    }
    const labels = data.labels.map(toLabel)
    const labelsById: Record<string, Label> = {}
    for (const label of labels) labelsById[label.id] = label
    const members = data.members.map((m) => toMember(m, online.has(m.id)))
    const membersById: Record<string, Member> = {}
    for (const member of members) membersById[member.id] = member

    return {
      board: toBoard(data.board),
      role: data.role,
      seq: data.seq,
      lists,
      cardsByList,
      cardsById,
      labels,
      labelsById,
      members,
      membersById,
      truncated: data.truncated,
    }
  }, [data, presence])
}

// --- 位置计算（乐观预演用） ---
function midpoint(prev: string | null, next: string | null): string {
  const p = prev === null ? null : Number(prev)
  const n = next === null ? null : Number(next)
  if (p !== null && n !== null) return String((p + n) / 2)
  if (p !== null) return String(p + 1024)
  if (n !== null) return String(n - 1024)
  return '1024'
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

// --- Mutations ---

export function useCreateList(boardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (title: string) => lists.create(boardId, { title }),
    onSuccess: (dto) => {
      // WS list.created 事件可能已先行写入，按 id 去重避免重复列
      updateSnapshot(queryClient, boardId, (snap) =>
        snap.lists.some((l) => l.id === dto.id) ? snap : { ...snap, lists: [...snap.lists, dto] },
      )
    },
    onError: (error) => toast(errorMessage(error, '创建列表失败')),
  })
}

export function useRenameList(boardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ listId, title, version }: { listId: string; title: string; version: number }) =>
      lists.update(listId, { title, expected_version: version }),
    onSuccess: (dto) => {
      updateSnapshot(queryClient, boardId, (snap) => ({
        ...snap,
        lists: snap.lists.map((l) => (l.id === dto.id ? dto : l)),
      }))
    },
    onError: (error) => {
      toast(errorMessage(error, '重命名失败'))
      queryClient.invalidateQueries({ queryKey: snapshotKey(boardId) })
    },
  })
}

export function useDeleteList(boardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (listId: string) => lists.remove(listId),
    onMutate: async (listId) => {
      const previous = queryClient.getQueryData<SnapshotDTO>(snapshotKey(boardId))
      updateSnapshot(queryClient, boardId, (snap) => ({
        ...snap,
        lists: snap.lists.filter((l) => l.id !== listId),
        cards: snap.cards.filter((c) => c.list_id !== listId),
      }))
      return { previous }
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(snapshotKey(boardId), context.previous)
      toast(errorMessage(error, '删除列表失败'))
    },
  })
}

export function useCreateCard(boardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { listId: string; title: string }) =>
      cards.create(input.listId, { title: input.title, client_move_id: getClientId() }),
    onSuccess: (dto) => {
      updateSnapshot(queryClient, boardId, (snap) =>
        snap.cards.some((c) => c.id === dto.id) ? snap : { ...snap, cards: [...snap.cards, dto] },
      )
    },
    onError: (error) => toast(errorMessage(error, '创建卡片失败')),
  })
}

export function useUpdateCard(boardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      cardId: string
      version: number
      patch: Partial<Pick<CardDTO, 'title' | 'description' | 'assignee_id' | 'due_date'>>
    }) =>
      cards.update(input.cardId, {
        ...input.patch,
        expected_version: input.version,
      }),
    onSuccess: (dto) => {
      updateSnapshot(queryClient, boardId, (snap) => ({
        ...snap,
        cards: snap.cards.map((c) => (c.id === dto.id ? dto : c)),
      }))
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        // 用服务端权威数据覆盖本地，提示冲突
        const latest = error.latest as CardDTO | undefined
        if (latest?.id) {
          updateSnapshot(queryClient, boardId, (snap) => ({
            ...snap,
            cards: snap.cards.map((c) => (c.id === latest.id ? latest : c)),
          }))
        }
        toast('卡片已被他人修改，已同步最新内容')
      } else {
        toast(errorMessage(error, '保存失败'))
      }
      queryClient.invalidateQueries({ queryKey: snapshotKey(boardId) })
    },
  })
}

export function useDeleteCard(boardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (cardId: string) => cards.remove(cardId),
    onMutate: async (cardId) => {
      const previous = queryClient.getQueryData<SnapshotDTO>(snapshotKey(boardId))
      updateSnapshot(queryClient, boardId, (snap) => ({
        ...snap,
        cards: snap.cards.filter((c) => c.id !== cardId),
      }))
      return { previous }
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(snapshotKey(boardId), context.previous)
      toast(errorMessage(error, '删除卡片失败'))
    },
  })
}

export function useSetCardLabels(boardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { cardId: string; labelIds: string[] }) =>
      cards.setLabels(input.cardId, input.labelIds),
    onSuccess: (dto) => {
      updateSnapshot(queryClient, boardId, (snap) => ({
        ...snap,
        cards: snap.cards.map((c) => (c.id === dto.id ? dto : c)),
      }))
    },
    onError: (error) => toast(errorMessage(error, '更新标签失败')),
  })
}

/**
 * 卡片移动：乐观更新 + 失败回滚。
 * 调用方（拖拽）给出目标列与插入位置的左右邻居 id，位置由服务端权威计算。
 */
export function useMoveCard(boardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      cardId: string
      toListId: string
      prevCardId: string | null
      nextCardId: string | null
    }) =>
      cards.move(input.cardId, {
        to_list_id: input.toListId,
        prev_card_id: input.prevCardId,
        next_card_id: input.nextCardId,
        client_move_id: getClientId(),
      }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: snapshotKey(boardId) })
      const previous = queryClient.getQueryData<SnapshotDTO>(snapshotKey(boardId))
      updateSnapshot(queryClient, boardId, (snap) => {
        const prevPos = snap.cards.find((c) => c.id === input.prevCardId)?.position ?? null
        const nextPos = snap.cards.find((c) => c.id === input.nextCardId)?.position ?? null
        return {
          ...snap,
          cards: snap.cards.map((c) =>
            c.id === input.cardId
              ? { ...c, list_id: input.toListId, position: midpoint(prevPos, nextPos) }
              : c,
          ),
        }
      })
      return { previous }
    },
    onSuccess: (result) => {
      // 用服务端权威 position/version 覆盖乐观值
      updateSnapshot(queryClient, boardId, (snap) => ({
        ...snap,
        cards: snap.cards.map((c) => (c.id === result.card.id ? result.card : c)),
      }))
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(snapshotKey(boardId), context.previous)
      toast(errorMessage(error, '移动失败，已还原'))
      queryClient.invalidateQueries({ queryKey: snapshotKey(boardId) })
    },
  })
}

export function useCreateLabel(boardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; color?: string }) => labelsApi.create(boardId, input),
    onSuccess: (dto) => {
      // 同理：WS label.created 可能已写入，按 id 去重
      updateSnapshot(queryClient, boardId, (snap) =>
        snap.labels.some((l) => l.id === dto.id) ? snap : { ...snap, labels: [...snap.labels, dto] },
      )
    },
    onError: (error) => toast(errorMessage(error, '创建标签失败')),
  })
}

export function useAddMember(boardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { email: string; role: Role }) => membersApi.add(boardId, input),
    onSuccess: (dto) => {
      updateSnapshot(queryClient, boardId, (snap) =>
        snap.members.some((m) => m.id === dto.id) ? snap : { ...snap, members: [...snap.members, dto] },
      )
      toast('成员已添加')
    },
    onError: (error) => toast(errorMessage(error, '添加成员失败')),
  })
}

export function useChangeMemberRole(boardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { userId: string; role: Role }) =>
      membersApi.changeRole(boardId, input.userId, input.role),
    onSuccess: (dto) => {
      updateSnapshot(queryClient, boardId, (snap) => ({
        ...snap,
        members: snap.members.map((m) => (m.id === dto.id ? dto : m)),
      }))
    },
    onError: (error) => toast(errorMessage(error, '修改角色失败')),
  })
}

export function useRemoveMember(boardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) => membersApi.remove(boardId, userId),
    onSuccess: (_data, userId) => {
      updateSnapshot(queryClient, boardId, (snap) => ({
        ...snap,
        members: snap.members.filter((m) => m.id !== userId),
      }))
    },
    onError: (error) => toast(errorMessage(error, '移除成员失败')),
  })
}
