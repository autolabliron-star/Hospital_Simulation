/**
 * R5: the points the watch camera frames and stands by (pure, allocation-free). An anchor is a named point of the room in SIM coordinates (y above the
 * level's floor): the working field, the patient's mouth, a port, the robot cart, the console's viewer and hand controls, the sink, the screen, the back
 * table, or a member of the team by role (where that person stands now: `ProcedureView.roles[].entityId` -> the entity's position; while nobody fills the
 * role, the spot the script puts the role at).
 *
 * Points on the patient follow the table's tilt and roll, and the cart anchors follow the cart: `syncAnchorCtx` refreshes the context once a frame from the
 * room's procedure view (the procedure engine's own `resolveTarget`, so the camera and the hands agree to the millimetre).
 */
import { PROCEDURE_META } from '@/content/procedures'
import { SURGERY_COPY } from '@/content/surgery'
import { anchorSpot, focusPointInto, newTargetCtx, resolveTarget, setTable, type CryoFocus, type CryoTargetId, type TargetCtx, type UsFocus, type UsTargetId } from '@/sim/procedure'
import type { CtNeedlePath } from '@/sim/procedure/cryoPlaces'
import { SURGERY } from '@/sim/places'
import type { CryoTarget, ProcRole, ProcedureId, ProcedureView, SurgeryProcedure, Vec3 } from '@/sim/types'

/** The room's own points. */
export type PlaceAnchor =
  | 'focus'
  | 'field'
  | 'mouth'
  | 'chest'
  | 'table'
  | 'port0'
  | 'port1'
  | 'port2'
  | 'port3'
  | 'assistantPort'
  | 'cart'
  | 'cartTable'
  | 'dock'
  | 'robotTop'
  | 'consoleViewer'
  | 'consoleHands'
  | 'sink'
  | 'monitor'
  | 'backTable'
  | 'mayo'

/**
 * The CT cryo suite's and the ultrasound room's own points (R5 wave 3, src/sim/procedure/cryoPlaces.ts and usPlaces.ts): the procedure engine's targets
 * and foci by their own names, so the camera and the hands agree to the millimetre. The CT ones follow the table's travel (`tablePos`), the case's target
 * and the needle being worked on (`syncCryoAnchors`).
 */
export type RoomAnchor = CryoTargetId | CryoFocus | UsTargetId | UsFocus

/** Something the camera looks at or stands by: a point of the room, a point of the CT or ultrasound room, or a member of the team. */
export type AnchorId = PlaceAnchor | RoomAnchor | ProcRole

/** A person's shoulder height, where the camera aims at someone (and where an over-the-shoulder eye starts from). */
export const SHOULDER_Y = 1.45

/** What the anchors read: the room's procedure view, the people, and the table and cart (the procedure engine's target context). */
export interface AnchorCtx {
  view: ProcedureView | null
  entities: ReadonlyMap<string, { position: Vec3 }> | null
  readonly targets: TargetCtx
  /** The procedure the port layout was set for. */
  layoutFor: ProcedureId | null
}

export function newAnchorCtx(): AnchorCtx {
  return { view: null, entities: null, targets: newTargetCtx('oblique'), layoutFor: null }
}

const PARK = SURGERY.cart.park.at

/** Refresh the context for this frame: the view and the people (by reference), the table's tilt and roll, the cart, the case's port layout. */
export function syncAnchorCtx(
  ctx: AnchorCtx,
  view: ProcedureView | null,
  entities: ReadonlyMap<string, { position: Vec3 }> | null,
  cart: { x: number; z: number } | null,
): void {
  ctx.view = view
  ctx.entities = entities
  const t = ctx.targets
  if (view !== null && view.procedureId !== null) {
    setTable(t, view.patient.headTiltDeg, view.patient.rollDeg, view.patient.position)
    if (ctx.layoutFor !== view.procedureId) {
      ctx.layoutFor = view.procedureId
      const meta = PROCEDURE_META[view.procedureId]
      const copy = meta.machine === 'daVinci' ? SURGERY_COPY.procedures[meta.key as SurgeryProcedure] : undefined
      t.layout = copy?.portLayout ?? 'oblique'
    }
  } else setTable(t, 0, 0, 'supine')
  t.cart = cart ?? PARK
}

/** The CT suite's state the anchors follow: the table, the case's target and the needle being worked on (`CryoSuiteState`). */
export interface CryoAnchorState {
  readonly tablePos: number
  readonly target: CryoTarget
  readonly needle: number
  readonly needles: readonly CtNeedlePath[]
}

/** Refresh the CT anchors for this frame: the table's travel into the bore, the case's target, the needle being worked on. Allocation-free. */
export function syncCryoAnchors(ctx: AnchorCtx, state: CryoAnchorState): void {
  const c = ctx.targets.cryo
  c.tablePos = state.tablePos
  c.target = state.target
  c.needle = state.needle
  c.needles = state.needles
}

