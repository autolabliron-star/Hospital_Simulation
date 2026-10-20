/**
 * R3 "Real screens": what a digital radiography console draws round a radiograph, painted once per view: the patient block and the view,
 * the lead side marker burned into the picture where the radiographer put it (a white R or L, as a lead letter shows), the detector, the
 * exposure (kV, mAs), the source-image distance and grid, and the exposure index with its deviation from the target. Words come from
 * content/imagingUi.json; values from the planner (render/spec.ts sliceMeta).
 */
import { IMAGING_UI, fillImaging } from '@/content/imagingUi'
import type { BodyPart } from '@/sim/types'
import type { Ctx2D } from '../ctx'
import { DIM, FONT, INK, NOTE, clearOverlay, disclaimer, label, patientBlock } from './common'
import type { SliceChrome } from './ct'

/** The exposure index the plates are calibrated for (the deviation index is 0 there). */
export const EI_TARGET = 300

/** The deviation index of an exposure index: 10 log10(EI / target), one decimal. */
export function deviationIndex(ei: number): number {
  return ei > 0 ? Math.round(100 * Math.log10(ei / EI_TARGET)) / 10 : 0
}

export function paintXrayChrome(c: Ctx2D, ch: SliceChrome & { bodyPart: BodyPart }): void {
  const S = ch.size
  const u = S / 384
  const t = IMAGING_UI.xray
  const m = ch.meta
  clearOverlay(c, S)
  patientBlock(c, u, ch.patientName, ch.patientId, ch.protocol)
  label(c, ch.series, S - 8 * u, 13 * u, 'right', 10 * u, INK, true)
  label(c, fillImaging(IMAGING_UI.image, { n: ch.image, total: ch.images }), S - 8 * u, 24 * u, 'right', 8 * u, DIM)
  label(c, t.detector, S - 8 * u, 35 * u, 'right', 8 * u, DIM)
  // the lead marker: a bright letter in a thin frame, as the lead shows on the plate
  if (m.marker > 0) {
    const s = m.marker === 1 ? IMAGING_UI.orient.R : IMAGING_UI.orient.L
    const x = m.markerX * S
    const y = Math.max(48 * u, m.markerY * S)
    const h = 16 * u
    c.fillStyle = 'rgba(250,252,252,0.96)'
    c.font = `bold ${h}px ${FONT}`
    c.textAlign = 'center'
    c.textBaseline = 'alphabetic'
    c.fillText(s, x, y + h * 0.36)
    c.strokeStyle = 'rgba(240,244,244,0.85)'
    c.lineWidth = Math.max(1, u)
    c.strokeRect(x - h * 0.55, y - h * 0.62, h * 1.1, h * 1.12)
  }
  const sid = ch.bodyPart === 'chest' ? 180 : 100
  const grid = ch.bodyPart === 'chest' || ch.bodyPart === 'pelvis' ? t.grid : t.noGrid
  const di = deviationIndex(m.ei)
  const rows = [fillImaging(t.exposure, { kv: m.kv, mas: m.mas }), `${fillImaging(t.sid, { cm: sid })}  ${grid}`]
  rows.forEach((r, i) => label(c, r, 8 * u, S - (23 + (rows.length - 1 - i) * 11) * u, 'left', 8 * u, DIM))
  if (m.ei > 0) label(c, `${fillImaging(t.ei, { ei: m.ei })}  ${fillImaging(t.di, { di: `${di >= 0 ? '+' : ''}${di.toFixed(1)}` })}`, 8 * u, S - 12 * u, 'left', 8 * u, Math.abs(di) > 1 ? NOTE : INK, true)
  disclaimer(c, S)
}
