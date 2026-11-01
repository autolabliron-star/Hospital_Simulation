/**
 * R5: what "Watch step by step" does with each answer of the room's port (watchFlow.ts), on fakes: the sim's surgery port, the watch session and the skip.
 */
import { describe, expect, it } from 'vitest'
import { emptyProcedureView } from '@/sim/procedure'
import type { ProcedureView, SurgeryProcedure, WatchResult } from '@/sim/types'
import type { WatchRequest, WatchSession } from '@/scene/watch/watch.store'
import type { WatchSim } from '@/scene/watch/rooms'
import type { SkipRequest } from '@/ui/skip/types'
import { followCase, rebook, skipToStart, watchProcedure, type FlowDeps } from './watchFlow'

interface Fake {
  deps: FlowDeps
  answers: WatchResult[]
  calls: { procedure: SurgeryProcedure; fromStart: boolean }[]
  begun: WatchRequest[]
  ended: number
  expected: number
  skips: SkipRequest[]
  skipMode: 'live' | 'rebuild' | null
  idle: (() => void)[]
  published: Record<string, unknown>[]
  startsAt: { value: number | null }
  view: ProcedureView
  sessionOk: boolean
}

function fake(answers: WatchResult[]): Fake {
  const f: Fake = {
    deps: null as unknown as FlowDeps,
    answers,
    calls: [],
    begun: [],
    ended: 0,
    expected: 0,
    skips: [],
    skipMode: 'live',
    idle: [],
    published: [],
    startsAt: { value: null },
    view: emptyProcedureView(),
    sessionOk: true,
  }
  const session: WatchSession = {
    begin: (req) => {
      f.begun.push(req)
      return f.sessionOk
    },
    end: () => void f.ended++,
    expectGeneration: () => void f.expected++,
    holdFreeLook: () => undefined,
    debug: () => ({ phase: 'off', status: 'waiting', shotId: null, free: 'off', moving: false, eye: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, fov: 45 }),
  }
  const sim = {
    t: 1000,
    player: null,
    entities: new Map(),
    surgery: {
      state: { procedure: f.view, robot: { cart: { x: 0, z: 0, heading: 0 } } },
      startWatch: (procedure: SurgeryProcedure, opts?: { fromStart?: boolean }): WatchResult => {
        f.calls.push({ procedure, fromStart: opts?.fromStart === true })
        return f.answers.shift() ?? 'busy'
      },
      get watchStartsAt() {
        return f.startsAt.value
      },
    },
  } as unknown as WatchSim
  f.deps = {
    sim: () => sim,
    session: () => session,
    skipToStart: (before) => {
      if (f.skipMode === null) return null
      const req: SkipRequest = { fromT: 1000, toT: 3000, fromHour: 8, toHour: 9, caption: '', mode: f.skipMode }
      before(req)
      f.skips.push(req)
      return req
    },
    whenIdle: (fn) => void f.idle.push(fn),
    publish: (p) => void f.published.push(p),
  }
  return f
}

describe('watchProcedure', () => {
  it('started: asks the theatre for the procedure and begins the watch', () => {
    const f = fake(['started'])
    expect(watchProcedure('or-cholecystectomy', {}, f.deps)).toBe('started')
    expect(f.calls).toEqual([{ procedure: 'cholecystectomy', fromStart: false }])
    expect(f.begun).toEqual([{ room: 'or', mode: 'watch', procedureId: 'or-cholecystectomy' }])
    expect(f.skips).toHaveLength(0)
  })

  it('queued: begins the watch (the overlay counts down); nothing is skipped unless asked for', () => {
    const f = fake(['queued'])
    expect(watchProcedure('or-cholecystectomy', {}, f.deps)).toBe('queued')
    expect(f.begun).toHaveLength(1)
    expect(f.skips).toHaveLength(0)
  })

  it('following: begins nothing (the panel offers the two choices); "the current case" follows it', () => {
    const f = fake(['following'])
    expect(watchProcedure('or-cholecystectomy', {}, f.deps)).toBe('following')
    expect(f.begun).toHaveLength(0)
    expect(followCase('or', f.deps)).toBe(true)
    expect(f.begun).toEqual([{ room: 'or', mode: 'follow', procedureId: null }])
  })

  it('"Full case from the start": booked after the case in the room, the watch begins and the clock skips to its start', () => {
    const f = fake(['queued'])
    expect(watchProcedure('or-cholecystectomy', { fromStart: true }, f.deps)).toBe('queued')
    expect(f.calls).toEqual([{ procedure: 'cholecystectomy', fromStart: true }])
    expect(f.begun).toHaveLength(1)
    expect(f.skips).toHaveLength(1)
    expect(f.published).toContainEqual({ skipping: true })
    f.idle.forEach((fn) => fn())
    expect(f.published).toContainEqual({ skipping: false })
  })

  it('busy and noTeam begin nothing; a procedure without a script is refused before asking', () => {
    for (const r of ['busy', 'noTeam'] as const) {
      const f = fake([r])
      expect(watchProcedure('or-cholecystectomy', {}, f.deps)).toBe(r)
      expect(f.begun).toHaveLength(0)
    }
    const f = fake(['started'])
    expect(watchProcedure('cryo-lung', {}, f.deps)).toBe('noScript')
    expect(f.calls).toHaveLength(0)
  })

  it('says noCamera when the camera cannot be taken', () => {
    const f = fake(['started'])
    f.sessionOk = false
    expect(watchProcedure('or-cholecystectomy', {}, f.deps)).toBe('noCamera')
  })
})

describe('the skip to the start', () => {
  it('a live skip keeps the booking: nothing is booked again', () => {
    const f = fake([])
    expect(skipToStart('or-cholecystectomy', f.deps)).toBe(true)
    expect(f.expected).toBe(0)
    f.idle.forEach((fn) => fn())
    expect(f.calls).toHaveLength(0)
  })

  it('a rebuilding skip is announced to the director, and the case is booked again once it is over', () => {
    const f = fake(['started'])
    f.skipMode = 'rebuild'
    expect(skipToStart('or-cholecystectomy', f.deps)).toBe(true)
    expect(f.expected).toBe(1)
    expect(f.calls).toHaveLength(0)
    f.idle.forEach((fn) => fn())
    expect(f.calls).toEqual([{ procedure: 'cholecystectomy', fromStart: false }])
  })

  it('nothing to skip to: false', () => {
    const f = fake([])
    f.skipMode = null
    expect(skipToStart('or-cholecystectomy', f.deps)).toBe(false)
  })
})

describe('rebook', () => {
  it('does nothing while the case is still booked or in the room', () => {
    const f = fake(['started'])
    f.startsAt.value = 2000
    expect(rebook('or-cholecystectomy', f.deps)).toBeNull()
    f.startsAt.value = null
    f.view.procedureId = 'or-cholecystectomy'
    f.view.watch = true
    expect(rebook('or-cholecystectomy', f.deps)).toBeNull()
    expect(f.calls).toHaveLength(0)
  })

  it('a day case came in meanwhile: follow it; the team has gone: stop', () => {
    const a = fake(['following'])
    expect(rebook('or-cholecystectomy', a.deps)).toBe('following')
    expect(a.begun).toEqual([{ room: 'or', mode: 'follow', procedureId: null }])
    const b = fake(['noTeam'])
    expect(rebook('or-cholecystectomy', b.deps)).toBe('noTeam')
    expect(b.ended).toBe(1)
  })
})
