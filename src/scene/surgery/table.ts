/**
 * R5 wave 2 (agent F): the robotic OR's LIVE table top. The base, the column and the housing stay baked into the static room (rooms/surgery/or.ts); everything
 * that rides on the column moves here, as instances of the robot rig's two pools (rig.ts: boxes and cylinders on the palette's `tinted` material), so the table
 * costs no draw call and no shader program:
 *
 *   platform    the frame under the pad (two sections: the main one and the leg section's), and the head block under it, over the column's collar
 *   pad         four sections, head / back / seat / leg, with 4 mm seams where a real table articulates
 *   rails       a rail down each side (the main one and the leg section's), where the accessories clamp
 *   braces      two shoulder braces (a padded block on a post, against the cranial side of each shoulder), shown when the head is tilted down more than 10 degrees
 *   boots       lithotomy: an Allen-style stirrup each side (a clamp on the rail just above the leg break, a pole, a padded boot cradling the calf from the knee to the
 *               ankle, a heel board). The leg section is off beyond `LEG_BREAK_D` while the patient lies in lithotomy.
 *
 * Every part is given on the LEVEL table, in the sim frame the rig works in (the room's group puts it in place), and carried by the ONE table transform the sim
 * uses (src/sim/surgery/tablePose.ts `tableMatrixInto`) from the room's `procedure.patient` (headTiltDeg, rollDeg), so the top, the patient, the drapes and the
 * robot's ports tip together. The stirrups swing in over about 1.5 s when the position changes (a critically damped follower: the exact solution, so any
 * frame time is stable and nothing overshoots), the braces slide in a little faster. Nothing is allocated in a frame.
 */
import { BODY_LANDMARKS, LEG_BREAK_D, LITHOTOMY_LEG, PELVIS_ON_TABLE } from '@/sim/procedure/body'
import { SURGERY } from '@/sim/places'
import { newTablePose, setTablePose, tableMatrixInto, type TablePose } from '@/sim/surgery/tablePose'
import type { PatientPoseView } from '@/sim/types'
import { hideInstance, putSegment } from './matrices'

// ---------------------------------------------------------------------------------------------
// Which instance is which (offsets into the rig's pools)
// ---------------------------------------------------------------------------------------------

/** Box instances: the platform's two sections, the tilting head block over the column's collar, the pad's four, the rails (left, right, left leg, right leg), two braces, then five per boot (left, right). */
export const TB = { platform: 0, block: 2, pad: 3, rail: 7, brace: 11, boot: 13, perBoot: 5 } as const
export const TABLE_BOX_COUNT = TB.boot + TB.perBoot * 2
/** Cylinder instances: the two stirrup poles, then the two brace posts. */
export const TC = { pole: 0, brace: 2 } as const
export const TABLE_CYL_COUNT = 4

/** The colours of the instances (the palette's frame, fabricTeal and metalDark, and a darker gel for the braces and boot walls). */
const FRAME = '#c6cdcf'
const WHITE = '#f5f6f6'
const PADDING = '#5ea89c'
const DARK = '#3a4245'
const GEL = '#6f8e96'
export const TABLE_BOX_HEX: readonly string[] = [
  FRAME, FRAME,
  WHITE,
  PADDING, PADDING, PADDING, PADDING,
  FRAME, FRAME, FRAME, FRAME,
  GEL, GEL,
  DARK, PADDING, GEL, GEL, DARK,
  DARK, PADDING, GEL, GEL, DARK,
]
export const TABLE_CYL_HEX: readonly string[] = [FRAME, FRAME, FRAME, FRAME]

// ---------------------------------------------------------------------------------------------
// The level table (the old static build, or.ts), in the sim frame: x east, y up from the floor, z toward the feet
// ---------------------------------------------------------------------------------------------

const CX = SURGERY.table.at.x
const CZ = SURGERY.table.at.z
const TOP = SURGERY.table.height
/** A hair of air between the sections (the pad's seams), metres. */
const SEAM = 0.004
/** The pad's section breaks along the table (d, toward the feet): head | back | seat | leg. The seat ends at the leg break. */
const BREAKS = [-0.98, -0.46, -0.04, LEG_BREAK_D, 0.98] as const

