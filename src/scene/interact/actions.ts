/**
 * What E does when it opens something: the small set of effects the interactables use. They write the UI stores (the prescribing
 * tablet, the room panel, the drawer card, the toast) and let go of the mouse so you can click what opened. Kept apart from
 * `registrations.ts` so the registrations are tested with fake actions.
 *
 * In walk mode the room panel opens WITHOUT the camera flight: `useFocus.setArea` only (the flight in roomFocus.ts is for the
 * overview camera).
 */
import { useFocus } from '@/scene/camera/focus.store'
import type { AreaId } from '@/sim/places'
import { useDrawerCard } from '@/ui/walk/drawerCard.store'
import { releasePointer } from '@/ui/walk/pointer'
import { useRx } from '@/ui/walk/rx.store'
import { showToast } from '@/ui/walk/toast.store'

export interface WalkActions {
  /** The prescribing tablet, starting on this room. */
  openRx(roomId: string): void
  /** The room panel (the Scan viewer for a console, the command center), without a camera flight. */
  openPanel(area: AreaId): void
  /** The drawer card for a room's MedDrawer. */
  openDrawer(roomId: string): void
  toast(text: string): void
}

export const walkActions: WalkActions = {
  openRx: (roomId) => {
    useRx.getState().openFor(roomId)
  },
  openPanel: (area) => {
    releasePointer()
    useFocus.getState().setArea(area)
  },
  // E at the same drawer again closes the card
  openDrawer: (roomId) => {
    const card = useDrawerCard.getState()
    if (card.roomId === roomId) card.close()
    else card.show(roomId)
  },
  toast: (text) => showToast(text),
}
