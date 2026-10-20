/**
 * The "no blood" guard in node: the tiers, `safeTissue` (no colour that goes through it can be tier A or tier B), and `bloodStats` (it finds what it is
 * meant to find on synthetic images: tier-A pixels, tier-B blobs and their size, thin dark-red slits).
 */
import { describe, expect, it } from 'vitest'
import { bloodStats, components, isRedSaturated, isTierA, isTierB, safeTissue, SAFE, type Rgb } from './noBlood'

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
    const c: Rgb = { r: 0, g: 0, b: 0 }
    let changed = 0
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
          expect(isTierA(R, G, B), `${r},${g},${b} -> ${R},${G},${B}`).toBe(false)
          expect(isTierB(R, G, B), `${r},${g},${b} -> ${R},${G},${B}`).toBe(false)
          expect(c.r).toBe(r)
          expect(G).toBeGreaterThanOrEqual(g)
          expect(B).toBeGreaterThanOrEqual(b)
        }
      }
    }
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
