/**
 * W4 health kiosks: one kiosk's session script. A station owns its `HealthKioskState` (the scene reads it every frame; it is mutated in place) and
 * runs one session at a time:
 *
 *   calling  the person walks onto the platform (the station waits for them: they are told with `kioskCalled`)
 *   login -> height -> weight -> bodyFat      standing on the weighing platform (the platform raises them 5 cm)
 *   sit -> spo2 -> bp -> (bpRest -> bp) ->    seated on the stool at the BP wing (`kioskSit`); the finger clip doubles as the rest before the cuff
 *   temp -> report                            back on the platform for the forehead thermometer and the printed report (`kioskCalled` again)
 *
 * The phases, their durations and the third reading come from plan.ts. The reading in `state.reading` fills in as each step finishes. `state.bpRound`
 * is the cuff reading being taken (1, 2, 3) during 'bp' and the reading just taken during 'bpRest'. `state.version` bumps when a screen's content
 * changes: a phase, a field, the user, and once a second of progress (so a canvas screen repaints at most about once a second).
 *
 * The station poses the subject's entity (anim, the seated flag, the platform height): 'finger' at login, SpO2 and the report, 'grip' on the body-fat
 * handles, 'idle' on the platform for height, weight and temperature, 'armIn' for the cuff. `sync()` re-applies it before every render, since the
 * person's own controller runs after the service in a step and may put an idle pose back. For YOUR avatar the scene moves you: only the anim is set.
 */
import { CONFIG } from '../config'
import { HEALTH_KIOSKS, type Spot } from '../places'
import type { Rng } from '../rng'
import type { AnimState, Entity, HealthKioskPhase, HealthKioskState, HealthSessionKind, VitalsReading } from '../types'
import { bmiOf, bpOfRounds, measureBodyFat, measureBp, measureHeight, measureSpo2, measureTemp, measureWeight, type Profile } from './model'
import { buildPlan, type Plan, type Step, type TimedPhase } from './plan'
import type { KioskSubjectExtras } from './line'
import type { KioskSubject } from './ports'
import { TUNING } from './tuning'

/** What the station needs to see of a person: their entity (to pose), and where their body is and whether it has finished walking. */
export interface BodyLike {
  entity: Entity
  walker: { x: number; z: number }
  /** An Actor's `done`: false while it is still carrying out a move. Absent: judged by position alone. */
  done?: boolean
}

/** One finished (or cut short) session, for the metrics and the tests. */
export interface SessionLog {
  index: number
  kind: HealthSessionKind
  userId: string
  userName: string
  /** When they joined the line (the call time for somebody who was not in it: you). */
  joinedAt: number
  calledAt: number
  /** When the login began (the person was on the platform). */
  startedAt: number
  endedAt: number
  partial: boolean
  /** Cuff readings taken. */
  rounds: number
  assisted: boolean
  /** The person never reached the platform and was taken as arrived after the timeout. */
  forced: boolean
}

/** What a station asks of its service. */
export interface StationEnv {
  readonly t: number
  profileOf(id: string, name: string, subject: KioskSubject): Profile
  bodyOf(subject: KioskSubject): BodyLike | null
  /** The BP stool: the registry's 'kioskBp:<i>' seat when the layout has it (claimed for `userId`), else the anchor spot. */
  claimStool(index: number, userId: string): { spot: Spot; seatId: string }
  releaseStool(index: number, userId: string): void
  /** A fresh reading id. */
  readingId(personId: string, source: 'kiosk' | 'player'): string
  /** The guide: true if she is free and now helps this kiosk's user. */
  reserveGuide(index: number, userId: string, userName: string): boolean
  releaseGuide(index: number): void
  /** The session ended: store the reading (if it holds any data), say the event, log it. `reading` is null when nothing was measured. */
  ended(log: SessionLog, reading: VitalsReading | null, subject: KioskSubject): void
}

export interface Session {
  subject: KioskSubject
  id: string
  name: string
  kind: HealthSessionKind
  player: boolean
  profile: Profile
  body: BodyLike | null
  rng: Rng
  steps: Step[]
  extra: [Step, Step]
  idx: number
  reading: VitalsReading
  joinedAt: number
  calledAt: number
  startedAt: number
  phaseTime: number
  assisted: boolean
  forced: boolean
  /** Cuff readings taken so far, and the BP steps begun. */
  rounds: number
  bpBegun: number
  /** The pose the station has put the entity in (so it takes back only what it set). */
  seatId: string
  seatedSet: boolean
  raised: boolean
  y: number
  lastTick: number
}

