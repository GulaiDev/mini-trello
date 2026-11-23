/** 路由守卫：未登录跳转登录页，加载中显示占位。 */

import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useMe } from './useAuth'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: me, isLoading, isError } = useMe()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-paper">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-3">
          加载中…
        </span>
      </div>
    )
  }

  if (isError || !me) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <>{children}</>
}
