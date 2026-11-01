/**
 * R5 wave 2 (agent H): the big sterile sheet, lofted over the body envelope (envelope.ts). Cross-sections are taken every 4 cm along the body (from the neck's edge toward
 * the feet): in each, the sheet runs from its hanging edge on one side up over the arm, the flank and the top of the body, and down the other side to its hem, 55 cm
 * under the pad. Over the legs it follows them; past the pad's edge it hangs straight (so the rails, the stirrup clamps and the leg section stay clear of it).
 *
 * The window: over the operative field (body-frame d -0.28 .. 0.04 about the navel, 40 cm across: it takes every port of both layouts and the 12 mm assistant port) the
 * quads are left out, so the prepped plate (plate.ts) shows. The rows and columns are laid so the window's edges are grid lines: straight, clean edges.
 *
 * It unfolds from the neck toward the feet: the last cross-section is wherever the leading edge is (`dLead`), its hem droops over the last few centimetres.
 */
import { COLOUR } from './colors'
import { envelopeH } from './envelope'
import { HANG_BOTTOM, SHEET_LIFT } from './frame'
import { addGrid, addVert, setColour, type StageMesh } from './mesh'

/** Body-frame d of the sheet's first cross-section (the neck's edge, where the anaesthetic screen rises) and the spacing of the rest. */
export const SHEET_B0 = -0.48
export const SHEET_STEP = 0.04
/** Cross-sections of the whole supine sheet (to the pad's end plus 14 cm: 1.12) and of the abdominal sheet of a lithotomy patient (to 0.24, past the groin and the tucked hands). */
export const SUPINE_STATIONS = 41
export const LITH_STATIONS = 19
export const SUPINE_END = SHEET_B0 + SHEET_STEP * (SUPINE_STATIONS - 1)
export const LITH_END = SHEET_B0 + SHEET_STEP * (LITH_STATIONS - 1)

/** The window: the cross-sections it spans (the first and the one after the last), body-frame d of its edges, and its half-width (a grid line). */
export const WINDOW = { r0: 5, r1: 13, d0: SHEET_B0 + SHEET_STEP * 5, d1: SHEET_B0 + SHEET_STEP * 13, halfX: 0.2 } as const

/** Half-profile across x: closer to the middle every 2.5 cm, then every 4 cm out over the arms. */
const HALF_X: readonly number[] = [0, 0.025, 0.05, 0.075, 0.1, 0.125, 0.15, 0.175, 0.2, 0.24, 0.28, 0.32, 0.36, 0.4]
const NH = HALF_X.length
const WIN_J = 8
/** The hang past the corner: (outward, down) offsets, the last going to the hem. Flat for the quad count: three numbers a row would allocate, so two parallel tables. */
const HANG_DX: readonly number[] = [0.01, 0.016, 0.02, 0.022, 0.024, 0.025]
const HANG_DH: readonly number[] = [-0.01, -0.035, -0.09, -0.22, -0.36, 0]
const HANG_N = HANG_DX.length
/** Columns across one cross-section: hang, top (both halves), hang. */
export const SHEET_COLS = HANG_N + (2 * NH - 1) + HANG_N
const WIN_C0 = HANG_N + NH - 1 - WIN_J
const WIN_C1 = HANG_N + NH - 1 + WIN_J
/** The hem's droop at the leading edge: (further on, lower by) for three more cross-sections. */
const DROOP_D: readonly number[] = [0.012, 0.02, 0.024]
const DROOP_H: readonly number[] = [0.03, 0.12, 0.3]
const MAX_ROWS = SUPINE_STATIONS + 1 + DROOP_D.length

const profX = new Float64Array(SHEET_COLS)
const profH = new Float64Array(SHEET_COLS)
/** The first cross-section (the screen rises from its top edge): read it right after `buildSheet`. */
export const HEAD_X = new Float64Array(SHEET_COLS)
export const HEAD_H = new Float64Array(SHEET_COLS)
const skip = new Uint8Array(MAX_ROWS * (SHEET_COLS - 1))

