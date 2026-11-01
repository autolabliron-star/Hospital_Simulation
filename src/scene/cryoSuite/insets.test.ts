/**
 * R5 wave 3: the CT suite's two watch insets in node. 'ctPlan' (the planning picture) and 'ctLive' (the live CT) are registered with the `insetSources`
 * registry at the layer's mount and removed at unmount; each has a small canvas of its own that is painted ONLY while its inset is wanted
 * (`insetWanted[id]`), by the very painters of the room's screens, at most 4 times a real second and only when what it shows changes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearInsetSources, insetSource, insetWanted, registerInsetSource, type InsetId } from '@/scene/registries/insetSources'
import { createRecorder, mockEnv } from '@/scene/imaging/images/mockCanvas'
import { baseSliceFor, newBaseSliceCache, paintLive, paintPlanning } from './ctPaint'
import { createCryoInsets, INSET_H, INSET_PERIOD_S } from './insets'
import { rasterEnv, rasterSurface, type RasterSurface } from './rasterTestkit'
import { TILE, TILE_LOGICAL_W } from './screens'
import { anaesState, cryoState } from './testkit'

const none = (): Record<InsetId, boolean> => ({ endo: false, us: false, ctPlan: false, ctLive: false })

beforeEach(() => clearInsetSources())
afterEach(() => clearInsetSources())

describe('registered at mount, removed at unmount', () => {
  it('registers both sources with their canvases, sizes and paint counts; the remover takes them out (and only them)', () => {
    const { env } = mockEnv()
    const insets = createCryoInsets(env, newBaseSliceCache(), none())
    expect(insetSource('ctPlan')).toBeNull()
    expect(insetSource('ctLive')).toBeNull()
    const off = insets.register()
    const plan = insetSource('ctPlan')!
    const live = insetSource('ctLive')!
    expect(plan.id).toBe('ctPlan')
    expect(live.id).toBe('ctLive')
    expect(plan.canvas).toBe(insets.plan.surface.canvas)
    expect(live.canvas).toBe(insets.live.surface.canvas)
    expect([plan.width, plan.height]).toEqual([TILE_LOGICAL_W[TILE.planning], INSET_H])
    expect([live.width, live.height]).toEqual([TILE_LOGICAL_W[TILE.live], INSET_H])
    expect(plan.canvas).not.toBe(live.canvas)
    // the canvases are the sources' own size
    expect((plan.canvas as { width: number }).width).toBe(plan.width)
    expect((live.canvas as { height: number }).height).toBe(live.height)
    expect(plan.paints()).toBe(0)
    // a source another layer registered in the meantime is left alone by our remover; ours is gone
    const theirs = { id: 'ctLive' as const, canvas: {}, width: 1, height: 1, paints: () => 0 }
    registerInsetSource(theirs)
    off()
    expect(insetSource('ctLive')).toBe(theirs)
    expect(insetSource('ctPlan')).toBeNull()
    // and with nothing else registered, unmounting leaves nothing behind
    clearInsetSources()
    const off2 = insets.register()
    expect(insetSource('ctLive')).not.toBeNull()
    off2()
    expect(insetSource('ctPlan')).toBeNull()
    expect(insetSource('ctLive')).toBeNull()
  })
})

describe('painted only while wanted', () => {
  it('costs nothing at all while no inset is on screen: no canvas call, no paint, however the state changes', () => {
    const rec = createRecorder()
    const { env } = mockEnv(rec)
    const insets = createCryoInsets(env, newBaseSliceCache(), none())
    const made = rec.total()
    const s = cryoState({ step: 'freeze1', ice: 0.1 })
    for (let i = 0; i < 600; i++) {
      s.ice = 0.1 + i / 1000
      s.version = i
      insets.update(s, i / 60)
    }
    expect(rec.total()).toBe(made)
    expect(insets.plan.paints).toBe(0)
    expect(insets.live.paints).toBe(0)
  })

  it('paints the inset that is wanted and not the other; each from its own flag', () => {
    const { env } = mockEnv()
    const wanted = none()
    const insets = createCryoInsets(env, newBaseSliceCache(), wanted)
    const s = cryoState({ step: 'freeze1', ice: 0.5 })
    wanted.ctLive = true
    insets.update(s, 0)
    expect([insets.plan.paints, insets.live.paints]).toEqual([0, 1])
    wanted.ctPlan = true
    insets.update(s, 1)
    expect([insets.plan.paints, insets.live.paints]).toEqual([1, 1])
    wanted.ctLive = false
    s.ice = 0.9
    s.version = 5
    insets.update(s, 2)
    expect([insets.plan.paints, insets.live.paints]).toEqual([2, 1])
  })

  it('at most 4 times a real second (the focused screens\' rate), however fast the state changes, and not when nothing changed', () => {
    expect(INSET_PERIOD_S).toBe(0.25)
    const { env } = mockEnv()
    const wanted = { ...none(), ctPlan: true, ctLive: true }
    const insets = createCryoInsets(env, newBaseSliceCache(), wanted)
    const s = cryoState({ step: 'freeze1', ice: 0.1 })
    for (let i = 0; i < 600; i++) {
      s.ice = 0.1 + i / 1000
      s.version = i
      insets.update(s, i / 60)
    }
    // 10 s at 4 Hz
    expect(insets.live.paints).toBeGreaterThanOrEqual(39)
    expect(insets.live.paints).toBeLessThanOrEqual(41)
    expect(insets.plan.paints).toBe(insets.live.paints)
    // a still picture is painted once, however long you look
    const still = createCryoInsets(env, newBaseSliceCache(), { ...none(), ctLive: true })
    const t = cryoState({ step: 'freeze1', ice: 0.5, timer: 10 })
    for (let i = 0; i < 600; i++) still.update(t, i / 60)
    expect(still.live.paints).toBe(1)
    // the timer's second is a change (the live picture says the ice's size, the plan the step)
    t.timer = 11
    still.update(t, 20)
    expect(still.live.paints).toBe(2)
  })

  it('paints at once when an inset comes on screen with something new, and stops when it goes', () => {
    const { env } = mockEnv()
    const wanted = none()
    const insets = createCryoInsets(env, newBaseSliceCache(), wanted)
    const s = cryoState({ step: 'freeze1', ice: 0.2 })
    insets.update(s, 0)
    s.ice = 0.8
    s.version = 3
    insets.update(s, 5)
    expect(insets.live.paints).toBe(0)
    wanted.ctLive = true
    insets.update(s, 5.001)
    expect(insets.live.paints).toBe(1)
    wanted.ctLive = false
    s.ice = 1
    s.version = 4
    for (let i = 0; i < 100; i++) insets.update(s, 6 + i / 10)
    expect(insets.live.paints).toBe(1)
  })

  it('the default flags are the registry\'s `insetWanted`, which the overlay sets', () => {
    const { env } = mockEnv()
    const insets = createCryoInsets(env, newBaseSliceCache())
    const s = cryoState({ step: 'freeze1', ice: 0.5 })
    insets.update(s, 0)
    expect(insets.live.paints).toBe(0)
    insetWanted.ctLive = true
    insets.update(s, 1)
    expect(insets.live.paints).toBe(1)
    expect(insets.plan.paints).toBe(0)
    insetWanted.ctLive = false
  })

  it('a case of another target repaints (the target is part of what is shown) and takes the base slice of its own', () => {
    const { env } = mockEnv()
    const wanted = { ...none(), ctPlan: true }
    const base = newBaseSliceCache()
    const insets = createCryoInsets(env, base, wanted)
    const k = cryoState({ step: 'freeze1' })
    insets.update(k, 0)
    expect(base.target).toBe('kidney')
    const l = anaesState({ step: 'freeze1' })
    l.version = k.version
    insets.update(l, 1)
    expect(insets.plan.paints).toBe(2)
    expect(base.target).toBe('lung')
  })
})

describe('the same pictures as the room\'s screens', () => {
  const grabbed = (surface: RasterSurface): Uint8ClampedArray => Uint8ClampedArray.from(surface.canvas.data)

  it('an inset is the painter\'s picture of the state on a canvas of its own: pixel for pixel what paintPlanning and paintLive draw from the same base slice', () => {
    for (const s of [cryoState({ step: 'aim', robot: 'aiming', robotNeedle: 1, inserted: [1, 0.4, 0] }), anaesState({ step: 'freeze1', ice: 0.8 }), anaesState({ step: 'freeze1', ice: 0.6, target: 'liver' })]) {
      const { env, created } = rasterEnv()
      const base = newBaseSliceCache()
      const insets = createCryoInsets(env, base, { ...none(), ctPlan: true, ctLive: true })
      insets.update(s, 0)
      const slice = baseSliceFor(base, env, s.imageSeed, s.target)
      const plan = rasterSurface(insets.plan.width, INSET_H)
      paintPlanning(plan.ctx, insets.plan.width, INSET_H, s, slice)
      const live = rasterSurface(insets.live.width, INSET_H)
      paintLive(live.ctx, insets.live.width, INSET_H, s, slice)
      const ps = insets.plan.surface as RasterSurface
      const ls = insets.live.surface as RasterSurface
      expect(created).toContain(ps)
      expect(grabbed(ps)).toEqual(grabbed(plan))
      expect(grabbed(ls)).toEqual(grabbed(live))
      // and the pictures are not blank
      expect(ps.mean(40, 40, 30)[0] + ps.mean(200, 130, 60)[0]).toBeGreaterThan(5)
    }
  })

  it('the lung\'s inset shows the lung\'s slice: the spine under the top edge of the picture, the tumour in the picture\'s right lung', () => {
    const { env } = rasterEnv()
    const insets = createCryoInsets(env, newBaseSliceCache(), { ...none(), ctPlan: true })
    const s = anaesState({ step: 'planning', ice: 0 })
    s.needles = []
    insets.update(s, 0)
    const pic = insets.plan.surface as RasterSurface
    // the square image is 256 px on the left of the 418 x 256 picture; its spine (-1..1 square: x 0, y -0.37)
    expect(pic.mean(128, 128 + 0.37 * -128, 4)[0]).toBeGreaterThan(190)
    // the tumour (x 0.5, y -0.02): a bright lump in the black lung
    expect(pic.mean(128 + 0.5 * 128, 128 + -0.02 * 128, 3)[0]).toBeGreaterThan(150)
  })
})
