/**
 * R5 wave 2 (agent H): the body envelope the drapes are shaped over. `envelope.data.ts` is measured on the real avatars (stage.generate.test.ts); this reads it.
 */
import { ENV_COL_STEP, ENV_ROW0, ENV_ROW_STEP, LEG_BINS, LEG_D0, LEG_RINGS, LEG_STEP, LITH_ENV, SUPINE_ENV } from './envelope.data'
import { fitActive, fitEnvelopeH, fitLegInto } from './fit'

/**
 * The highest skin over body-frame `bd` and across `x` (either side), metres; bilinear between the table's samples, clamped past its ends. The selected patient's own (fit.ts)
 * when one is selected, else the highest of any avatar.
 */
export function envelopeH(lith: boolean, bd: number, x: number): number {
  if (fitActive()) return fitEnvelopeH(lith, bd, x)
  const T = lith ? LITH_ENV : SUPINE_ENV
  const nr = T.length - 1
  let fr = (bd - ENV_ROW0) / ENV_ROW_STEP
  if (fr < 0) fr = 0
  else if (fr > nr) fr = nr
  let i = Math.floor(fr)
  if (i >= nr) i = nr - 1
  const ti = fr - i
  const nc = T[0].length - 1
  let fc = (x < 0 ? -x : x) / ENV_COL_STEP
  if (fc > nc) fc = nc
  let j = Math.floor(fc)
  if (j >= nc) j = nc - 1
  const tj = fc - j
  const r0 = T[i]
  const r1 = T[i + 1]
  const a = r0[j] + (r0[j + 1] - r0[j]) * tj
  const b = r1[j] + (r1[j + 1] - r1[j]) * tj
  return (a + (b - a) * ti) * 0.001
}

/** How many leg-ring stations there are, and where the last one is (table frame d). */
export const LEG_STATIONS = LEG_RINGS.length
export const LEG_D_END = LEG_D0 + (LEG_STATIONS - 1) * LEG_STEP
export { LEG_BINS, LEG_D0, LEG_STEP }

/**
 * The lithotomy leg ring at table-frame `d` (between stations the neighbours blend), into `out` (metres): its middle as (d, |x|, h), then its LEG_BINS radii around it (every
 * 360/LEG_BINS degrees from +x, the outward way, turning toward +h). The patient's own rings (fit.ts) lie in planes perpendicular to the leg's axis; the union of the avatars
 * (envelope.data.ts) in planes of constant d (`legRingsPerpendicular` says which).
 */
export function legRingInto(d: number, out: Float64Array): void {
  let f = (d - LEG_D0) / LEG_STEP
  if (f < 0) f = 0
  else if (f > LEG_STATIONS - 1) f = LEG_STATIONS - 1
  let i = Math.floor(f)
  if (i >= LEG_STATIONS - 1) i = LEG_STATIONS - 2
  const t = f - i
  if (fitActive()) {
    fitLegInto(i, t, out)
    return
  }
  const a = LEG_RINGS[i]
  const b = LEG_RINGS[i + 1]
  out[0] = d
  for (let c = 0; c < 2 + LEG_BINS; c++) out[1 + c] = (a[c] + (b[c] - a[c]) * t) * 0.001
}

/** Whether the rings in force are perpendicular to the leg (the patient's own) rather than planes of constant d (the union of the avatars). */
export function legRingsPerpendicular(): boolean {
  return fitActive()
}

/** Numbers `legRingInto` writes. */
export const LEG_RING_FLOATS = 3 + LEG_BINS
