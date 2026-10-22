/**
 * Jump to… (L1): whether the menu is open, and the phase of a jump in progress. A store so the HUD button, the J key, the
 * menu, the fade cover in App and the scene layers that remount on a new hospital (`generation`) all agree.
 * The sequence itself is in jumpFlow.ts (pure, tested with fake timers); this file only wires it to the running hospital.
 */
import { create } from 'zustand'
import { highlight, setFollowedPerson, setHoveredPerson, setSelectedPerson } from '@/scene/actors/crowd/runtime'
import { useBubbles } from '@/scene/fx/bubbleStore'
import { advanceBy, jumpTo, sim, simGeneration, skipRebuild } from '@/sim'
import { createJumpState, type JumpState } from './jumpFlow'
import { useLiftRide } from './liftRide.store'

export { FADE_IN_MS, FADE_OUT_MS, SETTLE_MS, type JumpPhase, type JumpState, type JumpTarget } from './jumpFlow'

/** `fn` after `n` painted frames. A timer backs it up, because a hidden tab never paints. */
function afterFrames(n: number, fn: () => void): void {
  let done = false
  const run = (): void => {
    if (done) return
    done = true
    fn()
  }
  let left = n
  const tick = (): void => {
    if (--left <= 0) run()
    else requestAnimationFrame(tick)
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(tick)
  setTimeout(run, 120 * n + 200)
}

export const useJump = create<JumpState>(
  createJumpState({
    rebuild: jumpTo,
    advance: advanceBy,
    rebuildAt: skipRebuild,
    generation: () => simGeneration,
    afterSwap: () => {
      // the people of the old hospital are gone: nobody is selected, followed or talking any more
      setSelectedPerson(null)
      setFollowedPerson(null)
      setHoveredPerson(null)
      useBubbles.getState().clear()
    },
    afterLiveSkip: () => {
      // the same hospital ran on: keep the selection, but let go of anybody who left meanwhile (a discharged patient, a finished visit)
      if (highlight.selectedId && !sim.entities.has(highlight.selectedId)) setSelectedPerson(null)
      if (highlight.followId && !sim.entities.has(highlight.followId)) setFollowedPerson(null)
      if (highlight.hoverId && !sim.entities.has(highlight.hoverId)) setHoveredPerson(null)
      useBubbles.getState().clear()
    },
    after: (ms, fn) => {
      setTimeout(fn, ms)
    },
    frames: afterFrames,
    onError: (error) => console.error('Jump failed; the hospital stays as it was.', error),
    // R2: never during your lift ride (two covers would overlap)
    busy: () => useLiftRide.getState().phase !== 'idle',
  }),
)

/**
 * A Jump with its own words on the cover ("A new day") instead of the moment's label. Same flow, same refusals: returns false (and
 * does nothing) while another jump or skip runs or during a lift ride.
 */
export function jumpWithCaption(hour: number, caption: string): boolean {
  if (!useJump.getState().jump(hour)) return false
  const target = useJump.getState().target
  if (target) useJump.setState({ target: { ...target, label: caption } })
  return true
}
