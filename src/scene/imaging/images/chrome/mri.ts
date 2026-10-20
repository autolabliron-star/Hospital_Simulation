/**
 * R3 "Real screens": what an MR console draws round an image, painted once per image into a transparent overlay: the patient block and
 * the field strength, the sequence and image number, the slice thickness and position, TR / TE (and TI for inversion recovery), the field
 * of view and the receive coil, orientation letters, a scale bar, and the localiser inset with this slice's line and the series' extent.
 * Words come from content/imagingUi.json; values from the planner (render/spec.ts sliceMeta).
 */
import { IMAGING_UI, fillImaging } from '@/content/imagingUi'
import type { BodyPart } from '@/sim/types'
import type { Ctx2D } from '../ctx'
import { DIM, INK, NOTE, clearOverlay, disclaimer, label, orientation, patientBlock, scaleBar, scoutInset } from './common'
import type { SliceChrome } from './ct'

export const MRI_ACCENT = '#5aa9ff'

/** The receive coil an exam lies in. */
export function coilOf(bodyPart: BodyPart): keyof typeof IMAGING_UI.mri.coils {
  if (bodyPart === 'brain' || bodyPart === 'head' || bodyPart === 'cervicalSpine' || bodyPart === 'neck') return 'head'
  if (bodyPart === 'lumbarSpine') return 'spine'
  if (bodyPart === 'knee' || bodyPart === 'ankle' || bodyPart === 'wrist') return 'knee'
  return 'body'
}

export function paintMriChrome(c: Ctx2D, ch: SliceChrome & { bodyPart: BodyPart }): void {
  const S = ch.size
  const u = S / 384
  const t = IMAGING_UI.mri
  const m = ch.meta
  clearOverlay(c, S)
  patientBlock(c, u, ch.patientName, ch.patientId, ch.protocol)
  label(c, ch.series, S - 8 * u, 13 * u, 'right', 10 * u, INK, true)
  label(c, fillImaging(IMAGING_UI.image, { n: ch.image, total: ch.images }), S - 8 * u, 24 * u, 'right', 8 * u, DIM)
  label(c, t.field, S - 8 * u, 35 * u, 'right', 8 * u, DIM)
  if (m.insetK >= 0) scoutInset(c, S, ch.scout, t.localiser, m.lines, MRI_ACCENT)
  orientation(c, S, ch.plane)
  scaleBar(c, S, m.fov)
  const rows = [fillImaging(t.trte, { tr: m.tr, te: m.te }) + (m.ti > 0 ? `  ${fillImaging(t.ti, { ti: m.ti })}` : ''), `${fillImaging(t.thick, { mm: m.thick.toFixed(1) })}  ${fillImaging(t.pos, { pos: m.pos.toFixed(1) })}`, `${fillImaging(t.fov, { fov: Math.round(m.fov) })}  ${t.coils[coilOf(ch.bodyPart)]}`]
  rows.forEach((r, i) => label(c, r, 8 * u, S - (12 + (rows.length - 1 - i) * 11) * u, 'left', 8 * u, i === 0 ? NOTE : DIM, i === 0))
  disclaimer(c, S)
}
