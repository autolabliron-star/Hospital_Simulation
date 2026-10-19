import { describe, expect, it } from 'vitest'
import { LEVEL2_FOOTPRINT, LEVEL2_STRIP, toDisplayInto } from '@/sim/levels'
import { LIFTS, SURGERY, areaById } from '@/sim/places'
import type { Vec3 } from '@/sim/types'
import { EAR_Y, ROOM_Y, listenerAt } from './listener'
import { FAR, soundGain } from './registry'

const out = (): Vec3 => ({ x: 0, y: 0, z: 0 })

describe('where the device sounds are heard from, with two levels (R2)', () => {
  it('is you, in SIM coordinates, on level 2 too: the strip, not where the level is drawn', () => {
    const o = out()
    const spot = SURGERY.table.approach
    const at = listenerAt({ x: spot.x, z: spot.z, mode: 'walk' }, null, o)
    expect(at).toBe(o)
    expect(o).toEqual({ x: spot.x, y: EAR_Y, z: spot.z })
    expect(o.x).toBeGreaterThanOrEqual(LEVEL2_STRIP.x0)
    expect(o.x).toBeLessThanOrEqual(LEVEL2_STRIP.x1)
    // the drawn position of the same spot is 150 m west: a listener there would sit in the middle of level 1
    const drawn = toDisplayInto({ x: spot.x, y: 0, z: spot.z }, out())
    expect(drawn.x).toBeGreaterThanOrEqual(LEVEL2_FOOTPRINT.x0)
    expect(drawn.x).toBeLessThan(0)
    expect(o.x).not.toBeCloseTo(drawn.x, 3)
  })

  it('hears only its own level: a level-2 device is loud at the OR table, a level-1 device (the lab, the MRI) is silent there, and the other way round', () => {
    const tableEar = listenerAt({ x: SURGERY.table.approach.x, z: SURGERY.table.approach.z, mode: 'walk' }, null, out())!
    const robot: Vec3 = { x: SURGERY.cart.dock.at.x, y: 1.3, z: SURGERY.cart.dock.at.z }
    const lab: Vec3 = { x: -28, y: 1.3, z: 19.5 }
    const mri: Vec3 = { x: -35.5, y: 1.3, z: -7 }
    expect(soundGain(tableEar, robot)).toBeGreaterThan(0.5)
    expect(soundGain(tableEar, lab)).toBe(0)
    expect(soundGain(tableEar, mri)).toBe(0)
    const labEar = listenerAt({ x: -28, z: 18, mode: 'walk' }, null, out())!
    expect(soundGain(labEar, lab)).toBeGreaterThan(0.5)
    expect(soundGain(labEar, robot)).toBe(0)
  })

  it('keeps the two levels beyond the engine\'s reach, lobby to lobby (the lifts are the same x on both levels, 150 m apart in the sim)', () => {
    for (const shaft of ['A', 'B'] as const) {
      const l1 = LIFTS[shaft][1].stretcher.at
      const l2 = LIFTS[shaft][2].stretcher.at
      expect(Math.hypot(l1.x - l2.x, l1.z - l2.z)).toBeGreaterThan(FAR * 5)
    }
  })

  it('is the middle of a focused level-2 room, in sim coordinates, at the room height', () => {
    const o = out()
    const r = areaById('l2Or').rect
    expect(listenerAt(null, 'l2Or', o)).toBe(o)
    expect(o).toEqual({ x: (r.x0 + r.x1) / 2, y: ROOM_Y, z: (r.z0 + r.z1) / 2 })
    expect(o.x).toBeGreaterThan(LEVEL2_STRIP.x0)
    // overview with nothing focused: nobody listens (also with Level 2 shown)
    expect(listenerAt({ x: 100, z: 0, mode: 'overview' }, null, out())).toBeNull()
  })

  it('walking beats a focused room, on either level', () => {
    const o = out()
    listenerAt({ x: 100, z: 5, mode: 'walk' }, 'mri', o)
    expect(o).toEqual({ x: 100, y: EAR_Y, z: 5 })
    listenerAt({ x: 100, z: 5, mode: 'toWalk' }, 'l2Or', o)
    expect(o.x).toBe(100)
  })
})
