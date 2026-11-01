/**
 * R5 wave 3: the CT cryo suite's anchors, targets and camera foci for the procedure engine (./targets.ts delegates every `ct*` anchor, every CT
 * target and the CT foci here). The suite (CRYO_SUITE, places.ts): the patient lies head west on the CT table, the robot is docked north, the
 * cryo console south of the control room's glass. Points on the patient ride the table (`tablePos` 0 out .. 1 in the bore) and follow the
 * patient's position for the target (kidney: left flank up, the skin window on the flank; lung and liver: prone, the skin window on the back).
 *
 * Anchors: the people's spots of CRYO_SUITE.staff. An anchor with several people at it (the table's sides, the control room's glass) has SLOTS, spots
 * in order (`cryoAnchorSlots`): the first person takes the first. `cryoAnchorSpot` is the first slot.
 *
 * Needle paths (CryoNeedleState.entry/tip/dz) are in the planning slice (+x the patient's left, +y posterior, dz toward the head), seen from the room
 * THROUGH THE PATIENT'S ROLL (./ctSlice.ts `ctSliceInto`: the kidney's patient on her right side, the lung's and the liver's face down; the robot's arm and the
 * drapes' window use the same map). The entry of the current needle is the `needleEntry` target.
 *
 * Every case has its own tumour point with the table out (`CRYO_SUITE.targets[target]`, places.ts: the kidney at the lumbar level, the lung and the liver
 * on the prone back at their own levels): the field, the entries and the table and ice foci all follow the target of the case in the room.
 *
 * Everything writes into preallocated objects: nothing allocates per frame.
 */
import { CRYO_SUITE, type Spot } from '../places'
import type { CryoTarget, FocusId, ProcAnchor, ProcTarget, Vec3 } from '../types'
import { ctSliceInto, ctTableShift } from './ctSlice'

export type CryoAnchor = Extract<ProcAnchor, `ct${string}`>
export type CryoTargetId = Extract<ProcTarget, 'ctField' | 'needleEntry' | 'ctFace' | 'robotGuide' | 'cryoScreen' | 'roomScreen' | 'ctScreen' | 'planScreen' | 'ctAnaesMachine'>
export type CryoFocus = Extract<FocusId, 'ctTable' | 'ctGantry' | 'needle' | 'iceBall' | 'cryoConsole' | 'controlRoom' | 'ctHead' | 'ctRoom'>

/** A planned needle as the context reads it (the suite's `CryoNeedleState` is one). */
export interface CtNeedlePath {
  entry: { x: number; y: number }
  dz: number
}

/** What CT targets depend on at a moment (part of the engine's `TargetCtx`, field `cryo`). */
export interface CryoTargetCtx {
  /** The CT table: 0 out .. 1 at the scan position (CryoSuiteState.tablePos). */
  tablePos: number
  target: CryoTarget
  /** The needle being worked on (CryoSuiteState.needle; -1: none). */
  needle: number
  /** The case's planned needles (CryoSuiteState.needles: the object the suite owns, read as it is). */
  needles: readonly CtNeedlePath[]
}

const NO_NEEDLES: readonly CtNeedlePath[] = []

export function newCryoTargetCtx(): CryoTargetCtx {
  return { tablePos: 0, target: 'kidney', needle: -1, needles: NO_NEEDLES }
}

const S = CRYO_SUITE.staff
/** The spots of an anchor, in the order people take them (made once). */
const SLOTS: Readonly<Record<CryoAnchor, readonly Spot[]>> = {
  ctInsert: [S.insert],
  ctConsole: [S.atConsole],
  ctHeadSouth: [S.sedation],
  ctAnaesHead: [S.anaesHead],
  ctFoot: [S.assist],
  ctSideSouth: S.sideSouth,
  ctSideNorth: S.sideNorth,
  ctControlScan: [CRYO_SUITE.seats.ctConsole],
  ctControlPlan: [CRYO_SUITE.seats.robotStation],
  ctControlStand: S.controlStand,
}

/** The spots of a CT anchor, in order (shared objects from places.ts: read them, never change them). Never empty. */
export function cryoAnchorSlots(anchor: CryoAnchor): readonly Spot[] {
  return SLOTS[anchor]
}

/** The first spot of a CT anchor (a shared object from places.ts: read it, never change it). */
export function cryoAnchorSpot(anchor: CryoAnchor): Spot {
  return SLOTS[anchor][0]
}

function at(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x
  out.y = y
  out.z = z
  return out
}

