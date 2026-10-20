/**
 * R3 (endoscope): the instrument sprites, shaded per pixel (pure arithmetic, like the plates: the node tests read the pixels) and put into ONE atlas canvas
 * once per page, plus the light's falloff (a vignette canvas). The per-frame compositor (frame.ts) only cuts rectangles out of them with `drawImage` under a
 * `setTransform`, so a frame creates no gradients and allocates nothing.
 *
 *   shaft      the 8 mm instrument shaft: matte carbon black, a long soft sheen and a sharp line of light, a faint weave; its last eighth is the steel
 *              collar where the wrist starts. Drawn in segments that narrow toward the wrist (perspective).
 *   shadow     a soft dark bar, drawn under each shaft, offset away from the lamp.
 *   wrist      the EndoWrist: a short cylinder with two cable pulleys and a clevis pin; brushed steel, or black (the bipolar and the hook).
 *   jaws       the upper jaw of each kind (the lower is the same sprite mirrored): fenestrated (a window and fine teeth), Cadiere (long, a paddle tip and a
 *              big window), Prograsp (window and coarse teeth), curved scissors (a polished curved blade), needle driver (short, a knurled carbide face),
 *              clip applier (a channel), sealer (broad, dark, a blade slot).
 *   tips       the monopolar hook (black insulation, a steel L), the suction tip (a steel tube with side holes).
 *   extras     a curved needle, a clip, the scissors' translucent amber tip cover, the energy glint (a small bright star), the tissue tent (light ridges
 *              and soft folds converging on the jaws).
 *
 * Steel reflects the warm tissue around it (pinkish highlights), as it does in a real endoscope picture; nothing is red (sprites.test.ts checks every
 * pixel against the no-blood tiers).
 */
import type { Env, Surface } from '@/scene/imaging/images/ctx'
import { clamp01, hash01, smooth } from './field'
import { JAW_KINDS, type JawKind } from './looks'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h })

/** The atlas: 1024 x 256, rows of sprites with a 2 px clear margin inside each rectangle. */
export const ATLAS_W = 1024
export const ATLAS_H = 256
export const SPRITE = {
  shaft: r(0, 0, 512, 64),
  shadow: r(512, 0, 128, 64),
  wristSteel: r(640, 0, 96, 64),
  wristDark: r(736, 0, 96, 64),
  suction: r(832, 0, 128, 64),
  hook: r(160, 112, 128, 48),
  clip: r(288, 112, 64, 48),
  needle: r(0, 160, 96, 96),
  tent: r(96, 160, 128, 96),
  glint: r(224, 160, 64, 64),
  tipCover: r(288, 160, 96, 72),
} as const
/** The jaw sprites by JAW_KINDS index: six along the second row, the sealer at the start of the third. */
export const JAW_RECTS: readonly Rect[] = JAW_KINDS.map((_, i) => (i < 6 ? r(i * 160, 64, 160, 48) : r(0, 112, 160, 48)))

/** Where the shaft sprite's steel collar starts (a fraction of its length). */
export const COLLAR_AT = 0.875
/** The vignette canvas. */
export const VIGNETTE_W = 384
export const VIGNETTE_H = 216

// ---------------------------------------------------------------------------------------------
// Shading
// ---------------------------------------------------------------------------------------------

/** A pixel being shaded: colour 0..255, alpha 0..1. */
interface Px {
  r: number
  g: number
  b: number
  a: number
}

const LX = -0.15
const LY = -0.3
const LZ = 0.94
/** Half vector of the lamp and the view (the view looks down -z). */
const HX = LX / 2
const HY = LY / 2
const HZ = (LZ + 1) / 2
const HL = Math.hypot(HX, HY, HZ)

function spec(nx: number, ny: number, nz: number, p: number): number {
  const d = (nx * HX + ny * HY + nz * HZ) / HL
  return d > 0 ? Math.pow(d, p) : 0
}

function diffuse(nx: number, ny: number, nz: number): number {
  const d = nx * LX + ny * LY + nz * LZ
  return d > 0 ? d : 0
}

