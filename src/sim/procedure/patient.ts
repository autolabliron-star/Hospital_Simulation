/**
 * R5: the step-by-step engine, part 3: the patient on the table at a point in a step. Pure and allocation-free.
 *
 * The script folds each step's `patient` delta onto the pose before it (`CompiledScript.poseAfter`). Inside a step the enums (position, arms,
 * airway, awareness, marks, catheter, manipulator) are the pose AFTER the step from its first moment: they switch when the step begins. The
 * numbers (head tilt, roll, prep, drape) ease from the value at the end of the step before to the value at the end of this one over the step,
 * so the pose is continuous across steps: the last moment of a step and the first of the next are the same numbers.
 */
import type { PatientPoseView } from '../types'
import type { CaseSteps } from './script'
import type { StepCursor } from './timing'

/** Smooth start and stop. */
export function smooth01(k: number): number {
  const u = k < 0 ? 0 : k > 1 ? 1 : k
  return u * u * (3 - 2 * u)
}

/** Copy every field of `from` into `to`. */
export function copyPose(to: PatientPoseView, from: PatientPoseView): PatientPoseView {
  to.position = from.position
  to.headTiltDeg = from.headTiltDeg
  to.rollDeg = from.rollDeg
  to.arms = from.arms
  to.airway = from.airway
  to.awareness = from.awareness
  to.prep = from.prep
  to.drape = from.drape
  to.marks = from.marks
  to.catheter = from.catheter
  to.manipulator = from.manipulator
  return to
}

/** The patient before the first step. */
export function patientStart(cs: CaseSteps, out: PatientPoseView): PatientPoseView {
  return copyPose(out, cs.cs.script.start)
}

/** The patient at `cursor` (a step and its progress), written into `out`. */
export function patientAt(cs: CaseSteps, cursor: StepCursor, out: PatientPoseView): PatientPoseView {
  const i = cursor.index
  const after = cs.cs.poseAfter[i]
  const before = i > 0 ? cs.cs.poseAfter[i - 1] : cs.cs.script.start
  const e = smooth01(cursor.progress)
  copyPose(out, after)
  out.headTiltDeg = before.headTiltDeg + (after.headTiltDeg - before.headTiltDeg) * e
  out.rollDeg = before.rollDeg + (after.rollDeg - before.rollDeg) * e
  out.prep = before.prep + (after.prep - before.prep) * e
  out.drape = before.drape + (after.drape - before.drape) * e
  return out
}
