/**
 * W4: the entrance health kiosks (China 健康一体机 style): two towers in the lobby, each with a weighing platform and a blood-pressure wing, one shared
 * line, a guide who helps the elderly, walk-up visitors who come in for a check, and ER walk-ins who stop at a kiosk while they wait for triage.
 * Owner: agent V (src/sim/vitals/**). The interface is frozen in ports.ts (`VitalsPort`, `KioskSubject`); `Simulation` builds, steps and syncs this.
 *
 *   model.ts    the seeded body behind every reading: height (the avatar's own), BMI, body fat (Deurenberg), pressure, pulse, SpO2, temperature,
 *               white-coat offset; measurement noise per device
 *   plan.ts     the timed script of a session (full, vitals-only, yours) and the third cuff reading
 *   station.ts  one kiosk running a session: the phases, the cuff, the reading filling in, the subject's pose
 *   line.ts     the shared first-come-first-served line
 *   walkUp.ts   walk-up visitors and their seeded arrivals
 *   guide.ts    Nurse Ingrid
 *   player.ts   your own short session
 *
 * Everything is synthetic and display-only: the sim never reads a value to decide anything, and the event line states numbers without judging them.
 */
import { renderLine } from '@/content/vitalsCopy'
import { W4_STAFF } from '@/content/staff'
import { CONFIG } from '../config'
import { rateAt } from '../population/schedule'
import { HEALTH_KIOSKS } from '../places'
import type { Walker } from '../walker'
import type { World } from '../er/world'
import type { Rng } from '../rng'
import type { Entity, HealthKioskPhase, HealthKioskState, HealthSessionKind, VitalsReading } from '../types'
import { KioskGuide } from './guide'
import { HealthLine, isQueueAware } from './line'
import { profileFor, readingAt, type Profile } from './model'
import { PlayerSubject, playerTooFar } from './player'
import type { KioskSubject, VitalsPort } from './ports'
import { KioskStation, NOT_STARTED, type BodyLike, type SessionLog, type StationEnv } from './station'
import { TUNING } from './tuning'
import { WalkUp, WalkUpSpawner, type WalkUpHost } from './walkUp'

export function newKioskState(index: number): HealthKioskState {
  return { index, phase: 'idle', phaseTime: 0, progress: 0, kind: null, userId: null, userName: null, bpRound: 0, cuff: 0, reading: null, assisted: false, sessionsToday: 0, version: 0 }
}

const NONE: readonly VitalsReading[] = []
/** The in-flight warm-up: which phase each kiosk is in at `MID_AT` seconds after the start (between the 50 s and 60 s pre-rolls). */
const IN_FLIGHT_PHASES: readonly HealthKioskPhase[] = ['bp', 'spo2', 'bodyFat', 'login']
const MID_AT = 55
/** How long a person's body and readings are kept (sim seconds), and how many session logs. */
const KEEP_SECONDS = 48 * 3600
const MAX_LOGS = 4000

/** The numbers the tests and the HUD read. */
export interface VitalsStats {
  /** Every session that got as far as the platform and ended, in order (the last 4000). */
  sessions: SessionLog[]
  walkUpsGone: number
  /** Readings by a nurse at triage. */
  triageReadings: number
}

export class VitalsService implements VitalsPort {
  readonly kiosks: HealthKioskState[] = HEALTH_KIOSKS.map((k) => newKioskState(k.index))
  /** The kiosk kept free for the presenter after a warm start, or -1 (for the tests and the panel). */
  get heldKiosk(): number {
    return this.held >= 0 && this.t < this.heldUntil ? this.held : -1
  }
  /** Your avatar (set by the Simulation): your own kiosk session moves it. Null when you are not in the hospital. */
  playerOf: () => Entity | null = () => null

