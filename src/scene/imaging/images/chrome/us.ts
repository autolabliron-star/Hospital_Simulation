/**
 * R3 "Real screens": what an ultrasound scanner draws round the picture, painted once per sweep into a transparent overlay (and a few live
 * words per frame): the patient and the preset, the acoustic output indices, the imaging parameters, a depth scale in centimetres with the
 * focus marker, the depth-gain (TGC) curve, the grey bar, a body-marker pictogram with the probe where it really is, and the sonographer's
 * annotation ("RT KIDNEY  LONG"). Words come from content/imagingUi.json; values are synthetic but plausible.
 */
import { IMAGING_UI, fillImaging } from '@/content/imagingUi'
import type { UsViewId } from '../../phantom/usViews'
import type { UsGeometry } from '../../render/us'
import type { Ctx2D } from '../ctx'

const FONT = 'ui-monospace, Menlo, Consolas, monospace'
const INK = 'rgba(214,232,234,0.95)'
const DIM = 'rgba(160,186,190,0.92)'
const NOTE = 'rgba(255,226,132,0.96)'
const ACCENT = '#7ee0c3'

export interface UsChrome {
  size: number
  geometry: UsGeometry
  patientName: string
  patientId: string
  view: UsViewId
  focusMm: number
  freq: number
  gain: number
  dr: number
  fps: number
}

