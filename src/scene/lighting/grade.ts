/**
 * The colour grade (W3): a procedural 32 x 32 x 32 look-up table, always mounted in the effect chain and faded in with the walk look by the
 * blend opacity of its effect (so strength 0 is the identity by the blend, not by a different shader). Warm highlights, cool shadows and a
 * gentle S-curve, nothing else: the hospital must stay a clean, white, believable place.
 *
 * Where it sits: after the tone mapper (Khronos Neutral, kept: AgX greyed the model look), so its input is the picture's display values.
 * postprocessing's LUT3DEffect declares an sRGB input, so the pass converts linear to sRGB before it and back after: the lattice below is
 * in sRGB-encoded values, the way a graded still would be. Grey input stays grey at mid-tone exactly and within a hair elsewhere.
 *
 * The curve, in order (c is an sRGB-encoded colour, y its Rec. 709 luma):
 *   1. S-curve per channel: f(c) = c + 0.35 (smoothstep(c) - c) (a gentle toe, a gentle shoulder, mid-tones a little more contrast; it moves no
 *      channel by more than 0.034, and a grey stays exactly grey). Black and white map to themselves.
 *   2. Split tone: add TINT x (2y-1) (1 - (2y-1)^4), y the input luma: zero at black, mid-grey and white, warm (red up, blue down) above mid,
 *      cool below.
 *
 * Pure (numbers in, numbers out; the texture is made by `createGradeLut`), so it runs under vitest in node.
 */
import { Data3DTexture, DataUtils, HalfFloatType, LinearFilter, RGBAFormat, ClampToEdgeWrapping } from 'three'

export const GRADE_LUT_SIZE = 32

/** How much of the S-curve is mixed in (0 = none). */
export const S_CURVE = 0.35
/** The split tone at its strongest (about y = 0.8 and 0.2): red, green, blue. */
export const TINT: readonly [number, number, number] = [0.02, 0.004, -0.022]

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Rec. 709 luma of sRGB-encoded channels. */
export const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b

/** The S-curve on one channel (0..1). Monotonic, f(0) = 0, f(1) = 1. */
export function sCurve(y: number): number {
  const s = y * y * (3 - 2 * y)
  return y + S_CURVE * (s - y)
}

/** The tint weight at luma y: 0 at 0, 0.5 and 1, positive above mid, negative below. */
export function tintWeight(y: number): number {
  const u = 2 * y - 1
  return u * (1 - u * u * u * u)
}

/**
 * The graded colour of (r, g, b) at `strength` (0 = unchanged, 1 = full grade), written into `out` (a 3-element array or typed array).
 * Inputs and outputs are sRGB-encoded 0..1.
 */
export function gradeColor(r: number, g: number, b: number, out: { [i: number]: number }, strength = 1): void {
  const y = luma(r, g, b)
  const w = tintWeight(y)
  const gr = clamp01(sCurve(r) + TINT[0] * w)
  const gg = clamp01(sCurve(g) + TINT[1] * w)
  const gb = clamp01(sCurve(b) + TINT[2] * w)
  out[0] = r + (gr - r) * strength
  out[1] = g + (gg - g) * strength
  out[2] = b + (gb - b) * strength
}

/** The lattice, RGBA half floats, `size`^3 texels, x = red, y = green, z = blue (postprocessing's layout), at `strength`. */
export function buildGradeLutData(size = GRADE_LUT_SIZE, strength = 1): Uint16Array {
  const data = new Uint16Array(size * size * size * 4)
  const rgb = [0, 0, 0]
  const one = DataUtils.toHalfFloat(1)
  const s = 1 / (size - 1)
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        gradeColor(r * s, g * s, b * s, rgb, strength)
        const i = (r + g * size + b * size * size) * 4
        data[i] = DataUtils.toHalfFloat(rgb[0])
        data[i + 1] = DataUtils.toHalfFloat(rgb[1])
        data[i + 2] = DataUtils.toHalfFloat(rgb[2])
        data[i + 3] = one
      }
    }
  }
  return data
}

/** Trilinear sample of a lattice built by `buildGradeLutData` at an sRGB colour (what the GPU does), for tests. */
export function sampleGradeLut(data: Uint16Array, size: number, r: number, g: number, b: number, out: { [i: number]: number }): void {
  const fx = clamp01(r) * (size - 1)
  const fy = clamp01(g) * (size - 1)
  const fz = clamp01(b) * (size - 1)
  const x0 = Math.min(size - 2, Math.floor(fx))
  const y0 = Math.min(size - 2, Math.floor(fy))
  const z0 = Math.min(size - 2, Math.floor(fz))
  const tx = fx - x0
  const ty = fy - y0
  const tz = fz - z0
  out[0] = out[1] = out[2] = 0
  for (let dz = 0; dz < 2; dz++) {
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz)
        const i = (x0 + dx + (y0 + dy) * size + (z0 + dz) * size * size) * 4
        out[0] += w * DataUtils.fromHalfFloat(data[i])
        out[1] += w * DataUtils.fromHalfFloat(data[i + 1])
        out[2] += w * DataUtils.fromHalfFloat(data[i + 2])
      }
    }
  }
}

let lut: Data3DTexture | null = null

/** The shared grade texture (built once, at full strength; the effect's blend opacity is the strength). */
export function createGradeLut(): Data3DTexture {
  if (lut) return lut
  const t = new Data3DTexture(buildGradeLutData(), GRADE_LUT_SIZE, GRADE_LUT_SIZE, GRADE_LUT_SIZE)
  t.format = RGBAFormat
  t.type = HalfFloatType
  t.minFilter = LinearFilter
  t.magFilter = LinearFilter
  t.wrapS = t.wrapT = t.wrapR = ClampToEdgeWrapping
  t.generateMipmaps = false
  t.unpackAlignment = 1
  t.name = 'grade-lut'
  t.needsUpdate = true
  lut = t
  return t
}
