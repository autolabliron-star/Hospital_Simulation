/**
 * R5 wave 2 (agent H): the skin marks, drawn on the prepped plate (plate.ts) at the ports, never red and never a wound:
 *
 *   marked   purple pen dots at the four robot ports and the 12 mm assistant port
 *   ports    small grey nicks with a short cannula stub standing up from each, the robot ports' while their arm is not docked (the docked arm brings its own cannula)
 *   closed   thin closed lines (a skin glue's grey)
 *   dressed  small white dressings
 *
 * Sites are the ports' body-frame (d, x) (ports.ts); a mark rides the plate (plate.ts `plateH`) a few millimetres over it, so a tipped table carries it along (the
 * mesh's own matrix). A site off the plate is not drawn.
 */
import type { PatientMarks } from '@/sim/types'
import { COLOUR, type Rgb } from './colors'
import { DRESSING_LIFT, MARK_LIFT } from './frame'
import { addTri, addVert, setColour, type StageMesh } from './mesh'
import { onPlate, plateH } from './plate'

/** Sites: four robot ports, then the assistant's. */
export const SITE_COUNT = 5
const ASSISTANT = 4
const SIDES = 8
const COS8 = new Float64Array(SIDES)
const SIN8 = new Float64Array(SIDES)
for (let k = 0; k < SIDES; k++) {
  COS8[k] = Math.cos((2 * Math.PI * k) / SIDES)
  SIN8[k] = Math.sin((2 * Math.PI * k) / SIDES)
}
const COS6 = new Float64Array(6)
const SIN6 = new Float64Array(6)
for (let k = 0; k < 6; k++) {
  COS6[k] = Math.cos((2 * Math.PI * k) / 6)
  SIN6[k] = Math.sin((2 * Math.PI * k) / 6)
}

/** Sizes (metres): a pen dot's radius, a nick's half-length and half-width, a dressing's half-sizes, a stub's stem and cap radius and heights. Port 5 is the 12 mm. */
export const MARK_SIZE = {
  dot: 0.006,
  nickLen: 0.007,
  nickWid: 0.0013,
  closedLen: 0.007,
  closedWid: 0.0009,
  dressX: 0.014,
  dressD: 0.011,
  stemR: 0.0045,
  stemH: 0.03,
  capR: 0.0075,
  capH: 0.009,
  /** The 12 mm assistant port: everything this much bigger. */
  assistant: 1.6,
} as const

/** A flat fan of `SIDES` triangles about (`d`, `x`), radius `r`, each rim point on the plate. */
function disc(m: StageMesh, lith: boolean, bd: number, pelvisD: number, x: number, r: number, lift: number): void {
  const centre = addVert(m, bd + pelvisD, x, plateH(lith, bd, x) + lift)
  const first = m.nv
  for (let k = 0; k < SIDES; k++) {
    const xx = x + r * COS8[k]
    const dd = bd + r * SIN8[k]
    addVert(m, dd + pelvisD, xx, plateH(lith, dd, xx) + lift)
  }
  for (let k = 0; k < SIDES; k++) addTri(m, centre, first + ((k + 1) % SIDES), first + k)
}

/** A rectangle about (`bd`, `x`) with half-sizes `hx` along x and `hd` along d, its corners on the plate. */
function rect(m: StageMesh, lith: boolean, bd: number, pelvisD: number, x: number, hx: number, hd: number, lift: number): void {
  const a = addVert(m, bd - hd + pelvisD, x - hx, plateH(lith, bd - hd, x - hx) + lift)
  const b = addVert(m, bd - hd + pelvisD, x + hx, plateH(lith, bd - hd, x + hx) + lift)
  const c = addVert(m, bd + hd + pelvisD, x - hx, plateH(lith, bd + hd, x - hx) + lift)
  const e = addVert(m, bd + hd + pelvisD, x + hx, plateH(lith, bd + hd, x + hx) + lift)
  addTri(m, a, c, b)
  addTri(m, b, c, e)
}

/** A six-sided prism standing on the plate at (`bd`, `x`): `r` wide, from `h0` to `h1` over the plate there, a capped top. */
function prism(m: StageMesh, lith: boolean, bd: number, pelvisD: number, x: number, r: number, h0: number, h1: number): void {
  // the foot sinks a few millimetres into the plate: the plate slopes under a prism
  const base = plateH(lith, bd, x) - SINK
  const b0 = m.nv
  for (let k = 0; k < 6; k++) addVert(m, bd + r * SIN6[k] + pelvisD, x + r * COS6[k], base + h0)
  const t0 = m.nv
  for (let k = 0; k < 6; k++) addVert(m, bd + r * SIN6[k] + pelvisD, x + r * COS6[k], base + h1)
  for (let k = 0; k < 6; k++) {
    const k1 = (k + 1) % 6
    addTri(m, b0 + k, t0 + k, b0 + k1)
    addTri(m, b0 + k1, t0 + k, t0 + k1)
  }
  // the top cap
  const c = addVert(m, bd + pelvisD, x, base + h1)
  for (let k = 0; k < 6; k++) addTri(m, c, t0 + ((k + 1) % 6), t0 + k)
}

/** A stub's foot goes this far under the plate's surface at its middle (the plate slopes). */
const SINK = 0.004

function colour(m: StageMesh, c: Rgb): void {
  setColour(m, c)
}

/**
 * Add the marks of `marks` for `sites` (five (body-frame d, x) pairs) on the plate of a patient whose pelvis lies at `pelvisD`. `docked` is a bit
 * mask of the robot ports (bit i: port i has its arm docked), whose stubs are then left out. Returns the sites drawn.
 */
export function buildMarks(m: StageMesh, marks: PatientMarks, lith: boolean, pelvisD: number, sites: Float64Array, docked: number): number {
  if (marks === 'none' || marks === 'needles') return 0
  let drawn = 0
  const S = MARK_SIZE
  for (let i = 0; i < SITE_COUNT; i++) {
    const bd = sites[i * 2]
    const x = sites[i * 2 + 1]
    if (!onPlate(bd, x, 0.02)) continue
    const k = i === ASSISTANT ? S.assistant : 1
    drawn++
    switch (marks) {
      case 'marked':
        colour(m, COLOUR.pen)
        disc(m, lith, bd, pelvisD, x, S.dot * k, MARK_LIFT)
        break
      case 'ports':
        colour(m, COLOUR.nick)
        rect(m, lith, bd, pelvisD, x, S.nickLen * k, S.nickWid * k, MARK_LIFT)
        if (i === ASSISTANT || (docked & (1 << i)) === 0) {
          colour(m, COLOUR.stub)
          prism(m, lith, bd, pelvisD, x, S.stemR * k, 0, S.stemH * k + SINK)
          colour(m, COLOUR.stubCap)
          prism(m, lith, bd, pelvisD, x, S.capR * k, S.stemH * k + SINK, (S.stemH + S.capH) * k + SINK)
        }
        break
      case 'closed':
        colour(m, COLOUR.closed)
        rect(m, lith, bd, pelvisD, x, S.closedLen * k, S.closedWid * k, MARK_LIFT)
        break
      case 'dressed':
        colour(m, COLOUR.dressing)
        rect(m, lith, bd, pelvisD, x, S.dressX * k, S.dressD * k, DRESSING_LIFT)
        break
    }
  }
  return drawn
}
