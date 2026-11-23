import { CheckIcon } from './icons'
import { useToastStore } from './toast-store'

export function Toaster() {
  const items = useToastStore((s) => s.items)

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-6 z-[80] flex flex-col items-center gap-2 px-4"
      role="status"
      aria-live="polite"
    >
      {items.map((item) => (
        <div
          key={item.id}
          className="animate-rise flex items-center gap-2 rounded-full border border-line bg-ink px-4 py-2 text-[12.5px] text-paper shadow-lift"
        >
          <CheckIcon className="h-3.5 w-3.5 text-vermilion-soft" />
          {item.message}
        </div>
      ))}
    </div>
  )
}
