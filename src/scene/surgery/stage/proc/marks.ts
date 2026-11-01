/**
 * R5 wave 3 (agent J): the skin marks of a procedure room, drawn on the prepped plate (plate.ts), never red and never a wound (the wave-2 colours: pen purple, nick grey,
 * dressing white):
 *
 *   marked   the CT's grid sticker over the window's middle (a small square of lines the scan shows) with a pen dot at each planned needle entry; the breast's pen ring and dot
 *   needles  a small grey nick at each needle's skin entry (the CT's planned entries from the cryo sim; the breast's one)
 *   closed   thin closed lines where the nicks were
 *   dressed  small white dressings over them
 *
 * A site is the patient frame's (z along, x across); a mark rides the plate (plate.ts `plateHeight`) a few millimetres over it, so the mesh's own matrix carries it with the table.
 * The window is placed round the sites (window.ts), so each lies inside it; a site off the window (the sim's entries lie on the plan's own axes: a body narrower than the plan's, or
 * on its side, has no skin there) is carried to the window's edge, 1.5 cm in, which is inside the plate by construction: the nick is where the needle meets the skin.
 */
import type { PatientMarks } from '@/sim/types'
import { COLOUR, type Rgb } from '../colors'
import { DRESSING_LIFT, MARK_LIFT } from '../frame'
import { addTri, setColour, type StageMesh } from '../mesh'
import { MARK_SIZE } from '../marks'
import { plateHeight, plateSurface, type PlateInfo } from './plate'
import { heightAt, type SkinField } from './field'
import { addV } from './mesh'
import { MAX_SITES } from './window'
import type { RoomId } from './config'

export { MAX_SITES }
/** The sticker's half-size and the grid lines' half-width (m). */
const STICKER = { half: 0.03, line: 0.0008, lines: 3 } as const
/** The breast's pen ring (outer radius, width) and its dressing (half sizes: larger than a port's). */
const RING = { r: 0.024, w: 0.0025, segs: 16 } as const
const US_DRESSING = { hx: 0.017, hz: 0.013 } as const
const SIDES = 8
const COS8 = new Float64Array(SIDES)
const SIN8 = new Float64Array(SIDES)
for (let k = 0; k < SIDES; k++) {
  COS8[k] = Math.cos((2 * Math.PI * k) / SIDES)
  SIN8[k] = Math.sin((2 * Math.PI * k) / SIDES)
}

/**
 * The plate's surface under (`z`, `x`): the mesh's own (exact on its triangles) while the marks of this build are laid, else the field's function. Module state set by `buildMarks`
 * (a build is atomic): nothing is allocated.
 */
let plateMesh: StageMesh | null = null
let plateOf: PlateInfo | null = null
function surf(f: SkinField, z: number, x: number): number {
  if (plateMesh !== null && plateOf !== null) {
    const h = plateSurface(plateMesh, plateOf, z, x)
    if (h === h) return h
  }
  return plateHeight(f, z, x)
}

/** A flat fan about (`z`, `x`), radius `r`, each rim point on the plate. */
function disc(m: StageMesh, f: SkinField, z: number, x: number, r: number, lift: number): void {
  const centre = addV(m, z, x, surf(f, z, x) + lift)
  const first = m.nv
  for (let k = 0; k < SIDES; k++) {
    const xx = x + r * COS8[k]
    const zz = z + r * SIN8[k]
    addV(m, zz, xx, surf(f, zz, xx) + lift)
  }
  for (let k = 0; k < SIDES; k++) addTri(m, centre, first + ((k + 1) % SIDES), first + k)
}

/** A rectangle about (`z`, `x`) with half sizes `hx` across and `hz` along, its corners on the plate. */
function rect(m: StageMesh, f: SkinField, z: number, x: number, hx: number, hz: number, lift: number): void {
  const a = addV(m, z - hz, x - hx, surf(f, z - hz, x - hx) + lift)
  const b = addV(m, z - hz, x + hx, surf(f, z - hz, x + hx) + lift)
  const c = addV(m, z + hz, x - hx, surf(f, z + hz, x - hx) + lift)
  const e = addV(m, z + hz, x + hx, surf(f, z + hz, x + hx) + lift)
  addTri(m, a, c, b)
  addTri(m, b, c, e)
}

