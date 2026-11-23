import { create } from 'zustand'

export interface ToastItem {
  id: number
  message: string
}

interface ToastState {
  items: ToastItem[]
  push: (message: string) => void
  dismiss: (id: number) => void
}

let seq = 0

export const useToastStore = create<ToastState>((set, get) => ({
  items: [],
  push: (message) => {
    const id = ++seq
    set((s) => ({ items: [...s.items, { id, message }].slice(-3) }))
    window.setTimeout(() => get().dismiss(id), 2800)
  },
  dismiss: (id) =>
    set((s) => ({ items: s.items.filter((item) => item.id !== id) })),
}))

export function toast(message: string) {
  useToastStore.getState().push(message)
}
