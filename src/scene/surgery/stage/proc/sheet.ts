/**
 * R5 wave 3 (agent J): the sterile sheet of a procedure room, lofted over the patient's skin field (field.ts). Cross-sections are taken every 4 cm along the body (from the
 * shoulders' edge toward the feet); in each the sheet runs from its hanging edge on one side up over the body to the other side's: a profile over the lattice of columns every
 * 2.5 cm across, each as high as the HIGHEST skin at or outside it on its own side (a sheet laid over a body cannot dip between a high flank and the middle, nor between an
 * arm and the ribs) over a wide maximum filter (field.ts), standing `SHEET_LIFT` off it; past the body's edge it hangs straight down, to the pad's top or a little under it and,
 * for the CT table, no lower than keeps it clear of the gantry's liner. One window (the field the needles go through) is cut out of it, its edges grid lines.
 *
 * It unfolds from the shoulders toward the feet: the last cross-section is wherever the leading edge is.
 *
 * The hang starts beyond the table's edge (R5 wave 3, `RoomConfig.hangFrom`: the CT's slab or the couch's frame and 2 cm): the sheet lies over the pad out to there, at the pad's height
 * where there is no body, and only then falls, so no part of it goes into the pad. The window is placed with the plate (window.ts): see there.
 *
 * The hole's edges are the window's EXACT edges (R5 wave 3, P5): the lattice's rows and columns nearest them are moved onto them (by at most half a step: the cloth's quads beside the
 * hole narrow by that much), so a window can be as small and as placed as the sites ask. And the hole has a SKIRT (P4, seen obliquely): the cloth stands 3 to 5 cm over the plate at the
 * hole's edge (it is laid over the highest skin round, a centimetre and a half off it), so a line of sight through the hole at a slant passed under the cloth and met the body or the gown
 * beyond the plate; the cloth now drops from the hole's edge to the plate, a vertical wall of the same cloth all round, so no sight line through the hole reaches anything but the plate.
 */
import { COLOUR } from '../colors'
import { SHEET_LIFT } from '../frame'
import { addGrid, addTri, setColour, type StageMesh } from '../mesh'
import type { RoomConfig } from './config'
import { FIELD, heightAt, type SkinField } from './field'
import { addV } from './mesh'
import { plateHeight, plateSurface, type PlateInfo } from './plate'
import { COL_STEP, HANG_N, NC, SHEET_COLS, SHEET_STEP } from './sheetGrid'
import { BODY_MIN, PLATE_CELL, bodyEdge, newPlacedWindow, placeWindow, type PlacedWindow } from './window'

export { COL_STEP, HANG_N, NC, SHEET_COLS, SHEET_STEP, BODY_MIN, bodyEdge, newPlacedWindow, placeWindow }
export type { PlacedWindow }

/** How far the skirt sinks into the plate under its foot (m: the plate's grid is 1.25 cm: its facets lie a little under or over its height function), and the wall's pieces along the hole's edge. */
const SKIRT_SINK = 0.004
const SKIRT_PIECE = PLATE_CELL

const HANG_DX: readonly number[] = [0.006, 0.01, 0.013, 0.015, 0.016]
const HANG_FR: readonly number[] = [0.2, 0.45, 0.7, 0.9, 1.0]
const MAX_ROWS = 64

const env = new Float64Array(2 * NC + 1)
const profX = new Float64Array(SHEET_COLS)
const profH = new Float64Array(SHEET_COLS)
const skip = new Uint8Array(MAX_ROWS * (SHEET_COLS - 1))

/** The lowest the hang goes at lateral position `x`: the room's, and for a bore (CT) no lower than keeps the point inside its liner. */
function hangBottom(cfg: RoomConfig, x: number): number {
  if (cfg.bore <= 0) return cfg.hangBottom
  const w = cfg.bore * cfg.bore - x * x
  const lo = cfg.boreAxis - (w > 0 ? Math.sqrt(w) : 0)
  return lo > cfg.hangBottom ? lo : cfg.hangBottom
}

