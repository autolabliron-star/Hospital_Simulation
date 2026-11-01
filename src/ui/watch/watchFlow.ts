/**
 * R5 "Watch step by step": what the room panel's button, the overlay and the probe do (the same code for all three). Pure of React; the sim, the watch
 * session (the director) and the skip machinery come in through `FlowDeps`, so node tests run it on fakes.
 *
 *   watchProcedure(id)        asks the room's port for a watch case of `id` and acts on the answer:
 *                               started   the case is wheeled in now: the watch begins
 *                               queued    it starts after the turnover: the watch begins (the overlay counts down and offers a skip)
 *                               following a case is in the room: the panel offers "Watch the current case" (`followCase`) or "Full case from the start"
 *                                         (`watchProcedure(id, { fromStart: true })`: booked after it, then the clock skips to its start)
 *                               busy / noTeam   the panel says so
 *   skipToStart(id)           the skip machinery to the booked case's start. A long skip REBUILDS the hospital (src/sim skipRebuild re-plans the day from
 *                             the seed and drops the watch case): the director is told the new generation is ours, and once the skip is over the case is
 *                             booked again (`rebook`): wheeled in now, after the turnover, or (a day case has come in meanwhile) followed.
 */
import { scriptFor } from '@/content/procedures'
import type { WatchSession, WatchUiState } from '@/scene/watch/watch.store'
import { roomOfProcedure, roomPort, roomView, type WatchRoomId, type WatchSim } from '@/scene/watch/rooms'
import type { ProcedureId, WatchResult } from '@/sim/types'
import type { SkipRequest } from '@/ui/skip/types'

/** What a pick did: the port's answer, or it could not start at all (no script yet, the camera could not be taken). */
export type PickResult = WatchResult | 'noScript' | 'noCamera'

export interface FlowDeps {
  sim(): WatchSim
  session(): WatchSession | null
  /** Start the skip to the booked watch case's start; `before` hears the request before it runs. Null: nothing to skip to, or refused. */
  skipToStart(before: (req: SkipRequest) => void): SkipRequest | null
  /** Call `fn` once the jump and skip flow is idle again. */
  whenIdle(fn: () => void): void
  publish(patch: Partial<Omit<WatchUiState, 'set'>>): void
}

/** Ask for a watch case of `id` and act on the answer (see the header). */
export function watchProcedure(id: ProcedureId, opts: { fromStart?: boolean }, deps: FlowDeps): PickResult {
  if (scriptFor(id) === undefined) return 'noScript'
  const room = roomOfProcedure(id)
  const port = roomPort(deps.sim(), room)
  if (port === null) return 'noScript'
  const session = deps.session()
  if (session === null) return 'noCamera'
  const fromStart = opts.fromStart === true
  const r = port.start(id, fromStart ? { fromStart: true } : undefined)
  if (r === 'started' || r === 'queued') {
    if (!session.begin({ room, mode: 'watch', procedureId: id })) return 'noCamera'
    if (r === 'queued' && fromStart) skipToStart(id, deps)
  }
  return r
}

/** Watch the case that is in the room now, from its current step. */
export function followCase(room: WatchRoomId, deps: FlowDeps): boolean {
  return deps.session()?.begin({ room, mode: 'follow', procedureId: null }) ?? false
}

/** Skip the clock to the booked watch case's start (see the header). False when there is nothing to skip to or the skip is refused. */
export function skipToStart(id: ProcedureId | null, deps: FlowDeps): boolean {
  const session = deps.session()
  if (session === null) return false
  const req = deps.skipToStart((r) => {
    if (r.mode === 'rebuild') session.expectGeneration()
  })
  if (req === null) return false
  deps.publish({ skipping: true })
  deps.whenIdle(() => {
    deps.publish({ skipping: false })
    if (req.mode === 'rebuild' && id !== null) rebook(id, deps)
  })
  return true
}

/** After a rebuilding skip: book the watch case again unless it is still booked or in the room. Follows a day case that came in meanwhile. */
export function rebook(id: ProcedureId, deps: FlowDeps): PickResult | null {
  const s = deps.sim()
  const room = roomOfProcedure(id)
  const port = roomPort(s, room)
  const session = deps.session()
  if (port === null || session === null) return null
  const view = roomView(s, room)
  if (port.startsAt() !== null || (view !== null && view.watch)) return null
  const r = port.start(id)
  if (r === 'following') session.begin({ room, mode: 'follow', procedureId: null })
  else if (r === 'noTeam') session.end()
  return r
}

/** Stop watching (Esc, the Exit button). */
export function stopWatching(deps: FlowDeps): void {
  deps.session()?.end()
}
