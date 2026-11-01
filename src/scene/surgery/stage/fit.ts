/**
 * R5 wave 2 (agent H): the drapes' fit to the patient on the table. `fit.data.ts` holds, for each of the four bodies a gowned patient can be (avatars.ts GOWN) at each of three
 * sizes, that body's OWN envelope, leg rings and a fine plate table (stage.generate.test.ts measures them on the real avatars as agent G's rig lays them on the table). With the
 * patient known (the crowd's registry: runtime.ts) the stage selects its tables (`selectFit`), blending the two sizes either side of the person's own, and every lookup
 * (`envelopeH`, `plateH`, the leg rings) answers from them; with nobody known (`selectFit(-1, ...)`) they answer from the union of the avatars (envelope.data.ts).
 *
 * The selection is one module-level state, set at the start of a build and read by the lookups in it (a build is atomic): nothing is allocated.
 */
import { ENV_COL_STEP, ENV_ROW0, ENV_ROW_STEP } from './envelope.data'
import { FIT_IDS, FIT_LEGS, FIT_LITH, FIT_PLATE_COLS, FIT_PLATE_DSTEP, FIT_PLATE_LITH, FIT_PLATE_ROW0, FIT_PLATE_ROWS, FIT_PLATE_SUPINE, FIT_PLATE_XSTEP, FIT_SCALES, FIT_SUPINE } from './fit.data'

const SIZES = FIT_SCALES.length
/** The columns of the coarse envelope. */
const COLS = 12
const LEG_COLS = 19

let avatar = -1
/** Entries of the two sizes either side of the patient's, and the weight of the second. */
let e0 = 0
let e1 = 0
let w = 0

/** Numbers per fitted leg ring: the middle's d, x and h, then the radii. */
export const FIT_LEG_COLS = LEG_COLS

/** The index of a body in the fit tables, -1 when it has none (a garment body, the procedural people, nobody). */
export function fitIndexOf(id: string): number {
  return FIT_IDS.indexOf(id)
}

/** Select the fit of body `index` (see `fitIndexOf`) at size `scale` (the person's `look.scale`); -1 selects none (the union of the avatars). */
export function selectFit(index: number, scale: number): void {
  if (index < 0 || index >= FIT_IDS.length) {
    avatar = -1
    return
  }
  avatar = index
  let s = scale
  if (s < FIT_SCALES[0]) s = FIT_SCALES[0]
  else if (s > FIT_SCALES[SIZES - 1]) s = FIT_SCALES[SIZES - 1]
  let k = 0
  while (k < SIZES - 2 && s > FIT_SCALES[k + 1]) k++
  e0 = index * SIZES + k
  e1 = e0 + 1
  w = (s - FIT_SCALES[k]) / (FIT_SCALES[k + 1] - FIT_SCALES[k])
}

/** Whether a body's own fit is selected. */
export function fitActive(): boolean {
  return avatar >= 0
}

/** Bilinear lookup in a flat row-major table at fractional row `fr` and column `fc` (both already clamped to the table). */
function bilinear(t: readonly number[], cols: number, fr: number, fc: number, rows: number): number {
  let i = Math.floor(fr)
  if (i >= rows - 1) i = rows - 2
  let j = Math.floor(fc)
  if (j >= cols - 1) j = cols - 2
  const ti = fr - i
  const tj = fc - j
  const o = i * cols + j
  const a = t[o] + (t[o + 1] - t[o]) * tj
  const b = t[o + cols] + (t[o + cols + 1] - t[o + cols]) * tj
  return a + (b - a) * ti
}

/** The selected body's own envelope height (metres) over body-frame `bd` and across `x`, blended between its two sizes. */
export function fitEnvelopeH(lith: boolean, bd: number, x: number): number {
  const T0 = lith ? FIT_LITH[e0] : FIT_SUPINE[e0]
  const T1 = lith ? FIT_LITH[e1] : FIT_SUPINE[e1]
  const rows = T0.length / COLS
  let fr = (bd - ENV_ROW0) / ENV_ROW_STEP
  if (fr < 0) fr = 0
  else if (fr > rows - 1) fr = rows - 1
  let fc = (x < 0 ? -x : x) / ENV_COL_STEP
  if (fc > COLS - 1) fc = COLS - 1
  const a = bilinear(T0, COLS, fr, fc, rows)
  const b = bilinear(T1, COLS, fr, fc, rows)
  return (a + (b - a) * w) * 0.001
}

/** The selected body's own skin height (metres, the fine table) over the window's plate at body-frame `bd` and across `x`. */
export function fitSkinH(lith: boolean, bd: number, x: number): number {
  const T0 = lith ? FIT_PLATE_LITH[e0] : FIT_PLATE_SUPINE[e0]
  const T1 = lith ? FIT_PLATE_LITH[e1] : FIT_PLATE_SUPINE[e1]
  let fr = (bd - FIT_PLATE_ROW0) / FIT_PLATE_DSTEP
  if (fr < 0) fr = 0
  else if (fr > FIT_PLATE_ROWS - 1) fr = FIT_PLATE_ROWS - 1
  let fc = (x < 0 ? -x : x) / FIT_PLATE_XSTEP
  if (fc > FIT_PLATE_COLS - 1) fc = FIT_PLATE_COLS - 1
  return blend(bilinear(T0, FIT_PLATE_COLS, fr, fc, FIT_PLATE_ROWS), bilinear(T1, FIT_PLATE_COLS, fr, fc, FIT_PLATE_ROWS)) * 0.001
}

/**
 * Two sizes' values blended toward the higher: the straight blend at either size, the higher of the two half way between. A body's shape moves with its size (the flank
 * widens, the dome shifts), so the straight blend of two measured skins can dip under the skin of a size between them; this cannot, and costs at most the difference
 * between the two sizes (a centimetre or two) over a person who is half way between.
 */
function blend(a: number, b: number): number {
  const lerp = a + (b - a) * w
  const top = a > b ? a : b
  const k = w < 0.5 ? w : 1 - w
  return lerp + 2 * k * (top - lerp)
}

/**
 * The selected body's own leg ring at station `i` and fraction `t` toward the next (blended between its two sizes), into `out` (metres): the ring's middle (d, |x|, h),
 * then its radii. The rings are perpendicular to the leg's axis (legFrame.ts).
 */
export function fitLegInto(i: number, t: number, out: Float64Array): void {
  const L0 = FIT_LEGS[e0]
  const L1 = FIT_LEGS[e1]
  for (let c = 0; c < LEG_COLS; c++) {
    const a0 = L0[i * LEG_COLS + c] + (L0[(i + 1) * LEG_COLS + c] - L0[i * LEG_COLS + c]) * t
    const a1 = L1[i * LEG_COLS + c] + (L1[(i + 1) * LEG_COLS + c] - L1[i * LEG_COLS + c]) * t
    // the middle (columns 0 to 2) blends straight; the radii toward the larger
    out[c] = (c < 3 ? a0 + (a1 - a0) * w : blend(a0, a1)) * 0.001
  }
}
