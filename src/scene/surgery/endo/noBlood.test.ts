/**
 * The "no blood" guard in node: the tiers, `safeTissue` (no colour that goes through it can be tier A or tier B), and `bloodStats` (it finds what it is
 * meant to find on synthetic images: tier-A pixels, tier-B blobs and their size, thin dark-red slits). R5: and every STAGE of every procedure, measured on the
 * composited picture (the plate, the patches, the clips, the stitches, the bag, the glow, the instruments), not only on the pieces it is made of.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DECAL_COLOURS } from './decals'
import { bloodStats, components, isRedSaturated, isTierA, isTierB, safeTissue, SAFE, type Rgb } from './noBlood'
import { EndoPainter } from './paint'
import { bakeEndoPlatesNow, resetEndoPlates } from './plates'
import { resetEndoSprites } from './sprites'
import { STAGE_COLOURS, STAGE_SETS, stageIndex } from './stages'
import { makeSurface, rasterEnv, rgbaOf } from './testRaster'
import { newEndoView, setProcedureLooks } from './view'

describe('the tiers', () => {
  it('call a saturated red blood (tier A), a deep brick red tier B, and tissue colours neither', () => {
    for (const [r, g, b] of [[150, 20, 25], [200, 30, 40], [255, 0, 0], [90, 10, 12]]) expect(isTierA(r, g, b), `${r},${g},${b}`).toBe(true)
    for (const [r, g, b] of [[180, 85, 85], [120, 55, 60]]) {
      expect(isTierA(r, g, b), `${r},${g},${b}`).toBe(false)
      expect(isTierB(r, g, b), `${r},${g},${b}`).toBe(true)
    }
    // salmon serosa, yellow fat, liver brown, white fascia, a mauve vessel, black
    for (const [r, g, b] of [[224, 156, 135], [245, 205, 110], [120, 66, 60], [235, 220, 212], [180, 115, 135], [10, 5, 5]]) {
      expect(isTierA(r, g, b), `${r},${g},${b}`).toBe(false)
      expect(isTierB(r, g, b), `${r},${g},${b}`).toBe(false)
    }
  })

  it('keep the old R2 rule inside tier A (anything the old test caught, tier A catches)', () => {
    for (let r = 0; r <= 255; r += 5) for (let g = 0; g <= 255; g += 15) for (let b = 0; b <= 255; b += 15) if (isRedSaturated(r, g, b)) expect(isTierA(r, g, b)).toBe(true)
  })
})

describe('safeTissue', () => {
  it('turns every colour of the cube into one that is neither tier A nor tier B, even after rounding to 8 bits', () => {
    // ~230k colours: collect the first few failures instead of 1.1 M expect() calls (which timed out on a loaded machine)
    const c: Rgb = { r: 0, g: 0, b: 0 }
    let changed = 0
    const bad: string[] = []
    for (let r = 0; r <= 255; r += 3) {
      for (let g = 0; g <= 255; g += 5) {
        for (let b = 0; b <= 255; b += 5) {
          c.r = r
          c.g = g
          c.b = b
          safeTissue(c)
          const R = Math.round(c.r)
          const G = Math.round(c.g)
          const B = Math.round(c.b)
          if (G !== g || B !== b) changed++
          const ok = !isTierA(R, G, B) && !isTierB(R, G, B) && c.r === r && G >= g && B >= b
          if (!ok && bad.length < 5) bad.push(`${r},${g},${b} -> ${c.r},${G},${B}`)
        }
      }
    }
    expect(bad).toEqual([])
    expect(changed).toBeGreaterThan(1000)
  })

  it('leaves colours that are not red alone, and is continuous at its knees', () => {
    for (const [r, g, b] of [[245, 205, 110], [224, 160, 140], [120, 80, 75], [60, 120, 200], [235, 220, 212]]) {
      const c = safeTissue({ r, g, b })
      expect([c.r, c.g, c.b]).toEqual([r, g, b])
    }
    const at = (kg: number): number => safeTissue({ r: 200, g: 200 * kg, b: 200 }).g / 200
    expect(at(SAFE.gKnee - 1e-6)).toBeCloseTo(SAFE.gKnee, 4)
    expect(at(SAFE.gFrom)).toBeCloseTo(SAFE.g, 9)
    expect(at(0)).toBeCloseTo(SAFE.g, 9)
  })
})

describe('bloodStats', () => {
  const image = (w: number, h: number, paint: (x: number, y: number) => [number, number, number]): Uint8ClampedArray => {
    const d = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [r, g, b] = paint(x, y)
        const o = (y * w + x) * 4
        d[o] = r
        d[o + 1] = g
        d[o + 2] = b
        d[o + 3] = 255
      }
    }
    return d
  }
  const tissue: [number, number, number] = [224, 156, 135]

  it('is all zero on clean tissue', () => {
    const s = bloodStats(image(64, 48, () => tissue), 64, 48)
    expect(s).toMatchObject({ pixels: 64 * 48, tierA: 0, tierB: 0, tierBShare: 0, blobs: 0, biggestBlob: 0, slits: 0 })
  })

  it('counts tier-A pixels, tier-B blobs and the biggest one', () => {
    const s = bloodStats(
      image(64, 48, (x, y) => {
        if (x < 3 && y < 3) return [180, 20, 20]
        if (x >= 20 && x < 30 && y >= 20 && y < 30) return [180, 85, 85]
        if (x >= 50 && x < 52 && y >= 5 && y < 7) return [180, 85, 85]
        return tissue
      }),
      64,
      48,
    )
    expect(s.tierA).toBe(9)
    expect(s.tierB).toBe(104)
    expect(s.blobs).toBe(2)
    expect(s.biggestBlob).toBe(100)
  })

  it('finds a thin dark-red line (what a cut would look like) and not a round dark-red spot of the same area', () => {
    const slit = bloodStats(image(64, 48, (x, y) => (y >= 20 && y < 22 && x >= 10 && x < 40 ? [110, 40, 45] : tissue)), 64, 48)
    expect(slit.slits).toBe(1)
    const spot = bloodStats(image(64, 48, (x, y) => (Math.hypot(x - 30, y - 24) < 4.4 ? [110, 40, 45] : tissue)), 64, 48)
    expect(spot.slits).toBe(0)
    // and a diagonal one
    const diag = bloodStats(image(64, 48, (x, y) => (Math.abs(x - y - 5) <= 1 && x > 10 && x < 40 ? [110, 40, 45] : tissue)), 64, 48)
    expect(diag.slits).toBe(1)
  })

  it('labels 4-connected components', () => {
    const m = new Uint8Array([1, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 1])
    expect(components(m, 4, 3)).toMatchObject({ count: 3, biggest: 3 })
  })
})

describe('every stage of every procedure', () => {
  const W = 288
  const H = 162
  beforeAll(() => {
    bakeEndoPlatesNow(rasterEnv)
  }, 60_000)
  afterAll(() => {
    resetEndoPlates()
    resetEndoSprites()
  })

  const picture = (p: number, key: string, progress: number, seed: number) => {
    const surface = makeSurface(W, H)
    const v = setProcedureLooks(newEndoView({ seed, t: 30 + seed, gain: 1, proc: p }), p)
    v.stage = stageIndex(p, key)
    v.stageProc = p
    v.prevStage = v.stage
    v.stageMix = 1
    v.stageP = progress
    // (an energy tool's pedal down: its glint is the brightest thing in the picture)
    v.energy[0] = 1
    new EndoPainter(W, H).paint(surface.ctx, v)
    return rgbaOf(surface.canvas)
  }

  it('has no blood in the picture: tier A none, tier B at most 0.2 % in blobs of at most 64 px, no dark-red slits, at two moments of every stage', () => {
    let measured = 0
    for (let p = 0; p < 3; p++) {
      for (const stage of STAGE_SETS[p].stages) {
        for (const [progress, seed] of [[0.5, 7], [1, 21]] as const) {
          const px = picture(p, stage.key, progress, seed)
          const s = bloodStats(px, W, H)
          const where = `procedure ${p}, stage ${stage.key}, progress ${progress}`
          expect(s.tierA, where).toBe(0)
          expect(s.tierBShare, where).toBeLessThanOrEqual(0.002)
          expect(s.biggestBlob, where).toBeLessThanOrEqual(64)
          expect(s.slits, where).toBe(0)
          measured++
        }
      }
    }
    // (11 + 9 + 14 stages, twice each)
    expect(measured).toBe(2 * (STAGE_SETS[0].stages.length + STAGE_SETS[1].stages.length + STAGE_SETS[2].stages.length))
  })

  it('actually draws what the stages add: a stage\'s picture is not the picture at rest (the pixels differ), so the check above sees the clips, the glow and the bag', () => {
    for (const [p, key] of [[0, 'firefly'], [0, 'clipping'], [0, 'bagging'], [1, 'cuffClosure'], [2, 'pedicles'], [2, 'anastomosis']] as const) {
      const at = picture(p, key, 1, 7)
      const rest = picture(p, 'survey', 1, 7)
      let differ = 0
      for (let i = 0; i < at.length; i += 4) if (Math.abs(at[i] - rest[i]) + Math.abs(at[i + 1] - rest[i + 1]) + Math.abs(at[i + 2] - rest[i + 2]) > 60) differ++
      expect(differ, `${p} ${key}`).toBeGreaterThan(W * H * 0.05)
    }
  })

  it('draws every colour of the stages from a palette with no blood in it: the clips, the stitches, the ring, the dark of the glow, the decals', () => {
    const palette: string[] = [STAGE_COLOURS.clipShadow, STAGE_COLOURS.suture, STAGE_COLOURS.sutureLight, STAGE_COLOURS.mark, STAGE_COLOURS.markEdge, STAGE_COLOURS.dark]
    for (const c of STAGE_COLOURS.clip) palette.push(c.body, c.light, c.dark)
    for (const c of palette) {
      const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c)
      expect(hex, c).not.toBeNull()
      const [r, g, b] = [parseInt(hex![1], 16), parseInt(hex![2], 16), parseInt(hex![3], 16)]
      expect(isTierA(r, g, b) || isTierB(r, g, b) || isRedSaturated(r, g, b), c).toBe(false)
    }
    for (const c of Object.values(DECAL_COLOURS)) expect(isTierA(c[0], c[1], c[2]) || isTierB(c[0], c[1], c[2]), String(c)).toBe(false)
  })

  it('names its stages without a graphic word', () => {
    const graphic = /blood|bleed|incision|wound|gore|cut\b/i
    for (const set of STAGE_SETS) for (const s of set.stages) expect(s.key, s.key).not.toMatch(graphic)
  })
})
