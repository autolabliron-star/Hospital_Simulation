/**
 * R3 "Real screens": what the CT, MRI and X-ray chrome share: outlined monospace words, the patient block, orientation letters at the
 * picture's edges, a centimetre scale bar, and the scout inset (the topogram or a localiser) with the slice line on it. Pure canvas calls on
 * a `Ctx2D`, so the recording mock in node can check them.
 */
import { IMAGING_UI } from '@/content/imagingUi'
import type { ScanPlane } from '@/sim/types'
import type { Ctx2D, Surface } from '../ctx'

export const FONT = 'ui-monospace, Menlo, Consolas, monospace'
export const INK = 'rgba(214,232,234,0.95)'
export const DIM = 'rgba(160,186,190,0.92)'
export const NOTE = 'rgba(255,226,132,0.96)'

export function label(c: Ctx2D, s: string, x: number, y: number, align: 'left' | 'right' | 'center', px: number, fill: string, bold = false): void {
  c.font = `${bold ? 'bold ' : ''}${px}px ${FONT}`
  c.textAlign = align
  c.textBaseline = 'alphabetic'
  c.lineJoin = 'round'
  c.lineWidth = Math.max(2, px * 0.28)
  c.strokeStyle = 'rgba(0,0,0,0.8)'
  c.strokeText(s, x, y)
  c.fillStyle = fill
  c.fillText(s, x, y)
}

/** Clear the overlay for a fresh paint. */
export function clearOverlay(c: Ctx2D, size: number): void {
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.globalAlpha = 1
  c.globalCompositeOperation = 'source-over'
  c.clearRect(0, 0, size, size)
}

/** Patient name, institution and ID, the protocol: the top-left block every scanner prints. */
export function patientBlock(c: Ctx2D, u: number, name: string, id: string, protocol: string): void {
  label(c, name.toUpperCase(), 8 * u, 13 * u, 'left', 10 * u, INK, true)
  label(c, `${IMAGING_UI.institution}  ${id}`, 8 * u, 24 * u, 'left', 8 * u, DIM)
  label(c, protocol, 8 * u, 35 * u, 'left', 8 * u, DIM)
}

/** The letters at the edges of a slice: which way is the patient's right, front, head. */
export function orientation(c: Ctx2D, size: number, plane: ScanPlane): void {
  const o = IMAGING_UI.orient
  const u = size / 384
  let lr: [string, string, string, string] | null = null
  if (plane === 'axial') lr = [o.R, o.L, o.A, o.P]
  else if (plane === 'coronal') lr = [o.R, o.L, o.H, o.F]
  else if (plane === 'sagittal') lr = [o.A, o.P, o.H, o.F]
  if (!lr) return
  const px = 10 * u
  label(c, lr[0], 6 * u, size / 2 + 4 * u, 'left', px, NOTE, true)
  label(c, lr[1], size - 6 * u, size / 2 + 4 * u, 'right', px, NOTE, true)
  label(c, lr[2], size / 2, 48 * u, 'center', px, NOTE, true)
  label(c, lr[3], size / 2, size - 26 * u, 'center', px, NOTE, true)
}

/** A 5 cm scale bar with centimetre ticks, standing up the right edge (a picture `fov` mm across). */
export function scaleBar(c: Ctx2D, size: number, fov: number): void {
  if (!(fov > 0)) return
  const u = size / 384
  const k = size / fov
  const len = 50 * k
  const x = size - 14 * u
  const y1 = size - 60 * u
  const y0 = y1 - len
  c.strokeStyle = 'rgba(200,222,226,0.8)'
  c.lineWidth = Math.max(1, u)
  c.beginPath()
  c.moveTo(x, y0)
  c.lineTo(x, y1)
  for (let cm = 0; cm <= 5; cm++) {
    const y = y0 + cm * 10 * k
    c.moveTo(x, y)
    c.lineTo(x - (cm % 5 === 0 ? 6 : 3) * u, y)
  }
  c.stroke()
}

/**
 * The scout inset at the top right: the scout picture (or a dark box until it arrives), its name, the first and last slices of the series as
 * dim lines and this slice's line in the modality's colour. `lines` are picture fractions of the scout: [ax, ay, bx, by] x 3.
 */
export function scoutInset(c: Ctx2D, size: number, scout: Surface['canvas'] | null, name: string, lines: readonly number[], accent: string): void {
  const u = size / 384
  const w = 84 * u
  const x0 = size - w - 8 * u
  const y0 = 44 * u
  c.fillStyle = 'rgba(0,0,0,0.85)'
  c.fillRect(x0, y0, w, w)
  if (scout) c.drawImage(scout, 0, 0, scout.width, scout.height, x0, y0, w, w)
  c.save()
  c.beginPath()
  c.rect(x0, y0, w, w)
  c.clip()
  const seg = (o: number, stroke: string, width: number): void => {
    if (!(lines[o] >= -1 && lines[o] <= 2)) return
    c.strokeStyle = stroke
    c.lineWidth = width
    c.beginPath()
    c.moveTo(x0 + lines[o] * w, y0 + lines[o + 1] * w)
    c.lineTo(x0 + lines[o + 2] * w, y0 + lines[o + 3] * w)
    c.stroke()
  }
  seg(4, 'rgba(200,222,226,0.55)', Math.max(1, 0.8 * u))
  seg(8, 'rgba(200,222,226,0.55)', Math.max(1, 0.8 * u))
  seg(0, accent, Math.max(1.2, 1.4 * u))
  c.restore()
  c.strokeStyle = 'rgba(160,186,190,0.7)'
  c.lineWidth = 1
  c.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, w - 1)
  label(c, name, x0 + w / 2, y0 + w + 10 * u, 'center', 7.5 * u, DIM)
}

/** The disclaimer, bottom right, on every picture. */
export function disclaimer(c: Ctx2D, size: number): void {
  const u = size / 384
  label(c, IMAGING_UI.disclaimer, size - 8 * u, size - 8 * u, 'right', 7.5 * u, 'rgba(160,185,188,0.85)')
}
