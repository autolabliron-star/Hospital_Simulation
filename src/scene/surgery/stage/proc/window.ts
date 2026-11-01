/**
 * R5 wave 3 (agent J): the window of a procedure room's sheet, and the plate under it, laid out TOGETHER so that the opaque plate always covers the hole.
 *
 * The plate is a skin-coloured grid over the window with a 3 cm margin all round (plate.ts) whose rows keep inside the body's edge. They used to be placed apart, the window by the
 * dilated field and the plate by the skin's own, and up to 8 % of the hole had no plate (the body, or the pad, showed through). Here the plate's rows are laid first, each with the body's
 * limit at its row (`PlacedWindow.eLo` / `eHi`: where the plate's edge may not pass), and the window is cut from inside them with `COVER_SAFE` to spare: for every row the hole touches the
 * window's edges are within the plate's, so by construction no point of the hole lacks plate (plate.ts builds each row as the window plus margin, clipped to the same limits).
 *
 * The window goes where the needles do (P5): `placeWindow` takes the sites (patient frame z, x pairs: the planned needles' skin entries, or the target field's middle before there are
 * any) and cuts the window to HOLD them: its edges are EXACT (the sheet's lattice rows and columns that carry them are moved to them: sheet.ts), not the lattice's own lines, so nothing
 * the body can hold is lost to rounding to 4 cm rows and 2.5 cm columns. It is as big as a procedure likes (`SITES_HALF_Z` x `SITES_HALF_X` from its middle at the least, the sites' span and
 * a margin when that is more) where the body holds every site across it, and as small as `SITES_MIN_HALF_Z` and the sites' span hold (a hand's breadth along the table) where it narrows
 * toward the head or the waist: a window cannot be wider than the narrowest row it spans, so the height is traded for the sites. The sim's entries are on the patient's skin (R5: the plan's
 * slice seen through her roll, src/sim/procedure/ctSlice.ts, calibrated so that on every avatar at every size they lie inside the window: window.test.ts P5); where the body is nevertheless
 * too narrow for a site (a body narrower than any of the avatars) the window slides inward and the nick is carried to it (marks.ts).
 */
import type { RoomConfig, WindowSpec } from './config'
import { COL_STEP, NC, SHEET_STEP } from './sheetGrid'
import { heightAt, type SkinField } from './field'

/** The body is "there" where the field stands more than this over the pad. */
export const BODY_MIN = 0.05
export const PLATE_MARGIN = 0.03
export const PLATE_CELL = 0.0125
/** How far inside the body's edge the plate's rows stay (m). */
export const PLATE_EDGE_KEEP = 0.012
/** The most rows a plate has (the window's height, its margins, at 1.25 cm: the biggest is about 40). */
export const PLATE_MAX_ROWS = 64
/** The window's edges keep this far inside the plate's own limit at every row they touch (m). */
export const COVER_SAFE = 0.005
/** What a site wants round it: the window holds a site with this much to spare along and across (m). */
export const SITE_MARGIN_Z = 0.05
export const SITE_MARGIN_X = 0.045
/** With needles to hold, the window is at least this big each way from its middle (m) where the body allows: 24 cm along and 15 cm across, what a procedure likes. */
export const SITES_HALF_Z = 0.12
export const SITES_HALF_X = 0.075
/**
 * The least it is made when the body does not hold the sites across the taller one: a hand's breadth (4 cm either side of its middle), or the sites' span and `HOLD_Z` either side. The
 * window's edges are exact, so this is the whole of it: it used to be 10 cm either side (a window spanning rows where the body is narrower than the sites need, and lattice rows
 * trimming it further).
 */
export const SITES_MIN_HALF_Z = 0.04
/** A site holds this far in from the window's edges along the table at the least (the nick keeps 1.5 cm in: marks.ts; and 5 mm). */
export const HOLD_Z = 0.02
/** The tries between the tallest window and the shortest. */
const HEIGHT_TRIES = 4
/** The most sites (the lung and the liver plan up to four needles, the kidney three). */
export const MAX_SITES = 6
/** What of the wanted width the body must hold for the window to stay where it was wanted (m); less, and it slides inward instead. */
export const MIN_WINDOW = 0.125
/** The least a window is across (two lattice columns, 5 cm); a body narrower than that at the window has none (the sheet closes). */
export const MIN_COLS = 2
/** The window never needs to be taller than this either side of its middle. */
const MAX_HALF_Z = 0.3
/** A limit that does not bind (the plate row has no body edge to keep inside). */
const FREE = 1

