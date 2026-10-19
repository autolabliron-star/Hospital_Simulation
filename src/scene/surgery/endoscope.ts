/**
 * R2 (agent O): the stylised endoscope picture, painted with the plain canvas-2D calls the imaging suite's `Ctx2D` allows, so it runs against a recording context
 * in node and a real canvas in the browser. ONE painter serves every screen that shows the camera: the shared 256 x 160 live texture (the vision cart's monitor,
 * the wall monitor and the two console viewers) and the 384 x 240 canvas of the console card (ConsoleCard.tsx).
 *
 * What it draws is deliberately not an operation: a soft warm field (a salmon-to-rose radial gradient with slow, soft folds and a few specular highlights),
 * two or three metal instrument tips coming in from the edge, their jaws opening and closing, the round endoscopic vignette. Nothing red, wet or cut: no blood,
 * no incisions, no organs drawn literally. It is a pure function of (seed, time, gain): the same inputs paint the same picture. The instrument tips move with
 * `tipMotion` (robotPose.ts), the same small seeded moves that the 3D arms make, so the screen and the arms stay in step.
 */
import type { Ctx2D } from '@/scene/imaging/images/ctx'
import { h01, tipMotion, type TipMotion } from './robotPose'

/** The seeds of the picture's own folds and highlights are drawn apart from the arms' (the same seed, a different stream). */
const STREAM = 977

export interface EndoView {
  /** The case's `motionSeed`. */
  seed: number
  /** Sim seconds. */
  t: number
  /** 0..1: how much the instruments move (the robot's `motionGain`); the jaws rest half open at 0. */
  gain: number
}

/** One instrument tip on the picture, in the circle's own units (the circle has radius 1, +x right, +y down). */
export interface TipOnScreen {
  /** Where the shaft enters at the circle's edge, where the tip is, and the shaft's direction (from the entry toward the tip). */
  ex: number
  ey: number
  x: number
  y: number
  dx: number
  dy: number
  /** 0 closed .. 1 open. */
  jaw: number
}

/** The three instrument arms (the endoscope, arm index 1, is the camera itself): where each comes in from and rests. */
const RIG: readonly { arm: number; ex: number; ey: number; x: number; y: number }[] = [
  { arm: 0, ex: -1.12, ey: 0.62, x: -0.24, y: 0.14 },
  { arm: 2, ex: 1.12, ey: 0.56, x: 0.26, y: 0.1 },
  { arm: 3, ex: 0.34, ey: 1.16, x: 0.06, y: 0.42 },
]
export const INSTRUMENT_ARMS: readonly number[] = RIG.map((r) => r.arm)

const _m: TipMotion = { insert: 0, pitch: 0, yaw: 0, jaw: 0, roll: 0 }

/** Where instrument `k` (0..2, arms 0, 2, 3) has its tip at `t`: the rest place moved by the arm's pitch, yaw and insertion. Writes into `out`. */
export function tipOnScreen(k: number, v: EndoView, out: TipOnScreen): TipOnScreen {
  const r = RIG[k]
  const m = tipMotion(r.arm, v.t, v.seed, _m)
  const g = v.gain
  // the shaft's direction at rest, and the tip pushed along it by the insertion (2.5 cm of the arm is about 0.12 of the picture)
  let dx = r.x - r.ex
  let dy = r.y - r.ey
  const len = Math.hypot(dx, dy)
  dx /= len
  dy /= len
  const push = m.insert * 5 * g
  out.ex = r.ex
  out.ey = r.ey
  out.x = r.x + dx * push + m.yaw * 2.4 * g
  out.y = r.y + dy * push + m.pitch * 2.4 * g
  const ax = out.x - out.ex
  const ay = out.y - out.ey
  const al = Math.hypot(ax, ay)
  out.dx = ax / al
  out.dy = ay / al
  out.jaw = 0.3 + (m.jaw - 0.3) * g
  return out
}

const _tip: TipOnScreen = { ex: 0, ey: 0, x: 0, y: 0, dx: 1, dy: 0, jaw: 0 }

const rgba = (r: number, g: number, b: number, a: number): string => `rgba(${r},${g},${b},${a})`