  readonly line = new HealthLine()
  readonly stations: KioskStation[]
  readonly stats: VitalsStats = { sessions: [], walkUpsGone: 0, triageReadings: 0 }
  /** Walk-up visitors on site now. */
  readonly walkUps = new Set<WalkUp>()
  readonly spawner: WalkUpSpawner
  /** The guide, once she is on site (the Simulation with a population: from the first step). */
  guide: KioskGuide | null = null
  /** The kiosk the guide is helping (-1: none). */
  guideFor = -1

  private t = 0
  private started = false
  private day = -1
  private readingSeq = 0
  private playerKiosk = -1
  private readonly playerSubject = new PlayerSubject()
  private readonly profiles = new Map<string, Profile>()
  private readonly profileAt = new Map<string, number>()
  private pruneAt = 0
  private readonly ages = new Map<string, number>()
  private readonly readings = new Map<string, VitalsReading[]>()
  private readonly profileRng: Rng
  private seatKnown: Set<string> | null = null
  /** S1: the kiosk kept free for the presenter after a warm start (-1: none), and until when. */
  private held = -1
  private heldUntil = 0

  constructor(
    protected readonly world: World,
    protected readonly rng: Rng,
    protected readonly walkerFor: (id: string) => Walker,
  ) {
    this.profileRng = rng.fork('profiles')
    const env = this.makeEnv()
    this.stations = this.kiosks.map((state, i) => new KioskStation(i, rng.fork(`station${i}`), env, state))
    const host: WalkUpHost = {
      offer: (s, kind) => this.offer(s, kind),
      abort: (id) => this.abort(id),
      walkUpGone: (w) => {
        this.walkUps.delete(w)
        this.stats.walkUpsGone++
      },
    }
    this.spawner = new WalkUpSpawner(
      world,
      rng.fork('walkups'),
      walkerFor,
      (p) => {
        this.walkUps.add(p)
        world.hooks.add(p)
      },
      host,
      () => this.line.length + this.pendingWalkUps() < this.line.capacity && this.walkUps.size < TUNING.maxWalkUps,
    )
  }

  // --- the port ------------------------------------------------------------------------------------------

  offer(subject: KioskSubject, kind: HealthSessionKind): boolean {
    if (kind === 'player') return false
    if (this.kioskOf(subject.id) >= 0 || this.line.has(subject.id)) return true
    return this.line.join({ id: subject.id, name: subject.name, subject, kind, joinedAt: this.t }) >= 0
  }

  abort(personId: string): void {
    this.line.leave(personId)
    const k = this.kioskOf(personId)
    if (k >= 0) {
      if (personId === this.playerSubject.id) this.playerKiosk = -1
      this.stations[k].abort()
    }
  }

  recordTriage(personId: string, personName: string, _nurseId: string): VitalsReading {
    const profile = this.profileOf(personId, personName, null)
    const seq = ++this.readingSeq
    const id = `triage:${personId}:${seq}`
    const reading = readingAt(profile, 'triage', this.rng.fork(id), { id, at: this.world.t })
    this.stats.triageReadings++
    this.store(reading)
    return reading
  }

  readingsFor(personId: string): readonly VitalsReading[] {
    return this.readings.get(personId) ?? NONE
  }

  beginPlayer(index: number): 'started' | 'busy' {
    if (index < 0 || index >= this.stations.length) return 'busy'
    if (this.playerOf() === null || this.playerKiosk >= 0) return 'busy'
    const st = this.stations[index]
    if (st.busy) return 'busy'
    this.playerKiosk = index
    st.beginPlayer(this.playerSubject)
    return 'started'
  }

  cancelPlayer(): void {
    const k = this.playerKiosk
    this.playerKiosk = -1
    if (k >= 0) this.stations[k].abort()
  }

  // --- time ------------------------------------------------------------------------------------------------

  step(t: number, dt: number): void {
    this.t = t
    if (!this.started) this.begin(t, dt)
    this.rollDay(t)
    if (t >= this.pruneAt) {
      this.pruneAt = t + 3600
      this.prune(t)
    }
    this.spawner.step(t)
    this.dispatch()
    for (let i = 0; i < this.stations.length; i++) this.stations[i].step(dt)
    this.watchPlayer()
  }

