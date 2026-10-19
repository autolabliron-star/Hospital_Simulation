import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { Rng } from '../rng'
import { SampleBook } from '../samples'
import type { DrawPhase, LabOrder, SeatSpec, TubeKind } from '../types'
import { bloodText, tubeWord } from '@/content/bloodCopy'
import { planDraw, plannedOutcome, straightSeconds, type PlanRng } from './plan'
import { RobotStation, scanSweep, type NursePort, type StationHost } from './station'
import type { DrawSubject } from './subject'
import { TicketBook, type DrawEntry } from './tickets'
import { BLOOD_EVENT_TYPE, type BloodEventKey } from '@/content/bloodCopy'

const DT = 1 / 60

/** A random stream that plays the plan's chances from a script and every duration at the middle of its range. */
function scripted(o: { noVein?: boolean; misses?: boolean[]; moves?: boolean[]; moveTube?: number } = {}): PlanRng {
  const misses = [...(o.misses ?? [])]
  const moves = [...(o.moves ?? [])]
  return {
    between: (span) => (span[0] + span[1]) / 2,
    int: (lo, hi) => Math.min(hi, Math.max(lo, o.moveTube ?? lo)),
    chance: (p) => {
      if (p === CONFIG.blood.noVeinChance) return o.noVein === true
      if (p === CONFIG.blood.firstStickMissChance) return misses.shift() ?? false
      if (p === CONFIG.blood.armMoveChance) return moves.shift() ?? false
      return false
    },
  }
}

class FakeSubject {
  readonly actor = { gone: false } as DrawSubject['actor']
  seated = false
  onChair = true
  armed: boolean[] = []
  released = 0
  nearlyDone = 0
  aborted = 0
  constructor(
    readonly id: string,
    readonly name: string,
  ) {}
  drawCalled(): void {}
  seatedOn(): boolean {
    return this.seated
  }
  offChair(): boolean {
    return !this.onChair
  }
  armIn(on: boolean): void {
    this.armed.push(on)
  }
  drawNearlyDone(): void {
    this.nearlyDone++
  }
  drawReleased(): void {
    this.released++
    // a walk-in gets up at once
    this.onChair = false
  }
  drawAborted(): void {
    this.aborted++
  }
  resultsReady(_o: LabOrder): void {}
}

class FakeNurse implements NursePort {
  readonly id = 'draw-nurse'
  readonly name = 'Nurse Hana'
  readonly onSite = true
  trays: { station: RobotStation; ticket: string }[] = []
  assists: { station: RobotStation; ticket: string; kind: 'manual' | 'reassure' }[] = []
  /** Every assist alert ever raised (the queues above are drained as she responds). */
  assistLog: { kind: 'manual' | 'reassure' }[] = []
  releases = 0
  /** Respond at once (zero walking time) unless a test holds her back. */
  auto = true
  bringTray(station: RobotStation, ticket: string): void {
    this.trays.push({ station, ticket })
  }
  assist(station: RobotStation, ticket: string, kind: 'manual' | 'reassure'): void {
    this.assists.push({ station, ticket, kind })
    this.assistLog.push({ kind })
  }
  release(): void {
    this.releases++
  }
  /** Her side of the conversation: deliver trays and arrive at stations. */
  pump(): void {
    if (!this.auto) return
    for (const t of this.trays.splice(0)) t.station.trayDelivered()
    for (const a of this.assists.splice(0)) a.station.nurseArrived(this.id)
  }
}

interface Rig {
  station: RobotStation
  host: StationHost & { events: { key: BloodEventKey; text: string }[]; sent: { id: string; source: number }[]; finished: { by: string; attempt: number }[]; abortCount: number; chairCount: number }
  nurse: FakeNurse
  subject: FakeSubject
  entry: DrawEntry
  samples: SampleBook
  phases: DrawPhase[]
  /** Seconds in each phase, in order. */
  spans: { phase: DrawPhase; seconds: number }[]
  t: number
  step(): void
  run(seconds: number): void
  runUntil(pred: () => boolean, max?: number): void
}

