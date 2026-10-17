import { describe, expect, it } from 'vitest'
import type { PlayerMode } from '@/sim/types'
import { hudKind, hudVisibility, type HudParts } from './visibility'

const MODES: PlayerMode[] = ['overview', 'toWalk', 'walk', 'toOverview']
const names = (p: HudParts): string[] => Object.entries(p).filter(([, on]) => on).map(([k]) => k).sort()

describe('the overview keeps today\'s HUD', () => {
  it('shows the title card, KPI card, Prescribe pill, event line and order rail, and none of the walk furniture', () => {
    expect(names(hudVisibility('overview', false))).toEqual(['eventLine', 'kpiCard', 'orderRail', 'rxPill', 'titleCard'])
  })
})

describe('walk mode is quiet', () => {
  it('shows a clock, the minimap, the prompt, the objective, the hint, the toast and the drawer card', () => {
    expect(names(hudVisibility('walk', false))).toEqual(['drawerCard', 'hint', 'minimap', 'objective', 'prompt', 'toast', 'walkClock'])
  })

  it('hides the KPI card, the order rail, the event line and the title card', () => {
    const p = hudVisibility('walk', false)
    expect(p.kpiCard).toBe(false)
    expect(p.orderRail).toBe(false)
    expect(p.eventLine).toBe(false)
    expect(p.titleCard).toBe(false)
    expect(p.rxPill).toBe(false)
  })
})

describe('the flights between the two', () => {
  it('show the HUD of where you are going', () => {
    expect(hudKind('toWalk')).toBe('walk')
    expect(hudKind('toOverview')).toBe('overview')
    expect(hudVisibility('toWalk', false)).toEqual(hudVisibility('walk', false))
    expect(hudVisibility('toOverview', false)).toEqual(hudVisibility('overview', false))
  })
})

describe('H', () => {
  it('hides everything, in every mode', () => {
    for (const mode of MODES) expect(names(hudVisibility(mode, true)), mode).toEqual([])
  })
})
