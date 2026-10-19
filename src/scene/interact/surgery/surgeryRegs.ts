/**
 * R2 (agent O): the E interactions of the robotic surgery suite, registered next to the others by `registerWalkInteractables`:
 *
 *   or:teach     beside the teaching console (priority 1): sit down at it (the session, teaching.ts) and watch the simulated endoscope view
 *   or:window    in the theatre corridor at the OR's viewing window (SURGERY.viewing): opens the OR panel
 *   preop:desk   at the admissions desk in pre-op: opens the pre-op panel
 *   pacu:island  at the recovery nurses' island: opens the PACU panel
 *
 * All the words are src/content/surgeryUi.ts's prompts (they carry a leading "E · "; the prompt line adds its own key cap, so it is cut here). The things the
 * teaching console reads (the seat's occupant, the controller) come from the host's live sim and `teachingRegistry`; a host without a surgery service (a test's) has no
 * console.
 */
import { SURGERY_UI } from '@/content/surgeryUi'
import type { Interactable } from '@/scene/interact.store'
import { OR_APPROACH } from '@/scene/surgery/dims'
import { PACU, PREOP, SURGERY } from '@/sim/places'
import type { RegHost } from '../registrations'
import { TEACH_SEAT, teachingRegistry, type TeachingLike } from './teaching'

/** How far from its spot each prompt appears (m). */
export const SURGERY_REGISTRATION_RADIUS = { teach: 1.9, window: 1.6, preOp: 1.6, pacu: 2.0 } as const

/** A prompt without the key cap the copy puts in front of it ("E · Sit at the teaching console" -> "Sit at the teaching console"). */
export function bare(label: string): string {
  return label.replace(/^\s*E\s*[·.:-]\s*/, '')
}

export interface TeachRegEnv {
  /** Who holds the teaching seat: null (free), or an id. `undefined` when the sim has no seat (a test's host). */
  occupant(): string | null | undefined
  controller(): TeachingLike | null
}

const hostEnv = (host: RegHost): TeachRegEnv => ({
  occupant: () => {
    const seats = (host.sim() as Partial<{ seats: { occupant(id: string): string | null } }>).seats
    return seats ? seats.occupant(TEACH_SEAT) : undefined
  },
  controller: () => teachingRegistry.current,
})

export function buildSurgeryInteractables(host: RegHost, env: TeachRegEnv = hostEnv(host)): Interactable[] {
  const { actions } = host
  return [
    {
      id: 'or:teach',
      kind: 'station',
      position: { x: OR_APPROACH.consoles.x, y: 0, z: OR_APPROACH.consoles.z },
      radius: SURGERY_REGISTRATION_RADIUS.teach,
      priority: 1,
      label: () => bare(SURGERY_UI.console.prompt),
      // free, or you are the one in it (E then stands you up: the interaction system takes that key before it gets here)
      enabled: () => {
        const who = env.occupant()
        return who === null || who === 'player'
      },
      onInteract: () => env.controller()?.press(),
    },
    {
      id: 'or:window',
      kind: 'station',
      position: { x: SURGERY.viewing.at.x, y: 0, z: SURGERY.viewing.at.z },
      radius: SURGERY_REGISTRATION_RADIUS.window,
      priority: 1,
      label: () => bare(SURGERY_UI.prompts.viewingWindow),
      onInteract: () => actions.openPanel('l2Or'),
    },
    {
      id: 'preop:desk',
      kind: 'station',
      position: { x: PREOP.desk.at.x, y: 0, z: PREOP.desk.at.z },
      radius: SURGERY_REGISTRATION_RADIUS.preOp,
      priority: 1,
      label: () => bare(SURGERY_UI.prompts.preOpDesk),
      onInteract: () => actions.openPanel('l2PreOp'),
    },
    {
      id: 'pacu:island',
      kind: 'station',
      position: { x: PACU.island.at.x, y: 0, z: PACU.island.at.z + 1.2 },
      radius: SURGERY_REGISTRATION_RADIUS.pacu,
      priority: 1,
      label: () => bare(SURGERY_UI.prompts.pacuIsland),
      onInteract: () => actions.openPanel('l2Pacu'),
    },
  ]
}
