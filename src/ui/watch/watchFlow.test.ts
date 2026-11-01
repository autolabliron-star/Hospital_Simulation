/**
 * R5: what "Watch step by step" does with each answer of the room's port (watchFlow.ts), on fakes: the sim's surgery, CT cryo suite and imaging ports, the
 * watch session and the skip. Wave 3: the CT suite's and the ultrasound room's flows, with the five answers each.
 */
import { describe, expect, it } from 'vitest'
import { emptyProcedureView } from '@/sim/procedure'
import type { CryoTarget, ProcedureId, ProcedureView, SurgeryProcedure, WatchResult } from '@/sim/types'
import type { WatchRequest, WatchSession } from '@/scene/watch/watch.store'
import type { WatchRoomId, WatchSim } from '@/scene/watch/rooms'
import type { SkipRequest } from '@/ui/skip/types'
import { followCase, rebook, skipToStart, watchProcedure, type FlowDeps } from './watchFlow'

interface Fake {
  deps: FlowDeps
  answers: WatchResult[]
  calls: { procedure: SurgeryProcedure; fromStart: boolean }[]
  /** The CT suite's and the ultrasound room's ports' calls. */
  cryoCalls: { target: CryoTarget; fromStart: boolean }[]
  usCalls: { protocol: string; fromStart: boolean }[]
  /** Why the CT suite answered 'noTeam'. */
  why: { value: 'hours' | 'late' | null }
  begun: WatchRequest[]
  ended: number
  expected: number
  skips: SkipRequest[]
  skipMode: 'live' | 'rebuild' | null
  idle: (() => void)[]
  published: Record<string, unknown>[]
  startsAt: { value: number | null }
  view: ProcedureView
  cryoView: ProcedureView
  usView: ProcedureView
  sessionOk: boolean
}