/** Fill the profile of the cross-section at `z`. */
function fillProfile(f: SkinField, cfg: RoomConfig, z: number, win: PlacedWindow | null, inWindow: boolean): void {
  // the highest skin at or outside each lattice column, on its own side
  for (let k = -NC; k <= NC; k++) env[k + NC] = heightAt(f.wide, z, k * COL_STEP)
  let run = 0
  for (let k = NC; k >= 0; k--) {
    if (env[k + NC] > run) run = env[k + NC]
    env[k + NC] = run
  }
  let runN = 0
  for (let k = -NC; k <= 0; k++) {
    if (env[k + NC] > runN) runN = env[k + NC]
    env[k + NC] = k === 0 ? Math.max(runN, env[NC]) : runN
  }
  let cP = bodyEdge(f.wide, z, 1, BODY_MIN) + 0.03
  let cN = bodyEdge(f.wide, z, -1, BODY_MIN) + 0.03
  if (inWindow && win !== null && win.open) {
    cP = Math.max(cP, win.x1 + 0.03)
    cN = Math.max(cN, -win.x0 + 0.03)
  }
  // (the hang starts beyond the table's edge: the sheet lies over the pad to there)
  cP = Math.min(Math.max(cP, cfg.hangFrom), cfg.sideMax)
  cN = Math.min(Math.max(cN, cfg.hangFrom), cfg.sideMax)
  const mid = HANG_N + NC
  for (let k = -NC; k <= NC; k++) {
    const xk = k * COL_STEP
    const xx = xk > cP ? cP : xk < -cN ? -cN : xk
    const ke = Math.max(-NC, Math.min(NC, xk > cP ? Math.floor(cP / COL_STEP) : xk < -cN ? -Math.floor(cN / COL_STEP) : k))
    profX[mid + k] = xx
    profH[mid + k] = env[ke + NC] + SHEET_LIFT
  }
  for (let t = 0; t < HANG_N; t++) {
    const xp = cP + HANG_DX[t]
    const xn = cN + HANG_DX[t]
    const hp = profH[mid + NC]
    const hn = profH[mid - NC]
    profX[mid + NC + 1 + t] = xp
    profH[mid + NC + 1 + t] = hp + (Math.min(hp, hangBottom(cfg, xp)) - hp) * HANG_FR[t]
    profX[mid - NC - 1 - t] = -xn
    profH[mid - NC - 1 - t] = hn + (Math.min(hn, hangBottom(cfg, xn)) - hn) * HANG_FR[t]
  }
}

/** The z of the sheet's row `r`: the lattice's (`z0` and every `SHEET_STEP`), or the hole's edge for the two rows that carry them. */
function rowZ(z0: number, win: PlacedWindow | null, r: number): number {
  if (win !== null && win.open) {
    if (r === win.r0) return win.z0
    if (r === win.r1) return win.z1
  }
  return z0 + SHEET_STEP * r
}

/**
 * The wall of cloth that closes the hole from its edge down to the plate (see the file's header), along the polyline of the sheet's vertices `ids` (n + 1 of them, taken from `m`): each
 * piece of it is the straight edge between two of them cut into `SKIRT_PIECE`s, its foot on the plate's own surface there (the mesh's, exact on its triangles) less `SKIRT_SINK`, its face
 * toward the window's inside (`inz`, `inx`: the direction into the hole in the plan).
 */
function wall(m: StageMesh, f: SkinField, plate: PlateInfo, ids: Int32Array, n: number, inz: number, inx: number): void {
  for (let i = 0; i < n; i++) {
    const a = ids[i] * 3
    const b = ids[i + 1] * 3
    const ax = m.pos[a]
    const ah = m.pos[a + 1]
    const az = m.pos[a + 2]
    const bx = m.pos[b]
    const bh = m.pos[b + 1]
    const bz = m.pos[b + 2]
    let pieces = Math.ceil(Math.hypot(bx - ax, bz - az) / SKIRT_PIECE)
    if (pieces < 1) pieces = 1
    let top0 = -1
    let foot0 = -1
    for (let q = 0; q <= pieces; q++) {
      const t = q / pieces
      const x = ax + (bx - ax) * t
      const z = az + (bz - az) * t
      const h = ah + (bh - ah) * t
      let foot = plateSurface(m, plate, z, x)
      if (foot !== foot) foot = plateHeight(f, z, x)
      foot -= SKIRT_SINK
      const top = h > foot + 0.002 ? h : foot + 0.002
      const t1 = addV(m, z, x, top)
      const f1 = addV(m, z, x, foot)
      if (q > 0) {
        // (the face toward the hole's inside: the winding is taken from the cross product, so no piece can come out inside-out)
        const to = top0 * 3
        const bo = foot0 * 3
        const ux = m.pos[bo] - m.pos[to]
        const uh = m.pos[bo + 1] - m.pos[to + 1]
        const uz = m.pos[bo + 2] - m.pos[to + 2]
        const vx = x - m.pos[to]
        const vh = top - m.pos[to + 1]
        const vz = z - m.pos[to + 2]
        const nx = uh * vz - uz * vh
        const nz = ux * vh - uh * vx
        if (nx * inx + nz * inz >= 0) {
          addTri(m, top0, foot0, t1)
          addTri(m, t1, foot0, f1)
        } else {
          addTri(m, top0, t1, foot0)
          addTri(m, t1, f1, foot0)
        }
      }
      top0 = t1
      foot0 = f1
    }
  }
}