/** Polished or brushed steel: its own grey lit by the lamp, the warm tissue reflected in it (lighter where the normal looks up), a white highlight. */
function steel(nx: number, ny: number, nz: number, tone: number, out: Px): void {
  const up = 0.5 - 0.5 * ny
  const env = 0.35 + 0.65 * up
  const d = diffuse(nx, ny, nz)
  const s = spec(nx, ny, nz, 50) * 0.9 + spec(nx, ny, nz, 8) * 0.12
  const fres = 0.55 + 0.45 * (1 - nz)
  out.r = tone * (46 + 58 * d) + fres * env * 104 + s * 240
  out.g = tone * (49 + 60 * d) + fres * env * 82 + s * 236
  out.b = tone * (53 + 64 * d) + fres * env * 76 + s * 232
}

/** Matte carbon black or black anodised metal: dark, a soft sheen and a sharp line of light, a little warm reflection. */
function dark(nx: number, ny: number, nz: number, gloss: number, out: Px): void {
  const d = diffuse(nx, ny, nz)
  const s = spec(nx, ny, nz, 40) * 0.42 * gloss + spec(nx, ny, nz, 5) * 0.1
  const env = (0.5 - 0.5 * ny) * 0.12
  out.r = 16 + 22 * d + env * 150 + s * 255
  out.g = 17 + 23 * d + env * 112 + s * 252
  out.b = 19 + 25 * d + env * 104 + s * 248
}

// ---------------------------------------------------------------------------------------------
// Rasterising: every sprite is a function of its own local coordinates
// ---------------------------------------------------------------------------------------------

/** Fill `rect` of an RGBA buffer (atlas width `W`) pixel by pixel: `f(u, v, px, out)` with u, v in 0..1 over the rectangle less its 2 px margin. */
function raster(buf: Uint8ClampedArray, W: number, rect: Rect, f: (u: number, v: number, px: number, out: Px) => void): void {
  const out: Px = { r: 0, g: 0, b: 0, a: 0 }
  const iw = rect.w - 4
  const ih = rect.h - 4
  for (let j = 0; j < ih; j++) {
    for (let i = 0; i < iw; i++) {
      out.r = 0
      out.g = 0
      out.b = 0
      out.a = 0
      f((i + 0.5) / iw, (j + 0.5) / ih, 1 / iw, out)
      const o = ((rect.y + 2 + j) * W + rect.x + 2 + i) * 4
      buf[o] = out.r
      buf[o + 1] = out.g
      buf[o + 2] = out.b
      buf[o + 3] = clamp01(out.a) * 255
    }
  }
}

/** Coverage of a signed distance (negative inside) at a pixel of size `px` (the same units). */
const cover = (d: number, px: number): number => clamp01(0.5 - d / px)

/** A cylinder across v (v 0..1 over the width; `edge` 0..0.5 the part left clear at each side): the normal's y and z, and the coverage. */
function cylinder(v: number, edge: number, pxV: number, out: { ny: number; nz: number; cov: number }): void {
  const half = 0.5 - edge
  const t = (v - 0.5) / half
  out.cov = cover(Math.abs(v - 0.5) - half, pxV)
  const tt = t < -1 ? -1 : t > 1 ? 1 : t
  out.ny = tt
  out.nz = Math.sqrt(Math.max(0, 1 - tt * tt))
}

const _cyl = { ny: 0, nz: 1, cov: 0 }

function shaftPx(u: number, v: number, px: number, out: Px): void {
  const pxV = px * (512 / 64)
  cylinder(v, 0.04, pxV, _cyl)
  out.a = _cyl.cov
  if (out.a <= 0) return
  if (u > COLLAR_AT) {
    // the steel collar, with a dark seam where it meets the carbon
    steel(0, _cyl.ny, _cyl.nz, 1, out)
    const seam = smooth(0.006, 0, Math.abs(u - COLLAR_AT - 0.008))
    out.r *= 1 - 0.7 * seam
    out.g *= 1 - 0.7 * seam
    out.b *= 1 - 0.7 * seam
    return
  }
  dark(0, _cyl.ny, _cyl.nz, 1, out)
}

function shadowPx(_u: number, v: number, _px: number, out: Px): void {
  const t = (v - 0.5) / 0.42
  out.a = 0.85 * Math.exp(-t * t * 2.6)
}

