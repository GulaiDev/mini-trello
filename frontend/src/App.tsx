import { useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Link, Route, Routes, useNavigate } from 'react-router'
import { Toaster } from './components/Toaster'
import { ArrowLeftIcon } from './components/icons'
import { setUnauthorizedHandler } from './lib/api'
import AuthPage from './features/auth/AuthPage'
import { RequireAuth } from './features/auth/RequireAuth'
import { meKey } from './features/auth/useAuth'
import BoardPage from './features/board/BoardPage'
import HomePage from './features/home/HomePage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
})

function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-ink-3">
        404
      </span>
      <h1 className="text-[28px]">这一页还没有画出来</h1>
      <p className="max-w-[300px] text-[13px] text-ink-3">
        链接可能已经失效，回到工作台继续看看。
      </p>
      <Link to="/" className="btn btn-ghost mt-2">
        <ArrowLeftIcon className="h-4 w-4" />
        返回工作台
      </Link>
    </div>
  )
}

/** 把 HTTP 客户端的 401 回调接到路由与会话失效上。 */
function UnauthorizedBridge() {
  const navigate = useNavigate()
  useEffect(() => {
    setUnauthorizedHandler(() => {
      queryClient.removeQueries({ queryKey: meKey })
      navigate('/login', { replace: true })
    })
    return () => setUnauthorizedHandler(null)
  }, [navigate])
  return null
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <UnauthorizedBridge />
        <Routes>
          <Route path="/login" element={<AuthPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <HomePage />
              </RequireAuth>
            }
          />
          <Route
            path="/boards/:boardId"
            element={
              <RequireAuth>
                <BoardPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
        <Toaster />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
