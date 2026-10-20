/**
 * R3 (endoscope): the lit tissue plates, one per procedure, baked once per page behind the loading screen.
 *
 * A plate is what the camera sees with nothing in the way: the anatomy (anatomy.ts) sampled per pixel into an albedo, a height field, a gloss and a fine
 * relief, then lit as an endoscope lights it, from a lamp beside the lens: the height field's normals for the diffuse light, ambient occlusion from the
 * height against its blur (crevices and organ rims darken), a depth falloff (far tissue is dimmer, near tissue brighter), and a soft wet sheen. The sharp
 * wet highlights go into a SECOND image, the specular layer (white, with the highlight as alpha), which the per-frame compositor (frame.ts) slides with a
 * little parallax as the camera and the breathing move, so the tissue glistens. `safeTissue` (noBlood.ts) runs on every plate pixel.
 *
 * The bake is pure arithmetic (node tests run it) in stages: sample rows, two separable box blurs of the height, shade rows. `PlateBaker.step` works for at
 * most a budget and returns; `ensureEndoPlates` runs the three plates in 8 ms slices with a frame between them and registers a warm gate
 * ('endoscope-plates', src/scene/warmup/registry.ts), so the warm-up holds the Enter button until the plates are in their canvases (the pattern of
 * src/scene/lighting/volume/texture.ts). Nothing here runs again after that.
 */
import type { Env, Surface } from '@/scene/imaging/images/ctx'
import { registerWarmGate } from '@/scene/warmup/registry'
import { newSample, PLATE_ASPECT, sampleAnatomy, type ProcIndex } from './anatomy'
import { clamp01, Lattice, smooth, vnoise } from './field'
import { safeTissue, type Rgb } from './noBlood'
import { ensureEndoSprites } from './sprites'

/** The plate's size: 16:9, a little more than the console card's 768 x 432 picture shows, so there is room to pan. */
export const PLATE_W = 864
export const PLATE_H = 486

/** The longest a bake slice works before it gives the page a frame (the CLAUDE.md budget for load-time slices). */
export const SLICE_MS = 8

/** Lighting: the lamp a little up and left of the lens, the half vector with the view, how strongly the height bends the normals, the exposure. */
const LIGHT = norm3(-0.18, -0.28, 1)
const HALF = norm3(LIGHT[0], LIGHT[1], LIGHT[2] + 1)
const RELIEF = 1.0
const MAX_SLOPE = 1.6
const WRAP = 0.35
const AO_K = 1.6
const SSS = 0.9
const EXPOSURE = 1.24
/** The fine relief that breaks the wet highlights up into speckles: its frequency (per plate height) and amplitude. */
const MICRO_FREQ = 120
const MICRO_AMP = 0.0006
/** The colour of the specular layer (a hair warm white). */
export const SPEC_RGB = [255, 252, 247] as const

function norm3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z)
  return [x / l, y / l, z / l]
}

const MICRO = new Lattice(0x4e5b)

/** The scratch arrays of a bake (shared by the bakes of one size: they run one after another). */
interface Scratch {
  w: number
  h: number
  alb: Float32Array
  height: Float32Array
  gloss: Float32Array
  micro: Float32Array
  /** The fine relief alone: it bends the highlights' normals, not the diffuse light's. */
  fine: Float32Array
  blur: Float32Array
  tmp: Float32Array
}
let scratch: Scratch | null = null

function scratchFor(w: number, h: number): Scratch {
  if (scratch && scratch.w === w && scratch.h === h) return scratch
  const n = w * h
  scratch = { w, h, alb: new Float32Array(n * 3), height: new Float32Array(n), gloss: new Float32Array(n), micro: new Float32Array(n), fine: new Float32Array(n), blur: new Float32Array(n), tmp: new Float32Array(n) }
  return scratch
}

const STAGES = ['sample', 'blurH1', 'blurV1', 'blurH2', 'blurV2', 'shade', 'done'] as const

