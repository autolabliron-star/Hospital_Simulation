/**
 * R5 "Watch step by step": the rooms you can watch a procedure in, as the watch camera sees them: the robotic theatre (wave 1), the CT cryo suite and the
 * ultrasound room (wave 3). Each has a spot to stand at while you watch, the area the camera stays in, how to read the room's procedure view, the moving machine
 * its anchors or its obstacles follow, its furniture, and its "Watch step by step" port; the shot sets are in shots.ts and the insets in the `insetSources` registry.
 *
 * Everything is in SIM coordinates (level 2 lives in its own strip of the flat sim, sim x = drawn x + 150, y floor-relative): the director converts to
 * where it is drawn (`toDisplayInto`) only when it writes the camera.
 */
import { PROCEDURE_META } from '@/content/procedures'
import type { Footprint } from '@/scene/building/layout'
import { LIGHTS } from '@/scene/surgery/dims'
import type { CryoNoTeamWhy } from '@/sim/cryoSuite/ports'
import { CRYO_SUITE, DOORS, SURGERY, type AreaId, type Spot } from '@/sim/places'
import type { CtNeedlePath } from '@/sim/procedure/cryoPlaces'
import type { CryoTarget, ProcMachine, ProcedureId, ProcedureView, SurgeryProcedure, Vec3, WatchResult } from '@/sim/types'
import { addObstacle, furnitureTop, newObstacles, type Obstacles } from './limits'

export type WatchRoomId = 'or' | 'cryo' | 'us'

export interface WatchRoomDef {
  id: WatchRoomId
  machine: ProcMachine
  /** The room's area: the camera stands inside it (shots may name another area, the theatre hall's sinks). */
  area: AreaId
  /** Where you stand while you watch: on the room's level, outside the room itself (the theatre corridor's viewing window, the CT suite's control room, the ultrasound room's doorway). */
  spot: Spot
  /** The areas whose furniture the camera keeps out of (the room, and the hall of its sinks). */
  furnitureAreas: readonly AreaId[]
}

/**
 * The ultrasound room's watch spot: in the imaging hall, a metre outside the room's door, facing it (you watch from the doorway: the room's walls hide
 * nothing from the watch camera, which stands inside).
 */
const US_DOOR = DOORS.find((d) => d.id === 'ultrasound')!
export const US_WATCH_SPOT: Spot = { at: { x: US_DOOR.center.x, z: US_DOOR.center.z - 1.1 }, heading: 0 }

/**
 * The rooms that can be watched: the robotic theatre (you stand at the corridor's viewing window), the CT cryo suite (in the control room, behind its
 * glass: the scan room's camera stays on the scan room's side of it, and the control room is a second area of the suite) and the ultrasound room (outside
 * its door).
 */
export const WATCH_ROOMS: Readonly<Record<WatchRoomId, WatchRoomDef>> = {
  or: { id: 'or', machine: 'daVinci', area: 'l2Or', spot: SURGERY.viewing, furnitureAreas: ['l2Or', 'l2Hall'] },
  cryo: { id: 'cryo', machine: 'cryoCt', area: 'l2Cryo', spot: CRYO_SUITE.viewing, furnitureAreas: ['l2Cryo', 'l2CryoControl'] },
  us: { id: 'us', machine: 'prosense', area: 'ultrasound', spot: US_WATCH_SPOT, furnitureAreas: ['ultrasound'] },
}

const ROOM_OF_MACHINE: Record<ProcMachine, WatchRoomId> = { daVinci: 'or', cryoCt: 'cryo', prosense: 'us' }

/** The room a procedure is watched in. */
export function roomOfProcedure(id: ProcedureId): WatchRoomId {
  return ROOM_OF_MACHINE[PROCEDURE_META[id].machine]
}

/** The procedures of a room, in the content's order. */
export function proceduresOfRoom(room: WatchRoomId): ProcedureId[] {
  return (Object.keys(PROCEDURE_META) as ProcedureId[]).filter((id) => roomOfProcedure(id) === room)
}

// ---------------------------------------------------------------------------------------------
// What the watch reads of the sim, per room (a narrow structural type, so node tests pass small fakes)
// ---------------------------------------------------------------------------------------------

