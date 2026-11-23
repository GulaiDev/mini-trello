import type { Member, Tone } from '../features/board/types'
import { toneSoft } from '../features/board/tone'

const sizeClass: Record<string, string> = {
  xs: 'h-5 w-5 text-[9px]',
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-[11px]',
  lg: 'h-10 w-10 text-[12px]',
}

interface AvatarProps {
  member: Member
  size?: 'xs' | 'sm' | 'md' | 'lg'
  showStatus?: boolean
  className?: string
  title?: string
}

export function Avatar({
  member,
  size = 'md',
  showStatus = false,
  className = '',
  title,
}: AvatarProps) {
  const tone: Tone = member.tone
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full font-serif font-semibold leading-none ring-2 ring-card ${sizeClass[size]} ${toneSoft[tone]} ${className}`}
      title={title ?? member.name}
      aria-hidden={title === undefined ? true : undefined}
    >
      {member.initial}
      {showStatus && member.online && (
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-moss ring-2 ring-card" />
      )}
    </span>
  )
}

interface AvatarStackProps {
  members: Member[]
  max?: number
  size?: 'xs' | 'sm' | 'md'
  showStatus?: boolean
}

export function AvatarStack({
  members,
  max = 3,
  size = 'sm',
  showStatus = false,
}: AvatarStackProps) {
  const shown = members.slice(0, max)
  const rest = members.length - shown.length
  return (
    <span className="flex items-center">
      {shown.map((member, index) => (
        <Avatar
          key={member.id}
          member={member}
          size={size}
          showStatus={showStatus}
          className={index === 0 ? '' : '-ml-1.5'}
        />
      ))}
      {rest > 0 && (
        <span
          className={`-ml-1.5 inline-flex items-center justify-center rounded-full border border-line bg-paper-2 font-mono text-ink-3 ring-2 ring-card ${sizeClass[size]}`}
        >
          +{rest}
        </span>
      )}
    </span>
  )
}