/**
 * Where a role's person stands now, on the floor (y = 0), into `out`. The entity filling the role if it exists, else the spot the script puts the role at
 * this step. False (and `out` untouched) when neither is known.
 */
export function roleFloorInto(role: ProcRole, ctx: AnchorCtx, out: Vec3): boolean {
  const view = ctx.view
  if (view === null) return false
  const roles = view.roles
  for (let i = 0; i < roles.length; i++) {
    const r = roles[i]
    if (r.role !== role) continue
    if (r.entityId !== null && ctx.entities !== null) {
      const e = ctx.entities.get(r.entityId)
      if (e !== undefined) {
        out.x = e.position.x
        out.y = 0
        out.z = e.position.z
        return true
      }
    }
    if (r.anchor !== null) {
      const s = anchorSpot(r.anchor)
      out.x = s.at.x
      out.y = 0
      out.z = s.at.z
      return true
    }
    return false
  }
  return false
}

/** The middle of the four ports (the working field), tipped with the table. */
function fieldInto(ctx: AnchorCtx, out: Vec3): Vec3 {
  let x = 0
  let y = 0
  let z = 0
  resolveTarget('port0', ctx.targets, out)
  x += out.x
  y += out.y
  z += out.z
  resolveTarget('port1', ctx.targets, out)
  x += out.x
  y += out.y
  z += out.z
  resolveTarget('port2', ctx.targets, out)
  x += out.x
  y += out.y
  z += out.z
  resolveTarget('port3', ctx.targets, out)
  out.x = (x + out.x) / 4
  out.y = (y + out.y) / 4
  out.z = (z + out.z) / 4
  return out
}

/** Write the point of anchor `id` into `out` (sim coordinates) and return it. Allocation-free. */
export function anchorInto(id: AnchorId, ctx: AnchorCtx, out: Vec3): Vec3 {
  const t = ctx.targets
  switch (id) {
    case 'focus': {
      const v = ctx.view
      if (v !== null && v.procedureId !== null) {
        out.x = v.focusAt.x
        out.y = v.focusAt.y
        out.z = v.focusAt.z
        return out
      }
      return resolveTarget('patient', t, out)
    }
    case 'field':
      return fieldInto(ctx, out)
    case 'mouth':
      return resolveTarget('patientFace', t, out)
    case 'chest':
      return resolveTarget('patientChest', t, out)
    case 'table':
      return resolveTarget('patient', t, out)
    case 'port0':
    case 'port1':
    case 'port2':
    case 'port3':
      return resolveTarget(id, t, out)
    case 'assistantPort':
      return resolveTarget('assistantPort', t, out)
    case 'cart':
      return resolveTarget('robotCart', t, out)
    case 'cartTable':
      // halfway from the cart (wherever it is: parked, driving in, docked) to the patient: both in one wide frame
      out.x = (t.cart.x + SURGERY.table.at.x) / 2
      out.y = 1.3
      out.z = (t.cart.z + SURGERY.table.at.z) / 2
      return out
    case 'dock':
      out.x = SURGERY.cart.dock.at.x
      out.y = 1.3
      out.z = SURGERY.cart.dock.at.z
      return out
    case 'robotTop': {
      // under the boom, over the patient: halfway from the cart to the camera port, at the height of the arms' instrument mounts
      resolveTarget('port1', t, out)
      out.x = (t.cart.x + out.x) / 2
      out.y = 1.35
      return out
    }
    case 'consoleViewer':
      return resolveTarget('consoleViewer', t, out)
    case 'consoleHands': {
      const c = SURGERY.consoles.surgeon.centre
      out.x = c.x + 0.42
      out.y = 0.98
      out.z = c.z
      return out
    }
    case 'sink':
      return resolveTarget('sink', t, out)
    case 'monitor':
      return resolveTarget('visionMonitor', t, out)
    case 'backTable':
      return resolveTarget('backTable', t, out)
    case 'mayo':
      return resolveTarget('mayo', t, out)
    case 'ctField':
    case 'needleEntry':
    case 'ctFace':
    case 'robotGuide':
    case 'cryoScreen':
    case 'roomScreen':
    case 'ctScreen':
    case 'planScreen':
    case 'ctAnaesMachine':
    case 'breast':
    case 'usFace':
    case 'usScreen':
    case 'prosenseScreen':
      return resolveTarget(id, t, out)
    case 'ctTable':
    case 'ctGantry':
    case 'needle':
    case 'iceBall':
    case 'cryoConsole':
    case 'controlRoom':
    case 'ctHead':
    case 'ctRoom':
    case 'usRoom':
    case 'prosenseConsole':
      return focusPointInto(id, t, out)
    default: {
      // a member of the team, at shoulder height; nobody known: the patient
      if (roleFloorInto(id, ctx, out)) {
        out.y = SHOULDER_Y
        return out
      }
      return resolveTarget('patient', t, out)
    }
  }
}
