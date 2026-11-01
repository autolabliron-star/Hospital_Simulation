/**
 * The tissue plates in node: every plate passes the no-blood measures (tier A none, tier B at most 0.2 % in blobs of at most 64 px, no dark-red slits),
 * shows its procedure's organs at their landmarks, is lit (not flat) and warm, bakes identically twice and the same in slices as in one go, and is baked
 * once per page behind a warm gate in slices of about 8 ms.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mockEnv } from '@/scene/imaging/images/mockCanvas'
import { warmGatesPending } from '@/scene/warmup/registry'
import { LANDMARKS, newSample, PATCHES, patchesOf, PLATE_ASPECT, PROCEDURE_KEYS, sampleAnatomy, sampleLayout, TISSUE_NAMES, type ProcIndex } from './anatomy'
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

  it('runs once per page in slices with a frame between them, behind a warm gate, and installs the three plates, the patches and the sprites', async () => {
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
    expect(endoPlates.patches.map((x) => x?.patch.id)).toEqual(PATCHES.map((p) => p.id))
    expect(endoPlates.slices).toBe(frames + 3 + PATCHES.length)
    // a slice stops as soon as its budget is spent: the budget plus the reading that ends it
    expect(endoPlates.longestMs).toBeLessThanOrEqual(SLICE_MS + 2)
  })
})

// ---------------------------------------------------------------------------------------------
// R5: the patches (what the steps have done to the tissue)
// ---------------------------------------------------------------------------------------------

const patchBaked = new Map<number, PlateBaker>()
const patchOf = (id: number): PlateBaker => {
  let b = patchBaked.get(id)
  if (!b) patchBaked.set(id, (b = PlateBaker.forPatch(PATCHES[id]).finish()))
  return b
}

/** Per patch: tissues its layout must show, and tissues that must be gone from inside its mask (the organ it replaces). */
const PATCH_CHECKS: Record<number, { shows: [number, number, string][]; gone: [number, number, string][] }> = {
  // Calot's triangle cleared: the duct and the artery, each on a pale bed; no fat in the triangle
  0: {
    shows: [[0.62, 0.58, 'artery'], [0.57, 0.74, 'duct'], [0.62, 0.66, 'bed']],
    gone: [[0.62, 0.66, 'fat'], [0.7, 0.66, 'fascia']],
  },
  // the gallbladder gone from its bed
  1: {
    shows: [[1.2, 0.25, 'liver'], [0.57, 0.74, 'duct'], [0.62, 0.58, 'artery']],
    gone: [[1.2, 0.25, 'gallbladder'], [1.0, 0.39, 'gallbladder'], [0.95, 0.45, 'gallbladder'], [1.35, 0.12, 'gallbladder']],
  },
  // the uterus out, the top of the vagina across the space; the tubes and ovaries stay
  2: {
    shows: [[PLATE_ASPECT / 2, 0.8, 'ligament'], [0.38, 0.69, 'ovary'], [PLATE_ASPECT - 0.38, 0.69, 'ovary']],
    gone: [[PLATE_ASPECT / 2, 0.5, 'uterus'], [PLATE_ASPECT / 2 + 0.15, 0.4, 'uterus']],
  },
  // the prostate out: the bladder neck above and the urethral stump below
  3: {
    shows: [[PLATE_ASPECT / 2, 0.47, 'bladder'], [PLATE_ASPECT / 2, 0.76, 'duct'], [PLATE_ASPECT / 2 + 0.2, 0.8, 'bed']],
    gone: [[PLATE_ASPECT / 2 + 0.15, 0.8, 'prostate'], [PLATE_ASPECT / 2 + 0.06, 0.6, 'fat'], [PLATE_ASPECT / 2, 0.9, 'vein']],
  },
}