/**
 * The window as placed on this body: its edges in metres (`z0`, `z1`, `x0`, `x1`: exact) and the lattice rows and columns of the sheet nearest them (`r0`, `r1`, `k0`, `k1`: the sheet moves
 * those rows and columns onto the edges, by at most half a step: sheet.ts), and the plate's rows laid round it.
 */
export interface PlacedWindow {
  r0: number
  r1: number
  k0: number
  k1: number
  z0: number
  z1: number
  x0: number
  x1: number
  /** False when the body is too narrow for a window here (the sheet is closed over it). */
  open: boolean
  /** The plate's rows: its z range and row count, and at each row the lowest and highest x the plate may reach (the body's edge less `PLATE_EDGE_KEEP`; FREE where there is none). */
  rows: number
  pz0: number
  pz1: number
  eLo: Float32Array
  eHi: Float32Array
}

export function newPlacedWindow(): PlacedWindow {
  return { r0: 0, r1: 0, k0: 0, k1: 0, z0: 0, z1: 0, x0: 0, x1: 0, open: false, rows: 0, pz0: 0, pz1: 0, eLo: new Float32Array(PLATE_MAX_ROWS), eHi: new Float32Array(PLATE_MAX_ROWS) }
}

/** The outermost lateral position (metres, >= 0) where grid `g` stands more than `min` over the pad at `z`, on side `dir` (+1 / -1); 0 when nothing does. */
export function bodyEdge(g: Float32Array, z: number, dir: 1 | -1, min: number): number {
  for (let x = NC * COL_STEP; x > 0; x -= COL_STEP / 2) if (heightAt(g, z, dir * x) > min) return x
  return 0
}

/** What `trimToBody` found (module scratch). */
const SPAN = { lo: 0, hi: 0 }
/** How far from the body's end along the table the window's edge keeps (m): the plate's margin and a little (the plate itself must lie on the body). */
const SPAN_KEEP = PLATE_MARGIN + 0.015

/**
 * The span along the table (patient frame z, `SPAN.lo` .. `SPAN.hi`) of the rows round `zm` where the body is "there" (more than `BODY_MIN` over the pad) at every column from `x0` to `x1`
 * (a point every plate cell), from `zMin` to `zMax`, less `SPAN_KEEP` at an end the body has: a window over rows where the body ends (the shoulder line, the neck, past the feet) would lie
 * on the bare pad, and the plate under it on a cliff. Nothing is trimmed when the body is not there at `zm` itself (the sites are off it).
 */
function trimToBody(g: Float32Array, zm: number, x0: number, x1: number, zMin: number, zMax: number): void {
  SPAN.lo = zMin
  SPAN.hi = zMax
  if (!bodyThere(g, zm, x0, x1)) return
  let z = zm
  while (z > zMin && bodyThere(g, z - 0.01, x0, x1)) z -= 0.01
  if (z > zMin) SPAN.lo = z - 0.01 + SPAN_KEEP
  z = zm
  while (z < zMax && bodyThere(g, z + 0.01, x0, x1)) z += 0.01
  if (z < zMax) SPAN.hi = z + 0.01 - SPAN_KEEP
}

/** Whether the body is "there" (more than `BODY_MIN` over the pad) at every column from `x0` to `x1` of the row at `z` (a point every plate cell). */
function bodyThere(g: Float32Array, z: number, x0: number, x1: number): boolean {
  for (let x = x0; x <= x1 + 1e-9; x += PLATE_CELL) if (heightAt(g, z, x) <= BODY_MIN) return false
  return heightAt(g, z, x1) > BODY_MIN
}

/** What `layoutRows` found (module scratch: the placement is single-threaded and allocates nothing). */
const L = { r0: 0, r1: 0, zA: 0, zB: 0, lim0: 0, lim1: 0 }

/**
 * Lay the window's rows round `zc` (half height `hz`, shifted into the sheet's span `zLo` .. `zHi` keeping its height) and the plate's rows round them into `out` (`rows`, `pz0`, `pz1`,
 * `eLo`, `eHi`), and find the limits across the window may take: the most inward of the plate's own limits (less `COVER_SAFE`) over the rows the hole touches, and the sheet's own widest
 * (`cap`). Into `L`: the window's edges `zA`, `zB` (exact), the sheet's rows nearest them `r0` .. `r1`, and `lim0` .. `lim1`.
 */
