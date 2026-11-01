/**
 * R5: the step-by-step procedure engine. Pure, seeded and allocation-free in its per-frame paths; the rooms (surgery, cryo suite, ProSense)
 * adapt it to their cases. See docs/R5-PROCEDURES.md and src/content/procedures.ts (the scripts).
 *
 *   compiledFor(id) / compileScript(script)        the compiled script (once, at module load)
 *   caseSteps(cs, 'live' | 'watch', rng, repeatN)  one case's steps (weights: real minutes with a seeded jitter, or watch seconds)
 *   stepAt(cs, unit, since, until, t, slots, out)  the step under the clock in a unit's window (slots: davinciSlots for docking / undocking)
 *   watchUnitSeconds(cs, unit, repeatN)            what a watch case needs for a unit
 *   patientAt / armsAt / scriptedExchanges         the table pose, the instrument on each arm, the planned changes
 *   fillView / clearView                           the published ProcedureView
 *   resolveTarget / anchorSpot / focusPointInto    places and points
 *   BODY_LANDMARKS / PELVIS_ON_TABLE / LITHOTOMY_LEG the nominal patient on the table (shared with the crowd, the table top and the drapes)
 */
export { compileScript, compiledFor, caseSteps, midSeconds, watchSecondsOf, COMPILED_SCRIPTS } from './script'
export type { CompiledScript, CompiledRole, CaseSteps, ArmChange, StepMode } from './script'
export { stepAt, newCursor, davinciSlots, watchUnitSeconds, watchTotalSeconds } from './timing'
export type { StepCursor, SlotFn, SlotWindow } from './timing'
export { patientAt, patientStart, copyPose, smooth01 } from './patient'
export { armsAt, scriptedExchanges } from './arms'
export type { ScriptedExchange } from './arms'
export { newRoleViews, applyRoleViews, roleLine, roleLineOf } from './roles'
export { fillView, clearView } from './view'
export type { ViewCtx } from './view'
export { anchorSpot, resolveTarget, focusPointInto, newTargetCtx, setTable, tiltPointInto } from './targets'
export type { TargetCtx } from './targets'
export { ACTION_ANIM, animOf } from './actions'
export { emptyProcedureView, emptyPatientPose } from './empty'
export { BODY_LANDMARKS, LEG_BREAK_D, LITHOTOMY_LEG, PELVIS_ON_TABLE, bodyPointOnTable } from './body'
export type { BodyPoint } from './body'
export { cryoAnchorSpot, cryoFocusInto, cryoTargetInto, newCryoTargetCtx } from './cryoPlaces'
export type { CryoAnchor, CryoFocus, CryoTargetCtx, CryoTargetId } from './cryoPlaces'
export { newUsTargetCtx, usAnchorSpot, usFocusInto, usTargetInto } from './usPlaces'
export type { UsAnchor, UsFocus, UsTargetCtx, UsTargetId } from './usPlaces'
