/**
 * The stage decals in node (decals.ts): the atlas's rectangles fit and do not overlap, every decal has something in it and a clear margin round it, nothing
 * is red (no visible pixel is tier A or B), the glow is green, the cleared patch is pale and warm, the bags are translucent films with a specimen inside,
 * and the build is deterministic.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mockEnv } from '@/scene/imaging/images/mockCanvas'
import { DECAL, DECAL_COLOURS, DECAL_H, DECAL_W, decalPixels, ensureEndoDecals, endoDecals, resetEndoDecals } from './decals'
import { isTierA, isTierB } from './noBlood'

const pixels = decalPixels()
const rects = Object.entries(DECAL)
const px = (x: number, y: number): [number, number, number, number] => {
  const o = (y * DECAL_W + x) * 4
  return [pixels[o], pixels[o + 1], pixels[o + 2], pixels[o + 3]]
}

describe('the decal atlas', () => {
  it('has every decal inside it, none overlapping', () => {
    for (const [name, r] of rects) expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= DECAL_W && r.y + r.h <= DECAL_H, name).toBe(true)
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const [a, ra] = rects[i]
        const [b, rb] = rects[j]
        expect(ra.x + ra.w <= rb.x || rb.x + rb.w <= ra.x || ra.y + ra.h <= rb.y || rb.y + rb.h <= ra.y, `${a} and ${b}`).toBe(true)
      }
    }
  })

  it('draws something in every decal and keeps a clear 2 px margin round it', () => {
    for (const [name, r] of rects) {
      let inked = 0
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          const edge = x < r.x + 2 || x >= r.x + r.w - 2 || y < r.y + 2 || y >= r.y + r.h - 2
          if (edge) expect(px(x, y)[3], `${name} margin at ${x},${y}`).toBe(0)
          else if (px(x, y)[3] > 0) inked++
        }
      }
      expect(inked, name).toBeGreaterThan(200)
    }
  })

  it('is never red: no visible pixel is tier A or tier B', () => {
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 8) continue
      expect(isTierA(pixels[i], pixels[i + 1], pixels[i + 2]), `pixel ${i / 4}`).toBe(false)
      expect(isTierB(pixels[i], pixels[i + 1], pixels[i + 2]), `pixel ${i / 4}`).toBe(false)
    }
    for (const colour of Object.values(DECAL_COLOURS)) {
      expect(isTierA(colour[0], colour[1], colour[2])).toBe(false)
      expect(isTierB(colour[0], colour[1], colour[2])).toBe(false)
    }
  })

  it('has a soft cleared patch (opaque in the middle, clear at the rim, pale and warm), and a green glow that fades out', () => {
    const b = DECAL.blob
    const mid = px(b.x + b.w / 2, b.y + b.h / 2)
    const rim = px(b.x + 3, b.y + b.h / 2)
    expect(mid[3]).toBeGreaterThan(150)
    expect(rim[3]).toBeLessThan(10)
    expect(mid[0]).toBeGreaterThan(220)
    expect(mid[0]).toBeGreaterThan(mid[2])
    const g = DECAL.glow
    const core = px(g.x + g.w / 2, g.y + g.h / 2)
    expect(core[3]).toBeGreaterThan(200)
    expect(core[1]).toBeGreaterThan(core[0] * 2)
    expect(px(g.x + 3, g.y + g.h / 2)[3]).toBeLessThan(10)
  })

  it('has bags that are thin films with a specimen in them: clear in the corners, brighter at the rim than in the middle of the film, the specimen\'s own colour inside', () => {
    for (const [name, specimen] of [['bagGallbladder', DECAL_COLOURS.gallbladder], ['bagProstate', DECAL_COLOURS.prostate]] as const) {
      const r = DECAL[name]
      expect(px(r.x + 3, r.y + 3)[3], name).toBeLessThan(10)
      // the specimen: about its place in the sack, mostly opaque and its colour (lit: within a third of it)
      const sp = px(r.x + 2 + Math.round((r.w - 4) * 0.44), r.y + 2 + Math.round((r.h - 4) * 0.58))
      expect(sp[3], name).toBeGreaterThan(200)
      for (let c = 0; c < 3; c++) expect(Math.abs(sp[c] - specimen[c]), `${name} channel ${c}`).toBeLessThan(specimen[c] * 0.35)
      // the rim of the sack (where the film folds) is more opaque than the film inside it
      const film = px(r.x + 2 + Math.round((r.w - 4) * 0.75), r.y + 2 + Math.round((r.h - 4) * 0.56))
      const rim = px(r.x + 2 + Math.round((r.w - 4) * 0.86), r.y + 2 + Math.round((r.h - 4) * 0.56))
      expect(rim[3], name).toBeGreaterThan(film[3])
    }
  })

  it('is deterministic, and builds into a canvas once', () => {
    expect(Buffer.from(decalPixels()).equals(Buffer.from(pixels))).toBe(true)
  })
})

describe('ensureEndoDecals', () => {
  afterEach(() => resetEndoDecals())
  it('builds the atlas once, and can be reset', () => {
    const { env } = mockEnv()
    expect(endoDecals.atlas).toBeNull()
    ensureEndoDecals(env)
    const first = endoDecals.atlas
    expect(first).not.toBeNull()
    expect([first!.canvas.width, first!.canvas.height]).toEqual([DECAL_W, DECAL_H])
    ensureEndoDecals(env)
    expect(endoDecals.atlas).toBe(first)
    resetEndoDecals()
    expect(endoDecals.atlas).toBeNull()
  })
})