/** A soft round blob: a radial gradient from `inner` to nothing, centred at (x, y), radius `r`. */
function blob(c: Ctx2D, x: number, y: number, rx: number, ry: number, inner: string, outer: string): void {
  c.save()
  c.translate(x, y)
  c.scale(1, ry / rx)
  const g = c.createRadialGradient(0, 0, 0, 0, 0, rx)
  g.addColorStop(0, inner)
  g.addColorStop(1, outer)
  c.fillStyle = g
  c.beginPath()
  c.arc(0, 0, rx, 0, Math.PI * 2)
  c.fill()
  c.restore()
}

/** One metal instrument: a tapering shaft with a bright edge, a wrist, and two jaw blades. All lengths in picture pixels. */
function instrument(c: Ctx2D, p: TipOnScreen, R: number, cx: number, cy: number): void {
  const ex = cx + p.ex * R
  const ey = cy + p.ey * R
  const tx = cx + p.x * R
  const ty = cy + p.y * R
  const nx = -p.dy
  const ny = p.dx
  const w = R * 0.085
  // the shaft: a long thin trapezoid, wider at the edge, with a gradient across it
  const g = c.createLinearGradient(ex + nx * w, ey + ny * w, ex - nx * w, ey - ny * w)
  g.addColorStop(0, '#f1f4f5')
  g.addColorStop(0.45, '#aeb8bb')
  g.addColorStop(1, '#5d686c')
  c.fillStyle = g
  c.beginPath()
  c.moveTo(ex + nx * w * 1.15, ey + ny * w * 1.15)
  c.lineTo(tx + nx * w * 0.55, ty + ny * w * 0.55)
  c.lineTo(tx - nx * w * 0.55, ty - ny * w * 0.55)
  c.lineTo(ex - nx * w * 1.15, ey - ny * w * 1.15)
  c.closePath()
  c.fill()
  // a soft shadow of it on the field, under and beside the shaft
  c.strokeStyle = rgba(70, 20, 25, 0.16)
  c.lineWidth = w * 1.6
  c.lineCap = 'round'
  c.beginPath()
  c.moveTo(ex + 3, ey + 4)
  c.lineTo(tx + 3, ty + 4)
  c.stroke()
  // a bright line along the lit edge
  c.strokeStyle = rgba(255, 255, 255, 0.7)
  c.lineWidth = Math.max(1, w * 0.22)
  c.beginPath()
  c.moveTo(ex + nx * w * 0.6, ey + ny * w * 0.6)
  c.lineTo(tx + nx * w * 0.3, ty + ny * w * 0.3)
  c.stroke()
  // the wrist, then the jaws: two blades turned by the jaw's opening about the shaft's axis
  c.fillStyle = '#7d898d'
  c.beginPath()
  c.arc(tx, ty, w * 0.78, 0, Math.PI * 2)
  c.fill()
  const open = 0.1 + p.jaw * 0.55
  const blade = R * 0.17
  for (const s of [-1, 1]) {
    const a = s * open
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    const bx = p.dx * ca - p.dy * sa
    const by = p.dx * sa + p.dy * ca
    c.strokeStyle = '#dfe5e7'
    c.lineWidth = w * 0.78
    c.lineCap = 'round'
    c.beginPath()
    c.moveTo(tx, ty)
    c.lineTo(tx + bx * blade, ty + by * blade)
    c.stroke()
    c.strokeStyle = 'rgba(60,70,74,0.55)'
    c.lineWidth = Math.max(1, w * 0.16)
    c.beginPath()
    c.moveTo(tx, ty)
    c.lineTo(tx + bx * blade, ty + by * blade)
    c.stroke()
  }
}

/**
 * Paint the endoscope picture into the whole `w` x `h` canvas: black round the circle, the soft field with its folds and highlights inside it, the instrument
 * tips, then the vignette. Deterministic: `view.seed` and `view.t` decide everything.
 */