/** One plate's bake, resumable: `step` works for a budget and returns whether it is finished. `rgba` and `spec` are the results (w x h x 4). */
export class PlateBaker {
  readonly rgba: Uint8ClampedArray
  readonly spec: Uint8ClampedArray
  private stage = 0
  private line = 0
  private readonly s: Scratch
  private readonly radius: number
  private readonly sample = newSample()
  private readonly px: Rgb = { r: 0, g: 0, b: 0 }

  constructor(
    readonly proc: ProcIndex,
    readonly w: number = PLATE_W,
    readonly h: number = PLATE_H,
  ) {
    this.rgba = new Uint8ClampedArray(w * h * 4)
    this.spec = new Uint8ClampedArray(w * h * 4)
    this.s = scratchFor(w, h)
    this.radius = Math.max(2, Math.round(h * 0.045))
  }

  get done(): boolean {
    return STAGES[this.stage] === 'done'
  }

  get stageName(): string {
    return STAGES[this.stage]
  }

  /** Work until done or until `budgetMs` has passed by `now`. Returns whether the plate is finished. */
  step(budgetMs: number, now: () => number): boolean {
    const t0 = now()
    while (!this.done) {
      this.unit()
      if (now() - t0 >= budgetMs) break
    }
    return this.done
  }

  /** Run to the end in one go. */
  finish(): this {
    while (!this.done) this.unit()
    return this
  }

  /** One unit of work: a row (or a column) of the current stage. */
  private unit(): void {
    const { w, h } = this
    switch (STAGES[this.stage]) {
      case 'sample':
        this.sampleRow(this.line)
        if (++this.line >= h) this.next()
        return
      case 'blurH1':
        blurRow(this.s.height, this.s.tmp, w, this.line, this.radius)
        if (++this.line >= h) this.next()
        return
      case 'blurV1':
        blurCol(this.s.tmp, this.s.blur, w, h, this.line, this.radius)
        if (++this.line >= w) this.next()
        return
      case 'blurH2':
        blurRow(this.s.blur, this.s.tmp, w, this.line, this.radius)
        if (++this.line >= h) this.next()
        return
      case 'blurV2':
        blurCol(this.s.tmp, this.s.blur, w, h, this.line, this.radius)
        if (++this.line >= w) this.next()
        return
      case 'shade':
        this.shadeRow(this.line)
        if (++this.line >= h) this.next()
        return
      default:
    }
  }

  private next(): void {
    this.stage++
    this.line = 0
  }

  private sampleRow(j: number): void {
    const { w, h, s } = this
    const smp = this.sample
    // the plate's height is the unit: x runs 0..16/9
    const scale = 1 / h
    const y = (j + 0.5) * scale
    for (let i = 0; i < w; i++) {
      const x = (i + 0.5) * scale * (PLATE_ASPECT / (w / h))
      sampleAnatomy(this.proc, x, y, smp)
      const k = j * w + i
      s.alb[k * 3] = smp.r
      s.alb[k * 3 + 1] = smp.g
      s.alb[k * 3 + 2] = smp.b
      s.gloss[k] = smp.gloss
      s.micro[k] = smp.micro
      s.height[k] = smp.h
      s.fine[k] = smp.micro * MICRO_AMP * (vnoise(MICRO, x * MICRO_FREQ, y * MICRO_FREQ) - 0.5) * 2
    }
  }

