/**
 * R5: ONE needle geometry for the CT cryo suite. The planning slice (src/sim/cryoSuite/plan.ts: mm from the tumour centre, +x the patient's LEFT, +y POSTERIOR, `dz` along the body
 * toward the head) is the patient's own frame, so the room sees it THROUGH THE ROLL the patient lies at: the kidney's patient is on her right side by `CT_OBLIQUE_DEG` (the left flank
 * up toward the robot's side: left-lateral points up and north), the lung's and the liver's lie face down (a half turn: posterior is up, the patient's left is south, her right the
 * robot's side), a level supine patient is the plain mapping. The sim, the robot's arm (src/scene/cryoSuite/pose.ts) and the drapes' window (src/scene/surgery/stage/proc/config.ts)
 * all map a needle through here, so an entry the sim plans is the entry the arm aims at and the drapes cut the window round.
 *
 * Room frame (sim: x east, y up, z south). The patient lies head WEST on the table (CRYO_SUITE.ct.table, heading +pi/2), so for a level supine body toward the head is -x, up is anterior
 * and the patient's left is -z (north). Rolled by psi about the body's long axis (+psi lifts the patient's LEFT: crowd/tablePatient.ts, `psi`: the body's roll; the half turn onto the
 * front is pi and the kidney's lateral position `OBLIQUE_DEG`), the patient's left and posterior directions in the room's (y, z) plane are
 *
 *     left      = ( sin psi, -cos psi)
 *     posterior = (-cos psi, -sin psi)
 *
 * so a slice point (sx, sy) mm from the tumour, `dz` along the body, is the room offset (y: sx sin psi - sy cos psi, z: -sx cos psi - sy sin psi, x: -dz) mm from the tumour. The map is a
 * rotation (its inverse is its transpose: `ctRoomToSliceInto`), so a path keeps its length and angles whatever the position.
 *
 * The tumour is a room point with the table OUT (`CRYO_SUITE.targets[target].tumour`) that rides in with the table (`tablePos`: the table's travel is added to x).
 *
 * The NOMINAL BODY (`ctBodyOf`): the torso's cross-section at the tumour's level as an ellipse in the patient's own frame (the pivot of the roll on the body's centre line, a pelvis' height
 * over the pad, as the crowd rolls the avatar about it), rolled by the same psi: where the skin nominally is, so the sim can say whether an entry is on the body and the robot's arm can
 * keep out of it, with no avatar in the sim. The real avatars differ from it by a few centimetres (the stage's P5 test measures the entries on the real skins).
 *
 * Everything writes into the objects it is given and allocates nothing (the per-frame paths: cryoPlaces.ts, the arm's `pathGuideInto`, the drapes' sites).
 */
import { CONFIG, type CryoTargetKey } from '../config'
import { CRYO_SUITE } from '../places'
import type { CryoTarget, PatientPosition, Vec3 } from '../types'

/** Metres per mm. */
const MM = 0.001

/**
 * The kidney's lateral position: the body rolled onto the right side by this much, the left flank up (the usual lateral decubitus is 45 to 60 degrees). The crowd's `OBLIQUE_DEG`
 * (src/scene/actors/crowd/tablePatient.ts), by value: features talk through registries, not imports; ctSlice.test.ts pins the two equal.
 */
export const CT_OBLIQUE_DEG = 55

/** The roll (radians, + lifts the patient's left) a position puts the body at on the CT table. */
export function ctRollOfPosition(position: PatientPosition): number {
  switch (position) {
    case 'prone':
      return Math.PI
    case 'obliqueLeftUp':
      return (CT_OBLIQUE_DEG * Math.PI) / 180
    default:
      return 0
  }
}

/** The cosine and sine of a target's roll (made once). */
interface Roll {
  psi: number
  c: number
  s: number
}

/** A sine or cosine without the 1e-16 a half turn leaves (the sine of pi is exactly 0, the cosine exactly -1). */
const trig = (x: number): number => Math.round(x * 1e12) / 1e12
const rollOf = (t: CryoTargetKey): Roll => {
  const psi = ctRollOfPosition(CONFIG.cryoSuite.targets[t].position)
  return { psi, c: trig(Math.cos(psi)), s: trig(Math.sin(psi)) }
}
const ROLLS: Readonly<Record<CryoTargetKey, Roll>> = { kidney: rollOf('kidney'), lung: rollOf('lung'), liver: rollOf('liver') }