const edgeIds = new Int32Array(SHEET_COLS + MAX_ROWS)

/** Where the last `buildSheet` put the end of the cloth's own triangles (index count: the skirt's follow): the stage splits the part there. */
export const SHEET_BUILD = { clothEnd: 0 }

/** The skirt round the hole of `win` in the sheet laid from vertex `v0` (`rows` cross-sections), on the plate `plate`: the edges whose both ends were built. */
function buildSkirt(m: StageMesh, f: SkinField, plate: PlateInfo, win: PlacedWindow, v0: number, rows: number): void {
  const c0 = HANG_N + NC + win.k0
  const c1 = HANG_N + NC + win.k1
  const ra = win.r0
  const rb = win.r1 < rows - 1 ? win.r1 : rows - 1
  if (ra >= rows - 1 || rb <= ra) return
  // the first edge along the table (toward the feet from it is the hole's inside), then the last if the sheet reaches it, then the two sides
  let n = 0
  for (let c = c0; c <= c1; c++) edgeIds[n++] = v0 + ra * SHEET_COLS + c
  wall(m, f, plate, edgeIds, n - 1, 1, 0)
  if (win.r1 <= rows - 1) {
    n = 0
    for (let c = c0; c <= c1; c++) edgeIds[n++] = v0 + win.r1 * SHEET_COLS + c
    wall(m, f, plate, edgeIds, n - 1, -1, 0)
  }
  n = 0
  for (let r = ra; r <= rb; r++) edgeIds[n++] = v0 + r * SHEET_COLS + c0
  wall(m, f, plate, edgeIds, n - 1, 0, 1)
  n = 0
  for (let r = ra; r <= rb; r++) edgeIds[n++] = v0 + r * SHEET_COLS + c1
  wall(m, f, plate, edgeIds, n - 1, 0, -1)
}

/**
 * Add the sheet to `m`: its cross-sections every 4 cm from `cfg.sheetZ0` to the leading edge `lead` (a z along the table; the last one is wherever the edge is), the window's
 * quads left out and its skirt added (when the plate `plate` it drops to is given: the plate is built first). Returns the cross-sections written (0 when the sheet has not started). The
 * lattice rows of the window (`win.r0` .. `win.r1`) are those the 4 cm spacing lays, moved onto the window's edges; so are its columns (`win.k0`, `win.k1`).
 */
export function buildSheet(m: StageMesh, f: SkinField, cfg: RoomConfig, lead: number, win: PlacedWindow | null, plate: PlateInfo | null = null): number {
  const z0 = cfg.sheetZ0
  SHEET_BUILD.clothEnd = m.ni
  if (lead < z0 + 0.004) return 0
  const stations = Math.floor((cfg.sheetZ1 - z0) / SHEET_STEP + 1e-9) + 1
  const open = win !== null && win.open
  // (the rows that carry the hole's edges lie on them: a row's z is the lattice's, or the edge's for those two; the rows still go toward the feet, so `full` counts a prefix)
  let full = 0
  while (full < stations && rowZ(z0, win, full) <= lead + 1e-9) full++
  const extra = full < stations && lead - rowZ(z0, win, full - 1) > 0.004
  const v0 = m.nv
  let rows = 0
  setColour(m, COLOUR.drape)
  const total = full + (extra ? 1 : 0)
  if (total < 2) return 0
  const mid = HANG_N + NC
  for (let r = 0; r < total && r < MAX_ROWS; r++) {
    const z = r < full ? rowZ(z0, win, r) : lead
    fillProfile(f, cfg, z, win, win !== null && r >= win.r0 - 1 && r <= win.r1 + 1)
    if (open && r >= win.r0 && r <= win.r1) {
      profX[mid + win.k0] = win.x0
      profX[mid + win.k1] = win.x1
    }
    for (let c = 0; c < SHEET_COLS; c++) addV(m, z, profX[c], profH[c])
    rows++
  }
  const q = SHEET_COLS - 1
  skip.fill(0, 0, (rows - 1) * q)
  if (open) {
    for (let r = win.r0; r < win.r1 && r < rows - 1; r++) for (let k = win.k0; k < win.k1; k++) skip[r * q + (HANG_N + NC + k)] = 1
  }
  addGrid(m, v0, rows, SHEET_COLS, false, skip)
  SHEET_BUILD.clothEnd = m.ni
  if (open && plate !== null && plate.v0 >= 0) buildSkirt(m, f, plate, win, v0, rows)
  return rows
}

/** The sheet's own limits for the tests: the rows the field allows. */
export const SHEET_LIMITS = { maxRows: MAX_ROWS, fieldZ0: FIELD.z0 } as const
