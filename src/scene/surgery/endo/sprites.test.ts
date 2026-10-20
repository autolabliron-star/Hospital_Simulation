/**
 * The instrument sprites in node: the atlas's rectangles fit and do not overlap, every sprite has something in it and a clear margin round it (so filtering
 * never bleeds a neighbour in), nothing is red, the vignette is clear in the middle and dark in the corners, and the build is deterministic.
 */
import { describe, expect, it } from 'vitest'
import { JAW_KINDS } from './looks'
import { isTierA, isTierB } from './noBlood'
import { atlasPixels, ATLAS_H, ATLAS_W, JAW_RECTS, SPRITE, vignettePixels, VIGNETTE_H, VIGNETTE_W, type Rect } from './sprites'

const rects: [string, Rect][] = [...Object.entries(SPRITE), ...JAW_KINDS.map((k, i): [string, Rect] => [`jaw:${k}`, JAW_RECTS[i]])]
const atlas = atlasPixels()
const alphaAt = (x: number, y: number): number => atlas[(y * ATLAS_W + x) * 4 + 3]

describe('the sprite atlas', () => {
  it('has every sprite inside it, none overlapping', () => {
    expect(rects.length).toBe(11 + JAW_KINDS.length)
    for (const [name, r] of rects) {
      expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= ATLAS_W && r.y + r.h <= ATLAS_H, name).toBe(true)
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const [a, ra] = rects[i]
        const [b, rb] = rects[j]
        const apart = ra.x + ra.w <= rb.x || rb.x + rb.w <= ra.x || ra.y + ra.h <= rb.y || rb.y + rb.h <= ra.y
        expect(apart, `${a} and ${b}`).toBe(true)
      }
    }
  })

  it('draws something in every sprite and keeps a clear 2 px margin round it', () => {
    for (const [name, r] of rects) {
      let inked = 0
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          const edge = x < r.x + 2 || x >= r.x + r.w - 2 || y < r.y + 2 || y >= r.y + r.h - 2
          if (edge) expect(alphaAt(x, y), `${name} margin at ${x},${y}`).toBe(0)
          else if (alphaAt(x, y) > 0) inked++
        }
      }
      expect(inked, name).toBeGreaterThan(40)
    }
  })

  it('is never red: no visible pixel is tier A or tier B', () => {
    for (let i = 0; i < atlas.length; i += 4) {
      if (atlas[i + 3] < 20) continue
      expect(isTierA(atlas[i], atlas[i + 1], atlas[i + 2]), `pixel ${i / 4}`).toBe(false)
      expect(isTierB(atlas[i], atlas[i + 1], atlas[i + 2]), `pixel ${i / 4}`).toBe(false)
    }
  })

  it('has a dark carbon shaft and bright steel jaws', () => {
    const lum = (r: Rect): number => {
      let sum = 0
      let n = 0
      for (let y = r.y + 2; y < r.y + r.h - 2; y++) {
        for (let x = r.x + 2; x < r.x + r.w - 2; x++) {
          const o = (y * ATLAS_W + x) * 4
          if (atlas[o + 3] < 200) continue
          sum += 0.299 * atlas[o] + 0.587 * atlas[o + 1] + 0.114 * atlas[o + 2]
          n++
        }
      }
      return sum / n
    }
    const carbon = { ...SPRITE.shaft, w: SPRITE.shaft.w * 0.8 }
    expect(lum(carbon)).toBeLessThan(80)
    expect(lum(JAW_RECTS[JAW_KINDS.indexOf('fenestrated')])).toBeGreaterThan(110)
  })

  it('is deterministic', () => {
    expect(Buffer.from(atlasPixels()).equals(Buffer.from(atlas))).toBe(true)
  })
})

describe('the vignette', () => {
  it('is clear in the lit middle and dark in the corners', () => {
    const v = vignettePixels()
    const a = (x: number, y: number): number => v[(y * VIGNETTE_W + x) * 4 + 3]
    expect(a(VIGNETTE_W / 2, VIGNETTE_H / 2)).toBeLessThan(10)
    expect(a(0, 0)).toBeGreaterThan(150)
    expect(a(VIGNETTE_W - 1, VIGNETTE_H - 1)).toBeGreaterThan(150)
    expect(a(VIGNETTE_W - 1, VIGNETTE_H / 2)).toBeGreaterThan(a(VIGNETTE_W * 0.75, VIGNETTE_H / 2))
  })
})
