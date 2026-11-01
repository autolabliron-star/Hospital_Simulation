/**
 * R5 wave 3 fixes K1-K3: "Watch step by step" in the ultrasound room projects when the room is really free.
 *
 *   K1  `watchStartsAt()` counts the rest of the current step, the scan to its end, the cleanup, the ProSense case's check and walk in, the
 *       radiologist's walk out and every demo booking ranked ahead; it is null once the watch case has begun (the theatre's port: ports.ts)
 *   K2  `startWatch` answers 'started' only when the room really is free for the case now: otherwise 'queued', with the right `watchStartsAt`
 *   K3  the department's per-tick path does not allocate while a ProSense booking waits for the radiologist to leave
 *
 * Second round (the edges the checker found): the radiologist's walk out past its allowance still counts, a visit whose cleanup time is over but whose patient is
 * still on the couch is not free, and `watchStartsAt` is a readonly property like the theatre's port.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { protocolById } from '@/content/imaging'
import { CONFIG } from '../config'
import { Simulation } from '../Simulation'
import type { SurgeryPort } from '../surgery/ports'
import { ImagingDepartment } from './department'
import { expectedVisitSeconds } from './exam'
import { STILL_LEAVING_SECONDS } from './procedureDoctor'
import { isScripted, procedureIdOf } from './prosense'
import { OFF_THE_COUCH_SECONDS, type Scanner } from './scanner'

const DT = CONFIG.sim.step
const run = (s: Simulation, seconds: number) => {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) s.step(DT)
}
const sim = (seed = 7) => new Simulation(seed, { startHour: 10, inFlight: false })

/** Step until the watch case has begun; returns the sim time it did (the first tick its booking is active), or -1. */
function untilWatchStarts(s: Simulation, limit = 4000): number {
  for (let i = 0, n = Math.round(limit / DT); i < n; i++) {
    s.step(DT)
    const b = s.imaging.bookings.filter((x) => x.watch === true).at(-1)
    if (b !== undefined && b.state === 'active') return s.t
  }
  return -1
}

/** While the watch booking waits, project every `every` s: returns the worst (projection - actual start) over the wait, in seconds (negative: early). */
function worstProjectionError(s: Simulation, every: number, limit = 4000): { early: number; late: number; samples: number; start: number } {
  const samples: { at: number; proj: number }[] = []
  let next = s.t
  let start = -1
  for (let i = 0, n = Math.round(limit / DT); i < n && start < 0; i++) {
    if (s.t >= next) {
      const p = s.imaging.watchStartsAt
      if (p !== null) samples.push({ at: s.t, proj: p })
      next = s.t + every
    }
    s.step(DT)
    const b = s.imaging.bookings.filter((x) => x.watch === true).at(-1)
    if (b !== undefined && b.state === 'active') start = s.t
  }
  let early = 0
  let late = 0
  for (const x of samples) {
    early = Math.min(early, x.proj - start)
    late = Math.max(late, x.proj - start)
  }
  return { early, late, samples: samples.length, start }
}

