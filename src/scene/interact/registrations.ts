/**
 * The things E can use (W1), registered into the interactable registry (src/scene/interact.store.ts). Everything is derived
 * from the layout contract in src/sim/places.ts, so moving a bed or a console moves its prompt.
 *
 *   bedside:<room>     each ward room, at the bed: opens the prescribing tablet on that room (priority 1)
 *   drawer:<room>      each MedDrawer, from the corridor: the drawer card (priority 1)
 *   console:<modality> the MRI, CT, X-ray and ultrasound consoles: the room panel with the Scan viewer (priority 1)
 *   command:<n>        along the command wall: the command-center room panel (priority 1)
 *   kiosk:<n>          the lobby kiosks: a short toast (priority 1)
 *   lift:<shaft>[:2]   the four lift lobbies (shaft A or B, level 1 or 2): E takes the lift to the other level (R2, lift.ts; priority 1)
 *
 * People and seats are not registered: the interaction system scans the entities and the seat registry (picker.ts).
 * All words come from src/content/walk.json. The sim is read at use time through `host.sim()`, so a Jump needs nothing here.
 */
import { WALK, fillWalk } from '@/content/walk'
import { useInteract, type Interactable } from '@/scene/interact.store'
import {
  COMMAND_WALL,
  IMAGING,
  LOBBY,
  ROOMS,
  wardSign,
  type ImagingModalityId,
  type RoomSpec,
} from '@/sim/places'
import type { Vec3 } from '@/sim/types'
import type { WalkActions } from './actions'
import { LIFT_RADIUS, buildLiftInteractables, type LiftHost } from './lift'
import { buildDrawInteractables } from './w4/drawRegs'
import { buildKioskInteractables } from './w4/kioskRegs'
import { buildLabInteractables } from './w4/labRegs'
import { buildSurgeryInteractables } from './surgery/surgeryRegs'
import { cryoSuiteRegs } from './cryoSuite/cryoRegs'

/** The part of the sim the labels read: who lies in the bed (the bed board's answer, the one a prescription is checked against). */
export interface RegSim {
  meds: { occupant(roomId: string): { id: string; name: string } | null }
}

export interface RegHost {
  sim(): RegSim
  actions: WalkActions
  /** R2: what the lift prompts do (default: the real cover and sim, lift.ts `realLiftHost`); tests pass fakes. */
  lift?: LiftHost
}

/** Where the prompt for a bedside is measured from: the bed, so you face the patient from the door side. */
export function bedsidePoint(room: RoomSpec): Vec3 {
  return { x: room.bed.x, y: 0, z: room.bed.z }
}

/** The MedDrawer's corridor face is this far out from the wall point of the layout, towards the corridor. */
export const DRAWER_OUT = 0.8

/** Where the prompt for a MedDrawer is measured from. */
export function drawerPoint(room: RoomSpec): Vec3 {
  return { x: room.drawer.x, y: 0, z: drawerFaceZ(room) }
}

export function drawerFaceZ(room: RoomSpec): number {
  return room.drawer.z - wardSign(room.ward) * DRAWER_OUT
}

/** Points along the command wall, on the room side, one per section of it. */
export const COMMAND_SECTIONS = 5
export function commandPoints(): Vec3[] {
  const w = COMMAND_WALL
  const n = COMMAND_SECTIONS
  return Array.from({ length: n }, (_, i) => ({ x: w.x + 0.6, y: 0, z: w.z0 + ((i + 0.5) * (w.z1 - w.z0)) / n }))
}

export const REGISTRATION_RADIUS = { bedside: 2.2, console: 2.2, command: 2.6, kiosk: 1.8, lift: LIFT_RADIUS } as const

/** Who lies in the bed, or null (an empty, being-cleaned or reserved bed has nobody to prescribe for). */
export function patientIn(sim: RegSim, roomId: string): string | null {
  return sim.meds.occupant(roomId)?.name ?? null
}

export function buildWalkInteractables(host: RegHost): Interactable[] {
  const out: Interactable[] = []
  const { actions } = host

  for (const room of ROOMS) {
    const roomId = room.id
    out.push({
      id: `bedside:${roomId}`,
      kind: 'bedside',
      position: bedsidePoint(room),
      radius: REGISTRATION_RADIUS.bedside,
      label: () => fillWalk(WALK.prompt.prescribe, { patient: patientIn(host.sim(), roomId) ?? roomId }),
      enabled: () => patientIn(host.sim(), roomId) !== null,
      lockedLabel: () => fillWalk(WALK.prompt.bedEmpty, { room: roomId }),
      onInteract: () => actions.openRx(roomId),
    })
    out.push({
      id: `drawer:${roomId}`,
      kind: 'drawer',
      position: drawerPoint(room),
      label: () => fillWalk(WALK.prompt.drawer, { room: roomId }),
      onInteract: () => actions.openDrawer(roomId),
    })
  }

  for (const modality of Object.keys(IMAGING) as ImagingModalityId[]) {
    const a = IMAGING[modality]
    out.push({
      id: `console:${modality}`,
      kind: 'console',
      position: { x: a.operator.at.x, y: 0, z: a.operator.at.z },
      radius: REGISTRATION_RADIUS.console,
      label: () => fillWalk(WALK.prompt.console, { device: WALK.device[modality] }),
      onInteract: () => actions.openPanel(a.controlArea),
    })
  }

  commandPoints().forEach((position, i) => {
    out.push({
      id: `command:${i}`,
      kind: 'station',
      position,
      radius: REGISTRATION_RADIUS.command,
      label: WALK.prompt.commandWall,
      onInteract: () => actions.openPanel('command'),
    })
  })

  LOBBY.kiosks.forEach((k, i) => {
    out.push({
      id: `kiosk:${i}`,
      kind: 'station',
      position: { x: k.x, y: 0, z: k.z },
      radius: REGISTRATION_RADIUS.kiosk,
      label: WALK.prompt.kiosk,
      onInteract: () => actions.toast(WALK.toast.kiosk),
    })
  })

  // R2: the lift lobbies of both levels (the ride to the other level: lift.ts)
  out.push(...buildLiftInteractables(host.lift))

  return out
}

/** Register everything; returns the function that takes it all out again. */
export function registerWalkInteractables(host: RegHost): () => void {
  // W4: the health kiosks, the robot draw centre and the lab add their own (src/scene/interact/w4)
  // R2: the robotic surgery suite on level 2 (src/scene/interact/surgery)
  const all = [
    ...buildWalkInteractables(host),
    ...buildKioskInteractables(host),
    ...buildDrawInteractables(host),
    ...buildLabInteractables(host),
    ...buildSurgeryInteractables(host),
    ...cryoSuiteRegs(host),
  ]
  const undo = all.map((item) => useInteract.getState().register(item))
  return () => {
    for (const u of undo) u()
  }
}
