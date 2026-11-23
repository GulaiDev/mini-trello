import type { Tone } from './types'

/** 实色（进度条、色点、封条） */
export const toneSolid: Record<Tone, string> = {
  clay: 'bg-clay',
  olive: 'bg-olive',
  sky: 'bg-sky',
  plum: 'bg-plum',
  sand: 'bg-sand',
  ink: 'bg-ink',
}

/** 柔色底 + 深色字（标签、头像） */
export const toneSoft: Record<Tone, string> = {
  clay: 'bg-clay-soft text-clay-deep',
  olive: 'bg-olive-soft text-olive-deep',
  sky: 'bg-sky-soft text-sky-deep',
  plum: 'bg-plum-soft text-plum-deep',
  sand: 'bg-sand-soft text-sand-deep',
  ink: 'bg-paper-3 text-ink',
}

export const toneOptions: { tone: Tone; label: string }[] = [
  { tone: 'clay', label: '朱砂' },
  { tone: 'olive', label: '橄榄' },
  { tone: 'sky', label: '天青' },
  { tone: 'plum', label: '梅紫' },
  { tone: 'sand', label: '砂金' },
]
