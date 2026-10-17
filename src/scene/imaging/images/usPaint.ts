/**
 * Draws one ultrasound frame: the sector fan with near-field layers, the structures of `usScene` at their echo level, posterior
 * enhancement and shadows, moving speckle (a wrapped noise tile slid over the picture), depth attenuation and the ruler.
 * About 25 canvas calls plus a dozen tile blits: well under a millisecond, so it can run at 10 Hz in the focused room.
 */
import type { Ctx2D, Surface } from './ctx'
import { grey } from './ctx'
import { blitTile } from './paint'
import { US_APEX_Y, US_HALF_ANGLE, type UsScene } from './ultrasound'

/** The fan's depth reaches this fraction of the picture height. */
export const US_BOTTOM = 0.94

export function paintUltrasound(t: Ctx2D, S: number, scene: UsScene, speckle: Surface, fine: Surface, time: number, phase: number, live: boolean): void {
  t.setTransform(1, 0, 0, 1, 0, 0)
  t.globalAlpha = 1
  t.globalCompositeOperation = 'source-over'
  t.fillStyle = '#020304'
  t.fillRect(0, 0, S, S)

  const ax = S / 2
  const ay = US_APEX_Y * S
  const R = (US_BOTTOM - US_APEX_Y) * S
  t.save()
  t.beginPath()
  t.moveTo(ax, ay)
  t.arc(ax, ay, R, Math.PI / 2 - US_HALF_ANGLE, Math.PI / 2 + US_HALF_ANGLE)
  t.closePath()
  t.clip()

  // soft tissue under the skin: a darker near field with bright layer interfaces, then the general level
  t.fillStyle = grey(0.2)
  t.fillRect(0, ay, S, R + 2)
  t.fillStyle = grey(0.1)
  t.fillRect(0, ay, S, 0.07 * S)
  t.strokeStyle = grey(0.9)
  t.lineWidth = 1.6
  t.globalAlpha = 0.85
  for (const f of [0.012, 0.075, 0.108]) {
    t.beginPath()
    t.arc(ax, ay, f * S, Math.PI / 2 - US_HALF_ANGLE, Math.PI / 2 + US_HALF_ANGLE)
    t.stroke()
    t.globalAlpha = 0.45
  }
  t.globalAlpha = 1

  // the structures, in order: body first, then what lies in it
  for (let i = 0; i < scene.count; i++) {
    const b = scene.blobs[i]
    if (b.rx <= 0.001 || b.ry <= 0.001) continue
    t.fillStyle = grey(0.04 + b.echo * 0.78)
    t.beginPath()
    t.ellipse(ax + b.cx * S, b.cy * S, b.rx * S, b.ry * S, b.rot, 0, Math.PI * 2)
    t.fill()
    if (b.wall > 0) {
      t.strokeStyle = grey(0.95)
      t.lineWidth = 1.3
      t.globalAlpha = b.wall
      t.stroke()
      t.globalAlpha = 1
    }
  }
  // enhancement behind fluid, shadow behind stones: vertical bands below the structure
  for (let i = 0; i < scene.count; i++) {
    const b = scene.blobs[i]
    if (b.behind === 0 || b.rx <= 0.001) continue
    const x0 = ax + (b.cx - b.rx * 0.9) * S
    const y0 = (b.cy + b.ry) * S
    const w = b.rx * 1.8 * S
    if (b.behind > 0) {
      t.globalCompositeOperation = 'lighter'
      t.fillStyle = grey(0.2 * b.behind)
      t.fillRect(x0, y0, w, (US_BOTTOM - b.cy - b.ry) * S)
    } else {
      t.globalCompositeOperation = 'multiply'
      t.fillStyle = grey(0.18)
      t.fillRect(x0, y0, w, (US_BOTTOM - b.cy - b.ry) * S)
    }
    t.globalCompositeOperation = 'source-over'
  }

  // speckle: slides with the probe, so it looks like grains that belong to the tissue
  t.globalCompositeOperation = 'overlay'
  t.globalAlpha = 0.8
  blitTile(t, speckle, S, phase * S * 0.35 + 7, time * 0.4 + 11, 1.6)
  t.globalCompositeOperation = 'soft-light'
  t.globalAlpha = 0.35
  blitTile(t, fine, S, phase * S * 0.35 * 1.3 + 91, time * 0.4 * 1.2 + 3, 1.3)
  t.globalCompositeOperation = 'lighter'
  t.globalAlpha = 0.035
  blitTile(t, fine, S, 130 + phase * 40, 55)
  // depth attenuation (gain compensation leaves the far field a little dimmer)
  const g = t.createLinearGradient(0, ay, 0, ay + R)
  g.addColorStop(0, 'rgb(255,255,255)')
  g.addColorStop(1, 'rgb(120,120,120)')
  t.globalCompositeOperation = 'multiply'
  t.globalAlpha = 1
  t.fillStyle = g
  t.fillRect(0, ay, S, R + 2)
  t.globalCompositeOperation = 'source-over'
  t.restore()

  // the fan's edges and the depth ruler
  t.strokeStyle = grey(0.35)
  t.lineWidth = 1
  t.beginPath()
  t.moveTo(ax, ay)
  t.lineTo(ax + Math.sin(US_HALF_ANGLE) * R, ay + Math.cos(US_HALF_ANGLE) * R)
  t.moveTo(ax, ay)
  t.lineTo(ax - Math.sin(US_HALF_ANGLE) * R, ay + Math.cos(US_HALF_ANGLE) * R)
  t.stroke()
  t.fillStyle = grey(0.8)
  t.strokeStyle = grey(0.8)
  t.font = '9px ui-monospace, Menlo, monospace'
  t.textAlign = 'right'
  t.textBaseline = 'middle'
  for (let cm = 1; cm <= scene.depthCm; cm++) {
    const y = ay + (cm / scene.depthCm) * R
    const major = cm % 2 === 0
    t.beginPath()
    t.moveTo(S - 4, y)
    t.lineTo(S - (major ? 12 : 8), y)
    t.stroke()
    if (major) t.fillText(String(cm), S - 15, y)
  }
  t.textAlign = 'left'
  t.textBaseline = 'alphabetic'
  void live
}