function wristPx(isDark: boolean): (u: number, v: number, px: number, out: Px) => void {
  return (u, v, px, out) => {
    const pxV = px * (96 / 64)
    // the profile: a little narrower than the shaft, waisted where the two links meet
    const waist = 0.08 * smooth(0.12, 0, Math.abs(u - 0.5))
    cylinder(v, 0.06 + waist, pxV, _cyl)
    out.a = _cyl.cov
    if (out.a <= 0) return
    if (isDark) dark(0, _cyl.ny, _cyl.nz, 1.3, out)
    else steel(0, _cyl.ny, _cyl.nz, 0.9, out)
    // two pulley grooves and the clevis pin
    const groove = smooth(0.02, 0, Math.abs(u - 0.3)) + smooth(0.02, 0, Math.abs(u - 0.7))
    const pinD = Math.hypot((u - 0.86) * 1.5, v - 0.5) - 0.11
    const pin = cover(pinD, pxV)
    const k = 1 - 0.55 * clamp01(groove)
    out.r = out.r * k
    out.g = out.g * k
    out.b = out.b * k
    if (pin > 0) {
      steel(0, (v - 0.5) * 3, 0.8, 1.1, _tmp)
      out.r += (_tmp.r - out.r) * pin
      out.g += (_tmp.g - out.g) * pin
      out.b += (_tmp.b - out.b) * pin
    }
  }
}
const _tmp: Px = { r: 0, g: 0, b: 0, a: 0 }

// ---------------------------------------------------------------------------------------------
// Jaws: u 0..1 from the hinge to the tip, v 0..1 from the closing face (v = 0, the sprite's bottom) to the back (the sprite's top is v = 1)
// ---------------------------------------------------------------------------------------------

/** The upper jaw of `kind` as a signed distance in jaw units (the length is 1, the sprite's height is 0.3 of it), negative inside. */
function jawSd(kind: JawKind, u: number, v: number): number {
  // v in jaw-length units, the closing face at 0
  switch (kind) {
    case 'scissors': {
      // a curved blade: its centre line bends up toward the tip, its back tapers to a point
      const c = 0.07 + 0.1 * u * u
      const half = 0.075 * (1 - u * 0.85)
      return Math.max(Math.abs(v - c) - half, u - 0.98, -u)
    }
    case 'needle': {
      const back = 0.22 - 0.05 * u
      return roundBox(u, v, 0.72, back)
    }
    case 'clip': {
      const back = 0.17 - 0.06 * u
      return roundBox(u, v, 0.95, back)
    }
    case 'sealer': {
      const back = 0.24 - 0.07 * u
      return roundBox(u, v, 0.96, back)
    }
    case 'cadiere': {
      // a long jaw with a paddle tip
      const back = 0.15 + 0.06 * smooth(0.5, 0.8, u)
      return roundBox(u, v, 0.97, back)
    }
    case 'prograsp': {
      const back = 0.2 - 0.08 * u
      return roundBox(u, v, 0.97, back)
    }
    default: {
      // fenestrated bipolar
      const back = 0.2 - 0.08 * u
      return roundBox(u, v, 0.96, back)
    }
  }
}

/** A jaw of length `len` whose back is at `back` (the closing face at 0), its tip a half round: the distance in jaw units. */
function roundBox(u: number, v: number, len: number, back: number): number {
  const rc = back / 2
  // a box from the hinge to the start of the round tip, united with the tip's circle
  const bx = Math.abs(u - (len - rc) / 2) - (len - rc) / 2
  const by = Math.abs(v - rc) - rc
  const box = Math.min(Math.max(bx, by), 0) + Math.hypot(Math.max(bx, 0), Math.max(by, 0))
  const tip = Math.hypot(u - (len - rc), v - rc) - rc
  return Math.min(box, tip)
}

/** The window of a fenestrated jaw (a hole), as a signed distance (negative inside the hole). */
function windowSd(kind: JawKind, u: number, v: number): number {
  if (kind === 'fenestrated') return Math.max(Math.abs(u - 0.5) - 0.24, Math.abs(v - 0.085) - 0.035)
  if (kind === 'cadiere') return Math.max(Math.abs(u - 0.62) - 0.22, Math.abs(v - 0.09) - 0.04)
  if (kind === 'prograsp') return Math.max(Math.abs(u - 0.48) - 0.2, Math.abs(v - 0.085) - 0.032)
  return 1
}

