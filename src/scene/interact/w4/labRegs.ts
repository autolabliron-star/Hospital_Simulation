/**
 * W4: the E interactions of the automated lab. Two places open the lab panel (the room panel for the `lab` area, no camera flight in walk mode):
 * the corridor spot where you look in through the glass front (`LAB.viewpoint`), and the status totem inside by the door. All words come from
 * src/content/labUi.json.
 */
import { LAB_UI } from '@/content/labUi'
import type { Interactable } from '@/scene/interact.store'
import { LAB } from '@/sim/places'
import type { RegHost } from '../registrations'

/** Prompt radii: the corridor spot is a place to stand (1.4 m), the totem is read from a step away. */
export const LAB_REGISTRATION_RADIUS = { viewpoint: 1.4, totem: 1.5 } as const

export function buildLabInteractables(host: RegHost): Interactable[] {
  const { actions } = host
  return [
    {
      id: 'lab:viewpoint',
      kind: 'station',
      position: { x: LAB.viewpoint.x, y: 0, z: LAB.viewpoint.z },
      radius: LAB_REGISTRATION_RADIUS.viewpoint,
      label: LAB_UI.prompt.viewpoint,
      onInteract: () => actions.openPanel('lab'),
    },
    {
      id: 'lab:totem',
      kind: 'station',
      position: { x: LAB.statusTotem.x, y: 0, z: LAB.statusTotem.z },
      radius: LAB_REGISTRATION_RADIUS.totem,
      label: LAB_UI.prompt.totem,
      onInteract: () => actions.openPanel('lab'),
    },
  ]
}