function layoutRows(f: SkinField, cfg: RoomConfig, zc: number, hz: number, zLo: number, zHi: number, cap: number, out: PlacedWindow): void {
  let zA = zc - hz
  let zB = zc + hz
  if (zA < zLo) {
    zB += zLo - zA
    zA = zLo
  }
  if (zB > zHi) {
    zA -= zB - zHi
    zB = zHi
    if (zA < zLo) zA = zLo
  }
  // the sheet's rows nearest the edges: at least one interval apart, inside the sheet (the first and last row stay whole)
  const z0 = cfg.sheetZ0
  const stations = Math.floor((cfg.sheetZ1 - z0) / SHEET_STEP + 1e-9) + 1
  let r0 = Math.round((zA - z0) / SHEET_STEP)
  if (r0 < 1) r0 = 1
  let r1 = Math.round((zB - z0) / SHEET_STEP)
  if (r1 <= r0) r1 = r0 + 1
  if (r1 > stations - 2) {
    r1 = stations - 2
    if (r0 >= r1) r0 = r1 - 1
  }
  // the plate's rows round the window (its margin each end) and the body's limit at each
  const pz0 = zA - PLATE_MARGIN
  const pz1 = zB + PLATE_MARGIN
  const rows = Math.min(PLATE_MAX_ROWS, Math.max(3, Math.round((pz1 - pz0) / PLATE_CELL) + 1))
  const spacing = (pz1 - pz0) / (rows - 1)
  let lim0 = -cap
  let lim1 = cap
  for (let r = 0; r < rows; r++) {
    const z = pz0 + spacing * r
    const eN = bodyEdge(f.h, z, -1, BODY_MIN)
    const eP = bodyEdge(f.h, z, 1, BODY_MIN)
    out.eLo[r] = eN > 0 ? -eN + PLATE_EDGE_KEEP : -FREE
    out.eHi[r] = eP > 0 ? eP - PLATE_EDGE_KEEP : FREE
    // the rows the hole touches (and the ones either side of its ends, whose plate edges the hole's ends lie between)
    if (z >= zA - spacing - 1e-9 && z <= zB + spacing + 1e-9) {
      if (out.eLo[r] + COVER_SAFE > lim0) lim0 = out.eLo[r] + COVER_SAFE
      if (out.eHi[r] - COVER_SAFE < lim1) lim1 = out.eHi[r] - COVER_SAFE
    }
  }
  out.rows = rows
  out.pz0 = pz0
  out.pz1 = pz1
  L.r0 = r0
  L.r1 = r1
  L.zA = zA
  L.zB = zB
  L.lim0 = lim0
  L.lim1 = lim1
}

/**
 * Place the window for `spec` (widened to hold the `nSites` sites in `sites`, z and x pairs) on the body in `f` (its own grid `h`, fitted over the sheet's span), in the sheet of `cfg`:
 * its exact edges and the rows and columns of the sheet that carry them, and the plate's rows round it, inside the body at every row the hole touches and inside the sheet's widest.
 * Written into `out`.
 *
 * With sites the window is the sites' bounding box with a margin, never smaller than `SITES_HALF_Z` x `SITES_HALF_X` from its middle; a rectangle must lie inside the body at EVERY row it
 * spans, so where the body is narrower somewhere along it than the sites need (a chest over a waist) it is made shorter, toward the sites' own rows (down to `SITES_MIN_HALF_Z`, and the
 * sites' span with `HOLD_Z` to spare), until the body holds them: the tallest window that holds the most sites is taken.
 */