/** `startedAt` of a call that never reached the platform. (Not -1: a warm start before 07:30 runs the sim clock at negative times.) */
export const NOT_STARTED = -Infinity

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
const smooth = (x: number): number => {
  const t = clamp01(x)
  return t * t * (3 - 2 * t)
}

/** The cuff over one reading: inflates over `cuffRise`, holds for `cuffHold`, then deflates slowly. 0..1. */
export function cuffAt(progress: number): number {
  const rise = TUNING.cuffRise
  const hold = rise + TUNING.cuffHold
  if (progress <= rise) return smooth(progress / rise)
  if (progress <= hold) return 1
  return 1 - smooth((progress - hold) / (1 - hold))
}

function hasData(r: VitalsReading): boolean {
  return r.heightCm !== null || r.weightKg !== null || r.bodyFatPct !== null || r.spo2 !== null || r.bp.length > 0 || r.tempC !== null
}

/** Phases spent standing on the weighing platform. */
function onPlatform(phase: HealthKioskPhase, phaseTime: number): boolean {
  switch (phase) {
    case 'login':
    case 'height':
    case 'weight':
    case 'bodyFat':
    case 'report':
      return true
    case 'temp':
      return phaseTime >= TUNING.standUpSeconds
    default:
      return false
  }
}

const SEATED: ReadonlySet<HealthKioskPhase> = new Set<HealthKioskPhase>(['sit', 'spo2', 'bp', 'bpRest'])
const OWN_ANIMS: ReadonlySet<AnimState> = new Set<AnimState>(['finger', 'grip', 'armIn'])

export class KioskStation {
  readonly state: HealthKioskState
  session: Session | null = null
  /** Seconds before this kiosk takes somebody new (the last person is stepping off the platform). */
  cooldown = 0
  readonly stand: Spot
  private count = 0

  constructor(
    readonly index: number,
    private readonly rng: Rng,
    private readonly env: StationEnv,
    state: HealthKioskState,
  ) {
    this.state = state
    this.stand = HEALTH_KIOSKS[index].stand
  }

  /** Nobody here and the platform has cleared: the next in line may be called. */
  get free(): boolean {
    return this.session === null && this.cooldown <= 0
  }
  get busy(): boolean {
    return this.session !== null
  }

  // --- starting ----------------------------------------------------------------------------------------

  /** The head of the line is called: they walk onto the platform. */
  call(subject: KioskSubject, kind: HealthSessionKind, joinedAt: number = this.env.t): void {
    this.open(subject, kind, false, joinedAt)
    subject.kioskCalled(this.index, this.stand)
  }

  /** Your own session: no calling phase, the scene has put you at the kiosk. */
  beginPlayer(subject: KioskSubject): void {
    this.open(subject, 'player', true, this.env.t)
    this.startSteps()
  }

  private open(subject: KioskSubject, kind: HealthSessionKind, player: boolean, joinedAt: number): void {
    const env = this.env
    const st = this.state
    const rng = this.rng.fork(++this.count)
    const profile = env.profileOf(subject.id, subject.name, subject)
    const wantAssist = rng.chance(CONFIG.vitals.assistChance) || profile.age >= CONFIG.vitals.assistAge
    const assisted = !player && wantAssist && env.reserveGuide(this.index, subject.id, subject.name)
    const plan: Plan = buildPlan(kind, rng, assisted)
    const reading = emptyFor(env.readingId(subject.id, player ? 'player' : 'kiosk'), subject, player ? 'player' : 'kiosk', this.index, env.t)
    this.session = {
      subject,
      id: subject.id,
      name: subject.name,
      kind,
      player,
      profile,
      body: env.bodyOf(subject),
      rng,
      steps: plan.steps,
      extra: plan.extra,
      idx: -1,
      reading,
      joinedAt,
      calledAt: env.t,
      startedAt: NOT_STARTED,
      phaseTime: 0,
      assisted,
      forced: false,
      rounds: 0,
      bpBegun: 0,
      seatId: '',
      seatedSet: false,
      raised: false,
      y: 0,
      lastTick: -1,
    }
    st.phase = 'calling'
    st.phaseTime = 0
    st.progress = 0
    st.kind = kind
    st.userId = subject.id
    st.userName = subject.name
    st.bpRound = 0
    st.cuff = 0
    st.reading = reading
    st.assisted = assisted
    st.version++
  }

  private startSteps(): void {
    const s = this.session!
    s.startedAt = this.env.t
    s.phaseTime = 0
    s.idx = 0
    this.enter(s.steps[0])
  }

  // --- the script ----------------------------------------------------------------------------------------

