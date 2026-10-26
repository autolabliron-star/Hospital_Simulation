/**
 * R4: the cryoablation suite's walk-mode stations (docs/R4-CRYO-SUITE.md), registered next to the others by `registerWalkInteractables`:
 *
 *   cryo:glass  in the control room at the lead glass (CRYO_SUITE.viewing): opens the suite's panel
 *   cryo:door   in recovery, outside the scan room's door: opens the same panel (you watch from outside the controlled area)
 *
 * The words are src/content/cryoSuite.ts's prompt. Priority 1, like the surgery stations.
 */
import { CRYO_SUITE_COPY } from '@/content/cryoSuite'
import type { Interactable } from '@/scene/interact.store'
import { CRYO_SUITE, DOORS } from '@/sim/places'
import type { RegHost } from '../registrations'

/** How far from its spot each prompt appears (m). */
export const CRYO_REGISTRATION_RADIUS = { glass: 1.6, door: 1.5 } as const

/** The recovery-side spot of the scan room's door (1.2 m east of the opening, clear of the supply cabinet). */
const scanDoor = DOORS.find((d) => d.id === 'l2Cryo')!
export const CRYO_DOOR_SPOT = { x: scanDoor.center.x + 1.2, z: scanDoor.center.z } as const

export function cryoSuiteRegs(host: RegHost): Interactable[] {
  const { actions } = host
  return [
    {
      id: 'cryo:glass',
      kind: 'station',
      position: { x: CRYO_SUITE.viewing.at.x, y: 0, z: CRYO_SUITE.viewing.at.z },
      radius: CRYO_REGISTRATION_RADIUS.glass,
      priority: 1,
      label: () => CRYO_SUITE_COPY.prompts.glass,
      onInteract: () => actions.openPanel('l2Cryo'),
    },
    {
      id: 'cryo:door',
      kind: 'station',
      position: { x: CRYO_DOOR_SPOT.x, y: 0, z: CRYO_DOOR_SPOT.z },
      radius: CRYO_REGISTRATION_RADIUS.door,
      priority: 1,
      label: () => CRYO_SUITE_COPY.prompts.glass,
      onInteract: () => actions.openPanel('l2Cryo'),
    },
  ]
}
