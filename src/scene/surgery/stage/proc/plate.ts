/**
 * R5 wave 3 (agent J): the prepped skin of a procedure room: an opaque plate over the sheet's window with a 3 cm margin all round, laid over the patient's skin field (field.ts)
 * a centimetre above the skin (the field is the patient's own, exact to a cell, so the plate hugs it; PLATE_LIFT_FIT as in the theatre), so the shot never shows more than a
 * neutral, matte skin tone: abstract skin under the drape's cut-out, no anatomy. The plate is a 1.25 cm grid in vertex colours; the antiseptic's pale orange-pink tint spreads
 * from the middle as `prep` goes 0 -> 1 (`paintPlate`), with a soft edge. Its rows keep inside the body's edge (a body on its side is narrower than the window is wide).
 */
import { COLOUR } from '../colors'
import { PLATE_LIFT_FIT, smoothstep } from '../frame'
import { addGrid, setColour, type StageMesh } from '../mesh'
import { heightAt, maxAt, type SkinField } from './field'
import { addV } from './mesh'
import { MAX_SITES, PLATE_CELL, PLATE_MARGIN, PLATE_MAX_ROWS, type PlacedWindow } from './window'

export { PLATE_CELL, PLATE_MARGIN, PLATE_MAX_ROWS }

/** The plate stands at least this far over the highest cell round any point (m). */
export const PLATE_LIFT_PEAK = 0.011
/** How soft the tint's front is (in units of the plate's half-sizes). */
const SOFT = 0.14

/**
 * What the plate was built as: the first vertex, the grid, its middle and half sizes (for the tint), each row's x range (the marks stay inside it), and the window it lies under
 * (the marks stay inside that: a nick is carried to the window when its site is off it) with the sites as drawn (the nicks' places, patient frame z and x: the tests read them).
 */
export interface PlateInfo {
  v0: number
  rows: number
  cols: number
  zc: number
  xc: number
  hz: number
  hx: number
  z0: number
  z1: number
  xlo: Float32Array
  xhi: Float32Array
  wz0: number
  wz1: number
  wx0: number
  wx1: number
  drawn: Float64Array
  nDrawn: number
}

export function newPlateInfo(): PlateInfo {
  return {
    v0: -1,
    rows: 0,
    cols: 0,
    zc: 0,
    xc: 0,
    hz: 1,
    hx: 1,
    z0: 0,
    z1: 0,
    xlo: new Float32Array(PLATE_MAX_ROWS),
    xhi: new Float32Array(PLATE_MAX_ROWS),
    wz0: 0,
    wz1: 0,
    wx0: 0,
    wx1: 0,
    drawn: new Float64Array(MAX_SITES * 2),
    nDrawn: 0,
  }
}

/**
 * The plate's height at (`z`, `x`): over the patient's skin by the field's own cells read bilinearly and a centimetre (exact on a slope), and never under the highest of the cells round
 * it plus a centimetre: a peak narrower than a cell (a nipple) or a flank's steep edge is covered, at the price of a tent over it.
 */
export function plateHeight(f: SkinField, z: number, x: number): number {
  const a = heightAt(f.h, z, x) + PLATE_LIFT_FIT
  const b = maxAt(f.h, z, x) + PLATE_LIFT_PEAK
  return a > b ? a : b
}

/**
 * Add the plate for `win` (skin-coloured; call `paintPlate` for the tint). Fills `out` and returns its first vertex. Its rows are the ones `placeWindow` laid (`win.rows`, from
 * `win.pz0` to `win.pz1`): each runs from the window's edge less the margin to the window's other edge plus the margin, clipped to the body's limit at that row (`win.eLo`, `win.eHi`);
 * the window's own edges are inside those limits (window.ts), so the window lies wholly over the plate.
 */
