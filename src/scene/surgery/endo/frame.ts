/**
 * R3 (endoscope): the per-frame compositor. Every call here runs at up to 10-12 Hz on the canvas of a picture and allocates nothing: no gradients, no
 * strings, no arrays, no closures. It cuts rectangles out of canvases baked at load (the plates, the sprite atlas, the vignette) under `setTransform`.
 *
 *   plate        the window of the procedure's plate the camera sees (view.ts cameraPose: pan, zoom, breathing), stretched over the whole 16:9 picture.
 *   wet          the plate's specular layer added on top ('lighter') through a window that moves a little MORE than the tissue: the highlights slide.
 *   tent         where a grasper has closed on tissue, the tissue's folds pulled toward its jaws.
 *   instruments  per tool: its soft shadow, the carbon shaft in segments that narrow toward the wrist (perspective), the steel collar, the wrist, the
 *                tip cover, the jaws turned about their pivot (the lower one mirrored), a needle and its suture, a clip, a hook or a suction tip, and the
 *                energy glint at the tip. A withdrawn tool slides back out along its own shaft.
 *   light        the vignette: the lamp's falloff toward the rim and the corners.
 *
 * Frame units: the picture's half-height is 1, x right, y down, (0, 0) the middle. A tool's shaft comes in from its port's side (RIG, off the picture's
 * edge) toward its wrist; the tip moves with the same seeded `tipMotion` as the 3D arm (robotPose.ts), so the screen and the arms stay in step.
 */
import type { Ctx2D } from '@/scene/imaging/images/ctx'
import { h01, tipMotion, type TipMotion } from '../robotPose'
import { PLATE_ASPECT } from './anatomy'
import { smooth } from './field'
import { ENERGY, LOOKS, type Look } from './looks'
import type { EndoPlate } from './plates'
import { COLLAR_AT, endoSprites, JAW_RECTS, SPRITE, type Rect } from './sprites'
import { cameraPose, INSTRUMENT_ARMS, REST_HALF, type CameraPose, type EndoView } from './view'

/** One instrument on the picture, in frame units: where its shaft enters (off the picture), its wrist, the shaft's direction, the jaws 0 closed .. 1 open, the wrist's bend (radians), and its size (the camera's zoom). */
export interface TipOnScreen {
  ex: number
  ey: number
  x: number
  y: number
  dx: number
  dy: number
  jaw: number
  bend: number
  scale: number
}

export const newTip = (): TipOnScreen => ({ ex: 0, ey: 0, x: 0, y: 0, dx: 1, dy: 0, jaw: 0, bend: 0, scale: 1 })

/** Where each slot's shaft enters and where its wrist rests (frame units, before the camera): arm 1 from the lower left, arm 3 from the right, arm 4 from the upper right. */
export const RIG: readonly { ex: number; ey: number; x: number; y: number }[] = [
  { ex: -2.15, ey: 1.15, x: -0.6, y: 0.2 },
  { ex: 2.15, ey: 1.0, x: 0.55, y: 0.12 },
  { ex: 1.75, ey: -1.5, x: 0.95, y: -0.42 },
]

/** Sizes in frame units: the shaft's half-width at the picture's edge and at the wrist, the wrist's length, the drop shadow's offset. */
export const TOOL = { shaftEdge: 0.22, shaftWrist: 0.105, wrist: 0.27, collar: 0.14, shadowX: 0.07, shadowY: 0.11 } as const

const _m: TipMotion = { insert: 0, pitch: 0, yaw: 0, jaw: 0, roll: 0 }
const _cam: CameraPose = { cx: 0, cy: 0, hh: REST_HALF, breath: 0 }