/** The head tilt (degrees) below which the shoulder braces are on. */
export const BRACE_TILT_DEG = -10
/** Seconds to swing a stirrup in (about: a critically damped follower reaches 95 % at 4.74 / omega), and the braces'. */
export const OMEGA_BOOT = 3.2
const OMEGA_BRACE = 6

// the stirrups (table frame: d toward the feet, xs outward from the centre line, h above the top). The calf lies from the knee to the ankle (body.ts
// LITHOTOMY_LEG, the pelvis slid 0.3 m); the boot's sole lies BOOT_DROP below it
const BOOT_DROP = 0.085
/** The sole runs on past the ankle joint to the heel (the heel is about 9 cm beyond it along the leg), where the heel board stands. */
export const HEEL_REACH = 0.09
const KNEE_D = PELVIS_ON_TABLE.lithotomy + LITHOTOMY_LEG.knee.d
const KNEE_X = LITHOTOMY_LEG.knee.x
const KNEE_H = LITHOTOMY_LEG.knee.h - BOOT_DROP
const ANK_D = PELVIS_ON_TABLE.lithotomy + LITHOTOMY_LEG.ankle.d
const ANK_X = LITHOTOMY_LEG.ankle.x
const ANK_H = LITHOTOMY_LEG.ankle.h - BOOT_DROP
const AX_LEN = Math.hypot(ANK_D - KNEE_D, ANK_X - KNEE_X, ANK_H - KNEE_H)
const AX_D = (ANK_D - KNEE_D) / AX_LEN
const AX_X = (ANK_X - KNEE_X) / AX_LEN
const AX_H = (ANK_H - KNEE_H) / AX_LEN
/** The clamp on the side rail, just above the leg break; the stirrup swings about it. */
const CLAMP_D = LEG_BREAK_D - 0.04
const RAIL_X = 0.265
const CLAMP_X = RAIL_X + 0.03
const CLAMP_H = -0.04
/** The pole runs from the clamp to the middle of the boot's sole. */
const POLE_D = (KNEE_D + ANK_D + AX_D * HEEL_REACH) / 2
const POLE_X = (KNEE_X + ANK_X + AX_X * HEEL_REACH) / 2
const POLE_H = (KNEE_H + ANK_H + AX_H * HEEL_REACH) / 2 - 0.02

// the shoulder braces: a block on the cranial side of the shoulder (body.ts), on a post at the rail
const SHOULDER = BODY_LANDMARKS.shoulder
const BRACE_D = SHOULDER.d - 0.1
const BRACE_X0 = 0.12
const BRACE_X1 = 0.3

// ---------------------------------------------------------------------------------------------
// Memory and scratch
// ---------------------------------------------------------------------------------------------

/** What the table remembers between frames: its pose, its matrix, and the two followers (value, velocity): the stirrups' swing and the braces'. */
export interface TableMemory {
  pose: TablePose
  /** The top's 4x4 (column-major), about the pivot. */
  m: Float64Array
  /** [stirrups, their velocity, braces, their velocity]; 0 stowed .. 1 in place. */
  st: Float64Array
  /** False until the first frame, which snaps the followers to where the patient is (no swing on a warm start). */
  init: boolean
}

export function newTableMemory(): TableMemory {
  const m = new Float64Array(16)
  const pose = newTablePose()
  tableMatrixInto(pose, m)
  return { pose, m, st: new Float64Array(4), init: false }
}

const _a = new Float64Array(3)
const _b = new Float64Array(3)
const _h = new Float64Array(3)

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

/**
 * One step of a critically damped follower toward `target` (the exact solution of x'' = -2 w x' - w^2 (x - target) over `dt`): no overshoot from rest, stable
 * for any frame time. Reads and writes `st[i]` (value) and `st[i + 1]` (velocity).
 */
export function settle(st: Float64Array, i: number, target: number, omega: number, dt: number): void {
  if (dt <= 0) return
  const x = st[i] - target
  const t = (st[i + 1] + omega * x) * dt
  const e = Math.exp(-omega * dt)
  st[i] = target + (x + t) * e
  st[i + 1] = (st[i + 1] - omega * t) * e
}