function jawPx(kind: JawKind): (u: number, v: number, px: number, out: Px) => void {
  const H = 0.3
  const e = 0.004
  return (u, vv, px, out) => {
    // the sprite's top is the jaw's back: v up from the bottom
    const v = (1 - vv) * H
    const d = Math.max(jawSd(kind, u, v), -windowSd(kind, u, v))
    out.a = cover(d, px)
    if (out.a <= 0) return
    // a bevel: the normal tilts toward the outside within a little of the rim (the distance's gradient)
    const gx = Math.max(jawSd(kind, u + e, v), -windowSd(kind, u + e, v)) - Math.max(jawSd(kind, u - e, v), -windowSd(kind, u - e, v))
    const gy = Math.max(jawSd(kind, u, v + e), -windowSd(kind, u, v + e)) - Math.max(jawSd(kind, u, v - e), -windowSd(kind, u, v - e))
    const gl = Math.hypot(gx, gy) || 1
    const rim = smooth(-0.022, 0, d)
    // the jaw is seen a little from its side, not face-on to the lamp: its face leans away (a darker, less blown-out steel), its rims catch the light
    const nx = (gx / gl) * rim * 0.85
    const ny = -(gy / gl) * rim * 0.85 + 0.38 * (1 - rim)
    const nz = Math.sqrt(Math.max(0.05, 1 - nx * nx - ny * ny))
    if (kind === 'sealer') dark(nx, ny, nz, 1.2, out)
    else steel(nx, ny, nz, kind === 'clip' ? 0.6 : 0.85, out)
    // the face: teeth, a knurl, a channel, a slot
    if (kind === 'needle') {
      const kn = Math.abs(Math.sin(u * 140 + v * 140)) < 0.25 || Math.abs(Math.sin(u * 140 - v * 140)) < 0.25
      if (v < 0.07 && kn) shadeBy(out, 0.55)
      if (v < 0.07) shadeBy(out, 0.82)
    } else if (kind === 'fenestrated' || kind === 'prograsp' || kind === 'cadiere') {
      const pitch = kind === 'prograsp' ? 34 : 60
      if (v < 0.018 && Math.sin(u * pitch * Math.PI) > 0.2) shadeBy(out, 0.5)
    } else if (kind === 'clip') {
      if (Math.abs(v - 0.035) < 0.012) shadeBy(out, 0.45)
    } else if (kind === 'sealer') {
      if (Math.abs(v - 0.06) < 0.006 && u > 0.1 && u < 0.85) shadeBy(out, 0.35)
    }
  }
}

function shadeBy(p: Px, k: number): void {
  p.r *= k
  p.g *= k
  p.b *= k
}

// ---------------------------------------------------------------------------------------------
// Tips and extras
// ---------------------------------------------------------------------------------------------

function hookPx(u: number, vv: number, px: number, out: Px): void {
  // local: u along 0..1 from the wrist, v up; black insulation to u = 0.45, then the steel wire, bent up into an L at the end
  const v = (0.5 - vv) * (48 / 128)
  const pxv = px
  const ins = Math.max(Math.abs(v) - 0.07 * (1 - 0.3 * u), u - 0.45)
  const wireA = Math.max(Math.abs(v) - 0.022, Math.max(u - 0.9, 0.42 - u))
  const wireB = Math.max(Math.abs(u - 0.88) - 0.022, Math.max(-v - 0.0, v - 0.15))
  const wire = Math.min(wireA, wireB)
  const ci = cover(ins, pxv)
  const cw = cover(wire, pxv)
  if (ci <= 0 && cw <= 0) return
  if (ci >= cw) {
    dark(0, -v / 0.07, Math.sqrt(Math.max(0, 1 - (v / 0.07) ** 2)), 1, out)
    out.a = ci
  } else {
    const across = wireA < wireB ? v / 0.022 : (u - 0.88) / 0.022
    steel(0, -Math.max(-1, Math.min(1, across)), Math.sqrt(Math.max(0, 1 - across * across)), 1.1, out)
    out.a = cw
  }
}