  sync(alpha: number): void {
    void alpha
    for (let i = 0; i < this.stations.length; i++) this.stations[i].sync()
  }

  /**
   * S1 in-flight warm (after warmStart): start the day here (so the first step does not reset what is placed), then put CONFIG.opening.kiosks walk-ups
   * on the kiosk platforms, each part-way through a session: the first at the cuff, the next on the finger clip (then the grip handles, the login). Each
   * is timed so the middle of that phase falls `MID_AT` seconds on, which holds for the 50 s opening pre-roll and the 60 s of a Jump. They are real
   * walk-ups in the line and at a station, so the sessions finish normally (slip, home). Logs nothing; seeded from the service stream. Not placed when
   * the clock is outside the walk-up hours.
   */
  warmInFlight(t: number): void {
    const wasT = this.world.t
    this.t = t
    this.world.t = t
    if (!this.started) this.begin(t, CONFIG.sim.step)
    this.rollDay(t)
    const want = Math.min(CONFIG.opening.kiosks, this.stations.length)
    // the kiosks past the placed ones: the last is kept free for you to show (nobody is called to it for a while, see `dispatch`)
    this.held = want < this.stations.length ? this.stations.length - 1 : -1
    this.heldUntil = t + CONFIG.opening.kioskHoldSeconds
    const hour = (((CONFIG.sim.startHour * 3600 + t + MID_AT) / 3600) % 24 + 24) % 24
    if (want <= 0 || this.world.ambient === null || rateAt(CONFIG.vitals.walkUpsPerHour, hour) <= 0) {
      this.world.t = wasT
      return
    }
    const rng = this.rng.fork('inFlight')
    const placed: WalkUp[] = []
    for (let i = 0; i < want; i++) {
      const w = this.spawner.spawnAt(this.stations[i].stand, rng.fork(i))
      if (w !== null) placed.push(w)
    }
    this.dispatch()
    const dt = CONFIG.sim.step
    for (const st of this.stations) {
      const s = st.session
      if (s === null || st.free) continue
      // when the target phase is in the middle of its run at MID_AT: start the session that much earlier
      const phase = IN_FLIGHT_PHASES[st.index % IN_FLIGHT_PHASES.length]
      let from = 0
      let mid = 0
      for (const step of s.steps) {
        if (step.phase === phase) {
          mid = from + step.dur / 2
          break
        }
        from += step.dur
      }
      const offset = Math.max(0, mid - MID_AT)
      const t0 = t - offset
      this.world.t = t0
      s.joinedAt = t0
      s.calledAt = t0
      st.step(dt) // on the platform already: the login begins
      for (let k = 1; k * dt < offset; k++) {
        this.world.t = t0 + k * dt
        st.step(dt)
      }
      this.world.t = t
    }
    for (const w of placed) w.settleOnStool()
    this.world.t = wasT
  }

  /** A start at another hour: an empty line and idle kiosks (the day's counts start from zero, the arrivals from that hour). */
  warmStart(hour: number): void {
    void hour
    this.cancelPlayer()
    for (const s of this.stations) {
      s.abort()
      s.cooldown = 0
    }
    this.line.clear()
    for (const k of this.kiosks) k.sessionsToday = 0
    this.held = -1
    this.started = false
    this.day = -1
  }

  /**
   * Somebody's age, when the caller knows it (an inpatient from the catalogue): used when their body is drawn. False if their profile already exists
   * (the age is then fixed). Everybody else gets a seeded age.
   */
  setAge(personId: string, age: number): boolean {
    if (this.profiles.has(personId)) return false
    this.ages.set(personId, age)
    return true
  }

  /** A person's body as the kiosks drew it, or null if nobody has needed it yet. For the panels and the tests. */
  profileIfDrawn(personId: string): Profile | null {
    return this.profiles.get(personId) ?? null
  }

