/**
 * R5 wave 2 (agent H): the prepped skin. An opaque plate over the operative window (sheet.ts WINDOW, with a 3 cm margin all round), laid over the body envelope a few
 * millimetres above the highest skin of any avatar (envelope.ts), so the shot never shows more than a neutral, matte skin tone: abstract skin under the gown's cut-out, no
 * anatomy. The plate is a 1.25 cm grid in vertex colours; the antiseptic's pale orange-pink tint spreads from the middle as `prep` goes 0 -> 1 (`paintPlate`), with a soft edge.
 */
import { COLOUR } from './colors'
import { envelopeH } from './envelope'
import { fitActive, fitSkinH } from './fit'
import { PLATE_LIFT, PLATE_LIFT_FIT, smoothstep } from './frame'
import { addGrid, addVert, setColour, type StageMesh } from './mesh'
import { WINDOW } from './sheet'

const MARGIN = 0.03
/** The plate's body-frame d range, its rows and columns (1.25 cm), its half-width. */
export const PLATE = {
  d0: WINDOW.d0 - MARGIN,
  d1: WINDOW.d1 + MARGIN,
  halfX: WINDOW.halfX + MARGIN,
  rows: 31,
  cols: 37,
} as const
const CENTRE_D = (PLATE.d0 + PLATE.d1) / 2
const AD = (PLATE.d1 - PLATE.d0) / 2
/** How soft the tint's front is (in units of the plate's half-sizes). */
const SOFT = 0.14

/**
 * The plate's height at body-frame `bd` and across `x`: about a centimetre over the selected patient's own skin (fit.ts), or a few millimetres over the highest skin of any
 * avatar when the patient is not known.
 */
export function plateH(lith: boolean, bd: number, x: number): number {
  if (fitActive()) return fitSkinH(lith, bd, x) + PLATE_LIFT_FIT
  return envelopeH(lith, bd, x) + PLATE_LIFT
}

/** Whether (`bd`, `x`) is on the plate, `inset` metres inside its edge. */
export function onPlate(bd: number, x: number, inset: number): boolean {
  return bd >= PLATE.d0 + inset && bd <= PLATE.d1 - inset && Math.abs(x) <= PLATE.halfX - inset
}

/** Add the plate (skin-coloured; call `paintPlate` for the tint). Returns its first vertex; it has `PLATE.rows * PLATE.cols` of them. */
export function buildPlate(m: StageMesh, lith: boolean, pelvisD: number): number {
  setColour(m, COLOUR.skin)
  const v0 = m.nv
  const { rows, cols } = PLATE
  for (let r = 0; r < rows; r++) {
    const bd = PLATE.d0 + ((PLATE.d1 - PLATE.d0) * r) / (rows - 1)
    for (let c = 0; c < cols; c++) {
      const x = -PLATE.halfX + ((2 * PLATE.halfX) * c) / (cols - 1)
      addVert(m, bd + pelvisD, x, plateH(lith, bd, x))
    }
  }
  addGrid(m, v0, rows, cols, false, null)
  return v0
}

/** Write the plate's vertex colours from `v0` for antiseptic `prep` (0..1): the tint spreads from the middle. */
export function paintPlate(m: StageMesh, v0: number, prep: number): void {
  const { rows, cols } = PLATE
  const R = prep * (Math.SQRT2 + SOFT + 0.01)
  const S = COLOUR.skin
  const A = COLOUR.antiseptic
  for (let r = 0; r < rows; r++) {
    const bd = PLATE.d0 + ((PLATE.d1 - PLATE.d0) * r) / (rows - 1)
    const nd = (bd - CENTRE_D) / AD
    for (let c = 0; c < cols; c++) {
      const x = -PLATE.halfX + ((2 * PLATE.halfX) * c) / (cols - 1)
      const nx = x / PLATE.halfX
      const rho = Math.sqrt(nx * nx + nd * nd)
      const k = 1 - smoothstep(R - SOFT, R, rho)
      const o = (v0 + r * cols + c) * 3
      m.col[o] = S.r + (A.r - S.r) * k
      m.col[o + 1] = S.g + (A.g - S.g) * k
      m.col[o + 2] = S.b + (A.b - S.b) * k
    }
  }
}
