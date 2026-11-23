/** 登录 / 注册页。成功后跳转到看板工作台。 */

import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { ApiError } from '../../lib/api'
import { useLogin, useMe, useRegister } from './useAuth'

type Mode = 'login' | 'register'

export default function AuthPage() {
  const navigate = useNavigate()
  const { data: me, isLoading } = useMe()
  const login = useLogin()
  const register = useRegister()

  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')

  // 已登录则直接进入工作台
  if (!isLoading && me) return <Navigate to="/" replace />

  const pending = login.isPending || register.isPending

  function switchMode(next: Mode) {
    setMode(next)
    setError('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    try {
      if (mode === 'login') {
        await login.mutateAsync({ email, password })
      } else {
        await register.mutateAsync({
          email,
          password,
          display_name: displayName.trim() || email.split('@')[0]!,
        })
      }
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '操作失败，请重试')
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="stamp">M</span>
          <h1 className="font-serif text-[26px] leading-tight text-ink">Mini Trello</h1>
          <p className="text-[12.5px] text-ink-3">多人实时协作看板</p>
        </div>

        <div className="rounded-[14px] border border-line bg-card p-6 shadow-paper">
          <div className="mb-5 flex rounded-lg border border-line bg-paper-2 p-0.5">
            {(['login', 'register'] as Mode[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => switchMode(option)}
                className={`flex-1 rounded-md px-3 py-1.5 text-[12.5px] transition ${
                  mode === option
                    ? 'bg-card text-ink shadow-paper'
                    : 'text-ink-3 hover:text-ink-2'
                }`}
              >
                {option === 'login' ? '登录' : '注册'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === 'register' && (
              <Field
                id="display-name"
                label="昵称"
                value={displayName}
                onChange={setDisplayName}
                placeholder="你的显示名"
                autoComplete="nickname"
              />
            )}
            <Field
              id="email"
              label="邮箱"
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
            <Field
              id="password"
              label="密码"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder={mode === 'register' ? '至少 8 位' : '你的密码'}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              required
            />

            {error && (
              <p role="alert" className="text-[11.5px] text-vermilion">
                {error}
              </p>
            )}

            <button type="submit" className="btn btn-primary w-full" disabled={pending}>
              {pending ? '处理中…' : mode === 'login' ? '登录' : '创建账号'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  autoComplete,
  required,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  placeholder?: string
  autoComplete?: string
  required?: boolean
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        className="field"
      />
    </div>
  )
}