/** Fill `profX`, `profH` with the cross-section at body-frame `bd`; the hang starts at least `cMin` out. */
function fillProfile(lith: boolean, bd: number, cMin: number): void {
  // the outermost x where the body stands more than 6 cm over the pad: the sheet hangs 3 cm beyond it
  let xe = 0
  for (let j = NH - 1; j >= 0; j--) {
    if (envelopeH(lith, bd, HALF_X[j]) > 0.06) {
      xe = HALF_X[j]
      break
    }
  }
  let c = xe + 0.03
  if (c < cMin) c = cMin
  if (c > 0.4) c = 0.4
  const hc = envelopeH(lith, bd, c) + SHEET_LIFT
  const mid = HANG_N + NH - 1
  for (let j = 0; j < NH; j++) {
    const x = HALF_X[j] < c ? HALF_X[j] : c
    const h = envelopeH(lith, bd, x) + SHEET_LIFT
    profX[mid - j] = -x
    profH[mid - j] = h
    profX[mid + j] = x
    profH[mid + j] = h
  }
  for (let t = 0; t < HANG_N; t++) {
    const x = c + HANG_DX[t]
    const h = t === HANG_N - 1 ? HANG_BOTTOM : hc + HANG_DH[t]
    profX[HANG_N - 1 - t] = -x
    profH[HANG_N - 1 - t] = h
    profX[mid + NH + t] = x
    profH[mid + NH + t] = h
  }
}

function writeRow(m: StageMesh, dd: number, drop: number): void {
  for (let c = 0; c < SHEET_COLS; c++) {
    let h = profH[c]
    if (drop > 0) {
      let k = (h - HANG_BOTTOM) / 0.4
      k = k < 0 ? 0 : k > 1 ? 1 : k
      h -= drop * k
    }
    addVert(m, dd, profX[c], h)
  }
}

/**
 * Add the sheet to `m`: `lith` the patient's position (the envelope and where the hang starts), `pelvisD` where the pelvis lies (table frame d), `dLead` how far toward the
 * feet it has unfolded (body frame d; nothing before the first cross-section), `droop` whether its hem droops at the leading edge (a lithotomy abdominal sheet ends under the
 * perineal drape instead). The 4 cm cross-sections end at `LITH_END` (lithotomy) or `SUPINE_END`. Returns the cross-sections written.
 */
export function buildSheet(m: StageMesh, lith: boolean, pelvisD: number, dLead: number, droop: boolean): number {
  const stations = lith ? LITH_STATIONS : SUPINE_STATIONS
  const cMin = lith ? 0.345 : 0.285
  if (dLead < SHEET_B0 + 0.004) return 0
  let full = 0
  while (full < stations && SHEET_B0 + SHEET_STEP * full <= dLead + 1e-9) full++
  const lastStation = SHEET_B0 + SHEET_STEP * (full - 1)
  const extra = full < stations && dLead - lastStation > 0.004
  let rows = 0
  const v0 = m.nv
  setColour(m, COLOUR.drape)
  for (let r = 0; r < full; r++) {
    const bd = SHEET_B0 + SHEET_STEP * r
    fillProfile(lith, bd, cMin)
    if (r === 0) {
      HEAD_X.set(profX)
      HEAD_H.set(profH)
    }
    writeRow(m, bd + pelvisD, 0)
    rows++
  }
  if (extra) {
    fillProfile(lith, dLead, cMin)
    writeRow(m, dLead + pelvisD, 0)
    rows++
  }
  if (rows < 2) {
    // a single cross-section is no sheet: take it back
    m.nv = v0
    return 0
  }
  const real = rows
  if (droop) {
    const dLast = (extra ? dLead : lastStation) + pelvisD
    for (let k = 0; k < DROOP_D.length; k++) {
      writeRow(m, dLast + DROOP_D[k], DROOP_H[k])
      rows++
    }
  }
  // the window: the quads of the stations it spans, across its width
  const q = SHEET_COLS - 1
  skip.fill(0, 0, (rows - 1) * q)
  for (let r = WINDOW.r0; r < WINDOW.r1 && r < real - 1; r++) for (let c = WIN_C0; c < WIN_C1; c++) skip[r * q + c] = 1
  addGrid(m, v0, rows, SHEET_COLS, false, skip)
  return real
}
