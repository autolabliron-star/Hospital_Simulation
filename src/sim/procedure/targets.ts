/**
 * R5: the step-by-step engine, part 6: places and points. An anchor (`ProcAnchor`) is a named spot a role stands at (a `Spot` from places.ts);
 * a target (`ProcTarget`) is a world point the hands work at or the eyes look at (sim frame; y is the height above the floor of the level, the
 * table top being 0.88). Targets on the patient follow the table's tilt and roll, so hands stay on the body when the table is tipped.
 *
 * Patient landmarks are the nominal body of ./body.ts placed on the table for the patient's position (`SURGERY.table`, head north): along the
 * table (`d`, towards the feet), across it (`x`, east +) and above its top (`h`). The ports are the case's `PortLayout` (places.ts). All of
 * them tip with the table through the one shared transform, src/sim/surgery/tablePose.ts.
 *
 * Everything writes into preallocated objects: nothing allocates per frame.
 */
import { CRYO_SUITE, IMAGING, SURGERY, type PortLayout, type Spot } from '../places'
import { setTablePose, tablePointInto, type TablePose } from '../surgery/tablePose'
import type { FocusId, PatientPosition, ProcAnchor, ProcTarget, Vec3 } from '../types'
import { BODY_LANDMARKS, PELVIS_ON_TABLE, type BodyPoint } from './body'

// ---------------------------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------------------------

/** The spot of an anchor (the shared object from places.ts: read it, never change it). */
export function anchorSpot(anchor: ProcAnchor): Spot {
  const s = SURGERY.staff
  switch (anchor) {
    case 'tableSurgeon':
      return s.tableSurgeon
    case 'assistant':
      return s.assistant
    case 'assistantWait':
      return s.assistantWait
    case 'scrub':
      return s.scrub
    case 'scrubWait':
      return s.scrubWait
    case 'circulator':
      return s.circulator
    case 'anaesHead':
      return SURGERY.anaesthesia.stand
    case 'anaesStool':
      return SURGERY.anaesthesia.stool
    case 'drive':
      return s.drive
    case 'driveEnd':
      return s.driveEnd
    case 'drape':
      return s.drape
    case 'sink0':
      return SURGERY.scrubSink.spots[0]
    case 'sink1':
      return SURGERY.scrubSink.spots[1]
    case 'surgeonConsole':
      return SURGERY.consoles.surgeon.seat
    case 'tableWest':
      return s.tableWest
    case 'tableWestHead':
      return s.tableWestHead
    case 'tableFoot':
      return s.tableFoot
    case 'scrubBackTable':
      return s.scrubBackTable
    case 'anaesLeft':
      return s.anaesLeft
    case 'circulatorCount':
      return s.circulatorCount
  }
}

// ---------------------------------------------------------------------------------------------
// The table's tilt and roll
// ---------------------------------------------------------------------------------------------

/**
 * What the targets depend on at a moment: the case's port layout, the patient's position, the table's tilt and roll (a `TablePose`: set them
 * with `setTable`), and the robot cart (by reference, "in place").
 */
export interface TargetCtx extends TablePose {
  layout: PortLayout
  /** Where the body lies on the table (./body.ts `PELVIS_ON_TABLE`): set it with `setTable`. */
  position: PatientPosition
  /** The cart's floor position: pass the robot state's `cart` object (it is read, not copied). */
  cart: { x: number; z: number }
}

export function newTargetCtx(layout: PortLayout = 'oblique'): TargetCtx {
  return { layout, position: 'supine', tiltDeg: 0, rollDeg: 0, cT: 1, sT: 0, cR: 1, sR: 0, cart: SURGERY.cart.park.at }
}

/** Set the table's tilt and roll (degrees) and, if given, the patient's position; cheap when nothing has changed. */
export function setTable(ctx: TargetCtx, tiltDeg: number, rollDeg: number, position?: PatientPosition): void {
  setTablePose(ctx, tiltDeg, rollDeg)
  if (position !== undefined) ctx.position = position
}

/**
 * A point on or over the level table, moved with the table's tilt and roll (src/sim/surgery/tablePose.ts `tablePointInto`, the transform the
 * scene's table, patient and drapes use). `out` may be the point itself.
 */
export function tiltPointInto(ctx: TargetCtx, x: number, y: number, z: number, out: Vec3): Vec3 {
  return tablePointInto(ctx, x, y, z, out)
}

// ---------------------------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------------------------

/** The landmarks the targets use (./body.ts), plus the centre of the body and the 12 mm assistant port on the patient's left (east). */
const BODY = {
  face: BODY_LANDMARKS.mouth,
  chest: BODY_LANDMARKS.chest,
  abdomen: BODY_LANDMARKS.navel,
  pelvis: BODY_LANDMARKS.pelvis,
  perineum: BODY_LANDMARKS.perineum,
  centre: { d: -0.2, x: 0, h: 0.26 },
  /** The 12 mm assistant port: on the patient's left (east), above the hip bone, within the bedside assistant's reach. */
  assistantPort: { d: -0.05, x: 0.14, h: 0.25 },
} as const satisfies Record<string, BodyPoint>