function rig(opts: { rng?: PlanRng; tubes?: TubeKind[]; kind?: DrawEntry['kind']; seat?: boolean } = {}): Rig {
  const tubes = opts.tubes ?? ['citrate', 'serum', 'heparin', 'EDTA']
  const samples = new SampleBook()
  const nurse = new FakeNurse()
  const subject = new FakeSubject('pt-1', 'Ana Silva')
  const book = new TicketBook()
  const entry = book.issue({ cls: 'P', patientId: 'pt-1', patientName: 'Ana Silva', orderId: 'L1', t: 0, subject: subject as unknown as DrawSubject, kind: opts.kind ?? 'outpatient', ready: true })
  entry.tubes = tubes
  entry.sampleIds = tubes.map((kind) => samples.create({ orderId: 'L1', patientId: 'pt-1', tube: kind, cap: 'gold', tests: ['cbc'], priority: 'routine' }, 0).id)
  entry.trayReady = true
  const events: { key: BloodEventKey; text: string }[] = []
  const sent: { id: string; source: number }[] = []
  const finished: { by: string; attempt: number }[] = []
  const host = {
    nurse,
    lab: { samples, send: (id: string, source: number) => sent.push({ id, source }) },
    now: () => r.t,
    say: (key: BloodEventKey, fields: Record<string, string | number>) => events.push({ key, text: bloodText(key, fields) }),
    drawFinished: (_s: RobotStation, _e: DrawEntry, by: 'robot' | 'nurse', attempt: number) => finished.push({ by, attempt }),
    releaseChair: () => {
      host.chairCount++
    },
    aborted: () => {
      host.abortCount++
    },
    events,
    sent,
    finished,
    abortCount: 0,
    chairCount: 0,
  }
  const seat = { id: 'drawChair:robot:1', kind: 'drawChair', area: 'diagnostics', x: -25.2, z: 10.25, heading: 0, pose: 'sit', height: 0.45, approach: { x: -25.2, z: 9.3 } } as SeatSpec
  const station = new RobotStation(1, opts.rng ?? scripted(), seat, host as unknown as StationHost)
  const phases: DrawPhase[] = []
  const spans: { phase: DrawPhase; seconds: number }[] = []
  const r: Rig = {
    station,
    host: host as Rig['host'],
    nurse,
    subject,
    entry,
    samples,
    phases,
    spans,
    t: 0,
    step() {
      nurse.pump()
      const before = station.state.phase
      station.step(DT)
      r.t += DT
      const ph = station.state.phase
      if (spans.length === 0 || spans[spans.length - 1].phase !== ph) {
        if (ph !== 'idle' || before !== 'idle') spans.push({ phase: ph, seconds: 0 })
      }
      if (spans.length > 0) spans[spans.length - 1].seconds += DT
      if (phases[phases.length - 1] !== ph) phases.push(ph)
    },
    run(seconds) {
      for (let i = 0, n = Math.round(seconds / DT); i < n; i++) r.step()
    },
    runUntil(pred, max = 900) {
      for (let i = 0, n = Math.round(max / DT); i < n && !pred(); i++) r.step()
    },
  }
  return r
}

/** Call the ticket and seat the patient: the robot starts its script. */
function begin(r: Rig): void {
  r.entry.ticket.state = 'called'
  r.station.begin(r.entry)
  r.phases.push(r.station.phase)
  r.subject.seated = true
}

const WORKING: DrawPhase[] = ['cardScan', 'armIn', 'cuff', 'sanitise', 'veinScan', 'needleIn', 'filling', 'needleOut', 'bandage']

