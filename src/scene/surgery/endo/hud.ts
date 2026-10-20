/**
 * R3 (endoscope): the HUD drawn INSIDE the picture, as on the surgeon's console: an arm chip per instrument along the bottom (its arm number in a badge, the
 * tool's short name, and for an energy tool a pedal icon that lights while the pedal is down: blue bipolar, yellow monopolar), the camera's chip at the top
 * left (arm 2, "30°"), "Exchanging" at the top while an instrument is being changed (its chip dims), and "Simulated" at the top right. The words are
 * src/content/endoscopeUi.json's.
 *
 * Per frame it allocates nothing: the fonts are built once per picture size, text widths are measured once and kept, every colour is a constant.
 */
import { ENDOSCOPE_UI } from '@/content/endoscopeUi'
import type { Ctx2D } from '@/scene/imaging/images/ctx'
import { ENERGY, LOOKS } from './looks'
import { SLOTS, type EndoView } from './view'

/** The arm numbers of the slots, as the console shows them (1-based). */
const ARM_LABEL = ['1', '3', '4'] as const

export const HUD_COLOURS = {
  chip: 'rgba(6,12,15,0.62)',
  chipEdge: 'rgba(220,240,242,0.16)',
  badge: '#2a9d92',
  badgeDim: '#4d6664',
  text: '#eef6f6',
  textDim: 'rgba(238,246,246,0.48)',
  bipolar: '#4ba6ff',
  monopolar: '#ffcf40',
  pedalOff: 'rgba(238,246,246,0.4)',
  exchange: 'rgba(255,207,64,0.92)',
} as const

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'

/** A rounded rectangle path. */
function roundRect(c: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath()
  c.moveTo(x + r, y)
  c.lineTo(x + w - r, y)
  c.quadraticCurveTo(x + w, y, x + w, y + r)
  c.lineTo(x + w, y + h - r)
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  c.lineTo(x + r, y + h)
  c.quadraticCurveTo(x, y + h, x, y + h - r)
  c.lineTo(x, y + r)
  c.quadraticCurveTo(x, y, x + r, y)
  c.closePath()
}

