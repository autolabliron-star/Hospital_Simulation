import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/scene/fx/emoteAtlas', async (orig) => {
  const real = await orig<typeof import('@/scene/fx/emoteAtlas')>()
  return { ...real, createEmoteAtlas: () => ({ dispose() {} }) }
})

import { EmoteRig } from '@/scene/fx/EmoteLayer'
import { REALISM_KEY, realismActive, useRealism } from './realism.store'

beforeEach(() => useRealism.setState({ walk: true, overview: false }))

describe('realism store', () => {
  it('defaults: on in walk mode, off in the overview', () => {
    expect(realismActive('walk')).toBe(true)
    expect(realismActive('toWalk')).toBe(true)
    expect(realismActive('overview')).toBe(false)
    expect(realismActive(undefined)).toBe(false)
  })
  it('the toggle flips only the view you are in', () => {
    useRealism.getState().toggle('walk')
    expect(realismActive('walk')).toBe(false)
    expect(realismActive('overview')).toBe(false)
    useRealism.getState().toggle('overview')
    expect(realismActive('overview')).toBe(true)
    expect(realismActive('walk')).toBe(false)
  })
  it('uses the R key', () => expect(REALISM_KEY).toBe('KeyR'))
})

describe('emote layer', () => {
  it('draws nothing and does no tracker work while realism is on', () => {
    const emoting = new Map([
      ['a', { id: 'a', role: 'patient', name: 'a', position: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0, anim: 'idle', emote: 'pill', mood: 'neutral', tier: 'near', variant: 0 }],
    ])
    const rig = new EmoteRig(emoting as never)
    const update = vi.spyOn(rig.tracker, 'update')
    rig.frame(0.016, 0, 1.6, 3, true, true)
    expect(rig.mesh.visible).toBe(false)
    expect(update).not.toHaveBeenCalled()
    rig.frame(0.016, 0, 1.6, 3, true, realismActive('overview'))
    expect(update).toHaveBeenCalled()
  })
})
