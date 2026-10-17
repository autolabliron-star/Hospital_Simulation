/**
 * Jump to… (L1): whether the menu is open, and the phase of a jump in progress. A store so the HUD button, the J key, the
 * menu, the fade cover in App and the scene layers that remount on a new hospital (`generation`) all agree.
 * The sequence itself is in jumpFlow.ts (pure, tested with fake timers); this file only wires it to the running hospital.
 */
import { create } from 'zustand'
import { setFollowedPerson, setHoveredPerson, setSelectedPerson } from '@/scene/actors/crowd/runtime'
import { useBubbles } from '@/scene/fx/bubbleStore'
import { jumpTo, simGeneration } from '@/sim'
import { createJumpState, type JumpState } from './jumpFlow'

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
    generation: () => simGeneration,
    afterSwap: () => {
      // the people of the old hospital are gone: nobody is selected, followed or talking any more
      setSelectedPerson(null)
      setFollowedPerson(null)
      setHoveredPerson(null)
      useBubbles.getState().clear()
    },
    after: (ms, fn) => {
      setTimeout(fn, ms)
    },
    frames: afterFrames,
    onError: (error) => console.error('Jump failed; the hospital stays as it was.', error),
  }),
)