/** The part of the surgery suite the watch reads and calls (`SurgeryPort`). */
export interface WatchSurgery {
  readonly state: { readonly procedure: ProcedureView; readonly robot: { readonly cart: { x: number; z: number; heading: number } } }
  startWatch(procedure: SurgeryProcedure, opts?: { fromStart?: boolean }): WatchResult
  readonly watchStartsAt: number | null
}

/** The part of the CT cryo suite the watch reads and calls (`CryoSuitePort`): the case's view, the table and the needles (the anchors follow them). */
export interface WatchCryo {
  readonly state: {
    readonly procedure: ProcedureView
    /** The CT table: 0 out .. 1 in the bore. */
    readonly tablePos: number
    readonly target: CryoTarget
    readonly needle: number
    readonly needles: readonly CtNeedlePath[]
  }
  startWatch(target: CryoTarget, opts?: { fromStart?: boolean }): WatchResult
  readonly watchStartsAt: number | null
  readonly whyNoTeam: CryoNoTeamWhy | null
}

/**
 * The part of the imaging department the watch reads and calls (`ImagingDepartment`): the ultrasound room's ProSense view, and its watch case. Its
 * `watchStartsAt` is a getter that allocates (a projection of the queue): read it only at the panel's 4 Hz, never in a frame.
 */
export interface WatchImaging {
  readonly scanners: { readonly us: { readonly procedure: ProcedureView } }
  startWatch(protocolId: string, opts?: { fromStart?: boolean }): WatchResult
  readonly watchStartsAt: number | null
}

/** A person as the watch camera sees them (`Entity`): where they are, and whether they are a body in the way (not the patient lying on the table). */
export interface WatchEntity {
  readonly position: Vec3
  readonly anim?: string
  readonly riding?: boolean
  readonly fade?: number
}

/** The part of the simulation the watch reads. */
export interface WatchSim {
  readonly t: number
  readonly player: { x: number; z: number; heading: number; mode: string } | null
  readonly entities: ReadonlyMap<string, WatchEntity>
  readonly surgery: WatchSurgery
  readonly cryoSuite: WatchCryo
  readonly imaging: WatchImaging
}

/** A room's procedure view: the theatre's, the CT suite's, the ultrasound room's ProSense view. Allocation-free. */
export function roomView(sim: WatchSim, room: WatchRoomId): ProcedureView | null {
  return room === 'or' ? sim.surgery.state.procedure : room === 'cryo' ? sim.cryoSuite.state.procedure : sim.imaging.scanners.us.procedure
}

// The CT table's cradle: its box is the layout's `l2:cryo:ct:table` footprint (src/scene/rooms/surgery/cryoRoom.ts: 2.9 m x 0.5 m, centred 0.35 m west of the
// table's seat `CRYO_SUITE.ct.table.out`), riding into the bore with `tablePos`. The patient lies on it (arms above the head when prone), so the box is wider
// than the cradle.
const CT_TABLE = CRYO_SUITE.ct.table

/** The floor position and heading of a room's moving machine. */
export interface CartPose {
  x: number
  z: number
  heading: number
}

export const CRADLE = { dx: -0.35, halfLength: 1.45, halfWidth: 0.42, top: 1.3 } as const
const _cradle: CartPose = { x: CT_TABLE.out.x + CRADLE.dx, z: CT_TABLE.out.z, heading: CT_TABLE.heading }

/**
 * The floor position of a room's moving machine: the da Vinci's patient cart (the anchors follow it too), or the CT table's cradle (the camera keeps out of
 * it; its anchors read `tablePos` themselves), or null (the ultrasound room has none). The cradle's object is shared and rewritten at each call. Allocation-free.
 */
export function roomCart(sim: WatchSim, room: WatchRoomId): CartPose | null {
  if (room === 'or') return sim.surgery.state.robot.cart
  if (room === 'cryo') {
    _cradle.x = CT_TABLE.out.x + CRADLE.dx + (CT_TABLE.in.x - CT_TABLE.out.x) * sim.cryoSuite.state.tablePos
    return _cradle
  }
  return null
}

