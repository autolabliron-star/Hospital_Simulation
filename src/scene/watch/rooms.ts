/**
 * R5 "Watch step by step": the rooms you can watch a procedure in, as the watch camera sees them. Wave 1 is the robotic theatre; the CT cryo suite and
 * the ultrasound room plug in here (a spot to stand at, the area the camera stays in, how to read the room's procedure view) with their shot sets in
 * shots.ts and their insets in the `insetSources` registry.
 *
 * Everything is in SIM coordinates (level 2 lives in its own strip of the flat sim, sim x = drawn x + 150, y floor-relative): the director converts to
 * where it is drawn (`toDisplayInto`) only when it writes the camera.
 */
import { PROCEDURE_META } from '@/content/procedures'
import type { Footprint } from '@/scene/building/layout'
import { LIGHTS } from '@/scene/surgery/dims'
import { SURGERY, type AreaId, type Spot } from '@/sim/places'
import type { ProcMachine, ProcedureId, ProcedureView, SurgeryProcedure, Vec3, WatchResult } from '@/sim/types'
import { addObstacle, furnitureTop, newObstacles, type Obstacles } from './limits'

export type WatchRoomId = 'or' | 'cryo' | 'us'

export interface WatchRoomDef {
  id: WatchRoomId
  machine: ProcMachine
  /** The room's area: the camera stands inside it (shots may name another area, the theatre hall's sinks). */
  area: AreaId
  /** Where you stand while you watch: on the room's level, outside its door (the theatre corridor's viewing window). */
  spot: Spot
  /** The areas whose furniture the camera keeps out of (the room, and the hall of its sinks). */
  furnitureAreas: readonly AreaId[]
}

/** The rooms that can be watched now (wave 1: the robotic theatre). */
export const WATCH_ROOMS: Partial<Record<WatchRoomId, WatchRoomDef>> = {
  or: { id: 'or', machine: 'daVinci', area: 'l2Or', spot: SURGERY.viewing, furnitureAreas: ['l2Or', 'l2Hall'] },
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
}

/** A room's procedure view (null for a room whose watch has not landed yet). Allocation-free. */
export function roomView(sim: WatchSim, room: WatchRoomId): ProcedureView | null {
  return room === 'or' ? sim.surgery.state.procedure : null
}

/** The floor position of a room's moving machine the anchors follow (the da Vinci's patient cart), or null. */
export function roomCart(sim: WatchSim, room: WatchRoomId): { x: number; z: number; heading: number } | null {
  return room === 'or' ? sim.surgery.state.robot.cart : null
}

/** A room's obstacles for the camera, and the slot of its moving machine (moved every frame; -1: none). */
export interface RoomObstacles {
  obstacles: Obstacles
  cartSlot: number
}

/**
 * What the camera keeps out of in a room: the moving cart (slot `cartSlot`, its boom up to 2.5 m), the furniture of the room's areas (layout footprints,
 * each with its height: the eye may pass over a stool, not through a console) and the surgical lights' heads under the ceiling. Built once.
 */
export function roomObstacles(room: WatchRoomId, footprints: readonly Footprint[]): RoomObstacles {
  const obstacles = newObstacles()
  const def = WATCH_ROOMS[room]
  let cartSlot = -1
  if (room === 'or') {
    const c = SURGERY.cart
    cartSlot = addObstacle(obstacles, 0, c.park.at.x, c.park.at.z, c.size.w / 2, c.size.l / 2, c.park.heading, 0, c.size.maxHeight)
    for (const h of LIGHTS.heads) addObstacle(obstacles, 1, h.x, h.z, LIGHTS.housingDia / 2, LIGHTS.housingDia / 2, 0, LIGHTS.faceY - 0.05, 3.0)
  }
  for (const f of footprints) {
    if (f.overhead || def === undefined || !def.furnitureAreas.includes(f.area as AreaId)) continue
    addObstacle(obstacles, f.kind === 'circle' ? 1 : 0, f.x, f.z, f.hw, f.hd, f.rotationY, 0, furnitureTop(f.id))
  }
  return { obstacles, cartSlot }
}

/** A room's "Watch step by step" port: start a case, and when the booked one starts. Null for a room without one yet. */
export interface WatchPort {
  start(procedureId: ProcedureId, opts?: { fromStart?: boolean }): WatchResult
  startsAt(): number | null
}

export function roomPort(sim: WatchSim, room: WatchRoomId): WatchPort | null {
  if (room !== 'or') return null
  const s = sim.surgery
  return {
    start: (id, opts) => s.startWatch(PROCEDURE_META[id].key as SurgeryProcedure, opts),
    startsAt: () => s.watchStartsAt,
  }
}
