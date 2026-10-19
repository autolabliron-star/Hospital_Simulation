/**
 * Which panels are open, as the interaction layer sees them: the room panel (`useFocus.area`), the prescribing tablet, the
 * "Go to…" and "Jump to…" menus and a Jump in progress own the keyboard and mouse (you stand still, E does nothing); the drawer
 * card does not (you can stand there and watch it), but Esc closes it. Closing the room panel here is `setArea(null)` and nothing
 * else: no camera flight to the overview (that is what `unfocus()` in roomFocus.ts does, for the overview camera).
 */
import { useWarmup } from '@/scene/warmup'
import { useFocus } from '@/scene/camera/focus.store'
import { useConsoleCard } from '@/ui/walk/consoleCard.store'
import { useDrawerCard } from '@/ui/walk/drawerCard.store'
import { useHealthCard } from '@/ui/walk/healthCard.store'
import { useGoTo } from '@/ui/goTo.store'
import { useJump } from '@/ui/jump.store'
import { useLiftRide } from '@/ui/liftRide.store'
import { useRx } from '@/ui/walk/rx.store'

/** A menu is open, or a Jump or your lift ride (R2) is running: they have their own Esc and their own keys. */
function menuOpen(): boolean {
  const j = useJump.getState()
  return useGoTo.getState().open || j.open || j.phase !== 'idle' || useLiftRide.getState().phase !== 'idle'
}

export function overlayOpen(): boolean {
  // (M5) before the presenter presses Enter on the loading screen nobody walks, turns or Tabs
  if (!useWarmup.getState().entered) return true
  return useRx.getState().open || useFocus.getState().area !== null || menuOpen()
}

/** R2: the teaching-console card opened by sitting at the console (the OR panel's own card closes with its panel). A closed card stands you up (teaching.ts). */
function seatedConsoleCardOpen(): boolean {
  const c = useConsoleCard.getState()
  return c.open && c.source === 'seat'
}

/** Esc would close something of ours, and no menu has a claim on it. */
export function closableOverlayOpen(): boolean {
  if (menuOpen()) return false
  return useRx.getState().open || useFocus.getState().area !== null || useDrawerCard.getState().roomId !== null || useHealthCard.getState().open || seatedConsoleCardOpen()
}

export function closeOverlays(): void {
  useRx.getState().close()
  useDrawerCard.getState().close()
  useHealthCard.getState().close()
  if (seatedConsoleCardOpen()) useConsoleCard.getState().close()
  if (useFocus.getState().area !== null) useFocus.getState().setArea(null)
}
