/**
 * R5 wave 2 (agent H): the lithotomy perineal drape. A sheet laid over the groin between the thighs, level with the top of the abdominal sheet, that turns down past the
 * furthest the pelvis reaches (FRONT_D, measured) and hangs from there to 55 cm under the pad: a covered perineal field where the bedside assistant works, and it hides
 * the gown's flat skirt. Below the thighs it flares out to either side. Nothing here follows anatomy: it is cloth, a flat top and a plain curtain.
 */
import { COLOUR } from './colors'
import { FRONT_D } from './envelope.data'
import { HANG_BOTTOM, clamp01 } from './frame'
import { addGrid, addVert, setColour, type StageMesh } from './mesh'

/** Height of the top (over the highest thigh and groin of any avatar, with the sheet's lift) and the first d of it, table frame. */
export const PERI_TOP = 0.345
export const PERI_D0 = 0.44
/** The curtain's plane, beyond the pelvis by 5 cm. */
export const PERI_FRONT = FRONT_D + 0.05
const COLS = 9
/** The profile (table frame d, h): flat over the groin, turning down, then hanging. */
const PD: readonly number[] = [PERI_D0, 0.6, 0.625, 0.645, PERI_FRONT - 0.015, PERI_FRONT - 0.007, PERI_FRONT - 0.003, PERI_FRONT - 0.001, PERI_FRONT, PERI_FRONT]
const PH: readonly number[] = [PERI_TOP, PERI_TOP, PERI_TOP - 0.006, PERI_TOP - 0.02, PERI_TOP - 0.05, PERI_TOP - 0.1, PERI_TOP - 0.2, PERI_TOP - 0.35, PERI_TOP - 0.55, HANG_BOTTOM]
const N = PD.length
const ARC = new Float64Array(N)
for (let i = 1; i < N; i++) ARC[i] = ARC[i - 1] + Math.hypot(PD[i] - PD[i - 1], PH[i] - PH[i - 1])
const TOTAL = ARC[N - 1]

/** Half-width at height `h`: between the thighs above the knees' line, flared out under the sleeves. */
export function periHalfWidth(h: number): number {
  return 0.17 + 0.1 * clamp01((0.12 - h) / 0.17)
}

/** Add the perineal drape unfolded by `f` (0..1 of its length, from the groin); nothing below 2 %. */
export function buildPerineum(m: StageMesh, f: number): void {
  if (f < 0.02) return
  const L = TOTAL * (f > 1 ? 1 : f)
  setColour(m, COLOUR.drape)
  const v0 = m.nv
  let rows = 0
  for (let i = 0; i < N; i++) {
    let d = PD[i]
    let h = PH[i]
    let last = false
    if (ARC[i] >= L) {
      // the leading row sits where the length runs out, inside this segment
      const t = (L - ARC[i - 1]) / (ARC[i] - ARC[i - 1])
      d = PD[i - 1] + (PD[i] - PD[i - 1]) * t
      h = PH[i - 1] + (PH[i] - PH[i - 1]) * t
      last = true
    }
    const w = periHalfWidth(h)
    for (let c = 0; c < COLS; c++) addVert(m, d, (c / (COLS - 1) * 2 - 1) * w, h)
    rows++
    if (last) break
  }
  addGrid(m, v0, rows, COLS, false, null)
}