/** The roll of a target's case (radians, + lifts the patient's left). */
export function ctRoll(target: CryoTarget): number {
  return ROLLS[target].psi
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** The table's travel toward the bore (sim x) at `tablePos` (0 out .. 1 at the scan position). */
export function ctTableShift(tablePos: number): number {
  const t = CRYO_SUITE.ct.table
  return (t.in.x - t.out.x) * clamp01(tablePos)
}

/** The tumour of `target` with the table at `tablePos`, into `out`. */
export function ctTumourInto(target: CryoTarget, tablePos: number, out: Vec3): Vec3 {
  const g = CRYO_SUITE.targets[target].tumour
  out.x = g.x + ctTableShift(tablePos)
  out.y = g.y
  out.z = g.z
  return out
}

/** A slice point (mm from the tumour: `sx` the patient's left, `sy` posterior; `dz` toward the head) in the room, the table at `tablePos`, into `out`. */
export function ctSliceInto(target: CryoTarget, tablePos: number, sx: number, sy: number, dz: number, out: Vec3): Vec3 {
  const g = CRYO_SUITE.targets[target].tumour
  const r = ROLLS[target]
  out.x = g.x + ctTableShift(tablePos) - dz * MM
  out.y = g.y + (sx * r.s - sy * r.c) * MM
  out.z = g.z + (-sx * r.c - sy * r.s) * MM
  return out
}

/**
 * The room direction of a vector of the slice (`dx` toward the patient's left, `dy` posterior; the paths lie in their own axial plane, so none along the body), unit length (`out` is
 * (0, 0, 0) for a zero vector).
 */
export function ctSliceDirInto(target: CryoTarget, dx: number, dy: number, out: Vec3): Vec3 {
  const r = ROLLS[target]
  const vy = dx * r.s - dy * r.c
  const vz = -dx * r.c - dy * r.s
  const l = Math.sqrt(vy * vy + vz * vz)
  out.x = 0
  if (l < 1e-12) {
    out.y = 0
    out.z = 0
    return out
  }
  out.y = vy / l
  out.z = vz / l
  return out
}

/** The slice coordinates (mm, `x` left, `y` posterior; `z` the offset along the body toward the head) of a room point: the inverse of `ctSliceInto`. Into `out`. */
export function ctRoomToSliceInto(target: CryoTarget, tablePos: number, px: number, py: number, pz: number, out: Vec3): Vec3 {
  const g = CRYO_SUITE.targets[target].tumour
  const r = ROLLS[target]
  const dy = (py - g.y) / MM
  const dz = (pz - g.z) / MM
  out.x = dy * r.s - dz * r.c
  out.y = -dy * r.c - dz * r.s
  out.z = -(px - g.x - ctTableShift(tablePos)) / MM
  return out
}

// ---------------------------------------------------------------------------------------------
// The nominal body
// ---------------------------------------------------------------------------------------------

/**
 * The body's cross-section at a target's level, in the PATIENT's frame about the roll's pivot (the body's centre line on the table, `pivotY` over the pad): an ellipse with centre
 * (`cu` toward the patient's left, `cv` posterior) from the pivot and half axes `a` (across) and `b` (front to back). Rolled by the target's roll about the pivot it is the torso as
 * the room sees it.
 */
export interface CtBody {
  cu: number
  cv: number
  a: number
  b: number
}

/** The roll's pivot: the table's centre line (z) and a pelvis' height over the pad (the avatars' `liePelvis` run 0.12 to 0.16 m). */
export const CT_PIVOT_ABOVE_PAD = 0.14

/** The nominal torso of each target at its tumour's level (metres; the numbers are measured on the avatars: window.test.ts P5). */
export const CT_BODIES: Readonly<Record<CryoTargetKey, CtBody>> = {
  kidney: { cu: 0, cv: -0.02, a: 0.19, b: 0.135 },
  lung: { cu: 0, cv: -0.02, a: 0.24, b: 0.14 },
  liver: { cu: 0, cv: -0.01, a: 0.24, b: 0.115 },
}

/** The pivot of the roll in the room (y: the table's top plus `CT_PIVOT_ABOVE_PAD`; z: the table's centre line), with the table out. */
export function ctPivotInto(out: Vec3): Vec3 {
  const t = CRYO_SUITE.ct.table
  out.x = t.out.x
  out.y = t.height + CT_PIVOT_ABOVE_PAD
  out.z = t.out.z
  return out
}

/**
 * How far (metres) a room point is outside the target's nominal body (negative inside): the distance to the ellipse of its cross-section, the body rolled about the pivot. Only the
 * point's y and z count (the body is a cylinder along the table). A point on the skin is 0.
 */
export function ctBodyOffsetOf(target: CryoTarget, y: number, z: number): number {
  const b = CT_BODIES[target]
  const r = ROLLS[target]
  const t = CRYO_SUITE.ct.table
  const py = y - (t.height + CT_PIVOT_ABOVE_PAD)
  const pz = z - t.out.z
  // into the patient's frame: u toward the left, v posterior (the slice's own axes, about the pivot)
  const u = py * r.s - pz * r.c - b.cu
  const v = -py * r.c - pz * r.s - b.cv
  return ellipseSignedDistance(u, v, b.a, b.b)
}

/**
 * The signed distance from (u, v) to the ellipse with half axes a, b (negative inside): the nearest point of the first quadrant's quarter (the ellipse is symmetric), found by a coarse
 * search over its parameter (the best basin: a point inside has two) and a ternary refinement of it. Exact to a micrometre; nothing allocates.
 */
export function ellipseSignedDistance(u: number, v: number, a: number, b: number): number {
  const au = u < 0 ? -u : u
  const av = v < 0 ? -v : v
  const STEPS = 16
  const HALF = Math.PI / 2
  let t0 = 0
  let best = Infinity
  for (let i = 0; i <= STEPS; i++) {
    const t = (HALF * i) / STEPS
    const dx = a * Math.cos(t) - au
    const dy = b * Math.sin(t) - av
    const d = dx * dx + dy * dy
    if (d < best) {
      best = d
      t0 = t
    }
  }
  let lo = t0 - HALF / STEPS
  let hi = t0 + HALF / STEPS
  if (lo < 0) lo = 0
  if (hi > HALF) hi = HALF
  for (let i = 0; i < 40; i++) {
    const m1 = lo + (hi - lo) / 3
    const m2 = hi - (hi - lo) / 3
    const dx1 = a * Math.cos(m1) - au
    const dy1 = b * Math.sin(m1) - av
    const dx2 = a * Math.cos(m2) - au
    const dy2 = b * Math.sin(m2) - av
    if (dx1 * dx1 + dy1 * dy1 < dx2 * dx2 + dy2 * dy2) hi = m2
    else lo = m1
  }
  const t = (lo + hi) / 2
  const dx = a * Math.cos(t) - au
  const dy = b * Math.sin(t) - av
  const d = Math.sqrt(dx * dx + dy * dy)
  return (au * au) / (a * a) + (av * av) / (b * b) < 1 ? -d : d
}
