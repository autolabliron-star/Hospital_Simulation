/**
 * R5 wave 2 (agent H): the lithotomy leg sleeves. Each is a tube lofted through leg rings, 5 cm apart from the thigh to past the heel, that cover the leg, the stirrup's boot and a
 * leg that stops short of the boot's ankle:
 *
 *   the patient known   (fit.ts: the crowd's registry) the rings of that body's own legs and the boot, in planes PERPENDICULAR to the leg (legFrame.ts), 3.5 cm outside them:
 *                       the sleeve hugs the leg and the boot
 *   nobody known        the union of every avatar's legs and the boot, in planes of constant d, 1.2 cm outside: loose, but it clears everybody
 *
 * It starts at the thigh and unfolds toward the feet; both ends are closed (a sleeve is a stocking, not a pipe).
 */
import { COLOUR } from './colors'
import { LEG_BINS, LEG_D0, LEG_D_END, LEG_RING_FLOATS, LEG_STEP, legRingInto, legRingsPerpendicular } from './envelope'
import { fitActive } from './fit'
import { SLEEVE_LIFT, SLEEVE_LIFT_FIT } from './frame'
import { ringFrameInto } from './legFrame'
import { addTri, addVert, setColour, type StageMesh } from './mesh'

/** Where a sleeve's closed end lies beyond its last ring (metres). */
const CAP = 0.025
/** Half the distance between the two rings the axis' direction is taken from. */
const SPAN = 0.025
/** The ring angles, precomputed. */
const COS = new Float64Array(LEG_BINS)
const SIN = new Float64Array(LEG_BINS)
for (let k = 0; k < LEG_BINS; k++) {
  COS[k] = Math.cos((2 * Math.PI * k) / LEG_BINS)
  SIN[k] = Math.sin((2 * Math.PI * k) / LEG_BINS)
}
const ring = new Float64Array(LEG_RING_FLOATS)
const ringA = new Float64Array(LEG_RING_FLOATS)
const ringB = new Float64Array(LEG_RING_FLOATS)
const frame = new Float64Array(6)
/** The axis direction (x, h, d) of the last ring `axisInto` looked at. */
const axis = new Float64Array(3)

/** The unit axis direction at table-frame `d` into `axis`: along +d for the union's rings, else the direction between the rings either side. */
function axisInto(d: number): void {
  if (!legRingsPerpendicular()) {
    axis[0] = 0
    axis[1] = 0
    axis[2] = 1
    return
  }
  const a = d - SPAN < LEG_D0 ? LEG_D0 : d - SPAN
  const b = d + SPAN > LEG_D_END ? LEG_D_END : d + SPAN
  legRingInto(a, ringA)
  legRingInto(b, ringB)
  const tx = ringB[1] - ringA[1]
  const th = ringB[2] - ringA[2]
  const td = ringB[0] - ringA[0]
  const l = Math.sqrt(tx * tx + th * th + td * td)
  axis[0] = tx / l
  axis[1] = th / l
  axis[2] = td / l
}

function writeRing(m: StageMesh, side: number, d: number): void {
  legRingInto(d, ring)
  axisInto(d)
  ringFrameInto(axis[0], axis[1], axis[2], frame)
  const lift = fitActive() ? SLEEVE_LIFT_FIT : SLEEVE_LIFT
  for (let k = 0; k < LEG_BINS; k++) {
    const rho = ring[3 + k] + lift
    const a = rho * COS[k]
    const b = rho * SIN[k]
    addVert(m, ring[0] + a * frame[2] + b * frame[5], side * (ring[1] + a * frame[0] + b * frame[3]), ring[2] + a * frame[1] + b * frame[4])
  }
}

/** Table-frame d of the sleeve's leading ring when it has unfolded by `ext` (0..1). */
export function sleeveLead(ext: number): number {
  return LEG_D0 + (LEG_D_END - LEG_D0) * ext
}

/** Add the sleeve of side `side` (+1 the patient's left, east; -1 the right) unfolded by `ext` (0..1); returns the rings written. */
export function buildSleeve(m: StageMesh, side: number, ext: number): number {
  const dLead = sleeveLead(ext)
  if (dLead < LEG_D0 + 0.01) return 0
  let full = 0
  while (LEG_D0 + LEG_STEP * full <= dLead + 1e-9) full++
  const last = LEG_D0 + LEG_STEP * (full - 1)
  const extra = dLead - last > 0.004
  setColour(m, COLOUR.drape)
  const v0 = m.nv
  let rings = 0
  for (let r = 0; r < full; r++) {
    writeRing(m, side, LEG_D0 + LEG_STEP * r)
    rings++
  }
  if (extra) {
    writeRing(m, side, dLead)
    rings++
  }
  if (rings < 2) {
    m.nv = v0
    return 0
  }
  const east = side > 0
  for (let r = 0; r < rings - 1; r++) {
    for (let k = 0; k < LEG_BINS; k++) {
      const k1 = (k + 1) % LEG_BINS
      const a = v0 + r * LEG_BINS + k
      const b = v0 + r * LEG_BINS + k1
      const c = a + LEG_BINS
      const e = b + LEG_BINS
      if (east) {
        addTri(m, a, b, c)
        addTri(m, b, e, c)
      } else {
        addTri(m, a, c, b)
        addTri(m, b, c, e)
      }
    }
  }
  // the closed ends: one beyond the leading ring (facing the feet), one at the thigh (facing the hip), along the axis there
  const dEnd = extra ? dLead : last
  legRingInto(dEnd, ring)
  axisInto(dEnd)
  const farC = addVert(m, ring[0] + axis[2] * CAP, side * (ring[1] + axis[0] * CAP), ring[2] + axis[1] * CAP)
  const lastRing = v0 + (rings - 1) * LEG_BINS
  legRingInto(LEG_D0, ring)
  axisInto(LEG_D0)
  const nearC = addVert(m, ring[0] - axis[2] * CAP, side * (ring[1] - axis[0] * CAP), ring[2] - axis[1] * CAP)
  for (let k = 0; k < LEG_BINS; k++) {
    const k1 = (k + 1) % LEG_BINS
    if (east) {
      addTri(m, farC, lastRing + k, lastRing + k1)
      addTri(m, nearC, v0 + k1, v0 + k)
    } else {
      addTri(m, farC, lastRing + k1, lastRing + k)
      addTri(m, nearC, v0 + k, v0 + k1)
    }
  }
  return rings
}
