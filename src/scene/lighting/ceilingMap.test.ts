import { LinearFilter, LinearMipmapLinearFilter, RGFormat, UnsignedByteType } from 'three'
import { describe, expect, it } from 'vitest'
import { AREAS, BUILDING, ceilingHeight } from '@/sim/places'
import { LEVEL2_DX, LEVEL2_FOOTPRINT, levelOf } from '@/sim/levels'
import {
  CEILING_HEIGHT_SCALE,
  CEILING_MAP2_HEIGHT,
  CEILING_MAP2_WIDTH,
  CEILING_MAP_HEIGHT,
  CEILING_MAP_WIDTH,
  CEILING_TEXELS_PER_METRE,
  buildCeilingMapData,
  createCeilingTexture,
  createCeilingTexture2,
} from './ceilingMap'
import { panelRectsOf } from './volume/input'

const data = buildCeilingMapData()
const data2 = buildCeilingMapData(2)
const k = CEILING_TEXELS_PER_METRE
const level1Areas = AREAS.filter((a) => levelOf((a.rect.x0 + a.rect.x1) / 2) === 1)
const level2Areas = AREAS.filter((a) => levelOf((a.rect.x0 + a.rect.x1) / 2) === 2)

/** The map's two bytes at a world point on the plan. */
function at(x: number, z: number): [number, number] {
  const ix = Math.floor((x - BUILDING.x0) * k)
  const iz = Math.floor((z - BUILDING.z0) * k)
  const o = (iz * CEILING_MAP_WIDTH + ix) * 2
  return [data[o], data[o + 1]]
}

/** Page 2's two bytes at a DRAWN point on the plan of level 2. */
function at2(x: number, z: number): [number, number] {
  const ix = Math.floor((x - LEVEL2_FOOTPRINT.x0) * k)
  const iz = Math.floor((z - LEVEL2_FOOTPRINT.z0) * k)
  const o = (iz * CEILING_MAP2_WIDTH + ix) * 2
  return [data2[o], data2[o + 1]]
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

  it('holds the right emitting area: the coverage sums to the panels of every roofed area of level 1', () => {
    let expected = 0
    for (const a of level1Areas) {
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
    for (const a of level1Areas) {
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

describe('the ceiling map, page 2 (R2: level 2)', () => {
  it('is 0.1 m per texel over the level-2 footprint, in drawn coordinates: 220 x 440, two bytes each', () => {
    expect(CEILING_MAP2_WIDTH).toBe(220)
    expect(CEILING_MAP2_HEIGHT).toBe(440)
    expect(data2.length).toBe(220 * 440 * 2)
    expect(LEVEL2_FOOTPRINT.x1 - LEVEL2_FOOTPRINT.x0).toBe(22)
  })

  it('is deterministic, and its own: level 1\'s page holds nothing of level 2 and the other way round', () => {
    expect(Buffer.compare(Buffer.from(data2), Buffer.from(buildCeilingMapData(2)))).toBe(0)
    expect(Buffer.compare(Buffer.from(data), Buffer.from(buildCeilingMapData(1)))).toBe(0)
    // level 1's page has the same bytes as before R2: the level-2 areas, sim x 88..110, lie beyond it and add nothing
    let sum1 = 0
    for (let i = 0; i < data.length; i += 2) sum1 += data[i] / 255
    let expected1 = 0
    for (const a of level1Areas) if (ceilingHeight(a.id) !== null) for (const p of panelRectsOf(a)) expected1 += (p.x1 - p.x0) * (p.z1 - p.z0)
    expect(sum1 / (k * k) / expected1).toBeGreaterThan(0.99)
    expect(sum1 / (k * k) / expected1).toBeLessThan(1.01)
  })

  it('has a bright panel where a level-2 panel is (drawn 150 m west of the sim), and nothing between panels', () => {
    const pre = level2Areas.find((a) => a.id === 'l2PreOp')!
    const rects = panelRectsOf(pre, -LEVEL2_DX)
    expect(rects.length).toBeGreaterThanOrEqual(4)
    const p = rects[1]
    const q = rects[2]
    expect(p.x0).toBeGreaterThan(LEVEL2_FOOTPRINT.x0)
    expect(p.x1).toBeLessThan(LEVEL2_FOOTPRINT.x1)
    expect(at2((p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2)[0]).toBeGreaterThanOrEqual(250)
    expect(at2((p.x1 + q.x0) / 2, (p.z0 + p.z1) / 2)[0]).toBe(0)
  })

  it('holds the right emitting area: the coverage sums to the panels of every roofed area of level 2', () => {
    let expected = 0
    for (const a of level2Areas) if (ceilingHeight(a.id) !== null) for (const p of panelRectsOf(a, -LEVEL2_DX)) expected += (p.x1 - p.x0) * (p.z1 - p.z0)
    let sum = 0
    for (let i = 0; i < data2.length; i += 2) sum += data2[i] / 255
    expect(expected).toBeGreaterThan(40)
    expect(sum / (k * k) / expected).toBeGreaterThan(0.99)
    expect(sum / (k * k) / expected).toBeLessThan(1.01)
  })

  it('records the ceiling height in G in every level-2 area, and nowhere else', () => {
    for (const a of level2Areas) {
      const cx = (a.rect.x0 + a.rect.x1) / 2 - LEVEL2_DX
      const cz = (a.rect.z0 + a.rect.z1) / 2
      expect(at2(cx, cz)[1], a.id).toBe(Math.round((3 / CEILING_HEIGHT_SCALE) * 255))
    }
    // the level-2 areas tile the footprint: every texel of the page has a ceiling
    let roofed = 0
    for (let i = 1; i < data2.length; i += 2) if (data2[i] > 0) roofed++
    expect(roofed / (data2.length / 2)).toBeGreaterThan(0.99)
  })

  it('makes its own texture with the mip chain the floor shader reads, once', () => {
    const t = createCeilingTexture2()
    expect(createCeilingTexture2()).toBe(t)
    expect(t).not.toBe(createCeilingTexture())
    expect(t.format).toBe(RGFormat)
    expect(t.type).toBe(UnsignedByteType)
    expect(t.generateMipmaps).toBe(true)
    expect(t.minFilter).toBe(LinearMipmapLinearFilter)
    expect(t.image.width).toBe(CEILING_MAP2_WIDTH)
    expect(t.image.height).toBe(CEILING_MAP2_HEIGHT)
  })
})
