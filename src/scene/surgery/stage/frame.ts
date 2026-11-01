/**
 * R5 wave 2 (agent H): the stage's frame and constants. Everything is built in the TABLE'S OWN frame (src/sim/surgery/tablePose.ts `tableLocalInto`): `d` metres from the
 * table's centre toward the feet, `x` across (east +: the patient's left), `h` above the pad's top surface, for the LEVEL table, and stored as sim-frame positions
 * (x east, y up from the floor, z toward the feet); the mesh's matrix is the table's own (`tableMatrixInto`), so a tipped table moves the lot and a step costs one matrix.
 *
 * The BODY FRAME shifts `d` by where the pelvis lies (body.ts `PELVIS_ON_TABLE`): the same torso envelope fits a supine and a lithotomy patient.
 */
import { SURGERY } from '@/sim/places'

/** The level table's centre and top in the sim frame (x, z) and (y). */
export const CX = SURGERY.table.at.x
export const CZ = SURGERY.table.at.z
export const TOP = SURGERY.table.height

/** How far the sterile sheets stand off the highest skin of any avatar (metres): a sheet is a few millimetres thick and lies on the body, not in it. */
export const SHEET_LIFT = 0.014
/** The plate (prepped skin) sits this far over the highest skin: under the sheet's lift, so the sheet's window edge stands a centimetre proud of it. */
export const PLATE_LIFT = 0.004
/** Marks sit this far over the plate (a pen dot, a nick), a dressing a little more. */
export const MARK_LIFT = 0.0025
export const DRESSING_LIFT = 0.0035
/** The sleeves stand off the leg rings (the highest and widest of every avatar's leg, ring by ring) by this much, and off a known patient's own (fit.ts): a hugging fit, 3.5 cm. */
export const SLEEVE_LIFT = 0.012
export const SLEEVE_LIFT_FIT = 0.035
/** The plate over a known patient's own skin (the fine table is already the highest skin within a centimetre and a half): about a centimetre. */
export const PLATE_LIFT_FIT = 0.010

/** Hangs the sterile sheet reaches below the pad's top (metres, negative). */
export const HANG_BOTTOM = -0.55

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

/** 0 below `a`, 1 above `b`, a smooth ramp between. */
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