describe('K1: watchStartsAt projects when the room is really free', () => {
  it('behind a plain scan it counts the whole cleanup (it was short by 40-70 s), at every point of the scan', { timeout: 600_000 }, () => {
    for (const seed of [3, 7]) {
      const s = sim(seed)
      expect(s.imaging.startDemoScan('us')).toBe(true)
      run(s, 20)
      expect(s.imaging.startWatch('us-cryo-breast')).toBe('queued')
      const first = s.imaging.watchStartsAt!
      expect(first).toBeGreaterThan(s.t + 300)
      const w = worstProjectionError(s, 15)
      expect(w.samples, 'sampled through the scan and its cleanup').toBeGreaterThan(30)
      // the cleanup alone is 40-70 s: an estimate that forgets it is wrong by that much
      expect(w.late, `seed ${seed}: never later than the real start`).toBeLessThanOrEqual(1.5)
      expect(w.early, `seed ${seed}: never earlier either`).toBeGreaterThanOrEqual(-1.5)
      expect(Math.abs(first - w.start), `seed ${seed}: the first projection`).toBeLessThanOrEqual(1.5)
    }
  })

  it('in the last seconds of a scan (the cleanup step, where Scanner.remaining() is 0) the projection still has the cleanup left', { timeout: 600_000 }, () => {
    const s = sim(5)
    s.imaging.startDemoScan('us')
    const sc = s.imaging.machines.us
    for (let i = 0, n = Math.round(1500 / DT); i < n && sc.session?.step !== 'cleanup'; i++) s.step(DT)
    expect(sc.session?.step).toBe('cleanup')
    expect(sc.state.remaining).toBe(0)
    run(s, 5)
    expect(s.imaging.startWatch('us-cryo-fibroadenoma')).toBe('queued')
    const proj = s.imaging.watchStartsAt!
    expect(proj - s.t).toBeGreaterThan(10)
    const start = untilWatchStarts(s)
    expect(Math.abs(proj - start)).toBeLessThanOrEqual(1.5)
  })

  it('behind a ProSense case (check, walk in, survey, drape, the freezes, the dressing and the radiologist\'s walk out) it is right at every step', { timeout: 900_000 }, () => {
    for (const protocol of ['us-cryo-fibroadenoma', 'us-cryo-breast']) {
      const s = sim(3)
      expect(s.imaging.startDemoScan('us', protocol)).toBe(true)
      run(s, 5)
      expect(s.imaging.startWatch('us-cryo-breast', { fromStart: true })).toBe('queued')
      const w = worstProjectionError(s, 20, 6000)
      expect(w.start, protocol).toBeGreaterThan(0)
      expect(w.samples, protocol).toBeGreaterThan(50)
      // (the radiologist's walk out is allowed `doctorLeaveSeconds`: within a few seconds of the real one)
      expect(w.late, `${protocol}: late by ${w.late}`).toBeLessThanOrEqual(3)
      expect(w.early, `${protocol}: early by ${w.early}`).toBeGreaterThanOrEqual(-3)
    }
  })

  it('a ProSense case that is still on its console check or its walk in is projected from those windows (130 s and more were missing)', { timeout: 600_000 }, () => {
    const s = sim(9)
    s.imaging.startDemoScan('us', 'us-cryo-fibroadenoma')
    run(s, 1)
    const sc = s.imaging.machines.us
    expect(sc.session?.step).toBe('check')
    const left = sc.freeIn()
    // at least the check, the walk in, the survey, the drape, the sequences and the cleanup of the case
    expect(left).toBeGreaterThan(CONFIG.imaging.cryo.checkSeconds + CONFIG.imaging.cryo.arriveSeconds + 600)
    expect(left).toBeGreaterThan(sc.state.remaining + 130)
  })

  it('counts every demo booking ranked ahead of the watch case: a plain demo queued behind the one in the room', { timeout: 900_000 }, () => {
    const s = sim(7)
    s.imaging.startDemoScan('us')
    run(s, 15)
    s.imaging.startDemoScan('us') // booked behind the first, ahead of the watch case
    expect(s.imaging.startWatch('us-cryo-breast')).toBe('queued')
    const one = sim(7)
    one.imaging.startDemoScan('us')
    run(one, 15)
    one.imaging.startWatch('us-cryo-breast')
    // the second demo (the usual rotation: the renal exam) adds about one visit (the mean of its plan: the draws are not made early)
    const visit = expectedVisitSeconds('us', protocolById('us-renal').sequences, { demo: true, scripted: false })
    expect(s.imaging.watchStartsAt! - one.imaging.watchStartsAt!).toBeCloseTo(visit, 0)
    // an estimate of a visit not yet planned: within a minute, and exact once it is in the room (a few seconds)
    const w = worstProjectionError(s, 30, 6000)
    expect(w.late).toBeLessThanOrEqual(75)
    expect(w.early).toBeGreaterThanOrEqual(-75)
  })

  it('is null once the watch case has begun and when none is booked (the theatre\'s watchStartsAt)', { timeout: 300_000 }, () => {
    const s = sim()
    expect(s.imaging.watchStartsAt).toBeNull()
    expect(s.imaging.startWatch('us-cryo-breast')).toBe('started')
    expect(s.imaging.watchStartsAt).toBeCloseTo(s.t, 6)
    run(s, 2)
    expect(s.imaging.machines.us.session?.booking.watch).toBe(true)
    expect(s.imaging.watchStartsAt).toBeNull()
    // and after it is over
    for (let i = 0, n = Math.round(1500 / DT); i < n && s.imaging.machines.us.session !== null; i++) s.step(DT)
    expect(s.imaging.watchStartsAt).toBeNull()
  })
})

