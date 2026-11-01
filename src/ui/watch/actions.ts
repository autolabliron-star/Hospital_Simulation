/**
 * R5 "Watch step by step": the flow (watchFlow.ts) bound to the live hospital, for the room panel's button, the overlay and the probe. The sim, the watch
 * session (the director <WatchCamera /> registers), the skip machinery (src/ui/skip) and the jump flow's phase.
 */
import { watchSession, useWatch } from '@/scene/watch/watch.store'
import type { WatchRoomId, WatchSim } from '@/scene/watch/rooms'
import { sim } from '@/sim'
import type { ProcedureId } from '@/sim/types'
import { useJump } from '@/ui/jump.store'
import { skipToWatchStart } from '@/ui/skip/SkipControl'
import { followCase, skipToStart, stopWatching, watchProcedure, type FlowDeps, type PickResult } from './watchFlow'

/** Call `fn` once the jump and skip flow is idle again. */
function whenJumpIdle(fn: () => void): void {
  if (useJump.getState().phase === 'idle') {
    fn()
    return
  }
  const off = useJump.subscribe((s) => {
    if (s.phase !== 'idle') return
    off()
    fn()
  })
}

export function realFlowDeps(): FlowDeps {
  return {
    // `sim` is a live binding (a Jump swaps it): read at every use
    sim: () => sim as unknown as WatchSim,
    session: watchSession,
    skipToStart: skipToWatchStart,
    whenIdle: whenJumpIdle,
    publish: (patch) => useWatch.getState().set(patch),
  }
}

export const watchActions = {
  pick: (id: ProcedureId, opts: { fromStart?: boolean } = {}): PickResult => watchProcedure(id, opts, realFlowDeps()),
  follow: (room: WatchRoomId): boolean => followCase(room, realFlowDeps()),
  skipToStart: (): boolean => skipToStart(useWatch.getState().procedureId, realFlowDeps()),
  stop: (): void => stopWatching(realFlowDeps()),
  holdFreeLook: (on: boolean): void => watchSession()?.holdFreeLook(on),
}