function label(c: Ctx2D, s: string, x: number, y: number, align: 'left' | 'right' | 'center', px: number, fill: string, bold = false): void {
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

/** Where the body-marker pictogram puts the probe for each view: position in the torso's box (0..1 across from the patient's right) and angle. */
const MARKER: Record<UsViewId, [number, number, number]> = {
  liver: [0.32, 0.4, -0.5],
  gallbladder: [0.36, 0.44, 1.0],
  kidneyR: [0.06, 0.48, Math.PI / 2],
  kidneyL: [0.94, 0.45, Math.PI / 2],
  spleen: [0.9, 0.36, 1.25],
  bladder: [0.5, 0.86, 0],
  pancreas: [0.5, 0.3, 0],
}

/** The overlay: everything that does not change from frame to frame of a sweep. */
export function paintUsChrome(c: Ctx2D, ch: UsChrome): void {
  const S = ch.size
  const u = S / 384
  const g = ch.geometry
  const t = IMAGING_UI.us
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.globalAlpha = 1
  c.globalCompositeOperation = 'source-over'
  c.clearRect(0, 0, S, S)

  // header: patient on the left, preset and output indices on the right
  label(c, ch.patientName.toUpperCase(), 8 * u, 13 * u, 'left', 10 * u, INK, true)
  label(c, `${IMAGING_UI.institution}  ${ch.patientId}`, 8 * u, 24 * u, 'left', 8 * u, DIM)
  label(c, t.preset, S - 8 * u, 13 * u, 'right', 9 * u, INK, true)
  label(c, `${fillImaging(t.mi, { mi: '1.1' })}  ${fillImaging(t.tis, { tis: '0.4' })}`, S - 8 * u, 24 * u, 'right', 8 * u, DIM)

  // the parameter column on the left
  const rows = [
    fillImaging(t.freq, { mhz: ch.freq.toFixed(1) }),
    fillImaging(t.gain, { gain: ch.gain }),
    fillImaging(t.dr, { dr: ch.dr }),
    fillImaging(t.depth, { cm: (g.depth / 10).toFixed(0) }),
    fillImaging(t.fr, { fps: ch.fps }),
  ]
  rows.forEach((r, i) => label(c, r, 8 * u, (52 + i * 12) * u, 'left', 8 * u, DIM))

  // the grey bar
  const gx = 9 * u
  const gy0 = 124 * u
  const gy1 = 214 * u
  const grad = c.createLinearGradient(0, gy0, 0, gy1)
  grad.addColorStop(0, '#ffffff')
  grad.addColorStop(1, '#000000')
  c.fillStyle = grad
  c.fillRect(gx, gy0, 6 * u, gy1 - gy0)
  c.strokeStyle = 'rgba(160,186,190,0.6)'
  c.lineWidth = 1
  c.strokeRect(gx, gy0, 6 * u, gy1 - gy0)

  // the depth scale along the right of the fan: a tick per centimetre, numbers every 5
  const xr = g.apexX + (g.radius + g.depth) * Math.sin(g.half) * g.k + 10 * u
  const xs = Math.min(S - 30 * u, xr)
  const y0 = g.apexY + g.radius * g.k
  c.strokeStyle = 'rgba(200,222,226,0.85)'
  c.lineWidth = Math.max(1, u)
  c.beginPath()
  c.moveTo(xs, y0)
  c.lineTo(xs, y0 + g.depth * g.k)
  c.stroke()
  for (let cm = 0; cm * 10 <= g.depth + 0.01; cm++) {
    const y = y0 + cm * 10 * g.k
    const long = cm % 5 === 0
    c.beginPath()
    c.moveTo(xs, y)
    c.lineTo(xs + (long ? 7 : 4) * u, y)
    c.stroke()
    if (long && cm > 0) label(c, String(cm), xs + 9 * u, y + 3 * u, 'left', 8 * u, DIM)
  }
  // the focus marker
  const yf = y0 + ch.focusMm * g.k
  c.fillStyle = ACCENT
  c.beginPath()
  c.moveTo(xs - 2 * u, yf)
  c.lineTo(xs - 8 * u, yf - 4 * u)
  c.lineTo(xs - 8 * u, yf + 4 * u)
  c.closePath()
  c.fill()

  // the TGC curve at the far right: the sonographer's sliders, a gentle S
  const xt = S - 10 * u
  c.strokeStyle = 'rgba(126,224,195,0.75)'
  c.lineWidth = Math.max(1, 1.2 * u)
  c.beginPath()
  for (let i = 0; i <= 16; i++) {
    const f = i / 16
    const x = xt - (2 + 4 * Math.sin(f * Math.PI) + 3 * f) * u
    const y = y0 + f * g.depth * g.k
    if (i === 0) c.moveTo(x, y)
    else c.lineTo(x, y)
  }
  c.stroke()

  // the body marker: a torso seen from the front (patient's right on the left), the probe as a bar where it is
  const bx = 14 * u
  const by = S - 86 * u
  const bw = 34 * u
  const bh = 50 * u
  c.strokeStyle = 'rgba(214,232,234,0.85)'
  c.lineWidth = Math.max(1, 1.2 * u)
  c.beginPath()
  c.arc(bx + bw / 2, by - 7 * u, 6 * u, 0, Math.PI * 2)
  c.stroke()
  c.beginPath()
  c.moveTo(bx + 4 * u, by)
  c.lineTo(bx + bw - 4 * u, by)
  c.quadraticCurveTo(bx + bw, by, bx + bw, by + 6 * u)
  c.lineTo(bx + bw - 2 * u, by + bh)
  c.lineTo(bx + 2 * u, by + bh)
  c.lineTo(bx, by + 6 * u)
  c.quadraticCurveTo(bx, by, bx + 4 * u, by)
  c.stroke()
  const [mx, my, ma] = MARKER[ch.view]
  const px = bx + mx * bw
  const py = by + my * bh
  c.save()
  c.translate(px, py)
  c.rotate(ma)
  c.fillStyle = ACCENT
  c.fillRect(-7 * u, -1.6 * u, 14 * u, 3.2 * u)
  c.fillStyle = NOTE
  c.beginPath()
  c.arc(-7 * u, 0, 2 * u, 0, Math.PI * 2)
  c.fill()
  c.restore()

  // the annotation, and the disclaimer
  label(c, t.views[ch.view], 58 * u, S - 30 * u, 'left', 10 * u, NOTE, true)
  label(c, IMAGING_UI.disclaimer, S - 8 * u, S - 8 * u, 'right', 7.5 * u, 'rgba(160,185,188,0.85)')
}

/** The live words of one frame: LIVE (with the stored-image count) or FREEZE, or the no-contact warning. */
export function paintUsStatus(c: Ctx2D, size: number, live: boolean, contact: number, stored: number, total: number): void {
  const u = size / 384
  const t = IMAGING_UI.us
  if (live && contact < 0.5) label(c, t.noContact, size / 2, 38 * u, 'center', 9 * u, NOTE, true)
  label(c, live ? t.live : t.freeze, size / 2, 13 * u, 'center', 10 * u, live ? ACCENT : '#ffd68c', true)
  if (total > 0) label(c, fillImaging(t.stored, { n: stored, total }), size / 2, 24 * u, 'center', 8 * u, DIM)
}