/** Where slot `k` (arms 1, 3, 4) has its tool on the picture: its rest place moved by the arm's tip motion, withdrawn by `view.withdraw[k]`, seen through the camera. Writes into `out`. */
export function tipOnScreen(k: number, v: EndoView, out: TipOnScreen): TipOnScreen {
  const r = RIG[k]
  const m = tipMotion(INSTRUMENT_ARMS[k], v.t, v.seed, _m)
  const g = v.gain
  let dx = r.x - r.ex
  let dy = r.y - r.ey
  const len = Math.sqrt(dx * dx + dy * dy)
  dx /= len
  dy /= len
  // the insertion slides the tip along the shaft (2.5 cm of the arm is about 0.12 of the picture), pitch and yaw swing it
  const push = m.insert * 5 * g
  let x = r.x + dx * push + m.yaw * 2.4 * g
  let y = r.y + dy * push + m.pitch * 2.4 * g
  // a withdrawn tool goes back along its shaft, past the picture's edge
  const w = v.withdraw[k]
  if (w > 0) {
    const sx = x - r.ex
    const sy = y - r.ey
    const sl = Math.sqrt(sx * sx + sy * sy)
    const back = smooth(0, 1, w) * (sl + 0.75)
    x -= (sx / sl) * back
    y -= (sy / sl) * back
  }
  // the camera: the window's zoom and pan (the ports ride the same breathing belly as the tissue)
  cameraPose(v, _cam)
  const zr = REST_HALF / _cam.hh
  const ox = (_cam.cx - PLATE_ASPECT / 2) / _cam.hh
  const oy = (_cam.cy - 0.5) / _cam.hh
  out.ex = r.ex * zr - ox
  out.ey = r.ey * zr - oy
  out.x = x * zr - ox
  out.y = y * zr - oy
  const ax = out.x - out.ex
  const ay = out.y - out.ey
  const al = Math.sqrt(ax * ax + ay * ay)
  out.dx = ax / al
  out.dy = ay / al
  out.jaw = 0.3 + (m.jaw - 0.3) * g
  out.bend = 0.45 * m.roll * g
  out.scale = zr
  return out
}

// ---------------------------------------------------------------------------------------------
// The tissue
// ---------------------------------------------------------------------------------------------

/** How much more the wet highlights move than the tissue under them. */
export const PARALLAX = 0.7

/** The plate's window over the whole picture, then its wet highlights added through a window that leads the camera a little. */
export function drawTissue(c: Ctx2D, w: number, h: number, plate: EndoPlate, cam: CameraPose): void {
  const P = plate.h
  const hh = cam.hh
  const hw = hh * PLATE_ASPECT
  const sw = 2 * hw * P
  const sh = 2 * hh * P
  const sx = clampTo((cam.cx - hw) * P, 0, plate.w - sw)
  const sy = clampTo((cam.cy - hh) * P, 0, plate.h - sh)
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.globalAlpha = 1
  c.globalCompositeOperation = 'source-over'
  c.drawImage(plate.plate.canvas, sx, sy, sw, sh, 0, 0, w, h)
  const lx = clampTo(sx + (cam.cx - PLATE_ASPECT / 2) * PARALLAX * P, 0, plate.w - sw)
  const ly = clampTo(sy + ((cam.cy - 0.5) * PARALLAX + cam.breath * 0.004) * P, 0, plate.h - sh)
  c.globalCompositeOperation = 'lighter'
  c.globalAlpha = 0.85
  c.drawImage(plate.spec.canvas, lx, ly, sw, sh, 0, 0, w, h)
  c.globalCompositeOperation = 'source-over'
  c.globalAlpha = 1
}

/** Before the plates are baked: a plain warm field. */
export function drawPlainField(c: Ctx2D, w: number, h: number): void {
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.globalAlpha = 1
  c.globalCompositeOperation = 'source-over'
  c.fillStyle = '#6b4a3e'
  c.fillRect(0, 0, w, h)
}

