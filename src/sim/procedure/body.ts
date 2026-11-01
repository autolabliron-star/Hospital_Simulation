/**
 * R5 wave 2: where a patient's body lies on the OR table, by position. One nominal person (1.75 m: the crowd's NOMINAL_BODY proportions, lying
 * with the pelvis centre at the anchor) shared by the sim (the targets hands work at, the camera's foci), the crowd (the patient's pose: it
 * places each avatar's pelvis at `PELVIS_ON_TABLE` and steers the lithotomy ankles into the boots), the live table top (the boots, the removed
 * leg section) and the drapes. Avatars differ by a few centimetres; the shared points keep hands, boots and drapes on the same body.
 *
 * Frame: the table top's own (src/sim/surgery/tablePose.ts `tableLocalInto`): `d` toward the feet, `x` across (east +: the patient's left,
 * the table's head being north), `h` above the top surface. Landmarks are relative to the pelvis centre: add `PELVIS_ON_TABLE[position]` to `d`.
 * The right side mirrors the left (x negated).
 */
import type { PatientPosition } from '../types'

export interface BodyPoint {
  d: number
  x: number
  h: number
}

/**
 * Where the pelvis centre lies along the table (from the table's centre, toward the feet). Supine: on the centre, as the crowd has always laid
 * a patient on the table's seat. Lithotomy: slid down so the buttocks reach the table's leg break (`LEG_BREAK_D`), the leg section removed.
 * Prone and oblique are the CT table's (wave 3) and keep the centre here.
 */
export const PELVIS_ON_TABLE: Record<PatientPosition, number> = { supine: 0, lithotomy: 0.3, prone: 0, obliqueLeftUp: 0 }

/** Lithotomy: the table's leg section is taken off from here to the foot end (table frame d); the boots clamp to the side rails just above it. */
export const LEG_BREAK_D = 0.4

/** Surface landmarks of a supine nominal patient (skin, not joints, except the hip, knee and ankle), relative to the pelvis centre. */
export const BODY_LANDMARKS = {
  crown: { d: -0.815, x: 0, h: 0.1 },
  /** The mouth (laryngoscope, tube, mask). */
  mouth: { d: -0.62, x: 0, h: 0.17 },
  eyes: { d: -0.71, x: 0, h: 0.19 },
  /**
   * The sternum's middle. R5 wave 2: the torso heights are the realistic avatars' (src/scene/surgery/stage/envelope.data.ts measured their skin over
   * the abdomen at 0.21-0.33 m above the pad, gowned), not the slimmer procedural body's: hands and ports sit at the skin, under the prepped plate.
   */
  chest: { d: -0.32, x: 0, h: 0.28 },
  /** The navel, on the gas-filled belly: the camera port of a cholecystectomy, 3 cm under a pelvic case's port line (places.ts SURGERY.ports, y). */
  navel: { d: -0.1, x: 0, h: 0.26 },
  /** Above the pubic bone (the pelvic field). */
  pelvis: { d: 0.02, x: 0, h: 0.26 },
  perineum: { d: 0.13, x: 0, h: 0.05 },
  /** The left hip joint, knee and ankle lying flat (supine). */
  hip: { d: 0.05, x: 0.092, h: 0.07 },
  knee: { d: 0.47, x: 0.1, h: 0.1 },
  ankle: { d: 0.87, x: 0.11, h: 0.08 },
  /** The left shoulder joint, and the left wrist with the arm tucked along the side (supine, arms 'tucked'). */
  shoulder: { d: -0.465, x: 0.19, h: 0.08 },
  wristTucked: { d: 0.02, x: 0.26, h: 0.06 },
} as const satisfies Record<string, BodyPoint>

/**
 * Low lithotomy for robotic pelvic surgery (hips bent about 15 degrees and spread about 30, knees bent a little more, so the robot's arms clear
 * the thighs): the left knee and ankle relative to the pelvis centre. The boot cradles the calf between them; the crowd steers each avatar's
 * ankle to `ankle` and lets the knee fall where its own thigh puts it.
 */
export const LITHOTOMY_LEG = {
  knee: { d: 0.4, x: 0.3, h: 0.14 },
  ankle: { d: 0.77, x: 0.36, h: 0.0 },
} as const satisfies Record<string, BodyPoint>

/** A landmark of the left side (x as given) or the right (x negated), placed on the table for `position`: written into `out` (table frame). */
export function bodyPointOnTable(p: BodyPoint, position: PatientPosition, right: boolean, out: BodyPoint): BodyPoint {
  out.d = p.d + PELVIS_ON_TABLE[position]
  out.x = right ? -p.x : p.x
  out.h = p.h
  return out
}