describe.each(PATCHES.map((p) => [p.id, p] as const))('the patch %s', (id, patch) => {
  it(`(${patch.what}) lies inside the plate, at the plate's own scale, with its mask inside its box`, () => {
    const b = patchOf(id)
    expect(patch.x0).toBeGreaterThanOrEqual(0)
    expect(patch.y0).toBeGreaterThanOrEqual(0)
    expect(patch.x1).toBeLessThanOrEqual(PLATE_ASPECT + 1e-9)
    expect(patch.y1).toBeLessThanOrEqual(1 + 1e-9)
    expect(b.w).toBe(Math.ceil((patch.x1 - patch.x0) * PLATE_H))
    expect(b.h).toBe(Math.ceil((patch.y1 - patch.y0) * PLATE_H))
    const m = patch.mask
    expect(m.cx - m.rx - m.feather).toBeLessThan(patch.x1)
    // the baked pieces are no bigger than half the plate, so four of them stay a small part of the bake
    expect((b.w * b.h) / (PLATE_W * PLATE_H)).toBeLessThan(0.6)
  })

  it('has no blood: tier A none, tier B at most 0.2 % in blobs of at most 64 px, no dark-red slits, no red-saturated pixel', () => {
    const b = patchOf(id)
    const s = bloodStats(b.rgba, b.w, b.h)
    expect(s.tierA).toBe(0)
    expect(s.tierBShare).toBeLessThanOrEqual(0.002)
    expect(s.biggestBlob).toBeLessThanOrEqual(64)
    expect(s.slits).toBe(0)
    for (let i = 0; i < b.rgba.length; i += 4) expect(isRedSaturated(b.rgba[i], b.rgba[i + 1], b.rgba[i + 2])).toBe(false)
  })

  it('is opaque through its mask, clear outside its feather and soft between, the wet highlights fading with it', () => {
    const b = patchOf(id)
    const m = patch.mask
    const at = (x: number, y: number): number => {
      const i = Math.min(b.w - 1, Math.max(0, Math.floor((x - patch.x0) * PLATE_H)))
      const j = Math.min(b.h - 1, Math.max(0, Math.floor((y - patch.y0) * PLATE_H)))
      return b.rgba[(j * b.w + i) * 4 + 3]
    }
    expect(at(m.cx, m.cy)).toBe(255)
    // the box's corners are outside the mask: clear
    expect(at(patch.x0, patch.y0) + at(patch.x1 - 1 / PLATE_H, patch.y1 - 1 / PLATE_H)).toBe(0)
    let soft = 0
    let opaque = 0
    for (let i = 3; i < b.rgba.length; i += 4) {
      if (b.rgba[i] > 0 && b.rgba[i] < 255) soft++
      if (b.rgba[i] === 255) opaque++
      // a highlight is never brighter than the patch under it
      expect(b.spec[i]).toBeLessThanOrEqual(b.rgba[i])
    }
    expect(opaque).toBeGreaterThan(b.w * b.h * 0.2)
    expect(soft).toBeGreaterThan(b.w * b.h * 0.02)
  })

  it('shows the structures it says and none of the organ it replaces', () => {
    const s = newSample()
    const checks = PATCH_CHECKS[id]
    expect(checks, `a check for patch ${id}`).toBeDefined()
    for (const [x, y, name] of checks.shows) {
      sampleLayout(patch.layout, x, y, s)
      expect(TISSUE_NAMES[s.tissue], `patch ${id} at ${x.toFixed(2)}, ${y.toFixed(2)}`).toBe(name)
    }
    for (const [x, y, name] of checks.gone) {
      sampleLayout(patch.layout, x, y, s)
      expect(TISSUE_NAMES[s.tissue], `patch ${id} at ${x.toFixed(2)}, ${y.toFixed(2)}`).not.toBe(name)
    }
  })

  it('bakes the same twice and the same in slices as in one go', () => {
    const a = PlateBaker.forPatch(patch).finish()
    expect(Buffer.from(a.rgba).equals(Buffer.from(patchOf(id).rgba))).toBe(true)
    let now = 0
    const sliced = PlateBaker.forPatch(patch)
    while (!sliced.step(SLICE_MS, () => now++)) continue
    expect(Buffer.from(sliced.rgba).equals(Buffer.from(a.rgba))).toBe(true)
    expect(Buffer.from(sliced.spec).equals(Buffer.from(a.spec))).toBe(true)
  })
})

describe('the patches together', () => {
  it('have ids that are their index, belong to the three procedures, and the changed layouts differ from the plate\'s in their mask', () => {
    PATCHES.forEach((p, i) => {
      expect(p.id).toBe(i)
      expect([0, 1, 2]).toContain(p.proc)
    })
    expect(patchesOf(0)).toEqual([0, 1])
    expect(patchesOf(1)).toEqual([2])
    expect(patchesOf(2)).toEqual([3])
    expect(patchesOf(9)).toEqual([])
    // the patch's tissue at the mask's middle is not the plate's
    const a = newSample()
    const b = newSample()
    for (const p of PATCHES) {
      let differ = 0
      for (let k = 0; k < 40; k++) {
        const x = p.mask.cx + (((k * 7919) % 100) / 100 - 0.5) * p.mask.rx
        const y = p.mask.cy + (((k * 104729) % 100) / 100 - 0.5) * p.mask.ry
        sampleLayout(p.layout, x, y, a)
        sampleAnatomy(p.proc, x, y, b)
        if (a.tissue !== b.tissue || Math.abs(a.r - b.r) > 0.01) differ++
      }
      expect(differ, `patch ${p.id}`).toBeGreaterThan(8)
    }
  })
})