export function placeWindow(f: SkinField, cfg: RoomConfig, spec: WindowSpec, sites: Float64Array, nSites: number, out: PlacedWindow): PlacedWindow {
  // 1. the wanted rectangle: the default's, or the sites' bounding box with a margin
  let zc = spec.zc
  let xc = spec.xc
  let hz = spec.hz
  let hx = spec.hx
  let hzMin = hz
  let xlo = Infinity
  let xhi = -Infinity
  if (nSites > 0) {
    let zlo = Infinity
    let zhi = -Infinity
    for (let i = 0; i < nSites; i++) {
      const z = sites[i * 2]
      const x = sites[i * 2 + 1]
      if (z < zlo) zlo = z
      if (z > zhi) zhi = z
      if (x < xlo) xlo = x
      if (x > xhi) xhi = x
    }
    zc = (zlo + zhi) / 2
    xc = (xlo + xhi) / 2
    const span = (zhi - zlo) / 2
    // (a window that holds the sites needs less than the default: a hand's breadth across and a forearm along, so it need not reach rows where the body is narrower)
    const needZ = span + SITE_MARGIN_Z
    const needX = (xhi - xlo) / 2 + SITE_MARGIN_X
    hz = needZ > SITES_HALF_Z ? needZ : SITES_HALF_Z
    hx = needX > SITES_HALF_X ? needX : SITES_HALF_X
    hzMin = span + HOLD_Z > SITES_MIN_HALF_Z ? span + HOLD_Z : SITES_MIN_HALF_Z
  }
  if (hz > MAX_HALF_Z) hz = MAX_HALF_Z
  if (hzMin > hz) hzMin = hz
  const cap = cfg.sideMax - 0.04
  if (hx > cap) hx = cap

  // 2, 3 and 4. the rows, what the body allows across them, and across: the tallest window first; shorter ones toward the sites while the body does not hold them all across the
  // taller one. Then the window must lie on the body along its whole length (`trimToBody`): where it would reach rows the body is not across, it is cut short and placed again.
  const stations = Math.floor((cfg.sheetZ1 - cfg.sheetZ0) / SHEET_STEP + 1e-9) + 1
  let zLo = cfg.sheetZ0 + 0.6 * SHEET_STEP
  let zHi = cfg.sheetZ0 + (stations - 1) * SHEET_STEP - 0.6 * SHEET_STEP
  const tries = nSites > 0 && hzMin < hz ? HEIGHT_TRIES : 0
  let xw0 = 0
  let xw1 = 0
  for (let pass = 0; pass < 2; pass++) {
    let best = 0
    let bestHeld = -1
    let last = -1
    for (let k = 0; k <= tries; k++) {
      layoutRows(f, cfg, zc, hz - ((hz - hzMin) * k) / HEIGHT_TRIES, zLo, zHi, cap, out)
      last = k
      if (nSites === 0) break
      let held = 0
      for (let i = 0; i < nSites; i++) {
        const z = sites[i * 2]
        const x = sites[i * 2 + 1]
        if (z >= L.zA && z <= L.zB && x >= L.lim0 && x <= L.lim1) held++
      }
      if (held > bestHeld) {
        bestHeld = held
        best = k
      }
      if (held === nSites) break
    }
    if (last !== best) layoutRows(f, cfg, zc, hz - ((hz - hzMin) * best) / HEIGHT_TRIES, zLo, zHi, cap, out)
    // across: what of the wanted width the body holds at those rows; where that is less than a window needs (the wanted place is mostly off the body: a narrow body, a flank), the
    // window is MIN_WINDOW wide (or what the body has) against the limit nearest the wanted place, taking in as much of the wanted width as the body allows
    const lim0 = L.lim0
    const lim1 = L.lim1
    const avail = lim1 - lim0
    const wd0 = xc - hx
    const wd1 = xc + hx
    xw0 = wd0 > lim0 ? wd0 : lim0
    xw1 = wd1 < lim1 ? wd1 : lim1
    if (avail < MIN_COLS * COL_STEP) {
      xw0 = (lim0 + lim1) / 2
      xw1 = xw0
    } else if (xw1 - xw0 < MIN_WINDOW) {
      const want = MIN_WINDOW < avail ? MIN_WINDOW : avail
      if (xc >= (lim0 + lim1) / 2) {
        xw1 = wd1 < lim1 ? wd1 : lim1
        xw0 = xw1 - want
        if (xw0 < lim0) {
          xw0 = lim0
          xw1 = lim0 + want
        }
      } else {
        xw0 = wd0 > lim0 ? wd0 : lim0
        xw1 = xw0 + want
        if (xw1 > lim1) {
          xw1 = lim1
          xw0 = lim1 - want
        }
      }
    }
    if (pass === 1 || xw1 - xw0 < MIN_COLS * COL_STEP) break
    // the window on the body along its length: the body's span round the window's middle over its own columns
    trimToBody(f.h, (L.zA + L.zB) / 2, xw0, xw1, zLo, zHi)
    if (SPAN.lo <= L.zA + 1e-9 && SPAN.hi >= L.zB - 1e-9) break
    // (a body span too short for the least window leaves the window where it is: there is no better place on this body)
    if (SPAN.hi - SPAN.lo < 2 * SITES_MIN_HALF_Z) break
    zLo = SPAN.lo
    zHi = SPAN.hi
  }
  const zA = L.zA
  const zB = L.zB
  const open = xw1 - xw0 >= MIN_COLS * COL_STEP - 1e-9
  out.r0 = L.r0
  out.r1 = L.r1
  out.z0 = zA
  out.z1 = zB
  out.open = open
  if (open) {
    // (the lattice columns nearest the edges carry them: the sheet moves them onto the edges, by at most half a column)
    const k0 = Math.round(xw0 / COL_STEP)
    let k1 = Math.round(xw1 / COL_STEP)
    if (k1 <= k0) k1 = k0 + 1
    out.k0 = k0
    out.k1 = k1
    out.x0 = xw0
    out.x1 = xw1
  } else {
    // (no window: nothing is cut from the sheet; the plate is the strip the body allows)
    const k = Math.round(xw0 / COL_STEP)
    out.k0 = k
    out.k1 = k
    out.x0 = xw0
    out.x1 = xw0
  }
  return out
}
