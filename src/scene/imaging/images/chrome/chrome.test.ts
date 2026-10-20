/**
 * R3: the CT, MRI and X-ray chrome print the scanner's words from the content (window and level, kV and mAs, TR and TE, the exposure
 * index), the disclaimer on every picture, the scout inset only when there is one, and the lead marker on a radiograph.
 */
import { describe, expect, it } from 'vitest'
import { IMAGING_UI } from '@/content/imagingUi'
import { emptySliceMeta } from '../../render/spec'
import type { Ctx2D } from '../ctx'
import { createRecorder, mockSurface } from '../mockCanvas'
import { paintCtChrome, type SliceChrome } from './ct'
import { coilOf, paintMriChrome } from './mri'
import { deviationIndex, paintXrayChrome } from './xray'

/** A recording surface that also keeps the words written on it. */
function textSurface(): { ctx: Ctx2D; texts: string[]; rec: ReturnType<typeof createRecorder> } {
  const rec = createRecorder()
  const s = mockSurface(384, 384, rec)
  const texts: string[] = []
  const ctx = new Proxy(s.ctx as object, {
    get(t, k: string) {
      if (k === 'fillText') return (str: string) => {
        texts.push(str)
        rec.calls.set('fillText', (rec.calls.get('fillText') ?? 0) + 1)
      }
      return (t as Record<string, unknown>)[k]
    },
    set(t, k: string, v) {
      ;(t as Record<string, unknown>)[k] = v
      return true
    },
  }) as Ctx2D
  return { ctx, texts, rec }
}

function chrome(o: Partial<SliceChrome> = {}): SliceChrome {
  const meta = emptySliceMeta()
  return { size: 384, patientName: 'Ada Synthetic', patientId: 'ID 1234567', protocol: 'CT head (non-contrast)', series: 'Axial head', plane: 'axial', image: 7, images: 40, meta, scout: null, ...o }
}

describe('CT chrome', () => {
  it('prints the window, the exposure, the slice position and the image number, and draws the topogram inset when there is one', () => {
    const c = chrome()
    Object.assign(c.meta, { level: 40, width: 80, kv: 120, mas: 280, pos: 812.5, thick: 5, fov: 240, insetK: 0, lines: [0, 0.5, 1, 0.5, 0, 0.9, 1, 0.9, 0, 0.1, 1, 0.1] })
    const s = textSurface()
    paintCtChrome(s.ctx, c)
    expect(s.texts).toContain('W 80  L 40')
    expect(s.texts).toContain('120 kV  280 mAs')
    expect(s.texts).toContain('Z +812.5 mm')
    expect(s.texts).toContain('Im 7/40')
    expect(s.texts).toContain(IMAGING_UI.ct.topogram)
    expect(s.texts).toContain(IMAGING_UI.disclaimer)
    // the orientation letters of an axial
    for (const l of ['R', 'L', 'A', 'P']) expect(s.texts).toContain(l)
  })
  it('leaves the inset out without a scout', () => {
    const s = textSurface()
    paintCtChrome(s.ctx, chrome())
    expect(s.texts).not.toContain(IMAGING_UI.ct.topogram)
  })
})

describe('MRI chrome', () => {
  it('prints TR, TE and TI, the field strength, the coil and the localiser', () => {
    const c = chrome({ series: 'FLAIR axial', protocol: 'MRI brain' })
    Object.assign(c.meta, { tr: 9000, te: 120, ti: 2500, thick: 5, pos: 12.3, fov: 230, insetK: 0, lines: [0.1, 0.5, 0.9, 0.5, 0.1, 0.8, 0.9, 0.8, 0.1, 0.2, 0.9, 0.2] })
    const s = textSurface()
    paintMriChrome(s.ctx, { ...c, bodyPart: 'brain' })
    expect(s.texts).toContain('TR 9000  TE 120  TI 2500')
    expect(s.texts).toContain(IMAGING_UI.mri.field)
    expect(s.texts.some((t) => t.includes(IMAGING_UI.mri.coils.head))).toBe(true)
    expect(s.texts).toContain(IMAGING_UI.mri.localiser)
    expect(coilOf('knee')).toBe('knee')
    expect(coilOf('lumbarSpine')).toBe('spine')
  })
})

describe('X-ray chrome', () => {
  it('prints the exposure and the exposure index with its deviation, and burns in the lead marker', () => {
    const c = chrome({ series: 'AP view', protocol: 'X-ray knee', plane: 'projection', image: 1, images: 1 })
    Object.assign(c.meta, { kv: 65, mas: 5, ei: 330, marker: 2, markerX: 0.84, markerY: 0.1 })
    const s = textSurface()
    paintXrayChrome(s.ctx, { ...c, bodyPart: 'knee' })
    expect(s.texts).toContain('65 kV  5 mAs')
    expect(s.texts).toContain('EI 330  DI +0.4')
    expect(s.texts).toContain('L')
    expect(s.texts).toContain(IMAGING_UI.disclaimer)
    expect(deviationIndex(300)).toBe(0)
    expect(deviationIndex(150)).toBeCloseTo(-3, 1)
  })
})