/** A thin ring about (`z`, `x`): outer radius `r`, width `w`. */
function ring(m: StageMesh, f: SkinField, z: number, x: number, r: number, w: number, segs: number, lift: number): void {
  const v0 = m.nv
  for (let k = 0; k < segs; k++) {
    const a = (2 * Math.PI * k) / segs
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    addV(m, z + r * sa, x + r * ca, surf(f, z + r * sa, x + r * ca) + lift)
    addV(m, z + (r - w) * sa, x + (r - w) * ca, surf(f, z + (r - w) * sa, x + (r - w) * ca) + lift)
  }
  for (let k = 0; k < segs; k++) {
    const k1 = (k + 1) % segs
    addTri(m, v0 + 2 * k, v0 + 2 * k + 1, v0 + 2 * k1)
    addTri(m, v0 + 2 * k1, v0 + 2 * k + 1, v0 + 2 * k1 + 1)
  }
}

function colour(m: StageMesh, c: Rgb): void {
  setColour(m, c)
}

/** Whether (`z`, `x`) is on the plate, `inset` metres inside its edge: the plate's middle and half sizes (a rectangle: its margin rows follow the body's edge a little). */
export function onPlate(p: PlateInfo, z: number, x: number, inset: number): boolean {
  return Math.abs(z - p.zc) <= p.hz - inset && Math.abs(x - p.xc) <= p.hx - inset
}

/**
 * Add the marks of `marks` for `nSites` sites (z, x pairs in `sites`) on the plate `p` of room `room`. A site off the window is carried into it (1.5 cm inside its edge: the window is
 * inside the plate by construction). The places drawn are kept in `p.drawn` (`p.nDrawn` of them). Returns the sites drawn.
 */
export function buildMarks(m: StageMesh, f: SkinField, p: PlateInfo, room: RoomId, marks: PatientMarks, sites: Float64Array, nSites: number): number {
  p.nDrawn = 0
  if (marks === 'none' || p.v0 < 0) return 0
  plateMesh = m
  plateOf = p
  const S = MARK_SIZE
  let drawn = 0
  if (marks === 'marked' && room === 'cryo') {
    // the CT's grid sticker over the middle of the window
    colour(m, COLOUR.dressing)
    rect(m, f, p.zc, p.xc, STICKER.half, STICKER.half, MARK_LIFT)
    colour(m, COLOUR.pen)
    for (let i = 0; i < STICKER.lines; i++) {
      const o = -STICKER.half + (STICKER.half * 2 * (i + 1)) / (STICKER.lines + 1)
      rect(m, f, p.zc + o, p.xc, STICKER.half, STICKER.line, MARK_LIFT + 0.0005)
      rect(m, f, p.zc, p.xc + o, STICKER.line, STICKER.half, MARK_LIFT + 0.0005)
    }
    drawn++
  }
  // (a site is carried into the window 1.5 cm from its edge, or where the pen ring of the couch's mark fits inside it)
  const iz = marks === 'marked' && room === 'us' ? RING.r + 0.004 : 0.015
  for (let i = 0; i < nSites; i++) {
    let z = sites[i * 2]
    let x = sites[i * 2 + 1]
    // (into the window: 1.5 cm inside its edges, or its middle where it is narrower than that)
    z = inside(z, p.wz0 + iz, p.wz1 - iz)
    x = inside(x, p.wx0 + iz, p.wx1 - iz)
    if (heightAt(f.h, z, x) <= 0) continue
    p.drawn[p.nDrawn * 2] = z
    p.drawn[p.nDrawn * 2 + 1] = x
    p.nDrawn++
    drawn++
    switch (marks) {
      case 'marked':
        colour(m, COLOUR.pen)
        if (room === 'us') ring(m, f, z, x, RING.r, RING.w, RING.segs, MARK_LIFT)
        disc(m, f, z, x, S.dot, MARK_LIFT)
        break
      case 'ports':
      case 'needles':
        colour(m, COLOUR.nick)
        rect(m, f, z, x, S.nickLen, S.nickWid, MARK_LIFT)
        break
      case 'closed':
        colour(m, COLOUR.closed)
        rect(m, f, z, x, S.closedLen, S.closedWid, MARK_LIFT)
        break
      case 'dressed':
        colour(m, COLOUR.dressing)
        if (room === 'us') rect(m, f, z, x, US_DRESSING.hx, US_DRESSING.hz, DRESSING_LIFT)
        else rect(m, f, z, x, S.dressX, S.dressD, DRESSING_LIFT)
        break
    }
  }
  plateMesh = null
  plateOf = null
  return drawn
}

/** `v` clamped to `lo` .. `hi` (their middle when `hi` is under `lo`). */
function inside(v: number, lo: number, hi: number): number {
  if (hi < lo) return (lo + hi) / 2
  return v < lo ? lo : v > hi ? hi : v
}
