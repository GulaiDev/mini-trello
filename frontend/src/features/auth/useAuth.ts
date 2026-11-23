/** 认证相关 hooks：当前用户查询与登录/注册/登出。 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, auth } from '../../lib/api'
import type { MeDTO } from '../../lib/api/types'

export const meKey = ['me'] as const

export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: async () => {
      try {
        return await auth.me()
      } catch (error) {
        // access 令牌可能已过期：静默刷新一次后重试；仍失败则视为未登录。
        // auth.me() 已跳过自动重试，故不会触发 401 回调造成重拉死循环。
        if (error instanceof ApiError && error.status === 401 && (await auth.refresh())) {
          return await auth.me()
        }
        throw error
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  })
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { email: string; password: string }) => auth.login(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: meKey })
    },
  })
}

export function useRegister() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { email: string; password: string; display_name: string }) =>
      auth.register(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: meKey })
    },
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => auth.logout(),
    onSettled: () => {
      queryClient.clear()
    },
  })
}

export function currentUser(me: MeDTO | undefined) {
  return me?.user ?? null
}