function fake(answers: WatchResult[]): Fake {
  const f: Fake = {
    deps: null as unknown as FlowDeps,
    answers,
    calls: [],
    cryoCalls: [],
    usCalls: [],
    why: { value: null },
    begun: [],
    ended: 0,
    expected: 0,
    skips: [],
    skipMode: 'live',
    idle: [],
    published: [],
    startsAt: { value: null },
    view: emptyProcedureView(),
    cryoView: emptyProcedureView(),
    usView: emptyProcedureView(),
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
    cryoSuite: {
      state: { procedure: f.cryoView, tablePos: 0, target: 'kidney', needle: -1, needles: [] },
      startWatch: (target: CryoTarget, opts?: { fromStart?: boolean }): WatchResult => {
        f.cryoCalls.push({ target, fromStart: opts?.fromStart === true })
        return f.answers.shift() ?? 'busy'
      },
      get watchStartsAt() {
        return f.startsAt.value
      },
      get whyNoTeam() {
        return f.why.value
      },
    },
    imaging: {
      scanners: { us: { procedure: f.usView } },
      startWatch: (protocol: string, opts?: { fromStart?: boolean }): WatchResult => {
        f.usCalls.push({ protocol, fromStart: opts?.fromStart === true })
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
    // (every procedure has a script now: an id with none is refused before any room is asked)
    const f = fake(['started'])
    expect(watchProcedure('or-appendicectomy' as ProcedureId, {}, f.deps)).toBe('noScript')
    expect(f.calls).toHaveLength(0)
    expect(f.cryoCalls).toHaveLength(0)
    expect(f.usCalls).toHaveLength(0)
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


// ---------------------------------------------------------------------------------------------
// R5 wave 3: the CT cryo suite's and the ultrasound room's ports
// ---------------------------------------------------------------------------------------------

const ROOMS: readonly { room: WatchRoomId; id: ProcedureId; key: string }[] = [
  { room: 'cryo', id: 'cryo-kidney', key: 'kidney' },
  { room: 'cryo', id: 'cryo-lung', key: 'lung' },
  { room: 'cryo', id: 'cryo-liver', key: 'liver' },
  { room: 'us', id: 'us-breastCancer', key: 'us-cryo-breast' },
  { room: 'us', id: 'us-fibroadenoma', key: 'us-cryo-fibroadenoma' },
]

/** What the room's port was asked: the CT suite's target or the ultrasound room's protocol, and whether from the start. */
function asked(f: Fake, room: WatchRoomId): { key: string; fromStart: boolean }[] {
  return room === 'cryo' ? f.cryoCalls.map((c) => ({ key: c.target, fromStart: c.fromStart })) : f.usCalls.map((c) => ({ key: c.protocol, fromStart: c.fromStart }))
}

describe.each(ROOMS)('watchProcedure in the $room room: $id', ({ room, id, key }) => {
  it('started: asks its own port for the procedure by its key and begins the watch in that room', () => {
    const f = fake(['started'])
    expect(watchProcedure(id, {}, f.deps)).toBe('started')
    expect(asked(f, room)).toEqual([{ key, fromStart: false }])
    expect(f.calls).toHaveLength(0) // the theatre was not asked
    expect(f.begun).toEqual([{ room, mode: 'watch', procedureId: id }])
    expect(f.skips).toHaveLength(0)
  })

  it('queued: begins the watch (the overlay counts down); nothing is skipped unless asked for', () => {
    const f = fake(['queued'])
    expect(watchProcedure(id, {}, f.deps)).toBe('queued')
    expect(f.begun).toEqual([{ room, mode: 'watch', procedureId: id }])
    expect(f.skips).toHaveLength(0)
  })

  it('following: begins nothing; "the current case" follows the room\'s case', () => {
    const f = fake(['following'])
    expect(watchProcedure(id, {}, f.deps)).toBe('following')
    expect(f.begun).toHaveLength(0)
    expect(followCase(room, f.deps)).toBe(true)
    expect(f.begun).toEqual([{ room, mode: 'follow', procedureId: null }])
  })

  it('"Full case from the start": booked after the case in the room, the watch begins and the clock skips to its start', () => {
    const f = fake(['queued'])
    expect(watchProcedure(id, { fromStart: true }, f.deps)).toBe('queued')
    expect(asked(f, room)).toEqual([{ key, fromStart: true }])
    expect(f.begun).toHaveLength(1)
    expect(f.skips).toHaveLength(1)
    expect(f.published).toContainEqual({ skipping: true })
    f.idle.forEach((fn) => fn())
    expect(f.published).toContainEqual({ skipping: false })
  })

  it('busy and noTeam begin nothing', () => {
    for (const r of ['busy', 'noTeam'] as const) {
      const f = fake([r])
      expect(watchProcedure(id, {}, f.deps)).toBe(r)
      expect(f.begun).toHaveLength(0)
    }
  })

  it('says noCamera when the camera cannot be taken', () => {
    const f = fake(['started'])
    f.sessionOk = false
    expect(watchProcedure(id, {}, f.deps)).toBe('noCamera')
  })

  it('a rebuilding skip is announced to the director, and the case is booked again from the same port once it is over', () => {
    const f = fake(['started'])
    f.skipMode = 'rebuild'
    expect(skipToStart(id, f.deps)).toBe(true)
    expect(f.expected).toBe(1)
    expect(asked(f, room)).toHaveLength(0)
    f.idle.forEach((fn) => fn())
    expect(asked(f, room)).toEqual([{ key, fromStart: false }])
  })

  it('rebook: nothing while the case is still booked or in the room; a day case that came in meanwhile is followed; the team gone: stop', () => {
    const still = fake(['started'])
    still.startsAt.value = 2000
    expect(rebook(id, still.deps)).toBeNull()
    still.startsAt.value = null
    const view = room === 'cryo' ? still.cryoView : still.usView
    view.procedureId = id
    view.watch = true
    expect(rebook(id, still.deps)).toBeNull()
    expect(asked(still, room)).toHaveLength(0)
    const a = fake(['following'])
    expect(rebook(id, a.deps)).toBe('following')
    expect(a.begun).toEqual([{ room, mode: 'follow', procedureId: null }])
    const b = fake(['noTeam'])
    expect(rebook(id, b.deps)).toBe('noTeam')
    expect(b.ended).toBe(1)
  })
})

describe('the CT suite\'s noTeam says why', () => {
  it('the team out of hours is noTeam; the team in but too late for a whole case today is tooLate (and begins nothing either)', () => {
    const hours = fake(['noTeam'])
    hours.why.value = 'hours'
    expect(watchProcedure('cryo-kidney', {}, hours.deps)).toBe('noTeam')
    const late = fake(['noTeam'])
    late.why.value = 'late'
    expect(watchProcedure('cryo-kidney', {}, late.deps)).toBe('tooLate')
    expect(late.begun).toHaveLength(0)
    // a reason with nothing refused changes nothing
    const ok = fake(['started'])
    ok.why.value = 'late'
    expect(watchProcedure('cryo-kidney', {}, ok.deps)).toBe('started')
    // the other rooms never say tooLate
    const us = fake(['noTeam'])
    us.why.value = 'late'
    expect(watchProcedure('us-breastCancer', {}, us.deps)).toBe('noTeam')
    const or = fake(['noTeam'])
    or.why.value = 'late'
    expect(watchProcedure('or-cholecystectomy', {}, or.deps)).toBe('noTeam')
  })
})