// ---------------------------------------------------------------------------------------------
// Writing instances
// ---------------------------------------------------------------------------------------------

/** An axis-aligned box of the LEVEL table (centre in the sim frame, sizes along x, y, z), carried by the top's matrix `M`. */
function boxAt(a: Float32Array, i: number, M: Float64Array, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): void {
  const o = i * 16
  a[o] = M[0] * sx
  a[o + 1] = M[1] * sx
  a[o + 2] = M[2] * sx
  a[o + 3] = 0
  a[o + 4] = M[4] * sy
  a[o + 5] = M[5] * sy
  a[o + 6] = M[6] * sy
  a[o + 7] = 0
  a[o + 8] = M[8] * sz
  a[o + 9] = M[9] * sz
  a[o + 10] = M[10] * sz
  a[o + 11] = 0
  a[o + 12] = M[0] * cx + M[4] * cy + M[8] * cz + M[12]
  a[o + 13] = M[1] * cx + M[5] * cy + M[9] * cz + M[13]
  a[o + 14] = M[2] * cx + M[6] * cy + M[10] * cz + M[14]
  a[o + 15] = 1
}

/** A box from bounds in the table's own frame (x across from the centre line, y absolute, d along from the centre), the level table's. */
function boxBounds(a: Float32Array, i: number, M: Float64Array, x0: number, x1: number, y0: number, y1: number, d0: number, d1: number): void {
  boxAt(a, i, M, CX + (x0 + x1) / 2, (y0 + y1) / 2, CZ + (d0 + d1) / 2, x1 - x0, y1 - y0, d1 - d0)
}

/**
 * A point of a stirrup (d along the table, xs outward from the centre line on side `s` (+1 the patient's left, east), h above the top), swung about the clamp
 * by the angle whose cosine and sine are `c` and `sn` (0 deployed: the stirrup points to the feet; a quarter turn: out to the side), then carried by `M`.
 */
function stirPoint(M: Float64Array, s: number, c: number, sn: number, d: number, xs: number, h: number, out: Float64Array): void {
  const dd = d - CLAMP_D
  const xx = xs - CLAMP_X
  const lx = CX + s * (CLAMP_X + dd * sn + xx * c)
  const ly = TOP + h
  const lz = CZ + CLAMP_D + dd * c - xx * sn
  out[0] = M[0] * lx + M[4] * ly + M[8] * lz + M[12]
  out[1] = M[1] * lx + M[5] * ly + M[9] * lz + M[13]
  out[2] = M[2] * lx + M[6] * ly + M[10] * lz + M[14]
}

/** The stirrup's "across the boot" direction (the table's x on side `s`, swung), carried by the top's linear part, into `_h`. */
function acrossInto(M: Float64Array, s: number, c: number, sn: number): void {
  const lx = s * c
  const lz = -sn
  _h[0] = M[0] * lx + M[8] * lz
  _h[1] = M[1] * lx + M[9] * lz
  _h[2] = M[2] * lx + M[10] * lz
}

function hideBoot(bm: Float32Array, cm: Float32Array, b: number, c: number): void {
  for (let k = 0; k < TB.perBoot; k++) hideInstance(bm, b + k)
  hideInstance(cm, c)
}