describe('K2: started only when the room really is free', () => {
  it('is queued, with the right start, while the last radiologist is still walking out', { timeout: 900_000 }, () => {
    const s = sim(7)
    expect(s.imaging.startWatch('us-cryo-breast')).toBe('started')
    const sc = s.imaging.machines.us
    // run to the moment the room is empty and the radiologist is on her way out
    let leaving = false
    for (let i = 0, n = Math.round(2000 / DT); i < n && !leaving; i++) {
      s.step(DT)
      const d = s.imaging.radiologist
      leaving = sc.session === null && d !== null && d.leaving
    }
    expect(leaving, 'the room is free and she is still leaving').toBe(true)
    expect(s.imaging.watchStartsAt).toBeNull()
    // the room is free (the old answer was 'started'), but a ProSense case cannot begin with her in the way
    expect(sc.free).toBe(true)
    expect(s.imaging.startWatch('us-cryo-fibroadenoma')).toBe('queued')
    const proj = s.imaging.watchStartsAt!
    expect(proj).toBeGreaterThan(s.t)
    expect(proj - s.t).toBeLessThanOrEqual(CONFIG.imaging.cryo.doctorLeaveSeconds)
    const start = untilWatchStarts(s)
    expect(start).toBeGreaterThan(0)
    expect(Math.abs(proj - start)).toBeLessThanOrEqual(2.5)
  })

  it('is queued while another demo is waiting for the free room ahead of it, and started when nothing is', { timeout: 600_000 }, () => {
    const a = sim(7)
    expect(a.imaging.startDemoScan('us')).toBe(true) // booked this very tick: the room is empty, but it goes first
    expect(a.imaging.machines.us.session).toBeNull()
    expect(a.imaging.startWatch('us-cryo-breast')).toBe('queued')
    expect(a.imaging.watchStartsAt!).toBeGreaterThan(a.t + 300)
    const b = sim(7)
    expect(b.imaging.startWatch('us-cryo-breast')).toBe('started')
    expect(b.imaging.watchStartsAt).toBeCloseTo(b.t, 6)
    // a plain scan in the room, or a ProSense case with fromStart: queued; a ProSense case without it: following
    const c = sim(7)
    c.imaging.startDemoScan('us', 'us-cryo-breast')
    run(c, 5)
    expect(c.imaging.startWatch('us-cryo-fibroadenoma')).toBe('following')
    expect(c.imaging.watchStartsAt).toBeNull()
  })

  it('the radiologist waiting to leave never holds a plain scan: only a ProSense watch case is queued behind her', { timeout: 300_000 }, () => {
    const s = sim(7)
    s.imaging.startWatch('us-cryo-breast')
    const sc = s.imaging.machines.us
    for (let i = 0, n = Math.round(2000 / DT); i < n && !(sc.session === null && s.imaging.radiologist?.leaving === true); i++) s.step(DT)
    expect(s.imaging.radiologist?.leaving).toBe(true)
    // a plain demo is taken at once, as before
    expect(s.imaging.startDemoScan('us')).toBe(true)
    run(s, 0.5)
    expect(sc.session).not.toBeNull()
    expect(isScripted(sc.session!.booking.protocolId)).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------
// K3: no allocation per tick while a ProSense booking waits for the radiologist to walk out
// ---------------------------------------------------------------------------------------------

function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (m) => m.replace(/[^\n]/g, ' '))
}

function bodyOf(src: string, name: string): string {
  const m = new RegExp(`(?:function\\s+|\\s)${name}\\s*\\(`, 'm').exec(src)
  if (!m) throw new Error(`no ${name}`)
  let i = m.index + m[0].length
  let depth = 1
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')') depth--
  }
  const open = src.indexOf('{', i)
  let braces = 0
  let end = open
  for (; end < src.length; end++) {
    if (src[end] === '{') braces++
    else if (src[end] === '}' && --braces === 0) break
  }
  return src.slice(open, end + 1)
}