function onPatient(ctx: TargetCtx, p: BodyPoint, out: Vec3): Vec3 {
  const t = SURGERY.table
  return tablePointInto(ctx, t.at.x + p.x, t.height + p.h, t.at.z + p.d + PELVIS_ON_TABLE[ctx.position], out)
}

/** Write the world point of `target` into `out` (and return it). */
export function resolveTarget(target: ProcTarget, ctx: TargetCtx, out: Vec3): Vec3 {
  switch (target) {
    case 'patientFace':
      return onPatient(ctx, BODY.face, out)
    case 'patientChest':
      return onPatient(ctx, BODY.chest, out)
    case 'abdomen':
      return onPatient(ctx, BODY.abdomen, out)
    case 'pelvis':
      return onPatient(ctx, BODY.pelvis, out)
    case 'perineum':
      return onPatient(ctx, BODY.perineum, out)
    case 'patient':
      return onPatient(ctx, BODY.centre, out)
    case 'assistantPort':
      return onPatient(ctx, BODY.assistantPort, out)
    case 'port0':
      return portInto(ctx, 0, out)
    case 'port1':
      return portInto(ctx, 1, out)
    case 'port2':
      return portInto(ctx, 2, out)
    case 'port3':
      return portInto(ctx, 3, out)
    case 'visionMonitor':
      out.x = SURGERY.visionCart.at.x
      out.y = 1.55
      out.z = SURGERY.visionCart.at.z
      return out
    case 'anaesMonitor':
      out.x = SURGERY.anaesthesia.machine.at.x
      out.y = 1.5
      out.z = SURGERY.anaesthesia.machine.at.z
      return out
    case 'mayo':
      out.x = SURGERY.mayo.at.x
      out.y = 1.0
      out.z = SURGERY.mayo.at.z
      return out
    case 'backTable':
      out.x = SURGERY.backTable.at.x
      out.y = 0.95
      out.z = SURGERY.backTable.at.z
      return out
    case 'robotCart':
      out.x = ctx.cart.x
      out.y = 1.3
      out.z = ctx.cart.z
      return out
    case 'consoleViewer':
      out.x = SURGERY.consoles.surgeon.centre.x
      out.y = 1.25
      out.z = SURGERY.consoles.surgeon.centre.z
      return out
    case 'sink':
      out.x = SURGERY.scrubSink.at.x
      out.y = 1.1
      out.z = SURGERY.scrubSink.at.z
      return out
  }
}

function portInto(ctx: TargetCtx, i: 0 | 1 | 2 | 3, out: Vec3): Vec3 {
  const p = SURGERY.ports[ctx.layout][i]
  return tablePointInto(ctx, p.x, p.y, p.z, out)
}

/** The point the watch camera frames for a focus (sim frame). OR foci follow the table and the cart; the others are fixed places. */
export function focusPointInto(focus: FocusId, ctx: TargetCtx, out: Vec3): Vec3 {
  switch (focus) {
    case 'room':
      return onPatient(ctx, BODY.centre, out)
    case 'head':
      return resolveTarget('patientFace', ctx, out)
    case 'abdomen':
      return resolveTarget('abdomen', ctx, out)
    case 'pelvis':
      return resolveTarget('pelvis', ctx, out)
    case 'legs':
      return onPatient(ctx, BODY.perineum, out)
    case 'ports':
      return resolveTarget('port1', ctx, out)
    case 'robotCart':
      return resolveTarget('robotCart', ctx, out)
    case 'console':
      return resolveTarget('consoleViewer', ctx, out)
    case 'endoscope':
      return resolveTarget('visionMonitor', ctx, out)
    case 'mayo':
      return resolveTarget('mayo', ctx, out)
    case 'backTable':
      return resolveTarget('backTable', ctx, out)
    case 'sink':
      return resolveTarget('sink', ctx, out)
    case 'stretcher':
      return onPatient(ctx, BODY.centre, out)
    case 'ctTable':
    case 'needle':
    case 'iceBall':
      out.x = CRYO_SUITE.target.x
      out.y = CRYO_SUITE.target.y
      out.z = CRYO_SUITE.target.z
      return out
    case 'ctGantry':
      out.x = CRYO_SUITE.ct.machine.x
      out.y = 1.1
      out.z = CRYO_SUITE.ct.machine.z
      return out
    case 'cryoConsole':
      out.x = CRYO_SUITE.console.at.at.x
      out.y = 1.2
      out.z = CRYO_SUITE.console.at.at.z
      return out
    case 'controlRoom':
      out.x = CRYO_SUITE.screens.ctConsole.x
      out.y = CRYO_SUITE.screens.ctConsole.y
      out.z = CRYO_SUITE.screens.ctConsole.z
      return out
    case 'usScreen':
      out.x = IMAGING.us.machine.x
      out.y = 1.3
      out.z = IMAGING.us.machine.z
      return out
    case 'breast':
      out.x = IMAGING.us.table.in.x
      out.y = IMAGING.us.table.height + 0.2
      out.z = IMAGING.us.table.in.z
      return out
  }
}
