/**
 * R5: the empty step-by-step view a procedure room publishes between cases (`ProcedureView.procedureId` null). Each room makes one at start
 * and the engine (./view.ts) fills it in place while a case is in the room.
 */
import type { PatientPoseView, ProcedureView } from '../types'

export function emptyPatientPose(): PatientPoseView {
  return {
    position: 'supine',
    headTiltDeg: 0,
    rollDeg: 0,
    arms: 'out',
    airway: 'none',
    awareness: 'awake',
    prep: 0,
    drape: 0,
    marks: 'none',
    catheter: false,
    manipulator: false,
  }
}

export function emptyProcedureView(): ProcedureView {
  return {
    procedureId: null,
    caseId: null,
    watch: false,
    unit: '',
    stepIndex: -1,
    stepCount: 0,
    stepId: '',
    stepSince: 0,
    stepEnds: 0,
    progress: 0,
    repeat: null,
    focus: 'room',
    focusAt: { x: 0, y: 0, z: 0 },
    roles: [],
    patient: emptyPatientPose(),
    scope: null,
    version: 0,
  }
}