function suctionPx(u: number, v: number, px: number, out: Px): void {
  const pxV = px * (128 / 64)
  cylinder(v, 0.12, pxV, _cyl)
  out.a = _cyl.cov * cover(u - 0.97, px)
  if (out.a <= 0) return
  steel(0, _cyl.ny, _cyl.nz, 0.85, out)
  // side holes, and the open end
  for (let k = 0; k < 3; k++) {
    const hd = Math.hypot((u - (0.45 + k * 0.16)) * 2, v - 0.5) - 0.07
    if (hd < 0) shadeBy(out, 0.25 + 0.5 * clamp01(-hd / 0.02 > 1 ? 0 : 1))
  }
  if (u > 0.93) shadeBy(out, 0.6)
}

function needlePx(u: number, v: number, px: number, out: Px): void {
  // a curved needle: half a circle, thick at the swaged end (left) and pointed at the right
  const x = u - 0.5
  const y = v - 0.62
  const rad = Math.hypot(x, y)
  const ang = Math.atan2(y, x)
  if (ang > 0.05) return
  const t = clamp01((-ang) / Math.PI)
  const half = 0.03 * (1 - 0.85 * t) + 0.004
  const d = Math.abs(rad - 0.36) - half
  out.a = cover(d, px)
  if (out.a <= 0) return
  const across = (rad - 0.36) / half
  steel(Math.cos(ang) * across * 0.8, Math.sin(ang) * across * 0.8, Math.sqrt(Math.max(0.1, 1 - across * across * 0.64)), 1.2, out)
}

function clipPx(u: number, v: number, px: number, out: Px): void {
  // a V-shaped titanium clip seen from the side: two legs from a rounded crown at the left
  const x = u
  const y = v - 0.5
  const legA = distSeg(x, y, 0.1, 0, 0.92, -0.2) - 0.05
  const legB = distSeg(x, y, 0.1, 0, 0.92, 0.2) - 0.05
  const d = Math.min(legA, legB)
  out.a = cover(d, px)
  if (out.a <= 0) return
  steel(0, legA < legB ? -0.3 : 0.3, 0.9, 1.25, out)
}

