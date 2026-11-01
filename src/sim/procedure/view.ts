/**
 * R5: the step-by-step engine, part 7: the published view. `fillView` writes the state of the case in a procedure room into its
 * `ProcedureView` IN PLACE (the view is created once, by `emptyProcedureView`): the step under the clock, who does what, the patient's pose and
 * the point the camera frames. The room calls it a few times a second from its derive step (the caption and roles only change at a step
 * change; the progress and the patient's eased numbers move with the clock).
 *
 * `version` changes only when the step changes (a new step, a new repeat, a new case), so a reader that watches it redraws a caption or a step
 * list once per step. Allocation-free except at a step change (the repeat marker and the first fill's role list).
 */
import type { ProcRole, ProcedureView } from '../types'
import { patientAt } from './patient'
import { applyRoleViews, newRoleViews } from './roles'
import type { CaseSteps } from './script'
import { focusPointInto, type TargetCtx } from './targets'
import type { StepCursor } from './timing'
import { emptyPatientPose } from './empty'

/** What the room tells the view besides the step. */
export interface ViewCtx {
  /** The case in the room, and whether it is a "Watch step by step" case. */
  caseId: string | null
  watch: boolean
  /** The staff member filling each role today (by role; missing or null: nobody). Read each call: keep one object and update it. */
  entityIds: Partial<Record<ProcRole, string | null>>
  /** The table's tilt and the cart, for the focus point (the same context the targets use). */
  targets: TargetCtx
}

/** Step change: rewrite everything that belongs to the step. May allocate (a repeat marker, the first fill's roles). */
function enterStep(view: ProcedureView, cs: CaseSteps, cur: StepCursor, vc: ViewCtx): void {
  const script = cs.cs
  const step = script.script.steps[cur.index]
  view.procedureId = script.id
  view.caseId = vc.caseId
  view.watch = vc.watch
  view.unit = step.unit
  view.stepIndex = cur.flat
  view.stepCount = cs.flatCount
  view.stepId = step.id
  view.repeat = step.repeat === true && cs.repeatN > 1 ? { k: cur.k, n: cs.repeatN } : null
  view.focus = step.focus
  view.scope = script.scopeAt[cur.index]
  if (view.roles.length !== script.roles.length) view.roles = newRoleViews(script.machine)
  applyRoleViews(view.roles, script, cur.index)
  view.version++
}

/**
 * Fill `view` for the step under the clock (`cur`, from `stepAt`). Returns true when the step changed (the version was bumped).
 * The patient pose, the progress, the step's window, the role entity ids and the focus point are refreshed on every call.
 */
export function fillView(view: ProcedureView, cs: CaseSteps, cur: StepCursor, vc: ViewCtx): boolean {
  const changed = view.procedureId !== cs.cs.id || view.caseId !== vc.caseId || view.stepIndex !== cur.flat
  if (changed) enterStep(view, cs, cur, vc)
  view.watch = vc.watch
  view.stepSince = cur.since
  view.stepEnds = cur.until
  view.progress = cur.progress
  patientAt(cs, cur, view.patient)
  focusPointInto(view.focus, vc.targets, view.focusAt)
  const roles = view.roles
  for (let r = 0; r < roles.length; r++) roles[r].entityId = vc.entityIds[roles[r].role] ?? null
  return changed
}

/** The case is over: back to the empty view (the version still bumps, once). Returns true when there was a case to clear. */
export function clearView(view: ProcedureView): boolean {
  if (view.procedureId === null) return false
  view.procedureId = null
  view.caseId = null
  view.watch = false
  view.unit = ''
  view.stepIndex = -1
  view.stepCount = 0
  view.stepId = ''
  view.stepSince = 0
  view.stepEnds = 0
  view.progress = 0
  view.repeat = null
  view.focus = 'room'
  view.scope = null
  const clean = emptyPatientPose()
  Object.assign(view.patient, clean)
  for (const r of view.roles) {
    r.entityId = null
    r.action = 'idle'
    r.left = 'none'
    r.right = 'none'
    r.anchor = null
  }
  view.version++
  return true
}