export class EndoHud {
  /** One pixel of the 216-high design, in this picture's pixels. */
  readonly s: number
  private readonly fontLabel: string
  private readonly fontBadge: string
  private readonly fontSmall: string
  /** Measured text widths (NaN until first drawn): per look, and the fixed words. */
  private readonly lookW: Float64Array
  private camW = Number.NaN
  private simW = Number.NaN
  private exW = Number.NaN

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.s = h / 216
    this.fontLabel = `600 ${(8.6 * this.s).toFixed(1)}px ${FONT}`
    this.fontBadge = `700 ${(8.4 * this.s).toFixed(1)}px ${FONT}`
    this.fontSmall = `600 ${(7.4 * this.s).toFixed(1)}px ${FONT}`
    this.lookW = new Float64Array(LOOKS.length).fill(Number.NaN)
  }

  private widthOfLook(c: Ctx2D, look: number): number {
    if (Number.isNaN(this.lookW[look])) {
      c.font = this.fontLabel
      this.lookW[look] = c.measureText(LOOKS[look].short).width
    }
    return this.lookW[look]
  }

  /** Draw the HUD of `v` over the picture. */
  draw(c: Ctx2D, v: EndoView): void {
    const s = this.s
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.globalAlpha = 1
    c.globalCompositeOperation = 'source-over'
    c.textBaseline = 'middle'
    if (Number.isNaN(this.camW)) {
      c.font = this.fontLabel
      this.camW = c.measureText(ENDOSCOPE_UI.hud.camera).width
      c.font = this.fontSmall
      this.simW = c.measureText(ENDOSCOPE_UI.hud.simulated).width
      this.exW = c.measureText(ENDOSCOPE_UI.hud.exchanging).width
    }
    const chipH = 19 * s
    const y = this.h - 8 * s - chipH
    // arm 1 at the bottom left; arms 3 and 4 at the bottom right, arm 4 outermost
    let right = this.w - 8 * s
    for (let k = SLOTS - 1; k >= 1; k--) {
      const cw = this.chipWidth(c, v.look[k])
      this.chip(c, k, right - cw, y, cw, chipH, v)
      right -= cw + 6 * s
    }
    this.chip(c, 0, 8 * s, y, this.chipWidth(c, v.look[0]), chipH, v)
    // the camera: arm 2, 30°
    const camW = 6 * s + 14 * s + 5 * s + this.camW + 7 * s
    this.box(c, 8 * s, 8 * s, camW, chipH)
    this.badge(c, 8 * s + 6 * s + 7 * s, 8 * s + chipH / 2, ENDOSCOPE_UI.hud.cameraArm, true)
    c.font = this.fontLabel
    c.textAlign = 'left'
    c.fillStyle = HUD_COLOURS.text
    c.fillText(ENDOSCOPE_UI.hud.camera, 8 * s + 6 * s + 14 * s + 5 * s, 8 * s + chipH / 2 + 0.5 * s)
    // "Simulated", top right
    const simW = this.simW + 12 * s
    this.box(c, this.w - 8 * s - simW, 8 * s, simW, 15 * s)
    c.font = this.fontSmall
    c.fillStyle = HUD_COLOURS.textDim
    c.fillText(ENDOSCOPE_UI.hud.simulated, this.w - 8 * s - simW + 6 * s, 8 * s + 7.5 * s + 0.5 * s)
    // "Exchanging", top middle, while an instrument is changed
    if (v.exchanging >= 0) {
      const ew = this.exW + 22 * s
      const ex = (this.w - ew) / 2
      this.box(c, ex, 8 * s, ew, 15 * s)
      c.strokeStyle = HUD_COLOURS.exchange
      c.lineWidth = Math.max(1, 1.1 * s)
      // two arrows, out and in
      const ay = 8 * s + 7.5 * s
      c.beginPath()
      c.moveTo(ex + 5 * s, ay - 2.5 * s)
      c.lineTo(ex + 11 * s, ay - 2.5 * s)
      c.lineTo(ex + 9 * s, ay - 4.5 * s)
      c.moveTo(ex + 11 * s, ay + 2.5 * s)
      c.lineTo(ex + 5 * s, ay + 2.5 * s)
      c.lineTo(ex + 7 * s, ay + 4.5 * s)
      c.stroke()
      c.fillStyle = HUD_COLOURS.exchange
      c.fillText(ENDOSCOPE_UI.hud.exchanging, ex + 15 * s, ay + 0.5 * s)
    }
  }

  private chipWidth(c: Ctx2D, look: number): number {
    const s = this.s
    const label = look >= 0 ? this.widthOfLook(c, look) : 6 * s
    const pedal = look >= 0 && LOOKS[look].energy !== ENERGY.none ? 15 * s : 0
    return 6 * s + 14 * s + 5 * s + label + pedal + 7 * s
  }

  private box(c: Ctx2D, x: number, y: number, w: number, h: number): void {
    roundRect(c, x, y, w, h, Math.min(h / 2, 5 * this.s))
    c.fillStyle = HUD_COLOURS.chip
    c.fill()
    c.strokeStyle = HUD_COLOURS.chipEdge
    c.lineWidth = Math.max(1, 0.8 * this.s)
    c.stroke()
  }

  private badge(c: Ctx2D, x: number, y: number, label: string, on: boolean): void {
    c.beginPath()
    c.arc(x, y, 6.6 * this.s, 0, Math.PI * 2)
    c.fillStyle = on ? HUD_COLOURS.badge : HUD_COLOURS.badgeDim
    c.fill()
    c.font = this.fontBadge
    c.textAlign = 'center'
    c.fillStyle = HUD_COLOURS.text
    c.fillText(label, x, y + 0.5 * this.s)
  }

  private chip(c: Ctx2D, k: number, x: number, y: number, w: number, h: number, v: EndoView): void {
    const s = this.s
    const look = v.look[k]
    const live = look >= 0 && v.withdraw[k] < 0.5 && v.exchanging !== k
    this.box(c, x, y, w, h)
    this.badge(c, x + 6 * s + 7 * s, y + h / 2, ARM_LABEL[k], live)
    c.font = this.fontLabel
    c.textAlign = 'left'
    c.fillStyle = live ? HUD_COLOURS.text : HUD_COLOURS.textDim
    const tx = x + 6 * s + 14 * s + 5 * s
    if (look < 0) {
      c.fillText('–', tx, y + h / 2 + 0.5 * s)
      return
    }
    c.fillText(LOOKS[look].short, tx, y + h / 2 + 0.5 * s)
    const energy = LOOKS[look].energy
    if (energy === ENERGY.none) return
    // the pedal: a small rounded plate, lit while the pedal is down
    const px = tx + this.widthOfLook(c, look) + 5 * s
    const py = y + h / 2 - 3.5 * s
    roundRect(c, px, py, 10 * s, 7 * s, 2 * s)
    const colour = energy === ENERGY.bipolar ? HUD_COLOURS.bipolar : HUD_COLOURS.monopolar
    if (v.energy[k] > 0.5) {
      c.fillStyle = colour
      c.fill()
    } else {
      c.strokeStyle = HUD_COLOURS.pedalOff
      c.lineWidth = Math.max(1, 0.9 * s)
      c.stroke()
      c.strokeStyle = colour
      c.beginPath()
      c.moveTo(px + 2.5 * s, py + 5 * s)
      c.lineTo(px + 7.5 * s, py + 5 * s)
      c.stroke()
    }
  }
}