describe('a robot draw, played straight', () => {
  it('goes calling -> cardScan -> armIn -> cuff -> sanitise -> veinScan -> needleIn -> filling -> needleOut -> bandage -> release -> reset -> idle', () => {
    const r = rig()
    begin(r)
    r.runUntil(() => r.station.free)
    expect(r.phases).toEqual(['calling', ...WORKING, 'release', 'reset', 'idle'])
    expect(r.station.free).toBe(true)
    expect(r.station.state.ticket).toBeNull()
    expect(r.station.state.drawsToday).toBe(1)
    expect(r.station.state.robotDrawsToday).toBe(1)
    expect(r.host.finished).toEqual([{ by: 'robot', attempt: 1 }])
    expect(r.entry.ticket.state).toBe('done')
    expect(r.entry.drawnBy).toBe('robot')
    expect(r.subject.released).toBe(1)
    expect(r.host.chairCount).toBe(1)
  })

  it('waits in calling for the patient on the chair and the nurse with the tray', () => {
    const r = rig()
    r.nurse.auto = false
    r.entry.ticket.state = 'called'
    r.station.begin(r.entry)
    r.run(20)
    expect(r.station.phase).toBe('calling') // nobody in the chair yet, no tray
    r.subject.seated = true
    r.run(20)
    expect(r.station.phase).toBe('calling') // the tray is not here
    expect(r.nurse.trays).toHaveLength(1)
    r.station.trayDelivered()
    r.run(0.1)
    expect(r.station.phase).toBe('cardScan')
    expect(r.station.state.trayHere).toBe(true)
    expect(r.entry.ticket.state).toBe('drawing')
  })

  it('takes 150-240 s from the card scan to the bandage for 4 tubes (the plan of this rig: the middle of every range)', () => {
    const r = rig()
    begin(r)
    r.runUntil(() => r.station.phase === 'release')
    const sum = r.spans.filter((s) => WORKING.includes(s.phase)).reduce((a, s) => a + s.seconds, 0)
    expect(sum).toBeGreaterThan(150)
    expect(sum).toBeLessThan(240)
    expect(sum).toBeCloseTo(straightSeconds(r.station.plan!), 0)
  })

  it('draws every tube once, in the order of draw, and sends them to the lab from this robot', () => {
    const r = rig()
    begin(r)
    const drawnOrder: string[] = []
    let last = -1
    for (let i = 0; i < 60 * 600 && !r.station.free; i++) {
      r.step()
      for (const id of r.entry.sampleIds) {
        if (r.samples.get(id)!.stage === 'drawn' && !drawnOrder.includes(id)) drawnOrder.push(id)
      }
      const tube = r.station.state.tube
      if (r.station.phase === 'filling') {
        expect(tube).toBeGreaterThanOrEqual(last)
        last = tube
      }
    }
    expect(drawnOrder).toEqual(r.entry.sampleIds)
    expect(r.samples.get(r.entry.sampleIds[0])!.tube).toBe('citrate')
    expect(r.host.sent.map((s) => s.id)).toEqual(r.entry.sampleIds)
    expect(r.host.sent.every((s) => s.source === 1)).toBe(true)
    expect(r.host.events.map((e) => BLOOD_EVENT_TYPE[e.key])).toEqual(['bloodDrawn', 'samplesSent'])
    expect(r.host.events[0].text).toBe(`Robot 2 drew 4 ${tubeWord(4)} from Ana Silva, first attempt.`)
  })

  it('moves the parts: the cuff rises and falls, the scan head sweeps and settles, the needle goes in and out, each tube fills then tips', () => {
    const r = rig({ tubes: ['serum', 'EDTA'] })
    begin(r)
    const plan = () => r.station.plan!
    let cuffMax = 0
    let needleMax = 0
    let scanMax = 0
    let scanAtEnd = -1
    const fills: number[] = []
    let inversionsMax = 0
    for (let i = 0; i < 60 * 600 && !r.station.free; i++) {
      r.step()
      const s = r.station.state
      expect(s.cuff).toBeGreaterThanOrEqual(0)
      expect(s.cuff).toBeLessThanOrEqual(1)
      expect(s.needle).toBeGreaterThanOrEqual(0)
      expect(s.needle).toBeLessThanOrEqual(1)
      expect(s.scan).toBeGreaterThanOrEqual(0)
      expect(s.scan).toBeLessThanOrEqual(1)
      cuffMax = Math.max(cuffMax, s.cuff)
      needleMax = Math.max(needleMax, s.needle)
      scanMax = Math.max(scanMax, s.scan)
      if (s.phase === 'needleIn' && plan()) scanAtEnd = s.scan
      if (s.phase === 'filling') fills.push(s.tubeFill)
      inversionsMax = Math.max(inversionsMax, s.inversions)
      if (s.phase === 'idle') {
        expect(s.cuff).toBe(0)
        expect(s.needle).toBe(0)
      }
    }
    expect(cuffMax).toBe(1)
    expect(needleMax).toBe(1)
    expect(scanMax).toBeGreaterThan(0.95) // the head sweeps the whole forearm ...
    expect(scanAtEnd).toBeCloseTo(0.625, 5) // ... and settles on the vein (the middle of 0.45-0.8)
    expect(fills.some((f) => f > 0.4 && f < 0.6)).toBe(true)
    expect(inversionsMax).toBe(8) // the last tube (EDTA) is tipped 8 times
    expect(scanSweep(0, 0.6)).toBe(0)
    expect(scanSweep(0.75, 0.6)).toBeCloseTo(0, 9)
    expect(scanSweep(1, 0.6)).toBeCloseTo(0.6, 9)
  })

  it('the scan head holds its last position through needle-in, filling and needle-out, and a re-scan starts from it (no snap)', () => {
    const r = rig({ rng: scripted({ misses: [true, false] }), tubes: ['EDTA'] })
    begin(r)
    let held = -1
    let rescanStart = -1
    let prev = 0
    let jump = 0
    let secondScan = false
    for (let i = 0; i < 60 * 600 && !r.station.free; i++) {
      const before = r.station.phase
      r.step()
      const s = r.station.state
      if (before === 'needleIn' && s.phase === 'veinScan') {
        secondScan = true
        rescanStart = s.scan
      }
      if (secondScan && s.phase === 'veinScan') jump = Math.max(jump, Math.abs(s.scan - prev))
      if ((s.phase === 'filling' || s.phase === 'needleOut' || s.phase === 'bandage') && held < 0) held = s.scan
      if (s.phase === 'filling' || s.phase === 'needleOut') expect(s.scan).toBeCloseTo(held, 9)
      prev = s.scan
    }
    expect(held).toBeCloseTo(0.625, 5)
    expect(rescanStart).toBeCloseTo(0.625, 5)
    expect(jump).toBeLessThan(0.05)
  })

  it('shows light: white idle, teal working, green when done', () => {
    const r = rig()
    expect(r.station.state.light).toBe('white')
    begin(r)
    expect(r.station.state.light).toBe('white') // calling: waiting for the patient
    const seen = new Set<string>()
    const byPhase = new Map<DrawPhase, string>()
    for (let i = 0; i < 60 * 600 && !r.station.free; i++) {
      r.step()
      seen.add(r.station.state.light)
      byPhase.set(r.station.phase, r.station.state.light)
    }
    expect(byPhase.get('filling')).toBe('teal')
    expect(byPhase.get('release')).toBe('green')
    expect(seen.has('amber')).toBe(false)
    expect(r.station.state.light).toBe('white')
  })

  it('bumps its version when the screen has something new, and tells the patient when to put the arm in and out', () => {
    const r = rig()
    const v0 = r.station.state.version
    begin(r)
    expect(r.station.state.version).toBeGreaterThan(v0)
    let v = r.station.state.version
    let bumps = 0
    for (let i = 0; i < 60 * 600 && !r.station.free; i++) {
      r.step()
      if (r.station.state.version !== v) {
        bumps++
        v = r.station.state.version
      }
    }
    expect(bumps).toBeGreaterThan(20)
    expect(r.subject.armed).toEqual([true, false])
    expect(r.subject.nearlyDone).toBe(1)
  })
})

