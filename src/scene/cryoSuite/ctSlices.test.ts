/**
 * R5 wave 3: the lung's and the liver's slice models (ctSlices.ts) in node: deterministic by seed, the right anatomy in the right order (the liver slice has no
 * flank bowel, its lung bases are drawn before the organs that cover them, its ribs and the table pad on top), the tumours placed where places.ts says
 * they lie. What they look like once painted is probed pixel by pixel in ctPaint.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { flatten } from '@/scene/imaging/images/shapes'
import { windowed } from '@/scene/imaging/images/tones'
import { CRYO_SUITE } from '@/sim/places'
import { CHEST_WINDOW, CRYO_SLICES, liverSliceModel, LIVER_Z, LUNG_Z, lungSliceModel, proneSliceModel } from './ctSlices'
import { CRYO_IMAGE } from './ctPaint'

describe('the slice models', () => {
  it('are deterministic by seed (the same seed, the same shapes; another seed, other numbers) and finite', () => {
    for (const make of [lungSliceModel, liverSliceModel]) {
      expect(flatten(make(11))).toEqual(flatten(make(11)))
      expect(flatten(make(11))).not.toEqual(flatten(make(12)))
      expect(flatten(make(11)).every(Number.isFinite)).toBe(true)
    }
    expect(proneSliceModel('lung', 5)).toEqual(lungSliceModel(5))
    expect(proneSliceModel('liver', 5)).toEqual(liverSliceModel(5))
  })

  it('the lung\'s is the chest at the lower chest with the table\'s pad after the body; the window shows lungs black and soft tissue bright', () => {
    expect(LUNG_Z).toBeGreaterThan(0.4)
    expect(LUNG_Z).toBeLessThan(0.8)
    const m = lungSliceModel(3)
    expect(m.prims.filter((p) => p.t === 'lung').length).toBeGreaterThanOrEqual(2)
    expect(m.prims.filter((p) => p.t === 'heart').length).toBeGreaterThan(0)
    expect(m.prims.filter((p) => p.t === 'bone').length).toBeGreaterThan(15)
    expect(m.prims.at(-1)?.t).toBe('cushion')
    // (Hounsfield units: lung -850, fat -100, soft tissue 45, bone 1100)
    expect(windowed(-850, CHEST_WINDOW)).toBe(0)
    expect(windowed(45, CHEST_WINDOW)).toBeGreaterThan(0.6)
    expect(windowed(-100, CHEST_WINDOW)).toBeGreaterThan(0.3)
    expect(windowed(-100, CHEST_WINDOW)).toBeLessThan(windowed(45, CHEST_WINDOW) - 0.1)
    expect(windowed(1100, CHEST_WINDOW)).toBe(1)
  })

  it('the liver\'s is the upper abdomen: no bowel at the flanks, the lungs\' lowest edges drawn before the first organ, ribs round it, the pad last', () => {
    expect(LIVER_Z).toBeLessThan(0.3)
    const m = liverSliceModel(3)
    expect(m.prims.some((p) => p.t === 'bowel')).toBe(false)
    expect(m.prims.some((p) => p.t === 'air' && p.k === 'e' && Math.abs(p.cx) > 0.6)).toBe(false)
    const firstLiver = m.prims.findIndex((p) => p.t === 'liver')
    const lungs = m.prims.map((p, i) => (p.t === 'lung' ? i : -1)).filter((i) => i >= 0)
    expect(lungs).toHaveLength(2)
    for (const i of lungs) expect(i).toBeLessThan(firstLiver)
    // the lungs sit beside the spine, one each side
    const sides = lungs.map((i) => (m.prims[i].k === 'e' ? Math.sign((m.prims[i] as { cx: number }).cx) : 0)).sort()
    expect(sides).toEqual([-1, 1])
    // a ring of ribs (a bone and its marrow each), the front and the spine's place clear
    const ribs = m.prims.filter((p, i) => p.k === 'e' && p.t === 'bone' && i > firstLiver && Math.abs(p.rx - 0.05) < 1e-9)
    expect(ribs.length).toBeGreaterThanOrEqual(10)
    expect(m.prims.at(-1)?.t).toBe('cushion')
    // the liver is on the supine slice's right = x < 0 here (the picture turns it)
    const liver = m.prims[firstLiver]
    expect(liver.k === 'e' && liver.cx).toBeLessThan(0)
  })
})

describe('where the tumours are', () => {
  it('the kidney\'s picture spec is the one it always had; the lung\'s and the liver\'s are on the picture\'s right (the patient\'s right), 80-100 mm from the spine and in the back half', () => {
    expect(CRYO_SLICES.kidney.tumour).toEqual(CRYO_IMAGE.tumour)
    expect(CRYO_SLICES.kidney.prone).toBe(false)
    for (const t of ['lung', 'liver'] as const) {
      const { tumour, prone } = CRYO_SLICES[t]
      expect(prone).toBe(true)
      expect(tumour.x).toBeGreaterThan(0)
      expect(tumour.y).toBeLessThan(0.1)
      // the sim's own distance from the spine (places.ts: 0.09 m lateral for the lung, 0.11 m for the liver), within the picture's scale of 180 mm a unit
      const mm = tumour.x * CRYO_IMAGE.mmPerUnit
      expect(Math.abs(mm - (t === 'lung' ? 90 : 110))).toBeLessThan(25)
    }
    // both tumours are on the robot's side of the table (north: smaller z) of the patient's midline, as the picture has them on the right
    for (const t of ['lung', 'liver'] as const) expect(CRYO_SUITE.targets[t].tumour.z).toBeLessThan(CRYO_SUITE.ct.table.out.z)
  })
})