/** One stirrup (side `s`), box instances from `b`, its pole cylinder `c`: the clamp, the pole, the boot's sole, its two padded walls and the heel board. */
function writeBoot(bm: Float32Array, cm: Float32Array, b: number, c: number, M: Float64Array, s: number, cs: number, sn: number): void {
  // the clamp round the rail does not swing
  boxAt(bm, b, M, CX + s * (RAIL_X + 0.02), TOP - 0.055, CZ + CLAMP_D, 0.07, 0.1, 0.05)
  acrossInto(M, s, cs, sn)
  stirPoint(M, s, cs, sn, CLAMP_D, CLAMP_X, CLAMP_H, _a)
  stirPoint(M, s, cs, sn, POLE_D, POLE_X, POLE_H, _b)
  putSegment(cm, c, _a[0], _a[1], _a[2], _b[0], _b[1], _b[2], 0.032, 0.032, 1, 0, 0)
  // the sole, under the calf from the knee to the ankle and on to the heel
  stirPoint(M, s, cs, sn, KNEE_D, KNEE_X, KNEE_H, _a)
  stirPoint(M, s, cs, sn, ANK_D + AX_D * HEEL_REACH, ANK_X + AX_X * HEEL_REACH, ANK_H + AX_H * HEEL_REACH, _b)
  putSegment(bm, b + 1, _a[0], _a[1], _a[2], _b[0], _b[1], _b[2], 0.12, 0.025, _h[0], _h[1], _h[2])
  // the two padded walls up each side of the calf
  for (let w = 0; w < 2; w++) {
    const o = w === 0 ? 0.058 : -0.058
    stirPoint(M, s, cs, sn, KNEE_D, KNEE_X + o, KNEE_H + 0.045, _a)
    stirPoint(M, s, cs, sn, ANK_D, ANK_X + o, ANK_H + 0.045, _b)
    putSegment(bm, b + 2 + w, _a[0], _a[1], _a[2], _b[0], _b[1], _b[2], 0.012, 0.075, _h[0], _h[1], _h[2])
  }
  // the heel board, across the boot at its far end, where the heel rests
  stirPoint(M, s, cs, sn, ANK_D + AX_D * HEEL_REACH, ANK_X + AX_X * HEEL_REACH, ANK_H + AX_H * HEEL_REACH + 0.05, _a)
  stirPoint(M, s, cs, sn, ANK_D + AX_D * (HEEL_REACH + 0.025), ANK_X + AX_X * (HEEL_REACH + 0.025), ANK_H + AX_H * (HEEL_REACH + 0.025) + 0.05, _b)
  putSegment(bm, b + 4, _a[0], _a[1], _a[2], _b[0], _b[1], _b[2], 0.13, 0.11, _h[0], _h[1], _h[2])
}

/** One shoulder brace (side `s`, slid out by `out` metres): the block against the shoulder, on a post down to the rail. `d` is where the shoulder lies on the table. */
function writeBrace(bm: Float32Array, cm: Float32Array, b: number, c: number, M: Float64Array, s: number, d: number, out: number): void {
  const x0 = BRACE_X0 + out
  const x1 = BRACE_X1 + out
  boxAt(bm, b, M, CX + s * ((x0 + x1) / 2), TOP + 0.065, CZ + d, x1 - x0, 0.13, 0.06)
  const px = CX + s * (BRACE_X1 - 0.015 + out)
  const pz = CZ + d
  // the post: from under the rail's level up into the block
  const ax = M[0] * px + M[4] * (TOP - 0.075) + M[8] * pz + M[12]
  const ay = M[1] * px + M[5] * (TOP - 0.075) + M[9] * pz + M[13]
  const az = M[2] * px + M[6] * (TOP - 0.075) + M[10] * pz + M[14]
  const bx = M[0] * px + M[4] * (TOP + 0.06) + M[8] * pz + M[12]
  const by = M[1] * px + M[5] * (TOP + 0.06) + M[9] * pz + M[13]
  const bz = M[2] * px + M[6] * (TOP + 0.06) + M[10] * pz + M[14]
  putSegment(cm, c, ax, ay, az, bx, by, bz, 0.03, 0.03, 1, 0, 0)
}

/**
 * Write the live table for the patient's pose `p` (the room's `procedure.patient`): the top's matrix from its tilt and roll, the sections, the rails, the boots
 * (swung in by the position) and the braces (by the head tilt). `b0` and `c0` are the table's first instance in the rig's box and cylinder pools; `dt` is the
 * real seconds since the last frame (0 while paused). Allocation-free.
 */
