/**
 * R3 (endoscope): one picture, start to end. An `EndoPainter` belongs to one picture size (the shared 384 x 216 live texture, the console card's 768 x 432)
 * and keeps everything a frame needs (the tips, the camera, the HUD's fonts and widths), so `paint` allocates nothing:
 *
 *   tissue -> tents -> shadows -> instruments (arm 4, the farthest, first) -> the light's falloff -> the HUD
 *
 * Before the plates are baked it paints a plain warm field under the same instruments, light and HUD. `paintStandby` is the dim screen before the camera is
 * docked (painted once per robot phase: it builds a gradient and that is fine there).
 */
import type { Ctx2D } from '@/scene/imaging/images/ctx'
import { drawInstrument, drawLight, drawPlainField, drawShadows, drawTent, drawTissue, flickerAt, newTip, tipOnScreen, type TipOnScreen } from './frame'
import { EndoHud } from './hud'
import { LOOKS } from './looks'
import { plateOf } from './plates'
import { cameraPose, REST_HALF, SLOTS, type CameraPose, type EndoView } from './view'

/** The order the tools are drawn in: arm 4 (slot 2, coming from above, the farthest) first, then arms 1 and 3. */
const DRAW_ORDER = [2, 0, 1] as const

export class EndoPainter {
  readonly hud: EndoHud
  /** Paints so far (the probe reads it). */
  paints = 0
  private readonly tips: TipOnScreen[] = [newTip(), newTip(), newTip()]
  private readonly cam: CameraPose = { cx: 0, cy: 0, hh: REST_HALF, breath: 0 }

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.hud = new EndoHud(w, h)
  }

  /** Paint `v` into `c` (a canvas of this painter's size). Deterministic: the same view paints the same picture. */
  paint(c: Ctx2D, v: EndoView): void {
    const { w, h } = this
    c.imageSmoothingEnabled = true
    c.imageSmoothingQuality = 'medium'
    const plate = plateOf(v.proc)
    if (plate) drawTissue(c, w, h, plate, cameraPose(v, this.cam))
    else drawPlainField(c, w, h)
    for (let k = 0; k < SLOTS; k++) tipOnScreen(k, v, this.tips[k])
    // tissue pulled up under the graspers that have closed
    for (let k = 0; k < SLOTS; k++) {
      const look = v.look[k]
      if (look < 0 || !LOOKS[look].grasps || v.withdraw[k] > 0.05) continue
      const grip = (1 - v.withdraw[k] / 0.05) * Math.max(0, (0.32 - this.tips[k].jaw) / 0.32) * v.gain
      drawTent(c, w, h, this.tips[k], LOOKS[look], grip * 0.85)
    }
    drawShadows(c, w, h, this.tips, v)
    for (let i = 0; i < DRAW_ORDER.length; i++) {
      const k = DRAW_ORDER[i]
      const look = v.look[k]
      if (look < 0 || !LOOKS[look].drawn || v.withdraw[k] > 0.995) continue
      drawInstrument(c, w, h, this.tips[k], LOOKS[look], v.energy[k], flickerAt(k, v.seed, v.t))
    }
    drawLight(c, w, h)
    this.hud.draw(c, v)
    c.setTransform(1, 0, 0, 1, 0, 0)
    this.paints++
  }
}

const painters: EndoPainter[] = []

/** The shared painter of a picture size (made on first use). */
export function painterFor(w: number, h: number): EndoPainter {
  for (let i = 0; i < painters.length; i++) if (painters[i].w === w && painters[i].h === h) return painters[i]
  const p = new EndoPainter(w, h)
  painters.push(p)
  return p
}

/** Paint the endoscope picture `v` into the whole `w` x `h` canvas. */
export function paintEndoscope(c: Ctx2D, w: number, h: number, v: EndoView): void {
  painterFor(w, h).paint(c, v)
}

/** The standby picture before the camera is docked: a dark 16:9 field with a soft glow, a thin frame, a title and one line under it. */
export function paintStandby(c: Ctx2D, w: number, h: number, title: string, line: string): void {
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.globalAlpha = 1
  c.globalCompositeOperation = 'source-over'
  c.fillStyle = '#071013'
  c.fillRect(0, 0, w, h)
  const g = c.createRadialGradient(w / 2, h / 2, h * 0.05, w / 2, h / 2, h * 0.75)
  g.addColorStop(0, 'rgba(60,110,115,0.3)')
  g.addColorStop(1, 'rgba(60,110,115,0)')
  c.fillStyle = g
  c.fillRect(0, 0, w, h)
  // a thin frame inset from the edges, its corners rounded
  const m = h * 0.06
  const r = h * 0.05
  c.strokeStyle = 'rgba(120,180,184,0.3)'
  c.lineWidth = Math.max(1, h * 0.006)
  c.beginPath()
  c.moveTo(m + r, m)
  c.lineTo(w - m - r, m)
  c.arc(w - m - r, m + r, r, -Math.PI / 2, 0)
  c.lineTo(w - m, h - m - r)
  c.arc(w - m - r, h - m - r, r, 0, Math.PI / 2)
  c.lineTo(m + r, h - m)
  c.arc(m + r, h - m - r, r, Math.PI / 2, Math.PI)
  c.lineTo(m, m + r)
  c.arc(m + r, m + r, r, Math.PI, Math.PI * 1.5)
  c.closePath()
  c.stroke()
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillStyle = 'rgba(205,232,234,0.92)'
  c.font = `600 ${Math.round(h * 0.085)}px ui-sans-serif, system-ui, sans-serif`
  c.fillText(title, w / 2, h / 2 - h * 0.04)
  c.fillStyle = 'rgba(150,190,194,0.85)'
  c.font = `500 ${Math.round(h * 0.062)}px ui-sans-serif, system-ui, sans-serif`
  c.fillText(line, w / 2, h / 2 + h * 0.07)
}
