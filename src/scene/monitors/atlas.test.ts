/**
 * The atlas plan: every region the 19 monitors and the 4 standby faces (the pre-op monitor shares the bedside one) need is inside the atlas, none
 * overlap (gutter kept), every band has two sweep slots of its own size and a label slot, and the whole fits about 2048 x 1800 (about 20 MB with
 * mipmaps).
 */
import { describe, expect, it } from 'vitest'
import { allRegions, GUTTER, IDLE_SHARED, packShelves, planAtlas, type Region } from './atlas'
import { GAP, LAYOUT_IDS, LAYOUTS } from './layouts'
import { realDefs } from './testkit'

const overlap = (a: Region, b: Region, pad: number): boolean => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad

describe('the atlas plan', () => {
  const defs = realDefs()
  const plan = planAtlas(defs)
  const regions = allRegions(plan)

  it('has a region for every static, two sweep slots and a label slot per band, and a standby face per layout', () => {
    let want = LAYOUT_IDS.length - Object.keys(IDLE_SHARED).length
    for (const d of defs) want += d.layout.statics.length + 3 * d.layout.bands.length
    expect(regions).toHaveLength(want)
    defs.forEach((d, i) => {
      const m = plan.monitors[i]
      d.layout.statics.forEach((s, k) => expect([m.statics[k].w, m.statics[k].h]).toEqual([s.w, s.h]))
      d.layout.bands.forEach((b, k) => {
        expect([m.bands[k].entries[0].w, m.bands[k].entries[0].h]).toEqual([b.w, b.h])
        expect([m.bands[k].entries[1].w, m.bands[k].entries[1].h]).toEqual([b.w, b.h])
        expect([m.bands[k].label.w, m.bands[k].label.h]).toEqual([d.layout.labelW + GAP, b.h])
      })
    })
    for (const id of LAYOUT_IDS) expect([plan.idle[id].w, plan.idle[id].h]).toEqual([LAYOUTS[id].w, LAYOUTS[id].h])
    // a shared standby face: the same size and the same statics, so the same picture
    for (const [id, same] of Object.entries(IDLE_SHARED)) {
      expect(plan.idle[id as keyof typeof plan.idle]).toBe(plan.idle[same])
      expect(LAYOUTS[id as keyof typeof LAYOUTS].statics).toEqual(LAYOUTS[same].statics)
    }
  })

  it('keeps every region inside the atlas, apart from every other by the gutter', () => {
    for (const r of regions) {
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.y).toBeGreaterThanOrEqual(0)
      expect(r.x + r.w).toBeLessThanOrEqual(plan.width)
      expect(r.y + r.h).toBeLessThanOrEqual(plan.height)
    }
    for (let i = 0; i < regions.length; i++) for (let j = i + 1; j < regions.length; j++) expect(overlap(regions[i], regions[j], GUTTER - 1)).toBe(false)
  })

  it('is about 2048 x 1800 (1848 today): about 20 MB of GPU memory with mipmaps', () => {
    expect(plan.width).toBe(2048)
    expect(plan.height).toBeLessThanOrEqual(1880)
    expect(plan.height % 8).toBe(0)
    const mb = (plan.width * plan.height * 4 * 4) / 3 / 1048576
    expect(mb).toBeLessThan(20.5)
    // and it is used well: more than 85 % of the pixels are regions
    const used = regions.reduce((n, r) => n + r.w * r.h, 0)
    expect(used / (plan.width * plan.height)).toBeGreaterThan(0.85)
  })

  it('is deterministic, and the packer refuses a region wider than the atlas', () => {
    expect(planAtlas(defs)).toEqual(plan)
    expect(() => packShelves([{ w: 3000, h: 10, order: 0, region: { x: 0, y: 0, w: 0, h: 0 } }], 2048, 2)).toThrow()
  })
})