function clampTo(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

// ---------------------------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------------------------

/** Draw `rect` of the atlas (less its 2 px margin) into the local rectangle (x, y, w, h) of the current transform. */
function sprite(c: Ctx2D, atlas: CanvasImageSource, r: Rect, x: number, y: number, w: number, h: number): void {
  c.drawImage(atlas, r.x + 2, r.y + 2, r.w - 4, r.h - 4, x, y, w, h)
}

/** A part of a sprite: u0..u1 of its width. */
function spritePart(c: Ctx2D, atlas: CanvasImageSource, r: Rect, u0: number, u1: number, x: number, y: number, w: number, h: number): void {
  const iw = r.w - 4
  c.drawImage(atlas, r.x + 2 + iw * u0, r.y + 2, iw * (u1 - u0), r.h - 4, x, y, w, h)
}

/** Point the current transform along (ux, uy) from (ox, oy), `s` pixels per local unit; `flip` mirrors the local y. */
function basis(c: Ctx2D, ox: number, oy: number, ux: number, uy: number, s: number, flip: boolean): void {
  const f = flip ? -s : s
  c.setTransform(ux * s, uy * s, -uy * f, ux * f, ox, oy)
}

const SEGMENTS = 6

/** The shaft from the entry to the wrist, in segments that narrow toward the wrist, ending in the steel collar. `shadow` draws its drop shadow instead. */
function drawShaft(c: Ctx2D, atlas: CanvasImageSource, w: number, h: number, t: TipOnScreen, shadow: boolean): void {
  const U = h / 2
  const s = t.scale
  const ox = shadow ? TOOL.shadowX * U * s : 0
  const oy = shadow ? TOOL.shadowY * U * s : 0
  const ex = w / 2 + t.ex * U + ox
  const ey = h / 2 + t.ey * U + oy
  const tx = w / 2 + t.x * U + ox
  const ty = h / 2 + t.y * U + oy
  const lx = tx - ex
  const ly = ty - ey
  const L = Math.sqrt(lx * lx + ly * ly)
  if (shadow) {
    // one soft quad, as wide as the shaft's middle: a blur has no taper to show
    const half = (TOOL.shaftEdge + TOOL.shaftWrist) * 0.5 * U * s * 1.4
    c.setTransform(t.dx * L, t.dy * L, -t.dy * 2 * half, t.dx * 2 * half, ex, ey)
    sprite(c, atlas, SPRITE.shadow, 0, -0.5, 1, 1)
    return
  }
  const collar = TOOL.collar * U * s
  const body = L - collar
  const seg = body / SEGMENTS
  for (let i = 0; i < SEGMENTS; i++) {
    const a = i / SEGMENTS
    const mid = (i + 0.5) / SEGMENTS
    const half = (TOOL.shaftEdge + (TOOL.shaftWrist - TOOL.shaftEdge) * ((mid * body) / L)) * U * s
    c.setTransform(t.dx * (seg + 1), t.dy * (seg + 1), -t.dy * 2 * half, t.dx * 2 * half, ex + t.dx * body * a, ey + t.dy * body * a)
    spritePart(c, atlas, SPRITE.shaft, a * COLLAR_AT, (a + 1 / SEGMENTS) * COLLAR_AT, 0, -0.5, 1, 1)
  }
  const half = TOOL.shaftWrist * U * s
  c.setTransform(t.dx * collar, t.dy * collar, -t.dy * 2 * half, t.dx * 2 * half, ex + t.dx * body, ey + t.dy * body)
  spritePart(c, atlas, SPRITE.shaft, COLLAR_AT, 1, 0, -0.5, 1, 1)
}

/** The tissue tenting under a grasper that has closed: its folds pulled toward the jaws' tip, `grip` 0..1. */
export function drawTent(c: Ctx2D, w: number, h: number, t: TipOnScreen, look: Look, grip: number): void {
  const atlas = endoSprites.atlas
  if (!atlas || grip <= 0.01) return
  const U = h / 2
  const s = t.scale * U
  const cb = Math.cos(t.bend)
  const sb = Math.sin(t.bend)
  const hx = t.dx * cb - t.dy * sb
  const hy = t.dx * sb + t.dy * cb
  const reach = TOOL.wrist + look.jawLen * 0.9
  basis(c, w / 2 + t.x * U + hx * reach * s, h / 2 + t.y * U + hy * reach * s, hx, hy, s, false)
  c.globalAlpha = grip
  sprite(c, atlas.canvas, SPRITE.tent, -0.6, -0.22, 0.62, 0.44)
  c.globalAlpha = 1
}

/** One instrument, shadow excluded (drawShadows draws all of them first). `energy` lights the glint; `flicker` 0..1 varies it. */
export function drawInstrument(c: Ctx2D, w: number, h: number, t: TipOnScreen, look: Look, energy: number, flicker: number): void {
  const sp = endoSprites.atlas
  if (!sp) return
  const atlas = sp.canvas
  drawShaft(c, atlas, w, h, t, false)
  const U = h / 2
  const s = t.scale * U
  const wx = w / 2 + t.x * U
  const wy = h / 2 + t.y * U
  // the head turns at the wrist by the bend
  const cb = Math.cos(t.bend)
  const sb = Math.sin(t.bend)
  const hx = t.dx * cb - t.dy * sb
  const hy = t.dx * sb + t.dy * cb
  const ww = TOOL.shaftWrist
  if (look.tip === 'suction') {
    basis(c, wx, wy, hx, hy, s, false)
    sprite(c, atlas, SPRITE.suction, 0, -ww, look.jawLen, 2 * ww)
    glint(c, atlas, wx + hx * look.jawLen * s, wy + hy * look.jawLen * s, s, 0, 0)
    return
  }
  basis(c, wx, wy, hx, hy, s, false)
  sprite(c, atlas, look.wrist === 'dark' ? SPRITE.wristDark : SPRITE.wristSteel, 0, -ww, TOOL.wrist, 2 * ww)
  if (look.tipCover) sprite(c, atlas, SPRITE.tipCover, -0.03, -ww * 1.18, TOOL.wrist + 0.035, 2 * ww * 1.18)
  // the pivot, at the wrist's end
  const px = wx + hx * TOOL.wrist * s
  const py = wy + hy * TOOL.wrist * s
  const L = look.jawLen
  if (look.tip === 'hook') {
    basis(c, px, py, hx, hy, s, false)
    sprite(c, atlas, SPRITE.hook, 0, -L * 0.18, L, L * 0.355)
    glint(c, atlas, px + hx * L * 0.88 * s, py + hy * L * 0.88 * s, s, energy, flicker)
    return
  }
  if (look.jaw < 0) return
  const jr = JAW_RECTS[look.jaw]
  const open = 0.04 + t.jaw * look.open
  const co = Math.cos(open)
  const so = Math.sin(open)
  // the jaws' height on screen is the sprite's 0.28 of their length
  const jh = L * 0.28
  // the lower jaw (mirrored), then what it holds, then the upper jaw
  basis(c, px, py, hx * co + hy * so, hy * co - hx * so, s, true)
  sprite(c, atlas, jr, 0, -jh, L, jh)
  if (look.holds === 'clip') {
    basis(c, px, py, hx, hy, s, false)
    sprite(c, atlas, SPRITE.clip, L * 0.25, -L * 0.17, L * 0.68, L * 0.34)
  }
  basis(c, px, py, hx * co - hy * so, hy * co + hx * so, s, false)
  sprite(c, atlas, jr, 0, -jh, L, jh)
  if (look.holds === 'needle') needle(c, atlas, px, py, hx, hy, s, L)
  if (look.energy !== ENERGY.none) glint(c, atlas, px + hx * L * 0.92 * s, py + hy * L * 0.92 * s, s, energy, flicker)
}

/** A curved needle held across the jaws near their tip, and its violet suture trailing off. */
function needle(c: Ctx2D, atlas: CanvasImageSource, px: number, py: number, hx: number, hy: number, s: number, L: number): void {
  // the needle's frame: across the jaws (its x along the jaws' normal), centred a little before the tip
  const cx = px + hx * L * 0.68 * s
  const cy = py + hy * L * 0.68 * s
  basis(c, cx, cy, -hy, hx, s, false)
  sprite(c, atlas, SPRITE.needle, -0.17, -0.21, 0.34, 0.34)
  // the suture from the swaged end (the needle's left end in its frame), sagging back past the wrist
  const sx = cx - hy * 0.122 * s
  const sy = cy + hx * 0.122 * s
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.strokeStyle = SUTURE
  c.lineWidth = Math.max(1, s * 0.012)
  c.lineCap = 'round'
  c.beginPath()
  c.moveTo(sx, sy)
  c.quadraticCurveTo(sx - hx * 0.35 * s + hy * 0.05 * s, sy - hy * 0.35 * s + 0.3 * s, sx - hx * 0.75 * s, sy - hy * 0.75 * s + 0.22 * s)
  c.stroke()
}

/** The suture's colour: a dyed violet. */
export const SUTURE = '#6c5fb4'

/** The energy glint at (x, y): a small bright star, `energy` 0..1. */
function glint(c: Ctx2D, atlas: CanvasImageSource, x: number, y: number, s: number, energy: number, flicker: number): void {
  if (energy <= 0.01) return
  const size = s * (0.16 + 0.08 * flicker)
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.globalCompositeOperation = 'lighter'
  c.globalAlpha = energy * (0.65 + 0.35 * flicker)
  sprite(c, atlas, SPRITE.glint, x - size / 2, y - size / 2, size, size)
  c.globalAlpha = 1
  c.globalCompositeOperation = 'source-over'
}

/** All the tools' drop shadows, softly, before any tool. */
export function drawShadows(c: Ctx2D, w: number, h: number, tips: readonly TipOnScreen[], v: EndoView): void {
  const sp = endoSprites.atlas
  if (!sp) return
  c.globalAlpha = 0.42
  for (let k = 0; k < tips.length; k++) {
    const look = v.look[k]
    if (look < 0 || !LOOKS[look].drawn || v.withdraw[k] > 0.995) continue
    drawShaft(c, sp.canvas, w, h, tips[k], true)
  }
  c.globalAlpha = 1
}

/** The glint's flicker for slot `k` at `t`: a seeded 20 Hz shimmer, 0..1. */
export function flickerAt(k: number, seed: number, t: number): number {
  return h01(seed, Math.floor(t * 20), 90 + k)
}

/** The light's falloff over the whole picture. */
export function drawLight(c: Ctx2D, w: number, h: number): void {
  const vg = endoSprites.vignette
  c.setTransform(1, 0, 0, 1, 0, 0)
  if (vg) c.drawImage(vg.canvas, 0, 0, w, h)
}
