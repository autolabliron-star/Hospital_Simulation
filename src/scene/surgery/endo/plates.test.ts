/**
 * The tissue plates in node: every plate passes the no-blood measures (tier A none, tier B at most 0.2 % in blobs of at most 64 px, no dark-red slits),
 * shows its procedure's organs at their landmarks, is lit (not flat) and warm, bakes identically twice and the same in slices as in one go, and is baked
 * once per page behind a warm gate in slices of about 8 ms.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mockEnv } from '@/scene/imaging/images/mockCanvas'
import { warmGatesPending } from '@/scene/warmup/registry'
import { LANDMARKS, newSample, PLATE_ASPECT, PROCEDURE_KEYS, sampleAnatomy, TISSUE_NAMES, type ProcIndex } from './anatomy'
import { bloodStats, isRedSaturated } from './noBlood'
import { endoPlates, ensureEndoPlates, PLATE_H, PLATE_W, PlateBaker, resetEndoPlates, SLICE_MS, type BakeClock } from './plates'
import { endoSprites, resetEndoSprites } from './sprites'

const baked = new Map<ProcIndex, PlateBaker>()
const plate = (p: ProcIndex): PlateBaker => {
  let b = baked.get(p)
  if (!b) baked.set(p, (b = new PlateBaker(p).finish()))
  return b
}

describe.each([0, 1, 2] as const)('the %s plate', (p) => {
  it(`(${PROCEDURE_KEYS[p]}) has no blood: tier A none, tier B at most 0.2 % in blobs of at most 64 px, no dark-red slits, no red-saturated pixel`, () => {
    const b = plate(p)
    expect([b.w, b.h]).toEqual([PLATE_W, PLATE_H])
    expect(b.w / b.h).toBeCloseTo(PLATE_ASPECT, 2)
    const s = bloodStats(b.rgba, b.w, b.h)
    expect(s.tierA).toBe(0)
    expect(s.tierBShare).toBeLessThanOrEqual(0.002)
    expect(s.biggestBlob).toBeLessThanOrEqual(64)
    expect(s.slits).toBe(0)
    let red = 0
    for (let i = 0; i < b.rgba.length; i += 4) if (isRedSaturated(b.rgba[i], b.rgba[i + 1], b.rgba[i + 2])) red++
    expect(red).toBe(0)
  })

  it('is opaque, lit (bright and dark parts, not one flat colour) and warm, with wet highlights in its specular layer', () => {
    const b = plate(p)
    let lo = 255
    let hi = 0
    let sr = 0
    let sb = 0
    let shiny = 0
    for (let i = 0; i < b.rgba.length; i += 4) {
      expect(b.rgba[i + 3]).toBe(255)
      const l = 0.299 * b.rgba[i] + 0.587 * b.rgba[i + 1] + 0.114 * b.rgba[i + 2]
      lo = Math.min(lo, l)
      hi = Math.max(hi, l)
      sr += b.rgba[i]
      sb += b.rgba[i + 2]
      if (b.spec[i + 3] > 128) shiny++
    }
    expect(hi - lo).toBeGreaterThan(120)
    expect(sr).toBeGreaterThan(sb * 1.3)
    const n = b.w * b.h
    // highlights: a sprinkling, not a sheet
    expect(shiny / n).toBeGreaterThan(0.0005)
    expect(shiny / n).toBeLessThan(0.15)
  })

  it('shows its organs at their landmarks', () => {
    const s = newSample()
    for (const l of LANDMARKS[p]) {
      sampleAnatomy(p, l.x, l.y, s)
      expect(TISSUE_NAMES[s.tissue], `${PROCEDURE_KEYS[p]}: ${l.name}`).toBe(TISSUE_NAMES[l.tissue])
    }
  })
})

describe('the bake', () => {
  afterEach(() => {
    resetEndoPlates()
    resetEndoSprites()
  })

  it('is deterministic, and slices give exactly what one go gives', () => {
    const a = new PlateBaker(1, 192, 108).finish()
    const b = new PlateBaker(1, 192, 108).finish()
    expect(Buffer.from(a.rgba).equals(Buffer.from(b.rgba))).toBe(true)
    expect(Buffer.from(a.spec).equals(Buffer.from(b.spec))).toBe(true)
    // a clock that moves 1 ms per reading: about 8 rows a slice
    let now = 0
    const sliced = new PlateBaker(1, 192, 108)
    let slices = 0
    while (!sliced.step(SLICE_MS, () => now++)) slices++
    expect(slices).toBeGreaterThan(20)
    expect(Buffer.from(sliced.rgba).equals(Buffer.from(a.rgba))).toBe(true)
    // the plates differ between procedures
    expect(Buffer.from(new PlateBaker(0, 192, 108).finish().rgba).equals(Buffer.from(a.rgba))).toBe(false)
  })

  it('runs once per page in slices with a frame between them, behind a warm gate, and installs the three plates and the sprites', async () => {
    const { env } = mockEnv()
    let frames = 0
    // a clock that moves 1 ms each time it is read: a slice is a known number of rows, whatever the machine is doing
    let ms = 0
    const clock: BakeClock = { now: () => ms++, frame: async () => void frames++ }
    const work = ensureEndoPlates(env, clock)
    // the sprites are there at once; the gate is open until the plates are in
    expect(endoSprites.atlas).not.toBeNull()
    expect(endoSprites.vignette).not.toBeNull()
    expect(warmGatesPending()).toBeGreaterThan(0)
    expect(ensureEndoPlates(env, clock)).toBe(work)
    await work
    expect(warmGatesPending()).toBe(0)
    expect(endoPlates.plates.map((x) => x?.proc)).toEqual([0, 1, 2])
    expect(endoPlates.plates.every((x) => x !== null && x.plate.canvas.width === PLATE_W && x.spec.canvas.height === PLATE_H)).toBe(true)
    expect(endoPlates.failed).toBe(false)
    expect(frames).toBeGreaterThan(10)
    expect(endoPlates.slices).toBe(frames + 3)
    // a slice stops as soon as its budget is spent: the budget plus the reading that ends it
    expect(endoPlates.longestMs).toBeLessThanOrEqual(SLICE_MS + 2)
  })
})