  private shadeRow(j: number): void {
    const { w, h, s } = this
    const H = s.height
    const F = s.fine
    const relief = RELIEF * h * 0.5
    const c = this.px
    for (let i = 0; i < w; i++) {
      const k = j * w + i
      const kl = i > 0 ? k - 1 : k
      const kr = i < w - 1 ? k + 1 : k
      const ku = j > 0 ? k - w : k
      const kd = j < h - 1 ? k + w : k
      let gx = (H[kr] - H[kl]) * relief
      let gy = (H[kd] - H[ku]) * relief
      // steep rims would turn black: the slope is capped, so an organ's edge darkens softly instead of drawing an outline
      const gl2 = gx * gx + gy * gy
      if (gl2 > MAX_SLOPE * MAX_SLOPE) {
        const gl = Math.sqrt(gl2)
        gx *= MAX_SLOPE / gl
        gy *= MAX_SLOPE / gl
      }
      const inv = 1 / Math.sqrt(gx * gx + gy * gy + 1)
      const ndl = (-gx * LIGHT[0] - gy * LIGHT[1] + LIGHT[2]) * inv
      const wrap = ((ndl > 0 ? ndl : 0) + WRAP) / (1 + WRAP)
      const hh = H[k]
      const cavity = s.blur[k] - hh
      const ao = clamp01(1 - AO_K * (cavity > 0 ? cavity : 0))
      const fall = 0.16 + 0.84 * smooth(0.04, 0.8, hh)
      const light = (0.04 + 0.96 * wrap) * fall * ao * EXPOSURE
      // the highlights' normal also has the fine relief
      const sx = gx + (F[kr] - F[kl]) * relief
      const sy = gy + (F[kd] - F[ku]) * relief
      const sinv = 1 / Math.sqrt(sx * sx + sy * sy + 1)
      const ndh = (-sx * HALF[0] - sy * HALF[1] + HALF[2]) * sinv
      const nh = ndh > 0 ? ndh : 0
      const gloss = s.gloss[k]
      const sheen = gloss * 0.05 * Math.pow((-gx * HALF[0] - gy * HALF[1] + HALF[2]) * inv, 12) * fall
      const ar = s.alb[k * 3]
      const ag = s.alb[k * 3 + 1]
      const ab = s.alb[k * 3 + 2]
      // light in linear (the albedo squared), back to sRGB (the square root)
      // light scattered under the surface comes back warmer and more saturated where the direct light is weak (the albedo squared once more)
      const sss = SSS * fall * (1 - wrap) * ao
      // and the far, dim tissue warms (a deep yellow reads orange, not olive)
      const warm = 1 - fall
      c.r = Math.min(255, Math.sqrt(ar * ar * (light + sss * ar * ar) + sheen) * 255)
      c.g = Math.min(255, Math.sqrt(ag * ag * (light + sss * ag * ag) * (1 - 0.22 * warm) + sheen) * 255)
      c.b = Math.min(255, Math.sqrt(ab * ab * (light + sss * ab * ab) * (1 - 0.34 * warm) + sheen) * 255)
      safeTissue(c)
      const o = k * 4
      this.rgba[o] = c.r
      this.rgba[o + 1] = c.g
      this.rgba[o + 2] = c.b
      this.rgba[o + 3] = 255
      const sharp = gloss * Math.pow(nh, 60) * (0.35 + 0.9 * s.micro[k]) * fall * ao
      this.spec[o] = SPEC_RGB[0]
      this.spec[o + 1] = SPEC_RGB[1]
      this.spec[o + 2] = SPEC_RGB[2]
      this.spec[o + 3] = clamp01(sharp * 1.4) * 255
    }
  }
}

/** A box blur of one row of `src` into `dst` (radius `r`, clamped at the ends). */
function blurRow(src: Float32Array, dst: Float32Array, w: number, j: number, r: number): void {
  const o = j * w
  const n = 2 * r + 1
  let sum = 0
  for (let i = -r; i <= r; i++) sum += src[o + (i < 0 ? 0 : i > w - 1 ? w - 1 : i)]
  for (let i = 0; i < w; i++) {
    dst[o + i] = sum / n
    const add = i + r + 1
    const sub = i - r
    sum += src[o + (add > w - 1 ? w - 1 : add)] - src[o + (sub < 0 ? 0 : sub)]
  }
}

/** A box blur of column `i` of `src` into `dst`. */
function blurCol(src: Float32Array, dst: Float32Array, w: number, h: number, i: number, r: number): void {
  const n = 2 * r + 1
  let sum = 0
  for (let j = -r; j <= r; j++) sum += src[(j < 0 ? 0 : j > h - 1 ? h - 1 : j) * w + i]
  for (let j = 0; j < h; j++) {
    dst[j * w + i] = sum / n
    const add = j + r + 1
    const sub = j - r
    sum += src[(add > h - 1 ? h - 1 : add) * w + i] - src[(sub < 0 ? 0 : sub) * w + i]
  }
}