describe('the robot cannot draw: the nurse takes over', () => {
  it('no suitable vein: the cuff opens, the light goes amber, the nurse draws by hand, then the arm is released', () => {
    const r = rig({ rng: scripted({ noVein: true }) })
    begin(r)
    r.runUntil(() => r.station.phase === 'fallbackToNurse')
    expect(r.station.phase).toBe('fallbackToNurse')
    expect(r.station.state.light).toBe('amber')
    expect(r.station.state.needle).toBe(0)
    expect(r.nurse.assistLog.map((a) => a.kind)).toEqual(['manual'])
    r.runUntil(() => r.station.free)
    expect(r.phases).toEqual(['calling', 'cardScan', 'armIn', 'cuff', 'sanitise', 'veinScan', 'fallbackToNurse', 'release', 'reset', 'idle'])
    expect(r.entry.drawnBy).toBe('nurse')
    expect(r.station.nurseReason).toBe('noVein')
    expect(r.station.state.nurseDrawsToday).toBe(1)
    expect(r.station.state.robotDrawsToday).toBe(0)
    expect(r.host.finished).toEqual([{ by: 'nurse', attempt: 1 }])
    expect(r.nurse.releases).toBe(1)
    const kinds = r.host.events.map((e) => e.key)
    expect(kinds).toEqual(['drawByNurseNoVein', 'bloodDrawnByNurse'])
    expect(r.host.events[0].text).toBe('Robot 2 found no suitable vein for Ana Silva: Nurse Hana will draw by hand.')
    // every tube was drawn once, by hand, and none went through the robot's riser
    expect(r.samples.counts().drawn).toBe(4)
    expect(r.host.sent).toEqual([])
    expect(r.station.handTubes).toEqual(r.entry.sampleIds)
    // the hand draw takes the planned 55-90 s (the middle: 72.5)
    const manual = r.spans.find((s) => s.phase === 'fallbackToNurse')!.seconds
    expect(manual).toBeGreaterThan(55)
    expect(manual).toBeLessThan(95)
  })

  it('the robot waits for the nurse: the hand draw only starts once she is at the chair', () => {
    const r = rig({ rng: scripted({ noVein: true }) })
    r.nurse.auto = false
    begin(r)
    r.station.trayDelivered()
    r.runUntil(() => r.station.phase === 'fallbackToNurse')
    r.run(60)
    expect(r.station.phase).toBe('fallbackToNurse')
    expect(r.station.state.progress).toBe(0)
    expect(r.station.nurseWait).toBeGreaterThan(55)
    expect(r.nurse.assists).toHaveLength(1)
    expect(r.nurse.assists[0].kind).toBe('manual')
    // the cuff opened meanwhile
    expect(r.station.state.cuff).toBe(0)
    r.station.nurseArrived('draw-nurse')
    expect(r.station.state.attendantId).toBe('draw-nurse')
    r.run(40)
    expect(r.station.state.progress).toBeGreaterThan(0.3)
    expect(r.station.state.light).toBe('amber')
  })

  it('a missed first stick goes back to the vein scan and tries again (attempt 2), with no nurse', () => {
    const r = rig({ rng: scripted({ misses: [true, false] }) })
    begin(r)
    r.runUntil(() => r.station.free)
    expect(r.phases).toEqual(['calling', 'cardScan', 'armIn', 'cuff', 'sanitise', 'veinScan', 'needleIn', 'veinScan', 'needleIn', 'filling', 'needleOut', 'bandage', 'release', 'reset', 'idle'])
    expect(r.entry.drawnBy).toBe('robot')
    expect(r.host.finished).toEqual([{ by: 'robot', attempt: 2 }])
    expect(r.host.events[0].key).toBe('bloodDrawnRetry')
    expect(r.host.events[0].text).toBe('Robot 2 drew 4 tubes from Ana Silva on attempt 2.')
    expect(r.nurse.assistLog).toHaveLength(0)
  })

  it('a missed stick pulls the needle back out before the new scan', () => {
    const r = rig({ rng: scripted({ misses: [true, false] }) })
    begin(r)
    let peak = 0
    let retracted = false
    r.runUntil(() => r.station.phase === 'needleIn' && r.station.state.attempts === 1)
    while (r.station.phase === 'needleIn') {
      r.step()
      peak = Math.max(peak, r.station.state.needle)
    }
    retracted = r.station.state.needle === 0
    expect(peak).toBeGreaterThan(0.7)
    expect(peak).toBeLessThan(0.9) // the miss never goes all the way in
    expect(retracted).toBe(true)
    expect(r.station.phase).toBe('veinScan')
  })

  it('after the maximum robot attempts the nurse draws (missed twice)', () => {
    expect(CONFIG.blood.maxRobotAttempts).toBe(2)
    const r = rig({ rng: scripted({ misses: [true, true] }) })
    begin(r)
    let attempts = 0
    while (!r.station.free) {
      r.step()
      attempts = Math.max(attempts, r.station.state.attempts)
    }
    expect(r.phases).toEqual(['calling', 'cardScan', 'armIn', 'cuff', 'sanitise', 'veinScan', 'needleIn', 'veinScan', 'needleIn', 'fallbackToNurse', 'release', 'reset', 'idle'])
    expect(r.station.nurseReason).toBe('missed')
    expect(r.entry.drawnBy).toBe('nurse')
    expect(r.host.events[0].key).toBe('drawByNurseMissed')
    expect(attempts).toBe(2)
  })

  it('the arm moves: the needle snaps out, the nurse is alerted and calms them, the robot retries from the cuff, and the tubes already filled stay filled', () => {
    const r = rig({ rng: scripted({ moves: [true, false], moveTube: 2 }) })
    begin(r)
    r.runUntil(() => r.station.phase === 'armMoved')
    expect(r.station.phase).toBe('armMoved')
    expect(r.station.state.needle).toBe(0)
    expect(r.station.state.light).toBe('amber')
    expect(r.station.state.tube).toBe(2)
    // the two tubes before the interrupted one are already drawn
    const drawn = () => r.entry.sampleIds.filter((id) => r.samples.get(id)!.stage === 'drawn')
    expect(drawn()).toEqual(r.entry.sampleIds.slice(0, 2))
    expect(r.station.state.tubeFill).toBe(0)
    expect(r.nurse.assistLog.map((a) => a.kind)).toEqual(['reassure'])
    r.runUntil(() => r.station.free)
    expect(r.phases).toEqual([
      'calling',
      'cardScan',
      'armIn',
      'cuff',
      'sanitise',
      'veinScan',
      'needleIn',
      'filling',
      'armMoved',
      'cuff',
      'sanitise',
      'veinScan',
      'needleIn',
      'filling',
      'needleOut',
      'bandage',
      'release',
      'reset',
      'idle',
    ])
    expect(r.entry.drawnBy).toBe('robot')
    expect(r.host.finished).toEqual([{ by: 'robot', attempt: 2 }])
    expect(r.station.armMoves).toBe(1)
    // every tube drawn exactly once: the four sends are the four samples in order
    expect(r.host.sent.map((s) => s.id)).toEqual(r.entry.sampleIds)
    expect(r.host.events.map((e) => e.key)).toEqual(['armMoved', 'bloodDrawnRetry', 'samplesSent'])
    // the calming took 15-30 s (the middle: 22.5 s)
    const calm = r.spans.find((s) => s.phase === 'armMoved')!.seconds
    expect(calm).toBeGreaterThan(20)
    expect(calm).toBeLessThan(26)
  })

  it('a second move goes to the nurse: the tubes the robot filled are kept and sent, the rest are drawn by hand', () => {
    const r = rig({ rng: scripted({ moves: [true, true], moveTube: 2 }) })
    begin(r)
    r.runUntil(() => r.station.free)
    expect(r.phases).toEqual([
      'calling',
      'cardScan',
      'armIn',
      'cuff',
      'sanitise',
      'veinScan',
      'needleIn',
      'filling',
      'armMoved',
      'cuff',
      'sanitise',
      'veinScan',
      'needleIn',
      'filling',
      'fallbackToNurse',
      'release',
      'reset',
      'idle',
    ])
    expect(r.station.nurseReason).toBe('moved')
    expect(r.entry.drawnBy).toBe('nurse')
    expect(r.host.sent.map((s) => s.id)).toEqual(r.entry.sampleIds.slice(0, 2)) // the robot's two tubes
    expect(r.station.handTubes).toEqual(r.entry.sampleIds.slice(2)) // the nurse's two
    expect(r.samples.counts().drawn).toBe(4)
    expect(r.host.events.map((e) => e.key)).toEqual(['armMoved', 'drawByNurseMoved', 'bloodDrawnByNurse', 'samplesSent'])
  })

  it('plays any plan the same way the plan says: the outcome of 300 seeded draws matches plannedOutcome', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const planRng = new Rng(seed)
      // two rigs from the same stream: one only reads the plan, the other plays it
      const expected = plannedOutcome(planDraw(new Rng(seed), ['EDTA', 'heparin']))
      const r = rig({ rng: planRng, tubes: ['EDTA', 'heparin'] })
      begin(r)
      r.runUntil(() => r.station.free, 1200)
      expect(r.station.free, `seed ${seed}`).toBe(true)
      if (expected.by === 'nurse') {
        expect(r.entry.drawnBy, `seed ${seed}`).toBe('nurse')
        expect(r.station.nurseReason, `seed ${seed}`).toBe(expected.reason)
      } else {
        expect(r.entry.drawnBy, `seed ${seed}`).toBe('robot')
        expect(r.station.nurseReason, `seed ${seed}`).toBeNull()
      }
      expect(r.samples.counts().drawn, `seed ${seed}`).toBe(2)
    }
  })
})