  step(dt: number): void {
    const s = this.session
    if (s === null) {
      if (this.cooldown > 0) this.cooldown -= dt
      return
    }
    const st = this.state
    s.phaseTime += dt
    if (st.phase === 'calling') {
      st.phaseTime = s.phaseTime
      if (this.arrived(s)) this.startSteps()
      else return
    }
    const step = s.steps[s.idx]
    st.phaseTime = s.phaseTime
    st.progress = clamp01(s.phaseTime / step.dur)
    st.cuff = st.phase === 'bp' ? cuffAt(st.progress) : 0
    const tick = Math.floor(s.phaseTime)
    if (tick !== s.lastTick) {
      s.lastTick = tick
      st.version++
    }
    this.pose(s, dt)
    if (s.phaseTime >= step.dur) this.advance(s, s.phaseTime - step.dur)
  }

  private arrived(s: Session): boolean {
    if (s.phaseTime >= TUNING.callTimeoutSeconds) {
      s.forced = true
      ;(s.subject as KioskSubjectExtras).kioskForced?.(this.stand)
      return true
    }
    const b = s.body
    if (b === null) return s.phaseTime >= TUNING.unknownArrivalSeconds
    if (b.done === false) return false
    return Math.hypot(b.walker.x - this.stand.at.x, b.walker.z - this.stand.at.z) <= TUNING.arriveRadius
  }

  private advance(s: Session, overflow: number): void {
    this.complete(s, s.steps[s.idx])
    s.idx++
    if (s.idx >= s.steps.length) {
      this.end(false)
      return
    }
    s.phaseTime = overflow
    this.enter(s.steps[s.idx])
  }

  /** A step begins: the state shows it, and the person is told where to go. */
  private enter(step: Step): void {
    const s = this.session!
    const st = this.state
    const phase: TimedPhase = step.phase
    st.phase = phase
    st.progress = 0
    st.cuff = 0
    s.lastTick = -1
    if (phase === 'bp') {
      s.bpBegun++
      st.bpRound = s.bpBegun
    }
    st.version++
    if (s.player) {
      this.pose(s, 0)
      return
    }
    if (phase === 'sit') {
      const stool = this.env.claimStool(this.index, s.id)
      s.seatId = stool.seatId
      s.subject.kioskSit(stool.spot)
    } else if (phase === 'temp') {
      // stand up from the stool and walk back to the platform for the thermometer
      this.env.releaseStool(this.index, s.id)
      this.unseat(s)
      s.subject.kioskCalled(this.index, this.stand)
    }
    this.pose(s, 0)
  }

  /** A step finished: its measurement joins the reading. */
  private complete(s: Session, step: Step): void {
    const r = s.reading
    const p = s.profile
    const rng = s.rng
    const st = this.state
    switch (step.phase) {
      case 'height':
        r.heightCm = measureHeight(p, rng)
        break
      case 'weight':
        r.weightKg = measureWeight(p, rng)
        r.bmi = Math.round(bmiOf(r.weightKg, r.heightCm ?? p.heightCm) * 10) / 10
        break
      case 'bodyFat':
        r.bodyFatPct = measureBodyFat(p, r.bmi ?? p.bmi, rng)
        break
      case 'spo2': {
        const m = measureSpo2(p, rng)
        r.spo2 = m.spo2
        r.pulse = m.pulse
        break
      }
      case 'bp': {
        r.bp.push(measureBp(p, s.rounds + 1, rng))
        s.rounds++
        const m = bpOfRounds(r.bp)!
        r.sys = m[0]
        r.dia = m[1]
        // two readings that disagree: a third after a rest (PUMCH guidance), spliced in right after this step
        if (s.kind === 'full' && s.rounds === 2 && Math.abs(r.bp[1][0] - r.bp[0][0]) > CONFIG.vitals.bpRepeatDeltaSys) s.steps.splice(s.idx + 1, 0, s.extra[0], s.extra[1])
        break
      }
      case 'temp':
        r.tempC = measureTemp(p, rng)
        break
      default:
        break
    }
    r.at = this.env.t
    st.version++
  }

  // --- ending --------------------------------------------------------------------------------------------

  /** Leave now: the reading so far is kept (partial) when it holds any data. For the line, a call that never started, and you walking away. */
  abort(): VitalsReading | null {
    if (this.session === null) return null
    return this.end(true)
  }