  /** The guide is on site (idempotent). The Simulation brings her with the first step when it has a population; tests with a bare world can call this. */
  ensureGuide(): KioskGuide | null {
    if (this.guide) return this.guide
    const staff = W4_STAFF.find((s) => s.id === 'kiosk-guide')
    if (!staff) return null
    const guide = new KioskGuide(staff, this.walkerFor(staff.id), { guideTarget: () => this.guideFor })
    this.guide = guide
    this.world.hooks.add(guide)
    return guide
  }

  // --- the first step, the day, the line ----------------------------------------------------------------------

  /** The first step of a run (or of a warm start). A world with no population (`population: false`) has no director, so no guide and no walk-ups. */
  private begin(t: number, dt: number): void {
    this.started = true
    if (this.world.ambient === null) return
    this.ensureGuide()
    this.spawner.start(t - dt)
  }

  private rollDay(t: number): void {
    const day = Math.floor((CONFIG.sim.startHour * 3600 + t) / 86400)
    if (this.day !== day) {
      if (this.day >= 0) for (const k of this.kiosks) k.sessionsToday = 0
      this.day = day
    }
  }

  /** A long run keeps what the last two days need: older readings, bodies and session logs go. */
  private prune(t: number): void {
    const horizon = t - KEEP_SECONDS
    for (const [id, list] of this.readings) if (list[list.length - 1].at < horizon) this.readings.delete(id)
    for (const [id, at] of this.profileAt) {
      if (at >= horizon) continue
      this.profileAt.delete(id)
      this.profiles.delete(id)
      this.ages.delete(id)
    }
    const logs = this.stats.sessions
    if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS + 1000)
  }

  private pendingWalkUps(): number {
    let n = 0
    for (const w of this.walkUps) if (w.state === 'fade') n++
    return n
  }

  /** Kiosk index of somebody's session (including the call), or -1. */
  private kioskOf(id: string): number {
    for (let i = 0; i < this.stations.length; i++) if (this.stations[i].session?.id === id) return i
    return -1
  }

  /**
   * A free kiosk takes the head of the line (the one with fewer sessions today first), then everyone is told where to stand. The kiosk kept for you
   * after a warm start takes nobody until the hold is over or you have used it.
   */
  private dispatch(): void {
    const line = this.line
    if (this.held >= 0 && this.t >= this.heldUntil) this.held = -1
    while (line.length > 0) {
      let pick: KioskStation | null = null
      for (const s of this.stations) {
        if (!s.free || s.index === this.held) continue
        if (pick === null || s.state.sessionsToday < pick.state.sessionsToday) pick = s
      }
      if (pick === null) break
      const e = line.shift()!
      pick.call(e.subject, e.kind, e.joinedAt)
    }
    const members = line.members
    for (let i = 0; i < members.length; i++) {
      const e = members[i]
      if (e.told === i) continue
      e.told = i
      if (isQueueAware(e.subject)) e.subject.kioskQueued(line.spotFor(i), i)
    }
  }

  private watchPlayer(): void {
    const k = this.playerKiosk
    if (k < 0) return
    const st = this.stations[k]
    const e = this.playerOf()
    const s = st.session
    if (e === null || s === null || playerTooFar(e, st.stand, this.t - s.startedAt)) this.cancelPlayer()
  }

  // --- the stations' side --------------------------------------------------------------------------------------

  private makeEnv(): StationEnv {
    const svc = this
    return {
      get t() {
        return svc.world.t
      },
      profileOf: (id, name, subject) => svc.profileOf(id, name, subject),
      bodyOf: (subject) => svc.bodyOf(subject),
      claimStool: (index, userId) => {
        const seatId = `kioskBp:${index}`
        if (svc.hasSeat(seatId)) {
          svc.world.seats.claimId(seatId, userId)
          const seat = svc.world.seats.byId(seatId)
          return { spot: { at: { x: seat.x, z: seat.z }, heading: seat.heading }, seatId }
        }
        return { spot: HEALTH_KIOSKS[index].bpSeat, seatId }
      },
      releaseStool: (index, userId) => {
        const seatId = `kioskBp:${index}`
        if (svc.hasSeat(seatId)) svc.world.seats.release(seatId, userId)
      },
      readingId: (personId, source) => `${source}:${personId}:${++svc.readingSeq}`,
      reserveGuide: (index, userId, userName) => {
        if (svc.guide === null || svc.guideFor >= 0) return false
        svc.guideFor = index
        svc.world.say('healthCheck', renderLine('guide', { guide: svc.guide.entity.name, name: userName, kiosk: index + 1 }), { subjectId: userId, actorId: svc.guide.entity.id })
        return true
      },
      releaseGuide: (index) => {
        if (svc.guideFor === index) svc.guideFor = -1
      },
      ended: (log, reading, subject) => svc.sessionEnded(log, reading, subject),
    }
  }

  private hasSeat(id: string): boolean {
    if (this.seatKnown === null) this.seatKnown = new Set(this.world.seats.all.map((s) => s.id))
    return this.seatKnown.has(id)
  }

  /** What the service can see of a person: their entity to pose and their body to watch. Anything with an entity and a walker, an ER patient, or you. */
  private bodyOf(subject: KioskSubject): BodyLike | null {
    const s = subject as Partial<BodyLike>
    if (s.entity !== undefined && s.walker !== undefined) return s as BodyLike
    if (subject.id === this.playerSubject.id) {
      const e = this.playerOf()
      return e === null ? null : { entity: e, walker: e.position }
    }
    return this.world.patients.get(subject.id) ?? null
  }

  /** A person's profile, drawn on first need (the kiosk or the triage nurse, whichever comes first) and kept for the day. */
  private profileOf(id: string, name: string, subject: KioskSubject | null): Profile {
    const have = this.profiles.get(id)
    if (have) return have
    const body = subject ? this.bodyOf(subject) : (this.world.patients.get(id) ?? null)
    const hint = {
      variant: body?.entity.variant,
      reason: this.world.patients.get(id)?.c.reason,
      age: id === this.playerSubject.id ? TUNING.playerAge : this.ages.get(id),
    }
    const p = profileFor(id, name, hint, this.profileRng)
    this.profiles.set(id, p)
    this.profileAt.set(id, this.t)
    return p
  }

  private store(r: VitalsReading): void {
    const list = this.readings.get(r.personId)
    if (list) list.push(r)
    else this.readings.set(r.personId, [r])
  }

  private sessionEnded(log: SessionLog, reading: VitalsReading | null, subject: KioskSubject): void {
    // a call that never reached the platform (the person left first) was no session
    if (log.startedAt !== NOT_STARTED) this.stats.sessions.push(log)
    if (log.userId === this.playerSubject.id) {
      this.playerKiosk = -1
      // you have shown it: the kiosk goes back to everyone
      if (log.index === this.held) this.held = -1
    }
    if (reading === null) return
    this.store(reading)
    const you = log.kind === 'player'
    const bp = reading.sys !== null && reading.dia !== null
    let text: string
    if (log.partial) {
      if (you) return
      text = bp ? renderLine('earlyWithBp', { name: log.userName, sys: reading.sys!, dia: reading.dia! }) : renderLine('early', { name: log.userName })
    } else {
      const v = { name: log.userName, kiosk: log.index + 1, sys: reading.sys ?? 0, dia: reading.dia ?? 0, spo2: reading.spo2 ?? 0, bmi: reading.bmi?.toFixed(1) ?? '0' }
      text = renderLine(you ? 'player' : log.kind === 'vitals' ? 'er' : 'walkUp', v)
    }
    this.world.say('healthCheck', text, { subjectId: subject.id })
  }
}
