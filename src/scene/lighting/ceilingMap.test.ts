import { LinearFilter, LinearMipmapLinearFilter, RGFormat, UnsignedByteType } from 'three'
import { describe, expect, it } from 'vitest'
import { AREAS, BUILDING, ceilingHeight } from '@/sim/places'
import {
  CEILING_HEIGHT_SCALE,
  CEILING_MAP_HEIGHT,
  CEILING_MAP_WIDTH,
  CEILING_TEXELS_PER_METRE,
  buildCeilingMapData,
  createCeilingTexture,
} from './ceilingMap'
import { panelRectsOf } from './volume/input'

const data = buildCeilingMapData()
const k = CEILING_TEXELS_PER_METRE

/** The map's two bytes at a world point on the plan. */
function at(x: number, z: number): [number, number] {
  const ix = Math.floor((x - BUILDING.x0) * k)
  const iz = Math.floor((z - BUILDING.z0) * k)
  const o = (iz * CEILING_MAP_WIDTH + ix) * 2
  return [data[o], data[o + 1]]
}

describe('the ceiling map', () => {
  it('is 0.1 m per texel over the building: 1020 x 440, two bytes each', () => {
    expect(CEILING_MAP_WIDTH).toBe(1020)
    expect(CEILING_MAP_HEIGHT).toBe(440)
    expect(data.length).toBe(1020 * 440 * 2)
  })

  it('is deterministic', () => {
    expect(Buffer.compare(Buffer.from(data), Buffer.from(buildCeilingMapData()))).toBe(0)
  })

  it('has a bright panel where a panel is, and nothing between panels', () => {
    const er = AREAS.find((a) => a.id === 'er')!
    const rects = panelRectsOf(er)
    const p = rects[8]
    const q = rects[9]
    expect(at((p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2)[0]).toBeGreaterThanOrEqual(250)
    // halfway to the next panel in the row, on the same line: no panel
    expect(at((p.x1 + q.x0) / 2, (p.z0 + p.z1) / 2)[0]).toBe(0)
    // a panel is wider along x than along z, like the painted one (3 tiles by 1)
    expect((p.x1 - p.x0) / (p.z1 - p.z0)).toBeGreaterThan(2.5)
    expect((p.x1 - p.x0) / (p.z1 - p.z0)).toBeLessThan(3.5)
  })

  it('holds the right emitting area: the coverage sums to the panels of every roofed area', () => {
    let expected = 0
    for (const a of AREAS) {
      if (ceilingHeight(a.id) === null) continue
      for (const p of panelRectsOf(a)) expected += (p.x1 - p.x0) * (p.z1 - p.z0)
    }
    let sum = 0
    for (let i = 0; i < data.length; i += 2) sum += data[i] / 255
    const area = sum / (k * k)
    expect(expected).toBeGreaterThan(200)
    expect(area / expected).toBeGreaterThan(0.99)
    expect(area / expected).toBeLessThan(1.01)
  })

  it('records the ceiling height in G, and no ceiling (and no panel) in the open atrium', () => {
    const [r, g] = at(-53, 14)
    expect(g).toBe(Math.round((3 / CEILING_HEIGHT_SCALE) * 255))
    expect(r).toBeGreaterThanOrEqual(0)
    // the atrium keeps its sky
    for (const [x, z] of [[20, 0], [30, 5], [14, -10]] as const) {
      const [ar, ag] = at(x, z)
      expect(ag).toBe(0)
      expect(ar).toBe(0)
    }
    // every roofed area has its height somewhere inside
    for (const a of AREAS) {
      const h = ceilingHeight(a.id)
      const cx = (a.rect.x0 + a.rect.x1) / 2
      const cz = (a.rect.z0 + a.rect.z1) / 2
      expect(at(cx, cz)[1] > 0, a.id).toBe(h !== null)
    }
  })

  it('makes one texture with the mip chain the floor shader reads', () => {
    const t = createCeilingTexture()
    expect(createCeilingTexture()).toBe(t)
    expect(t.format).toBe(RGFormat)
    expect(t.type).toBe(UnsignedByteType)
    expect(t.generateMipmaps).toBe(true)
    expect(t.minFilter).toBe(LinearMipmapLinearFilter)
    expect(t.magFilter).toBe(LinearFilter)
    expect(t.image.width).toBe(CEILING_MAP_WIDTH)
    expect(t.image.height).toBe(CEILING_MAP_HEIGHT)
  })
})
