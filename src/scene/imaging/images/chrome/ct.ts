/**
 * R3 "Real screens": what a CT console draws round a slice, painted once per slice into a transparent overlay: the patient block, the
 * series and image number, the table position (Z), the scanner and its exposure (kV, mAs), the slice thickness and the reconstruction
 * kernel, the window and level, orientation letters, a scale bar, and the topogram inset with this slice's line across it. Words come from
 * content/imagingUi.json; values are the planner's own (render/spec.ts sliceMeta).
 */
import { IMAGING_UI, fillImaging } from '@/content/imagingUi'
import type { ScanPlane } from '@/sim/types'
import type { SliceMeta } from '../../render/spec'
import type { Ctx2D, Surface } from '../ctx'
import { DIM, INK, NOTE, clearOverlay, disclaimer, label, orientation, patientBlock, scaleBar, scoutInset } from './common'

export const CT_ACCENT = '#ff6a5a'

export interface SliceChrome {
  size: number
  patientName: string
  patientId: string
  protocol: string
  series: string
  plane: ScanPlane
  /** This image (1-based) of the series' count. */
  image: number
  images: number
  meta: SliceMeta
  /** The scout picture the meta's inset lines are drawn on (null until it arrives, or none). */
  scout: Surface['canvas'] | null
}

const signed = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`

export function paintCtChrome(c: Ctx2D, ch: SliceChrome): void {
  const S = ch.size
  const u = S / 384
  const t = IMAGING_UI.ct
  const m = ch.meta
  clearOverlay(c, S)
  patientBlock(c, u, ch.patientName, ch.patientId, ch.protocol)
  label(c, ch.series, S - 8 * u, 13 * u, 'right', 10 * u, INK, true)
  label(c, fillImaging(IMAGING_UI.image, { n: ch.image, total: ch.images }), S - 8 * u, 24 * u, 'right', 8 * u, DIM)
  if (ch.plane !== 'scout') label(c, fillImaging(t.pos, { z: signed(m.pos) }), S - 8 * u, 35 * u, 'right', 8 * u, DIM)
  if (m.insetK >= 0) scoutInset(c, S, ch.scout, t.topogram, m.lines, CT_ACCENT)
  orientation(c, S, ch.plane)
  if (ch.plane !== 'scout') scaleBar(c, S, m.fov)
  // the acquisition, bottom left; the window, bottom right
  const rows = [t.scanner, fillImaging(t.exposure, { kv: m.kv, mas: m.mas })]
  if (ch.plane !== 'scout') rows.push(`${fillImaging(t.thick, { mm: m.thick.toFixed(m.thick < 2 ? 2 : 1) })}  ${m.sharp ? t.kernel.sharp : t.kernel.soft}`)
  rows.forEach((r, i) => label(c, r, 8 * u, S - (12 + (rows.length - 1 - i) * 11) * u, 'left', 8 * u, DIM))
  if (ch.plane !== 'scout') label(c, fillImaging(t.wl, { w: m.width, l: m.level }), S - 8 * u, S - 20 * u, 'right', 9 * u, NOTE, true)
  disclaimer(c, S)
}
