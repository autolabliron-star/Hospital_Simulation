/**
 * What E does in the robot blood-draw centre (W4), registered next to the others by `registerWalkInteractables`:
 *
 *   draw:robot:<i>   each robot (kind console, priority 1): opens the room panel on the draw centre
 *   draw:checkin     the check-in kiosk by the door (kind station): you take a queue number, a toast tells you which (you are not drawn)
 *   draw:send        the manual send station (kind station): opens the room panel
 *
 * Positions come from the contract (src/sim/places.ts `DRAW_CENTRE`), so moving a robot moves its prompt. All words come from
 * src/content/drawUi.json. The sim is read at use time (`sim` is a live binding), so a Jump needs nothing here.
 */
import { DRAW_UI, fillDraw } from '@/content/drawUi'
import type { Interactable } from '@/scene/interact.store'
import { requestTicketFlash } from '@/scene/drawCentre/flash'
import { sim } from '@/sim'
import { DRAW_CENTRE } from '@/sim/places'
import type { RegHost } from '../registrations'

/** How near you must be for each prompt to show (m). */
export const DRAW_REGISTRATION_RADIUS = { robot: 2.0, checkIn: 1.7, send: 1.9 } as const

/** Where each prompt is measured from: the robot's front (between its chair and the cabinet), the kiosk's guest spot, the send station's front. */
export function robotPromptPoint(i: number): { x: number; y: number; z: number } {
  const r = DRAW_CENTRE.robots[i]
  return { x: r.cabinet.x, y: 0, z: r.cabinet.z - 0.62 }
}
export function checkInPromptPoint(): { x: number; y: number; z: number } {
  const g = DRAW_CENTRE.checkIn.guest.at
  return { x: g.x, y: 0, z: g.z }
}
export function sendPromptPoint(): { x: number; y: number; z: number } {
  return { x: DRAW_CENTRE.manualSend.x, y: 0, z: DRAW_CENTRE.manualSend.z - 0.9 }
}

export function buildDrawInteractables(host: RegHost): Interactable[] {
  const { actions } = host
  const out: Interactable[] = DRAW_CENTRE.robots.map((_, i) => ({
    id: `draw:robot:${i}`,
    kind: 'console',
    position: robotPromptPoint(i),
    radius: DRAW_REGISTRATION_RADIUS.robot,
    label: fillDraw(DRAW_UI.prompt.robot, { n: i + 1 }),
    onInteract: () => actions.openPanel('diagnostics'),
  }))
  out.push({
    id: 'draw:checkin',
    kind: 'station',
    position: checkInPromptPoint(),
    radius: DRAW_REGISTRATION_RADIUS.checkIn,
    label: DRAW_UI.prompt.checkIn,
    onInteract: () => {
      const ticket = sim.blood.takePlayerTicket()
      requestTicketFlash()
      actions.toast(fillDraw(DRAW_UI.toast.ticket, { ticket }))
    },
  })
  out.push({
    id: 'draw:send',
    kind: 'station',
    position: sendPromptPoint(),
    radius: DRAW_REGISTRATION_RADIUS.send,
    label: DRAW_UI.prompt.send,
    onInteract: () => actions.openPanel('diagnostics'),
  })
  return out
}