export function paintEndoscope(c: Ctx2D, w: number, h: number, view: EndoView): void {
  const cx = w / 2
  const cy = h / 2
  const R = Math.min(w, h) * 0.485
  const t = view.t
  const seed = view.seed + STREAM
  c.fillStyle = '#040708'
  c.fillRect(0, 0, w, h)
  c.save()
  c.beginPath()
  c.arc(cx, cy, R, 0, Math.PI * 2)
  c.clip()
  // the field: a warm salmon centre falling to rose at the rim, lit a little from the upper left
  const g = c.createRadialGradient(cx - R * 0.18, cy - R * 0.22, R * 0.05, cx, cy, R * 1.05)
  g.addColorStop(0, '#f0b49b')
  g.addColorStop(0.55, '#dc8f80')
  g.addColorStop(1, '#a95a58')
  c.fillStyle = g
  c.fillRect(cx - R, cy - R, R * 2, R * 2)
  // slow soft folds: wide, low blobs of lighter and deeper tones that drift a little
  for (let k = 0; k < 9; k++) {
    const u = h01(seed, k, 1)
    const v = h01(seed, k, 2)
    const s = 0.28 + 0.34 * h01(seed, k, 3)
    const drift = 0.035 * Math.sin(t * (0.13 + 0.1 * h01(seed, k, 4)) + k * 1.7)
    const x = cx + (u * 2 - 1) * R * 0.85 + drift * R
    const y = cy + (v * 2 - 1) * R * 0.85 + 0.6 * drift * R
    const light = k % 2 === 0
    blob(c, x, y, R * s, R * s * (0.45 + 0.4 * h01(seed, k, 5)), light ? rgba(255, 222, 196, 0.46) : rgba(140, 62, 72, 0.42), light ? rgba(255, 218, 190, 0) : rgba(150, 70, 78, 0))
  }
  // a few warm yellow patches, far fainter, so the field is not one flat colour
  for (let k = 0; k < 3; k++) {
    const x = cx + (h01(seed, k, 11) * 2 - 1) * R * 0.6
    const y = cy + (h01(seed, k, 12) * 2 - 1) * R * 0.6
    blob(c, x, y, R * 0.3, R * 0.18, rgba(246, 214, 150, 0.3), rgba(246, 214, 150, 0))
  }
  // specular highlights: soft white spots that slide slowly over the wet-looking field
  for (let k = 0; k < 3; k++) {
    const x = cx + R * (0.5 * Math.sin(t * (0.09 + 0.05 * k) + k * 2.1) + (h01(seed, k, 21) - 0.5) * 0.7)
    const y = cy + R * (0.4 * Math.cos(t * (0.07 + 0.04 * k) + k * 1.3) + (h01(seed, k, 22) - 0.5) * 0.7)
    blob(c, x, y, R * (0.1 + 0.05 * k), R * (0.06 + 0.03 * k), rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0))
  }
  // the instruments
  for (let k = 0; k < RIG.length; k++) instrument(c, tipOnScreen(k, view, _tip), R, cx, cy)
  // the vignette: the rim falls away to black
  const vg = c.createRadialGradient(cx, cy, R * 0.72, cx, cy, R)
  vg.addColorStop(0, 'rgba(4,7,8,0)')
  vg.addColorStop(1, 'rgba(4,7,8,0.92)')
  c.fillStyle = vg
  c.fillRect(cx - R, cy - R, R * 2, R * 2)
  c.restore()
  // a thin bright ring where the scope's field ends
  c.strokeStyle = 'rgba(190,215,220,0.22)'
  c.lineWidth = Math.max(1, R * 0.012)
  c.beginPath()
  c.arc(cx, cy, R, 0, Math.PI * 2)
  c.stroke()
}

/** The standby picture before the camera is docked: a dark field with a faint circle, a title and one line under it. */
export function paintStandby(c: Ctx2D, w: number, h: number, title: string, line: string): void {
  const cx = w / 2
  const cy = h / 2
  const R = Math.min(w, h) * 0.485
  c.fillStyle = '#071013'
  c.fillRect(0, 0, w, h)
  const g = c.createRadialGradient(cx, cy, R * 0.1, cx, cy, R)
  g.addColorStop(0, 'rgba(60,110,115,0.28)')
  g.addColorStop(1, 'rgba(60,110,115,0)')
  c.fillStyle = g
  c.beginPath()
  c.arc(cx, cy, R, 0, Math.PI * 2)
  c.fill()
  c.strokeStyle = 'rgba(120,180,184,0.3)'
  c.lineWidth = Math.max(1, R * 0.012)
  c.beginPath()
  c.arc(cx, cy, R, 0, Math.PI * 2)
  c.stroke()
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillStyle = 'rgba(205,232,234,0.92)'
  c.font = `600 ${Math.round(h * 0.085)}px ui-sans-serif, system-ui, sans-serif`
  c.fillText(title, cx, cy - h * 0.04)
  c.fillStyle = 'rgba(150,190,194,0.85)'
  c.font = `500 ${Math.round(h * 0.062)}px ui-sans-serif, system-ui, sans-serif`
  c.fillText(line, cx, cy + h * 0.07)
}