function distSeg(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const ex = bx - ax
  const ey = by - ay
  const k = clamp01(((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey))
  return Math.hypot(x - ax - ex * k, y - ay - ey * k)
}

function tipCoverPx(u: number, v: number, px: number, out: Px): void {
  // a translucent amber sleeve over the wrist: a cylinder with a rounded front edge
  const pxV = px * (96 / 72)
  cylinder(v, 0.03, pxV, _cyl)
  const front = cover(u - 0.94 + 0.04 * (1 - _cyl.nz), px)
  out.a = _cyl.cov * front * (0.42 + 0.3 * (1 - _cyl.nz))
  if (out.a <= 0) return
  const s = spec(0, _cyl.ny, _cyl.nz, 30)
  out.r = 222 + s * 33
  out.g = 168 + s * 80
  out.b = 108 + s * 140
  out.a = Math.min(1, out.a + s * 0.5)
}

function glintPx(u: number, v: number, _px: number, out: Px): void {
  const x = (u - 0.5) * 2
  const y = (v - 0.5) * 2
  const r2 = x * x + y * y
  const core = Math.exp(-r2 * 26)
  const halo = Math.exp(-r2 * 5) * 0.35
  const rays = (Math.exp(-y * y * 900) * Math.exp(-x * x * 3) + Math.exp(-x * x * 900) * Math.exp(-y * y * 3)) * 0.6
  out.r = 255
  out.g = 255
  out.b = 255
  out.a = Math.min(1, core + halo + rays)
}

function tentPx(u: number, v: number, _px: number, out: Px): void {
  // the apex (where the jaws hold the tissue) at the right middle; folds radiate back from it, fading with distance
  const x = 1 - u
  const y = (v - 0.5) * 0.75
  const dist = Math.hypot(x, y)
  const ang = Math.atan2(y, x + 0.04)
  const fade = smooth(1, 0.15, dist) * smooth(0, 0.06, dist)
  const folds = Math.sin(ang * 7 + 0.6 * hash01(3, 0, 0)) * 0.7 + Math.sin(ang * 3.1 + 1.3) * 0.3
  const light = smooth(0.45, 1, folds) * smooth(0.9, 0.2, Math.abs(ang))
  const shadow = smooth(-0.3, -1, folds) * smooth(1.1, 0.3, Math.abs(ang))
  // a bright sheen on the ridges, soft shade in the troughs, and a little pull-shadow just behind the apex
  const pull = smooth(0.35, 0, dist) * 0.25
  if (light > shadow) {
    out.r = 255
    out.g = 246
    out.b = 238
    out.a = light * 0.26 * fade
  } else {
    out.r = 40
    out.g = 26
    out.b = 24
    out.a = (shadow * 0.22 + pull) * fade
  }
}

/** The light's falloff over the picture: black, transparent in the lit middle, darker toward the rim and darkest in the corners. */
function vignettePx(u: number, v: number, _px: number, out: Px): void {
  const x = (u - 0.5) * 2 * (16 / 9)
  const y = (v - 0.5) * 2 + 0.08
  const r2 = (x * x) / 2.2 + y * y * 1.05
  const fall = smooth(0.12, 2.7, r2)
  out.a = Math.min(0.95, fall * 0.92)
}

// ---------------------------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------------------------

/** The atlas's pixels (RGBA, ATLAS_W x ATLAS_H). Pure: the same every time. */
export function atlasPixels(): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(ATLAS_W * ATLAS_H * 4)
  raster(buf, ATLAS_W, SPRITE.shaft, shaftPx)
  raster(buf, ATLAS_W, SPRITE.shadow, shadowPx)
  raster(buf, ATLAS_W, SPRITE.wristSteel, wristPx(false))
  raster(buf, ATLAS_W, SPRITE.wristDark, wristPx(true))
  raster(buf, ATLAS_W, SPRITE.suction, suctionPx)
  raster(buf, ATLAS_W, SPRITE.hook, hookPx)
  raster(buf, ATLAS_W, SPRITE.clip, clipPx)
  raster(buf, ATLAS_W, SPRITE.needle, needlePx)
  raster(buf, ATLAS_W, SPRITE.tent, tentPx)
  raster(buf, ATLAS_W, SPRITE.glint, glintPx)
  raster(buf, ATLAS_W, SPRITE.tipCover, tipCoverPx)
  JAW_KINDS.forEach((k, i) => raster(buf, ATLAS_W, JAW_RECTS[i], jawPx(k)))
  return buf
}

/** The vignette's pixels (RGBA, VIGNETTE_W x VIGNETTE_H). */
export function vignettePixels(): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(VIGNETTE_W * VIGNETTE_H * 4)
  // (the raster keeps a 2 px margin; the vignette must reach the edges, so it gets a rectangle 4 px larger than the canvas, starting at -2)
  const out: Px = { r: 0, g: 0, b: 0, a: 0 }
  for (let j = 0; j < VIGNETTE_H; j++) {
    for (let i = 0; i < VIGNETTE_W; i++) {
      out.a = 0
      vignettePx((i + 0.5) / VIGNETTE_W, (j + 0.5) / VIGNETTE_H, 1 / VIGNETTE_W, out)
      const o = (j * VIGNETTE_W + i) * 4
      buf[o] = 2
      buf[o + 1] = 4
      buf[o + 2] = 5
      buf[o + 3] = clamp01(out.a) * 255
    }
  }
  return buf
}

/** The sprites of the page: built once (the first `ensureEndoSprites`), read by every compositor. */
export const endoSprites: { atlas: Surface | null; vignette: Surface | null } = { atlas: null, vignette: null }

function put(env: Env, w: number, h: number, data: Uint8ClampedArray): Surface {
  const s = env.createSurface(w, h)
  const img = s.ctx.createImageData(w, h)
  img.data.set(data)
  s.ctx.putImageData(img, 0, 0)
  return s
}

/** Build the atlas and the vignette into canvases of `env`, once. */
export function ensureEndoSprites(env: Env): void {
  if (endoSprites.atlas && endoSprites.vignette) return
  endoSprites.atlas = put(env, ATLAS_W, ATLAS_H, atlasPixels())
  endoSprites.vignette = put(env, VIGNETTE_W, VIGNETTE_H, vignettePixels())
}

/** For tests: forget the sprites. */
export function resetEndoSprites(): void {
  endoSprites.atlas = null
  endoSprites.vignette = null
}