const FLAGGED: [RegExp, string][] = [
  [/\bnew\s+[A-Za-z]/, 'new'],
  [/(^|[=(,:?&|]|\breturn)\s*\[/m, 'array literal'],
  [/(^|[=(,?&|]|\breturn)\s*\{\s*[a-zA-Z_]+\s*:/m, 'object literal'],
  [/\.\.\./, 'spread'],
  [/=>/, 'closure'],
  [/\.(map|filter|reduce|slice|concat|splice|forEach|some|find|every|sort)\(/, 'array method'],
  [/\bObject\.(entries|keys|values|fromEntries)\b/, 'Object.entries & co'],
  [/\bfunction\b/, 'inner function'],
]

describe('K3: the department\'s per-tick path allocates nothing', () => {
  const dept = code(readFileSync(join(process.cwd(), 'src/sim/imaging/department.ts'), 'utf8'))
  const pros = code(readFileSync(join(process.cwd(), 'src/sim/imaging/prosense.ts'), 'utf8'))

  it('serve() (every scanner, every tick) and the memoised look-up of the script have no allocation', () => {
    const offenders: string[] = []
    const scan = (file: string, src: string, name: string, skipFirstLookup = false) => {
      let body = bodyOf(src, name)
      // procedureIdOf: the first look-up (a Map hit) is what runs per tick; the miss path below it runs once per protocol
      if (skipFirstLookup) body = body.slice(0, body.indexOf('let found'))
      expect(body.length, `${file} ${name}`).toBeGreaterThan(20)
      body.split('\n').forEach((line, i) => {
        for (const [re, what] of FLAGGED) if (re.test(line)) offenders.push(`${file} ${name}+${i}: ${what}: ${line.trim()}`)
      })
    }
    scan('department.ts', dept, 'serve')
    scan('prosense.ts', pros, 'procedureIdOf', true)
    scan('prosense.ts', pros, 'isScripted')
    expect(offenders).toEqual([])
  })

  it('serve() is the loop step() calls every tick, and holds the `isScripted` test of a waiting booking', () => {
    expect(bodyOf(dept, 'step')).toContain('this.serve(t, dt)')
    expect(bodyOf(dept, 'serve')).toContain('isScripted(b.protocolId)')
  })

  it('asking whether a protocol is scripted twice looks the script up once (no Object.entries on the second ask)', () => {
    const spy = vi.spyOn(Object, 'entries')
    try {
      expect(procedureIdOf('us-cryo-breast')).toBe('us-breastCancer') // (first look-up of this protocol anywhere in the run, or a hit)
      const warm = spy.mock.calls.length
      for (let i = 0; i < 500; i++) {
        expect(isScripted('us-cryo-breast')).toBe(true)
        expect(isScripted('us-cryo-fibroadenoma')).toBe(true)
        expect(isScripted('us-abdo')).toBe(false)
      }
      // (the other two protocols were looked up once each, in the first round; never again)
      expect(spy.mock.calls.length - warm).toBeLessThanOrEqual(2)
      const after = spy.mock.calls.length
      for (let i = 0; i < 500; i++) {
        isScripted('us-cryo-breast')
        isScripted('us-cryo-fibroadenoma')
        isScripted('us-abdo')
      }
      expect(spy.mock.calls.length).toBe(after)
    } finally {
      spy.mockRestore()
    }
  })

  it('a ProSense booking waiting for the walking-out radiologist ticks without any look-up through the case\'s ticks', { timeout: 300_000 }, () => {
    const s = sim(7)
    s.imaging.startWatch('us-cryo-breast')
    const sc = s.imaging.machines.us
    for (let i = 0, n = Math.round(2000 / DT); i < n && !(sc.session === null && s.imaging.radiologist?.leaving === true); i++) s.step(DT)
    expect(s.imaging.radiologist?.leaving).toBe(true)
    // warm the memo for every protocol the department asks about, then queue a ProSense demo behind her
    isScripted('us-cryo-breast')
    expect(s.imaging.startDemoScan('us', 'us-cryo-breast')).toBe(true)
    const spy = vi.spyOn(Object, 'entries')
    try {
      const before = spy.mock.calls.length
      let waiting = 0
      for (let i = 0, n = Math.round(6 / DT); i < n && s.imaging.radiologist?.leaving === true; i++) {
        s.imaging.step(s.t, DT) // the department alone: the loop that used to allocate
        waiting++
      }
      expect(waiting).toBeGreaterThan(30)
      // (the department's own step looks no script up: the remaining calls, if any, are other code's, a handful at most)
      expect(spy.mock.calls.length - before).toBeLessThanOrEqual(0)
    } finally {
      spy.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------------------------
// K1, the estimate's edges
// ---------------------------------------------------------------------------------------------

describe('K1 edges: the walk out past its allowance, the patient still on the couch, and the port\'s shape', () => {
  /** A free room, a watch case run to the moment the room is empty and the radiologist is still on her way out. */
  function leavingRoom(): Simulation {
    const s = sim(7)
    expect(s.imaging.startWatch('us-cryo-breast')).toBe('started')
    const sc = s.imaging.machines.us
    let leaving = false
    for (let i = 0, n = Math.round(2000 / DT); i < n && !leaving; i++) {
      s.step(DT)
      const d = s.imaging.radiologist
      leaving = sc.session === null && d !== null && d.leaving
    }
    expect(leaving, 'the room is free and she is still leaving').toBe(true)
    return s
  }

  it('past `doctorLeaveSeconds` she is still leaving: leavesIn() never reads "out of the way", so the watch case is queued, not "started", and the projection is ahead', { timeout: 300_000 }, () => {
    const s = leavingRoom()
    const d = s.imaging.radiologist!
    expect(d.leavesIn()).toBeGreaterThan(0)
    // a slow walk: the allowance is used up and she is still walking out (the failsafe is DISMISS_LIMIT, 40 s)
    ;(d as unknown as { dismissT: number }).dismissT = CONFIG.imaging.cryo.doctorLeaveSeconds + 5
    expect(d.leaving).toBe(true)
    expect(d.leavesIn(), 'the old answer was 0 here').toBeGreaterThanOrEqual(STILL_LEAVING_SECONDS)
    expect(s.imaging.startWatch('us-cryo-fibroadenoma'), 'the room is free but she is in the way').toBe('queued')
    const proj = s.imaging.watchStartsAt!
    expect(proj - s.t).toBeGreaterThanOrEqual(STILL_LEAVING_SECONDS - 1e-6)
    const start = untilWatchStarts(s)
    expect(start).toBeGreaterThan(0)
    // never later than the real start (a skip lands before it, never in it), and close
    expect(proj).toBeLessThanOrEqual(start + 1.5)
    expect(start - proj).toBeLessThanOrEqual(12)
  })

  it('leavesIn() is 0 when she is not on her way out (parked, or not in the building yet) and counts down inside the allowance', { timeout: 300_000 }, () => {
    const s = sim(7)
    expect(s.imaging.radiologist).toBeNull()
    const s2 = leavingRoom()
    const d = s2.imaging.radiologist!
    const a = d.leavesIn()
    expect(a).toBeLessThanOrEqual(CONFIG.imaging.cryo.doctorLeaveSeconds)
    run(s2, 1)
    expect(d.leaving ? d.leavesIn() : 0).toBeLessThanOrEqual(a)
    // parked again after the walk: nothing left
    for (let i = 0, n = Math.round(60 / DT); i < n && d.leaving; i++) s2.step(DT)
    expect(d.leaving).toBe(false)
    expect(d.leavesIn()).toBe(0)
  })

  it('a visit whose cleanup time is over but whose patient is still on the couch is not free: it has about a second left, not none, and a watch case is queued behind it', { timeout: 300_000 }, () => {
    const s = sim(5)
    expect(s.imaging.startDemoScan('us')).toBe(true)
    const sc: Scanner = s.imaging.machines.us
    for (let i = 0, n = Math.round(1500 / DT); i < n && sc.session?.step !== 'cleanup'; i++) s.step(DT)
    expect(sc.session?.step).toBe('cleanup')
    const sess = (sc as unknown as { sess: { stepT: number; plan: { cleanupS: number } } }).sess
    // inside its time the cleanup counts down as before
    sess.stepT = sess.plan.cleanupS - 5
    expect(sc.freeIn()).toBeCloseTo(5, 6)
    // past it the session is still open (end() waits for the patient to be off the couch): the room is not free yet
    sess.stepT = sess.plan.cleanupS + 3
    expect(OFF_THE_COUCH_SECONDS).toBeGreaterThan(0.5)
    expect(sc.freeIn(), 'it was 0 here').toBe(OFF_THE_COUCH_SECONDS)
    expect(s.imaging.startWatch('us-cryo-breast'), 'it said "started" here').toBe('queued')
    expect(s.imaging.watchStartsAt! - s.t).toBeCloseTo(OFF_THE_COUCH_SECONDS, 6)
  })

  it('watchStartsAt is a readonly property like the theatre\'s SurgeryPort (the watch panel reads both the same way), not a method', () => {
    const d = Object.getOwnPropertyDescriptor(ImagingDepartment.prototype, 'watchStartsAt')
    expect(d?.get).toBeTypeOf('function')
    expect(d?.set).toBeUndefined()
    const s = sim()
    // (compile time: the department satisfies the port's member)
    const port: Pick<SurgeryPort, 'watchStartsAt'> = s.imaging
    expect(port.watchStartsAt).toBeNull()
    expect(s.imaging.startWatch('us-cryo-breast')).toBe('started')
    expect(port.watchStartsAt).toBeCloseTo(s.t, 6)
    expect(typeof port.watchStartsAt).toBe('number')
  })
})