// ---------------------------------------------------------------------------------------------
// The plates of the page
// ---------------------------------------------------------------------------------------------

export interface EndoPlate {
  proc: ProcIndex
  /** The lit tissue, opaque. */
  plate: Surface
  /** The wet highlights: white, the highlight in alpha. */
  spec: Surface
  w: number
  h: number
}

/** What the page can read: which plates are in their canvases, and how the bake went. */
export const endoPlates = {
  plates: [null, null, null] as (EndoPlate | null)[],
  failed: false,
  slices: 0,
  longestMs: 0,
}

/** Put an RGBA image into a new surface of `env`. */
export function surfaceOf(env: Env, w: number, h: number, data: Uint8ClampedArray): Surface {
  const s = env.createSurface(w, h)
  const img = s.ctx.createImageData(w, h)
  img.data.set(data)
  s.ctx.putImageData(img, 0, 0)
  return s
}

function install(env: Env, b: PlateBaker): void {
  endoPlates.plates[b.proc] = { proc: b.proc, plate: surfaceOf(env, b.w, b.h, b.rgba), spec: surfaceOf(env, b.w, b.h, b.spec), w: b.w, h: b.h }
}

export interface BakeClock {
  now(): number
  /** Let the page breathe: one animation frame, or a short timer in a tab that is not drawing. */
  frame(): Promise<void>
}

/** One animation frame, or 50 ms in a tab that is not drawing, whichever comes first. */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = (): void => {
      if (!done) {
        done = true
        resolve()
      }
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(finish)
    setTimeout(finish, 50)
  })
}

export const browserClock: BakeClock = { now: () => performance.now(), frame: nextFrame }

let started: Promise<void> | null = null

/**
 * Build the instrument sprites (now: they are small) and bake the three plates (in slices, a frame between them), once per page, holding the warm-up until
 * they are in. Safe to call from an effect that mounts twice. A failed bake leaves the plates it has: the picture falls back to a plain warm field.
 */
export function ensureEndoPlates(env: Env, clock: BakeClock = browserClock): Promise<void> {
  if (started) return started
  ensureEndoSprites(env)
  started = (async () => {
    for (let p = 0; p < 3; p++) {
      if (endoPlates.plates[p]) continue
      const b = new PlateBaker(p as ProcIndex)
      for (;;) {
        const t0 = clock.now()
        const done = b.step(SLICE_MS, clock.now)
        endoPlates.slices++
        endoPlates.longestMs = Math.max(endoPlates.longestMs, clock.now() - t0)
        if (done) break
        await clock.frame()
      }
      install(env, b)
    }
  })().catch((err: unknown) => {
    endoPlates.failed = true
    console.warn('[endoscope] the tissue plates did not bake; the picture falls back to a plain field', err)
  })
  registerWarmGate('endoscope-plates', started)
  return started
}

/** Bake (synchronously) and install the plates of `procs` that are missing, and the sprites: for node tests and the probe's previews. */
export function bakeEndoPlatesNow(env: Env, procs: readonly ProcIndex[] = [0, 1, 2]): void {
  ensureEndoSprites(env)
  for (const p of procs) if (!endoPlates.plates[p]) install(env, new PlateBaker(p).finish())
}

/** The plate of `proc`, or null while it is not baked. */
export function plateOf(proc: number): EndoPlate | null {
  return endoPlates.plates[proc] ?? null
}

/** For tests: forget the plates so they can bake again. */
export function resetEndoPlates(): void {
  started = null
  endoPlates.plates[0] = null
  endoPlates.plates[1] = null
  endoPlates.plates[2] = null
  endoPlates.failed = false
  endoPlates.slices = 0
  endoPlates.longestMs = 0
  scratch = null
}