describe('the ER patient and the safety net', () => {
  it('an ER patient is released onto the wheelchair: the robot waits in awaitPorter until they are off the chair', () => {
    const r = rig({ kind: 'er' })
    begin(r)
    r.subject.drawReleased = function () {
      this.released++ // stays on the chair: the porter has not come yet
    }
    r.runUntil(() => r.station.phase === 'awaitPorter')
    expect(r.station.phase).toBe('awaitPorter')
    expect(r.station.state.light).toBe('green')
    r.run(120)
    expect(r.station.phase).toBe('awaitPorter') // the porter is slow; the robot stays put
    r.subject.onChair = false
    r.run(0.1)
    expect(r.station.phase).toBe('reset')
    r.runUntil(() => r.station.free)
    expect(r.station.free).toBe(true)
    expect(r.entry.drawnBy).toBe('robot')
  })

  it('a walk-in who never gets to the chair does not hold the robot for ever: the call is dropped after config.blood.stuckSeconds', () => {
    const r = rig()
    r.entry.ticket.state = 'called'
    r.station.begin(r.entry)
    r.subject.seated = false
    r.run(CONFIG.blood.stuckSeconds - 5)
    expect(r.station.phase).toBe('calling')
    r.run(10)
    expect(r.station.free).toBe(true)
    expect(r.host.abortCount).toBe(1)
  })

  it('an ER patient on the way is never dropped', () => {
    const r = rig({ kind: 'er' })
    r.entry.ticket.state = 'called'
    r.station.begin(r.entry)
    r.run(CONFIG.blood.stuckSeconds * 3)
    expect(r.station.phase).toBe('calling')
    expect(r.host.abortCount).toBe(0)
  })

  it('can serve patient after patient, each from a clean start', () => {
    const r = rig()
    for (let k = 0; k < 3; k++) {
      r.entry.ticket.state = 'called'
      r.subject.onChair = true
      r.station.begin(r.entry)
      r.subject.seated = true
      r.runUntil(() => r.station.free)
      expect(r.station.free).toBe(true)
      expect(r.station.state.tubes).toEqual([])
      expect(r.station.state.patientName).toBeNull()
    }
    expect(r.station.state.drawsToday).toBe(3)
  })
})