export function buildPlate(m: StageMesh, f: SkinField, win: PlacedWindow, out: PlateInfo): number {
  setColour(m, COLOUR.skin)
  const rows = win.rows
  const zA = win.pz0
  const zB = win.pz1
  const cols = Math.max(3, Math.round((win.x1 - win.x0 + 2 * PLATE_MARGIN) / PLATE_CELL) + 1)
  const v0 = m.nv
  let xmin = Infinity
  let xmax = -Infinity
  for (let r = 0; r < rows; r++) {
    const z = zA + ((zB - zA) * r) / (rows - 1)
    // the plate's x range at this row: the window and its margin, inside the body's limit
    let xa = win.x0 - PLATE_MARGIN
    let xb = win.x1 + PLATE_MARGIN
    if (xa < win.eLo[r]) xa = win.eLo[r]
    if (xb > win.eHi[r]) xb = win.eHi[r]
    if (xb < xa + 0.04) xb = xa + 0.04
    out.xlo[r] = xa
    out.xhi[r] = xb
    if (xa < xmin) xmin = xa
    if (xb > xmax) xmax = xb
    for (let c = 0; c < cols; c++) {
      const x = xa + ((xb - xa) * c) / (cols - 1)
      addV(m, z, x, plateHeight(f, z, x))
    }
  }
  addGrid(m, v0, rows, cols, false, null)
  out.v0 = v0
  out.rows = rows
  out.cols = cols
  out.z0 = zA
  out.z1 = zB
  out.zc = (zA + zB) / 2
  out.xc = (xmin + xmax) / 2
  out.hz = (zB - zA) / 2
  out.hx = (xmax - xmin) / 2
  out.wz0 = win.z0
  out.wz1 = win.z1
  out.wx0 = win.x0
  out.wx1 = win.x1
  return v0
}

/**
 * The height of the plate's own mesh at (`z`, `x`) (exact on its triangles: the grid's quads are split as `addGrid` splits them), or NaN off it: what a mark lies on, so a mark
 * and the plate under it never cross. The vertices are read from the mesh `m` the plate was built into.
 */
export function plateSurface(m: StageMesh, p: PlateInfo, z: number, x: number): number {
  if (p.v0 < 0 || p.rows < 2) return NaN
  let fr = ((z - p.z0) / (p.z1 - p.z0)) * (p.rows - 1)
  if (fr < 0 || fr > p.rows - 1) return NaN
  let r = Math.floor(fr)
  if (r > p.rows - 2) r = p.rows - 2
  fr -= r
  // the column: the fraction across at the two rows, blended by how far between them
  const u0 = (x - p.xlo[r]) / (p.xhi[r] - p.xlo[r])
  const u1 = (x - p.xlo[r + 1]) / (p.xhi[r + 1] - p.xlo[r + 1])
  let fc = (u0 + (u1 - u0) * fr) * (p.cols - 1)
  if (fc < 0 || fc > p.cols - 1) return NaN
  let c = Math.floor(fc)
  if (c > p.cols - 2) c = p.cols - 2
  fc -= c
  const a = (p.v0 + r * p.cols + c) * 3
  const b = a + 3
  const cc = (p.v0 + (r + 1) * p.cols + c) * 3
  const e = cc + 3
  // the two triangles of the quad: (a, cc, b) and (b, cc, e); positions are (x, h, z) in the mesh
  let best = NaN
  for (let t = 0; t < 2; t++) {
    const i = t === 0 ? a : b
    const j = cc
    const k = t === 0 ? b : e
    const iz = m.pos[i + 2]
    const ix = m.pos[i]
    const den = (m.pos[j + 2] - m.pos[k + 2]) * (ix - m.pos[k]) + (m.pos[k] - m.pos[j]) * (iz - m.pos[k + 2])
    if (den > -1e-14 && den < 1e-14) continue
    const l1 = ((m.pos[j + 2] - m.pos[k + 2]) * (x - m.pos[k]) + (m.pos[k] - m.pos[j]) * (z - m.pos[k + 2])) / den
    const l2 = ((m.pos[k + 2] - iz) * (x - m.pos[k]) + (ix - m.pos[k]) * (z - m.pos[k + 2])) / den
    const l3 = 1 - l1 - l2
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue
    best = l1 * m.pos[i + 1] + l2 * m.pos[j + 1] + l3 * m.pos[k + 1]
    break
  }
  return best
}

/** Write the plate's vertex colours for antiseptic `prep` (0..1): the tint spreads from the middle. */
export function paintPlate(m: StageMesh, p: PlateInfo, prep: number): void {
  if (p.v0 < 0) return
  const R = prep * (Math.SQRT2 + SOFT + 0.01)
  const S = COLOUR.skin
  const A = COLOUR.antiseptic
  for (let r = 0; r < p.rows; r++) {
    for (let c = 0; c < p.cols; c++) {
      const v = p.v0 + r * p.cols + c
      const nd = (m.pos[v * 3 + 2] - p.zc) / p.hz
      const nx = (m.pos[v * 3] - p.xc) / p.hx
      const rho = Math.sqrt(nx * nx + nd * nd)
      const k = 1 - smoothstep(R - SOFT, R, rho)
      const o = v * 3
      m.col[o] = S.r + (A.r - S.r) * k
      m.col[o + 1] = S.g + (A.g - S.g) * k
      m.col[o + 2] = S.b + (A.b - S.b) * k
    }
  }
}