/** A room's obstacles for the camera, and the slot of its moving machine (moved every frame; -1: none). */
export interface RoomObstacles {
  obstacles: Obstacles
  cartSlot: number
}

/** The needle robot's arm over the CT table when it aims (its base is the layout's `l2:cryo:robot`): a box from the mount to the skin window, 0.8 m to 1.6 m up. */
export const ROBOT_ARM = { x: CRYO_SUITE.robot.mount.x + 0.4, z: CRYO_SUITE.robot.mount.z + 0.4, halfX: 0.6, halfZ: 0.45, bottom: 0.8, top: 1.6 } as const

/**
 * What the camera keeps out of in a room: the moving cart (slot `cartSlot`, its boom up to 2.5 m) or the CT table's cradle, the furniture of the room's
 * areas (layout footprints, each with its height: the eye may pass over a stool, not through a console), the surgical lights' heads under the ceiling and the
 * needle robot's arm over the table. Built once.
 */
export function roomObstacles(room: WatchRoomId, footprints: readonly Footprint[]): RoomObstacles {
  const obstacles = newObstacles()
  const def = WATCH_ROOMS[room]
  let cartSlot = -1
  if (room === 'or') {
    const c = SURGERY.cart
    cartSlot = addObstacle(obstacles, 0, c.park.at.x, c.park.at.z, c.size.w / 2, c.size.l / 2, c.park.heading, 0, c.size.maxHeight)
    for (const h of LIGHTS.heads) addObstacle(obstacles, 1, h.x, h.z, LIGHTS.housingDia / 2, LIGHTS.housingDia / 2, 0, LIGHTS.faceY - 0.05, 3.0)
  } else if (room === 'cryo') {
    // the cradle (it rides with the table: moved every frame) in place of the table's footprint, which is the cradle at its seat only
    cartSlot = addObstacle(obstacles, 0, _cradle.x, _cradle.z, CRADLE.halfWidth, CRADLE.halfLength, CT_TABLE.heading, 0, CRADLE.top)
    addObstacle(obstacles, 0, ROBOT_ARM.x, ROBOT_ARM.z, ROBOT_ARM.halfX, ROBOT_ARM.halfZ, 0, ROBOT_ARM.bottom, ROBOT_ARM.top)
  }
  for (const f of footprints) {
    if (f.overhead || !def.furnitureAreas.includes(f.area as AreaId)) continue
    if (room === 'cryo' && /:ct:table$/.test(f.id)) continue
    addObstacle(obstacles, f.kind === 'circle' ? 1 : 0, f.x, f.z, f.hw, f.hd, f.rotationY, 0, furnitureTop(f.id))
  }
  return { obstacles, cartSlot }
}

/**
 * A room's "Watch step by step" port: start a case, when the booked one starts, and why a `noTeam` answer was given. `startsAt` of the ultrasound room
 * allocates (the department's projection): the panel reads it at 4 Hz, never a frame.
 */
export interface WatchPort {
  start(procedureId: ProcedureId, opts?: { fromStart?: boolean }): WatchResult
  startsAt(): number | null
  /** The CT suite says whether the team is out of hours or it is too late for a whole case today; the other rooms have one reason only (null). */
  whyNoTeam(): CryoNoTeamWhy | null
}

/** The room's port (never null today: every room has a watch; kept nullable so a room without one stays expressible). */
export function roomPort(sim: WatchSim, room: WatchRoomId): WatchPort | null {
  if (room === 'or') {
    const s = sim.surgery
    return { start: (id, opts) => s.startWatch(PROCEDURE_META[id].key as SurgeryProcedure, opts), startsAt: () => s.watchStartsAt, whyNoTeam: () => null }
  }
  if (room === 'cryo') {
    const c = sim.cryoSuite
    return { start: (id, opts) => c.startWatch(PROCEDURE_META[id].key as CryoTarget, opts), startsAt: () => c.watchStartsAt, whyNoTeam: () => c.whyNoTeam }
  }
  const img = sim.imaging
  return { start: (id, opts) => img.startWatch(PROCEDURE_META[id].key, opts), startsAt: () => img.watchStartsAt, whyNoTeam: () => null }
}