export function writeTable(bm: Float32Array, cm: Float32Array, b0: number, c0: number, p: Readonly<PatientPoseView>, dt: number, mem: TableMemory): void {
  const lithT = p.position === 'lithotomy' ? 1 : 0
  const braceT = p.headTiltDeg < BRACE_TILT_DEG ? 1 : 0
  const st = mem.st
  if (!mem.init) {
    mem.init = true
    st[0] = lithT
    st[1] = 0
    st[2] = braceT
    st[3] = 0
  } else {
    settle(st, 0, lithT, OMEGA_BOOT, dt)
    settle(st, 2, braceT, OMEGA_BRACE, dt)
  }
  const lith = clamp01(st[0])
  const brace = clamp01(st[2])
  setTablePose(mem.pose, p.headTiltDeg, p.rollDeg)
  const M = mem.m
  tableMatrixInto(mem.pose, M)

  // the leg section comes off as the stirrups go in
  const legOn = lith < 0.5
  const hw = 0.25
  const B0 = BREAKS[0]
  const B3 = BREAKS[3]
  const B4 = BREAKS[4]
  boxBounds(bm, b0 + TB.platform, M, -hw, hw, 0.8, 0.84, -1.0, B3 - SEAM)
  boxBounds(bm, b0 + TB.block, M, -0.16, 0.16, 0.68, 0.8, 0.04, 0.36)
  if (legOn) boxBounds(bm, b0 + TB.platform + 1, M, -hw, hw, 0.8, 0.84, B3 + SEAM, 1.0)
  else hideInstance(bm, b0 + TB.platform + 1)
  for (let k = 0; k < 4; k++) {
    if (k === 3 && !legOn) hideInstance(bm, b0 + TB.pad + 3)
    else boxBounds(bm, b0 + TB.pad + k, M, -hw, hw, 0.83, TOP, BREAKS[k] + (k === 0 ? 0 : SEAM), BREAKS[k + 1] - (k === 3 ? 0 : SEAM))
  }
  boxBounds(bm, b0 + TB.rail, M, -RAIL_X - 0.01, -RAIL_X + 0.01, 0.79, 0.84, B0 + 0.03, B3 - SEAM)
  boxBounds(bm, b0 + TB.rail + 1, M, RAIL_X - 0.01, RAIL_X + 0.01, 0.79, 0.84, B0 + 0.03, B3 - SEAM)
  if (legOn) {
    boxBounds(bm, b0 + TB.rail + 2, M, -RAIL_X - 0.01, -RAIL_X + 0.01, 0.79, 0.84, B3 + SEAM, B4 - 0.03)
    boxBounds(bm, b0 + TB.rail + 3, M, RAIL_X - 0.01, RAIL_X + 0.01, 0.79, 0.84, B3 + SEAM, B4 - 0.03)
  } else {
    hideInstance(bm, b0 + TB.rail + 2)
    hideInstance(bm, b0 + TB.rail + 3)
  }

  // the stirrups: a quarter turn out to the side when stowed, swung in to point to the feet
  const bb = b0 + TB.boot
  if (lith < 0.004) {
    hideBoot(bm, cm, bb, c0 + TC.pole)
    hideBoot(bm, cm, bb + TB.perBoot, c0 + TC.pole + 1)
  } else {
    const phi = (1 - lith) * (Math.PI / 2)
    const cs = Math.cos(phi)
    const sn = Math.sin(phi)
    writeBoot(bm, cm, bb, c0 + TC.pole, M, 1, cs, sn)
    writeBoot(bm, cm, bb + TB.perBoot, c0 + TC.pole + 1, M, -1, cs, sn)
  }

  // the shoulder braces, sliding in from the side as the head goes down
  if (brace < 0.004) {
    hideInstance(bm, b0 + TB.brace)
    hideInstance(bm, b0 + TB.brace + 1)
    hideInstance(cm, c0 + TC.brace)
    hideInstance(cm, c0 + TC.brace + 1)
  } else {
    // (the shoulders lie where the body does: slid toward the feet by the stirrups' position, with them)
    const d = BRACE_D + PELVIS_ON_TABLE.lithotomy * lith
    const out = (1 - brace) * 0.15
    writeBrace(bm, cm, b0 + TB.brace, c0 + TC.brace, M, 1, d, out)
    writeBrace(bm, cm, b0 + TB.brace + 1, c0 + TC.brace + 1, M, -1, d, out)
  }
}