  private end(partial: boolean): VitalsReading | null {
    const s = this.session!
    const st = this.state
    const env = this.env
    const r = s.reading
    r.partial = partial
    r.at = env.t
    const data = hasData(r)
    this.release(s)
    env.releaseGuide(this.index)
    const started = s.startedAt !== NOT_STARTED
    st.phase = 'idle'
    st.phaseTime = 0
    st.progress = 0
    st.kind = null
    st.userId = null
    st.userName = null
    st.bpRound = 0
    st.cuff = 0
    st.reading = null
    st.assisted = false
    if (started) st.sessionsToday++
    st.version++
    this.session = null
    this.cooldown = s.player || !started ? 0 : TUNING.turnoverSeconds
    const log: SessionLog = {
      index: this.index,
      kind: s.kind,
      userId: s.id,
      userName: s.name,
      joinedAt: s.joinedAt,
      calledAt: s.calledAt,
      startedAt: s.startedAt,
      endedAt: env.t,
      partial,
      rounds: s.rounds,
      assisted: s.assisted,
      forced: s.forced,
    }
    env.ended(log, data ? r : null, s.subject)
    // the person is told only when the session ran to its end: when they or the player cut it short, they already know
    if (!partial && !s.player) s.subject.kioskDone(r)
    return data ? r : null
  }

  // --- the person's pose --------------------------------------------------------------------------------

  /** The anim the phase asks for, or null while the person is still walking or gliding (their own controller poses them then). */
  private animFor(s: Session): AnimState | null {
    switch (this.state.phase) {
      case 'login':
      case 'report':
      case 'spo2':
        return 'finger'
      case 'height':
      case 'weight':
        return 'idle'
      case 'bodyFat':
        return 'grip'
      case 'temp':
        return s.phaseTime >= TUNING.standUpSeconds ? 'idle' : null
      case 'sit':
        return s.phaseTime >= TUNING.seatSettleSeconds ? 'armIn' : null
      case 'bp':
      case 'bpRest':
        return 'armIn'
      default:
        return null
    }
  }

  /** Is the person on the stool now? (Not while they are still gliding onto it, nor once they have stood up for the thermometer.) */
  private seatedNow(s: Session): boolean {
    const phase = this.state.phase
    return SEATED.has(phase) && !(phase === 'sit' && s.phaseTime < TUNING.seatSettleSeconds)
  }

  /** Where the person's body should be and what it is doing: written every step (with the platform's rise) and again before every render. */
  private pose(s: Session, dt: number): void {
    const e = s.body?.entity ?? null
    if (e === null) return
    const anim = this.animFor(s)
    if (s.player) {
      // you are moved by the scene: only the pose
      if (anim !== null) e.anim = anim
      return
    }
    // the platform raises the person who stands on it; walking on and stepping off are smooth
    const target = onPlatform(this.state.phase, s.phaseTime) ? TUNING.platformY : 0
    const rate = (TUNING.platformY / TUNING.platformRiseSeconds) * dt
    s.y += Math.abs(target - s.y) <= rate ? target - s.y : Math.sign(target - s.y) * rate
    s.raised = s.raised || s.y > 0
    if (anim !== null) e.anim = anim
    if (this.seatedNow(s)) {
      if (e.seated === undefined) {
        e.seated = { seatId: s.seatId, pose: 'sit' }
        s.seatedSet = true
      }
    } else if (s.seatedSet) {
      e.seated = undefined
      s.seatedSet = false
    }
    if (s.raised) e.position.y = s.y
  }

  /** Re-apply the pose (called before every render): the person's own controller runs after the service in a step and may have put an idle pose back. */
  sync(): void {
    const s = this.session
    if (s === null || s.body === null || this.state.phase === 'calling') return
    const e = s.body.entity
    const anim = this.animFor(s)
    if (anim !== null) e.anim = anim
    if (s.player) return
    if (s.seatedSet && e.seated === undefined) e.seated = { seatId: s.seatId, pose: 'sit' }
    if (s.raised) e.position.y = s.y
  }

  private unseat(s: Session): void {
    const e = s.body?.entity
    if (e && s.seatedSet) e.seated = undefined
    s.seatedSet = false
  }

  /** Put back what the station set: the stool, the platform height, our own poses. */
  private release(s: Session): void {
    const e = s.body?.entity ?? null
    this.env.releaseStool(this.index, s.id)
    if (e === null) return
    if (OWN_ANIMS.has(e.anim)) e.anim = 'idle'
    if (s.player) return
    this.unseat(s)
    if (s.raised) e.position.y = 0
  }
}

function emptyFor(id: string, subject: KioskSubject, source: 'kiosk' | 'player', station: number, at: number): VitalsReading {
  return {
    id,
    personId: subject.id,
    personName: subject.name,
    at,
    source,
    station,
    sys: null,
    dia: null,
    pulse: null,
    spo2: null,
    tempC: null,
    heightCm: null,
    weightKg: null,
    bmi: null,
    bodyFatPct: null,
    bp: [],
    partial: true,
  }
}