/** The table's travel toward the bore (sim x) at `tablePos` (ctSlice.ts: the same one the needles' points ride with). */
function tableShift(ctx: CryoTargetCtx): number {
  return ctTableShift(ctx.tablePos)
}

/** The tumour of the case's target with the table out (places.ts `CRYO_SUITE.targets`; the kidney's is `CRYO_SUITE.target`). */
function tumourOf(ctx: CryoTargetCtx): Vec3 {
  return CRYO_SUITE.targets[ctx.target].tumour
}

/** The skin window: the kidney's on the flank (north, up), the lung's and the liver's on the back (the prone patient's top). */
function fieldInto(ctx: CryoTargetCtx, out: Vec3): Vec3 {
  const t = CRYO_SUITE.targets[ctx.target]
  const g = t.tumour
  const f = t.field
  return at(out, g.x + tableShift(ctx) + f.x, g.y + f.y, g.z + f.z)
}

/**
 * The skin entry of needle `ctx.needle` in the room (the table at `tablePos`), or the skin window when no needle is current. The plan's entry is a point of the planning slice, seen
 * through the patient's roll (ctSlice.ts): the same map the robot's arm and the drapes' window use.
 */
function entryInto(ctx: CryoTargetCtx, out: Vec3): Vec3 {
  const n = ctx.needle >= 0 && ctx.needle < ctx.needles.length ? ctx.needles[ctx.needle] : undefined
  if (n === undefined) return fieldInto(ctx, out)
  return ctSliceInto(ctx.target, ctx.tablePos, n.entry.x, n.entry.y, n.dz, out)
}

/** Write the world point of a CT target into `out` (and return it). */
export function cryoTargetInto(target: CryoTargetId, ctx: CryoTargetCtx, out: Vec3): Vec3 {
  const sc = CRYO_SUITE.screens
  switch (target) {
    case 'ctField':
      return fieldInto(ctx, out)
    case 'needleEntry':
      return entryInto(ctx, out)
    case 'ctFace':
      return at(out, CRYO_SUITE.ct.table.out.x - 0.75 + tableShift(ctx), CRYO_SUITE.ct.table.height + (ctx.target === 'kidney' ? 0.15 : 0.13), CRYO_SUITE.ct.table.out.z)
    case 'robotGuide':
      return at(out, CRYO_SUITE.robot.mount.x, CRYO_SUITE.robot.mount.y + 0.3, CRYO_SUITE.robot.mount.z + 0.4)
    case 'cryoScreen':
      return at(out, CRYO_SUITE.console.screen.x, CRYO_SUITE.console.screen.y, CRYO_SUITE.console.screen.z)
    case 'roomScreen':
      return at(out, sc.roomLive.x, sc.roomLive.y, sc.roomLive.z)
    case 'ctScreen':
      return at(out, sc.ctConsole.x, sc.ctConsole.y, sc.ctConsole.z)
    case 'planScreen':
      return at(out, sc.robotStation.x, sc.robotStation.y, sc.robotStation.z)
    case 'ctAnaesMachine':
      return at(out, CRYO_SUITE.anaesMachine.at.at.x, CRYO_SUITE.anaesMachine.monitorY, CRYO_SUITE.anaesMachine.at.at.z)
  }
}

/** The point the watch camera frames for a CT focus (sim frame). */
export function cryoFocusInto(focus: CryoFocus, ctx: CryoTargetCtx, out: Vec3): Vec3 {
  switch (focus) {
    case 'ctTable':
    case 'iceBall': {
      const g = tumourOf(ctx)
      return at(out, g.x + tableShift(ctx), g.y, g.z)
    }
    case 'needle':
      return entryInto(ctx, out)
    case 'ctGantry':
      return at(out, CRYO_SUITE.ct.machine.x, 1.1, CRYO_SUITE.ct.machine.z)
    case 'cryoConsole':
      return at(out, CRYO_SUITE.console.at.at.x, 1.2, CRYO_SUITE.console.at.at.z)
    case 'controlRoom':
      return at(out, CRYO_SUITE.screens.ctConsole.x, CRYO_SUITE.screens.ctConsole.y, CRYO_SUITE.screens.ctConsole.z)
    case 'ctHead':
      return cryoTargetInto('ctFace', ctx, out)
    case 'ctRoom': {
      // the middle of the table top as it is now (it rides into the bore), a little above it: the whole patient and the team round her
      const t = CRYO_SUITE.ct.table
      return at(out, t.out.x + tableShift(ctx), t.height + 0.2, t.out.z)
    }
  }
}
