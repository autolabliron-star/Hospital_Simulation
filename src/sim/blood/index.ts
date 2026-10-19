/**
 * W4: the robot blood-draw centre. Booked outpatients and ER patients get a ticket (P / V), a tube-prep job and a robot; three robots draw,
 * and one supervising nurse carries the labelled trays, draws by hand when a robot cannot (about 6 %), and calms a patient whose arm moved.
 * The tubes then go to the lab through the pneumatic tube (world.lab.send). The frozen interface is ports.ts (DrawPort); everything else
 * here is this service's own.
 *
 *   tickets.ts  P / V numbers and the call order        prep.ts     the BC-ROBO tube-prep machine
 *   plan.ts     one draw's durations and chance rolls   station.ts  one robot's script        nurse.ts  the supervising nurse
 *   visitor.ts  booked outpatients                      arrivals.ts when they arrive          subject.ts who is drawn (also ER patients)
 *
 * Owner: agent B (src/sim/blood/**, plus its wiring of er/patient.ts, er/pathway.machine.ts and er/porter.ts).
 */
import { bloodText, BLOOD_EVENT_TYPE, type BloodEventKey } from '@/content/bloodCopy'
import { LAB_CATALOGUE, panelTests, tubesFor } from '@/content/lab'
import { CONFIG } from '../config'
import type { EventRefs, World } from '../er/world'
import { isWalkable } from '../nav/layout'
import { hourAt } from '../population/schedule'
import { ARRIVALS, DRAW_CENTRE, type Spot } from '../places'
import type { Rng } from '../rng'
import type { DrawStationState, DrawTicket, LabOrder, SeatSpec, TubeKind, TubePrepState, Vec2 } from '../types'
import type { Walker } from '../walker'
import { ArrivalSchedule, expectedArrivals } from './arrivals'
import { DrawNurse } from './nurse'
import type { PlanRng } from './plan'
import type { DrawPort } from './ports'
import { PrepMachine } from './prep'
import { RobotStation, type StationHost } from './station'
import type { DrawSubject } from './subject'
import { TicketBook, type DrawEntry } from './tickets'
import { BloodOutpatient, CheckInLine, drawAge, type VisitorServices } from './visitor'

export { binFor, newPrepState } from './prep'
export { newStationState } from './station'
export { planDraw, plannedOutcome, straightSeconds, type DrawPlan } from './plan'
export type { DrawSubject } from './subject'

/** A finished draw, for the stats and the tests. */
export interface DrawRecord {
  ticket: string
  cls: 'P' | 'V'
  kind: DrawEntry['kind']
  station: number
  by: 'robot' | 'nurse'
  attempt: number
  readyAt: number
  calledAt: number
  doneAt: number
  waitedMin: number
}

/** Holding spots in the draw room where a porter waits with an ER patient until a robot is called (pusher spot, facing south). */
const HOLD_CANDIDATES: Vec2[][] = [
  [{ x: -25.7, z: 6.4 }, { x: -25.4, z: 6.4 }, { x: -25.1, z: 6.2 }],
  [{ x: -25.7, z: 4.6 }, { x: -25.4, z: 4.6 }, { x: -25.1, z: 4.8 }],
  [{ x: -24.7, z: 5.5 }, { x: -24.9, z: 5.4 }, { x: -25.2, z: 5.5 }],
]

function firstWalkable(candidates: readonly Vec2[], margin = 0.3): Vec2 {
  for (const c of candidates) if (isWalkable(c.x, c.z, margin)) return { x: c.x, z: c.z }
  const c = candidates[0]
  return { x: c.x, z: c.z }
}

export class DrawCentre implements DrawPort, StationHost, VisitorServices {
  readonly robots: RobotStation[]
  readonly stations: DrawStationState[]
  readonly prep: TubePrepState
  readonly queue: DrawTicket[] = []
  calling: DrawTicket | null = null
  nurseId: string | null = null
  readonly stats = { draws: 0, robotFirstPass: 0, nurseDraws: 0, medianWaitMin: null as number | null }
  version = 0

  readonly book = new TicketBook()
  readonly machine: PrepMachine
  readonly nurse: DrawNurse
  readonly line = new CheckInLine()
  /** Every finished draw, in order. */
  readonly records: DrawRecord[] = []
  /** Outpatients on site now (booked and demo). */
  readonly outpatients: BloodOutpatient[] = []
  outpatientsSpawned = 0
  outpatientsHome = 0
  /** Calls dropped because the holder never came (a bug if not zero). */
  stuckFixes = 0
  /** Chair claims that found the registry seat already held (a bug if not zero). */
  chairConflicts = 0
  /** Arrivals of booked outpatients: 'auto' = on when the hospital has its staff (a bare Simulation has none), or force on/off. */
  arrivals: 'auto' | boolean = 'auto'

  private readonly schedule: ArrivalSchedule
  private readonly arrivalRng: Rng
  private readonly entryByOrder = new Map<string, DrawSubject>()
  private readonly waits: number[] = []
  private readonly chairs: SeatSpec[]
  private readonly chairReal: boolean[]
  private readonly benchSeats: SeatSpec[]
  private readonly benchReal: boolean[]
  private readonly benchBy: (string | null)[]
  private readonly overflowBy: (string | null)[] = DRAW_CENTRE.overflow.map(() => null)
  private readonly holds: Spot[]
  private readonly holdBy: (string | null)[]
  private t = 0
  private started = false
  private arrivalsOn = false
  private pollAcc = 0
  private callRepeatAt = 0
  private demoCount = 0

  constructor(
    readonly world: World,
    protected readonly rng: Rng,
    protected readonly walkerFor: (id: string) => Walker,
  ) {
    this.arrivalRng = rng.fork('arrivals')
    this.schedule = new ArrivalSchedule(this.arrivalRng.fork('schedule'))
    this.chairs = DRAW_CENTRE.robots.map((r) => this.resolveChair(r.index))
    this.chairReal = this.chairs.map((c) => this.inRegistry(c.id))
    this.benchSeats = DRAW_CENTRE.bench.map((b, i) => this.resolveBench(b, i))
    this.benchReal = this.benchSeats.map((c) => this.inRegistry(c.id))
    this.benchBy = this.benchSeats.map(() => null)
    this.holds = HOLD_CANDIDATES.map((c) => ({ at: firstWalkable(c), heading: 0 }))
    this.holdBy = this.holds.map(() => null)
    this.machine = new PrepMachine(rng.fork('prep'), { trayReady: (e) => this.trayReady(e) })
    this.prep = this.machine.state
    this.robots = DRAW_CENTRE.robots.map((r) => new RobotStation(r.index, rng.fork(`station:${r.index}`), this.chairs[r.index], this))
    this.stations = this.robots.map((r) => r.state)
    // the supervising nurse is on site from the first moment, a real person (24/7 in v1)
    this.nurse = new DrawNurse(world, walkerFor('draw-nurse'), {
      hasTray: (ticket) => this.machine.state.rack.includes(ticket),
      takeTray: (ticket) => this.machine.takeTray(ticket),
      sendByHand: (ids) => {
        for (const id of ids) this.world.lab?.send(id, 3)
      },
      say: (text, refs) => this.world.say('samplesSent', text, refs),
    })
    this.nurseId = this.nurse.id
    world.hooks.add(this.nurse)
    // the lab tells the ER patient when the results are verified
    const lab = world.lab
    if (lab) {
      const previous = lab.onOrderComplete
      lab.onOrderComplete = (order) => {
        this.onLabComplete(order)
        previous?.(order)
      }
    }
  }

  // --- the frozen port -----------------------------------------------------------------------------------------------

  startDemoDraw(): boolean {
    const station = this.freeStation()
    if (!station || !this.nurse.onSite) return false
    const w = this.world
    const id = w.id('bld-demo')
    const name = w.uniqueName(this.arrivalRng)
    const g = DRAW_CENTRE.checkIn.guest
    const at = { x: g.at.x, z: g.at.z + 0.5 }
    const v = new BloodOutpatient(this, id, name, 30 + (this.demoCount++ % 40), at, 0, this.walkerFor(id), this.arrivalRng.fork(id), true)
    v.panel = this.pickPanel()
    const entry = this.issue(v, 'demo', true, 'P')
    v.fadeIn()
    this.outpatients.push(v)
    this.outpatientsSpawned++
    w.hooks.add(v)
    this.call(entry, station)
    return true
  }

  takePlayerTicket(): string {
    const id = this.book.nextNumber('P')
    this.world.say('drawTicket', bloodText('playerTicket', { ticket: id }), { subjectId: 'player' })
    this.version++
    return id
  }

  // --- the Simulation's calls -----------------------------------------------------------------------------------------

  step(t: number, dt: number): void {
    this.t = t
    if (!this.started) this.start(hourAt(t))
    if (this.arrivalsOn) {
      const n = this.schedule.step(hourAt(t), dt)
      for (let i = 0; i < n; i++) this.spawnOutpatient()
    }
    this.machine.step(dt)
    for (const r of this.robots) r.step(dt)
    this.pollAcc += dt
    if (this.pollAcc >= 0.25) {
      this.pollAcc -= 0.25
      this.tryCall()
      this.housekeeping()
    }
  }

  sync(alpha: number): void {
    void alpha
  }

  /** A day that starts at `hour`: the numbers of the day so far (tickets, draws) and arrivals from there on. Idempotent. */
  warmStart(hour: number): void {
    this.start(hour)
  }

  private start(hour: number): void {
    if (this.started) return
    this.started = true
    this.arrivalsOn = this.arrivals === 'auto' ? this.world.idlePorters.size > 0 : this.arrivals
    // the day so far, from the first appointment (07:00): tickets are numbered on from there, the robots have drawn their share
    const [h0] = CONFIG.blood.outpatientHours
    const before = Math.round(expectedArrivals(h0, hour))
    if (before > 0) {
      const v = Math.round(before * 0.07)
      this.book.setCounters(before - v, v)
      const per = Math.floor(before / this.robots.length)
      this.robots.forEach((r, i) => {
        const share = per + (i < before - per * this.robots.length ? 1 : 0)
        r.state.drawsToday = share
        r.state.robotDrawsToday = Math.round(share * 0.94)
        r.state.nurseDrawsToday = share - r.state.robotDrawsToday
      })
      const nurse = this.robots.reduce((a, r) => a + r.state.nurseDrawsToday, 0)
      this.stats.draws = before
      this.stats.nurseDraws = nurse
      this.stats.robotFirstPass = Math.round((before - nurse) * 0.93)
      this.machine.state.traysToday = before
    }
    this.version++
  }

  // --- tickets and prep ---------------------------------------------------------------------------------------------------

  /** A booked outpatient finished at the check-in kiosk: ticket, lab order and prep job (VisitorServices). */
  checkedIn(v: BloodOutpatient): void {
    this.issue(v, v.demo ? 'demo' : 'outpatient', true, v.age >= CONFIG.blood.priorityAge ? 'V' : 'P')
  }

  /**
   * An ER patient's blood tests were ordered: a V ticket, the lab order (stat) and the prep job now, so the tray is ready by the time the
   * porter has brought them. The ticket is not callable until `erArrived`.
   */
  requestEr(subject: DrawSubject, panel: string): DrawTicket {
    const entry = this.issue(subject, 'er', false, 'V', panel)
    return entry.ticket
  }

  /** The porter has the ER patient at the holding spot in the draw room: they may be called. */
  erArrived(ticketId: string): void {
    const e = this.book.open.get(ticketId)
    if (!e || e.ready) return
    e.ready = true
    e.readyAt = this.t
    this.tryCall()
  }

  private issue(subject: DrawSubject, kind: DrawEntry['kind'], ready: boolean, cls: 'P' | 'V', panelOverride?: string): DrawEntry {
    const w = this.world
    const panel = panelOverride ?? (subject instanceof BloodOutpatient ? subject.panel : this.pickPanel())
    const priority = cls === 'V' && kind === 'er' ? 'stat' : 'routine'
    const lab = w.lab
    let order: LabOrder | null = null
    if (lab) {
      order = lab.order({
        patientId: subject.id,
        patientName: subject.name,
        source: kind === 'er' ? 'er' : kind === 'demo' ? 'demo' : 'outpatient',
        panel,
        priority,
        ticket: null,
      })
    }
    const entry = this.book.issue({ cls, patientId: subject.id, patientName: subject.name, orderId: order?.id ?? '', t: w.t, subject, kind, ready })
    if (order) {
      order.ticket = entry.ticket.id
      entry.sampleIds = [...order.sampleIds]
      entry.tubes = order.sampleIds.map((id) => lab!.samples.get(id)!.tube)
      this.entryByOrder.set(order.id, subject)
    } else {
      entry.tubes = tubesFor(panelTests(panel)).map((x) => x.tube)
    }
    this.machine.add(entry, kind === 'demo')
    this.say(kind === 'er' ? 'drawTicketEr' : 'drawTicket', { name: subject.name, ticket: entry.ticket.id }, { subjectId: subject.id })
    this.rebuildQueue()
    return entry
  }

  private pickPanel(): string {
    const list = LAB_CATALOGUE.outpatientPanels
    return this.arrivalRng.weighted(
      list.map((p) => p.panel),
      list.map((p) => p.weight),
    )
  }

  private trayReady(entry: DrawEntry): void {
    entry.trayReady = true
    const lab = this.world.lab
    if (lab) {
      for (const id of entry.sampleIds) {
        lab.samples.advance(id, 'labelled', this.t)
        const s = lab.samples.get(id)
        if (s) s.where.line = 'tray'
      }
    }
    this.version++
  }

  // --- calling -------------------------------------------------------------------------------------------------------------

  /** The free robot that has drawn the fewest patients today (they take turns), or null. */
  private freeStation(): RobotStation | null {
    let best: RobotStation | null = null
    for (const r of this.robots) {
      if (!r.free) continue
      if (this.chairReal[r.index] && this.world.seats.occupant(this.chairs[r.index].id) !== null) continue
      if (best === null || r.state.drawsToday < best.state.drawsToday) best = r
    }
    return best
  }

  private tryCall(): void {
    if (!this.nurse.onSite) return
    for (let guard = 0; guard < this.robots.length; guard++) {
      const station = this.freeStation()
      if (!station) return
      const entry = this.book.next(() => true)
      if (!entry) return
      this.call(entry, station)
    }
  }

  private call(entry: DrawEntry, station: RobotStation): void {
    const t = entry.ticket
    this.book.take(entry)
    t.state = 'called'
    t.calledAt = this.t
    t.station = station.index
    if (Number.isNaN(entry.readyAt)) entry.readyAt = this.t
    entry.waited = Math.max(0, this.t - entry.readyAt)
    this.claimChair(station.index, entry.subject.id)
    station.begin(entry)
    this.say('drawCalled', { ticket: t.id, robot: station.index + 1 }, { subjectId: entry.subject.id })
    entry.subject.drawCalled(station.index, station.seat)
    this.calling = t
    this.callRepeatAt = this.t + CONFIG.blood.callRepeatSeconds
    this.rebuildQueue()
  }

  /** Slow upkeep (4 Hz): the queue screen's repeat call and its hold time, and keeping `queue` and the stats honest. */
  private housekeeping(): void {
    const c = this.calling
    if (c !== null) {
      if (c.state === 'called') {
        if (this.t >= this.callRepeatAt) {
          // the call repeats on the screen (and its chime) until the patient is in the chair
          this.callRepeatAt = this.t + CONFIG.blood.callRepeatSeconds
          this.version++
        }
      } else if (this.t - (c.calledAt ?? this.t) > 12) {
        this.calling = null
        this.version++
      }
    }
  }

  private rebuildQueue(): void {
    const q = this.queue
    q.length = 0
    const called: DrawTicket[] = []
    for (const e of this.book.open.values()) if (e.ticket.state === 'called') called.push(e.ticket)
    called.sort((a, b) => (a.calledAt ?? 0) - (b.calledAt ?? 0))
    for (const t of called) q.push(t)
    for (const e of this.book.waiting) q.push(e.ticket)
    this.version++
  }

  // --- the stations' host (StationHost) ------------------------------------------------------------------------------------

  get lab(): World['lab'] {
    return this.world.lab
  }

  now(): number {
    return this.t
  }

  say(key: BloodEventKey, fields: Record<string, string | number>, refs: EventRefs = {}): void {
    this.world.say(BLOOD_EVENT_TYPE[key], bloodText(key, fields), refs)
  }

  drawFinished(station: RobotStation, entry: DrawEntry, by: 'robot' | 'nurse', attempt: number): void {
    const s = this.stats
    s.draws++
    if (by === 'robot' && attempt <= 1 && station.armMoves === 0) s.robotFirstPass++
    if (by === 'nurse') s.nurseDraws++
    const waitedMin = (entry.waited ?? 0) / 60
    let i = this.waits.length
    this.waits.push(waitedMin)
    while (i > 0 && this.waits[i - 1] > waitedMin) {
      this.waits[i] = this.waits[i - 1]
      i--
    }
    this.waits[i] = waitedMin
    const n = this.waits.length
    s.medianWaitMin = n % 2 === 1 ? this.waits[(n - 1) / 2] : (this.waits[n / 2 - 1] + this.waits[n / 2]) / 2
    this.records.push({
      ticket: entry.ticket.id,
      cls: entry.ticket.cls,
      kind: entry.kind,
      station: station.index,
      by,
      attempt,
      readyAt: entry.readyAt,
      calledAt: entry.ticket.calledAt ?? this.t,
      doneAt: this.t,
      waitedMin,
    })
    const order = entry.ticket.orderId ? this.world.lab?.orderById(entry.ticket.orderId) : undefined
    if (order) {
      order.drawnBy = by
      order.drawnAt = this.t
    }
    this.book.close(entry)
    this.rebuildQueue()
  }

  releaseChair(station: RobotStation, occupantId: string): void {
    if (this.chairReal[station.index]) this.world.seats.release(this.chairs[station.index].id, occupantId)
  }

  aborted(station: RobotStation, entry: DrawEntry): void {
    this.stuckFixes++
    entry.ticket.state = 'done'
    this.machine.cancel(entry)
    this.book.close(entry)
    this.releaseChair(station, entry.subject.id)
    entry.subject.drawAborted()
    this.rebuildQueue()
  }

  // --- chairs, bench, overflow, holds ---------------------------------------------------------------------------------------

  private inRegistry(id: string): boolean {
    return this.world.seats.all.some((s) => s.id === id)
  }

  /** The robot's chair: the layout's seat 'drawChair:robot:<i>' when it has it, else one made from the anchor (a registry-less table). */
  private resolveChair(i: number): SeatSpec {
    const id = `drawChair:robot:${i}`
    const real = this.world.seats.all.find((s) => s.id === id)
    if (real) return real
    const a = DRAW_CENTRE.robots[i]
    return { id, kind: 'drawChair', area: 'diagnostics', x: a.chair.at.x, z: a.chair.at.z, heading: a.chair.heading, pose: 'sit', height: 0.45, approach: { x: a.chair.at.x, z: a.chair.at.z - 0.95 } }
  }

  private resolveBench(b: Spot, i: number): SeatSpec {
    const id = `waiting:draw:${i}`
    const real = this.world.seats.all.find((s) => s.id === id)
    if (real) return real
    return { id, kind: 'waiting', area: 'diagnostics', x: b.at.x, z: b.at.z, heading: b.heading, pose: 'sit', height: 0.45, approach: { x: b.at.x + 1.0, z: b.at.z } }
  }

  /** The chair of robot `i` (a registry seat or a made one), for the porter and the scene. */
  chairOf(i: number): SeatSpec {
    return this.chairs[i]
  }

  private claimChair(i: number, who: string): void {
    if (!this.chairReal[i]) return
    if (!this.world.seats.claimId(this.chairs[i].id, who) && this.world.seats.occupant(this.chairs[i].id) !== who) this.chairConflicts++
  }

  /** An ER patient was lifted off the chair onto the wheelchair: free its claim (a made chair is not in the registry). */
  releaseChairSeat(seat: SeatSpec, occupantId: string): void {
    if (this.inRegistry(seat.id)) this.world.seats.release(seat.id, occupantId)
  }

  claimBench(who: string): SeatSpec | null {
    for (let i = 0; i < this.benchSeats.length; i++) {
      if (this.benchBy[i] === who) return this.benchSeats[i]
    }
    for (let i = 0; i < this.benchSeats.length; i++) {
      if (this.benchBy[i] !== null) continue
      if (this.benchReal[i] && !this.world.seats.claimId(this.benchSeats[i].id, who)) continue
      this.benchBy[i] = who
      return this.benchSeats[i]
    }
    return null
  }

  releaseBench(who: string): void {
    for (let i = 0; i < this.benchSeats.length; i++) {
      if (this.benchBy[i] !== who) continue
      this.benchBy[i] = null
      if (this.benchReal[i]) this.world.seats.release(this.benchSeats[i].id, who)
    }
  }

  claimOverflow(who: string): Vec2 {
    let i = this.overflowBy.indexOf(who)
    if (i < 0) i = this.overflowBy.indexOf(null)
    if (i < 0) i = this.overflowBy.length - 1
    if (this.overflowBy[i] === null) this.overflowBy[i] = who
    return DRAW_CENTRE.overflow[i]
  }

  releaseOverflow(who: string): void {
    const i = this.overflowBy.indexOf(who)
    if (i >= 0) this.overflowBy[i] = null
  }

  /** Where a porter waits with an ER patient until a robot is called: a standing spot (pusher), facing the robots. */
  claimHold(who: string): Spot {
    let i = this.holdBy.indexOf(who)
    if (i < 0) i = this.holdBy.indexOf(null)
    if (i < 0) i = 0
    this.holdBy[i] = who
    return this.holds[i]
  }

  releaseHold(who: string): void {
    const i = this.holdBy.indexOf(who)
    if (i >= 0) this.holdBy[i] = null
  }

  // --- outpatient arrivals --------------------------------------------------------------------------------------------------

  /** A booked outpatient arrives at the entrance (the schedule calls this; a test may pass an age to force a V ticket). */
  spawnOutpatient(ageOverride?: number): BloodOutpatient {
    const w = this.world
    const id = w.id('bld')
    const name = w.uniqueName(this.arrivalRng)
    const age = drawAge(this.arrivalRng)
    const e = ARRIVALS.entrance
    const at = { x: e.at.x, z: e.at.z + this.arrivalRng.range(-0.8, 0.8) }
    const v = new BloodOutpatient(this, id, name, ageOverride ?? age, at, e.heading, this.walkerFor(id), this.arrivalRng.fork(id), false)
    v.panel = this.pickPanel()
    v.fadeIn()
    this.outpatients.push(v)
    this.outpatientsSpawned++
    w.hooks.add(v)
    return v
  }

  gone(v: BloodOutpatient): void {
    const i = this.outpatients.indexOf(v)
    if (i >= 0) this.outpatients.splice(i, 1)
    if (v.home) this.outpatientsHome++
  }

  // --- results ------------------------------------------------------------------------------------------------------------

  private onLabComplete(order: LabOrder): void {
    const subject = this.entryByOrder.get(order.id)
    if (!subject) return
    this.entryByOrder.delete(order.id)
    subject.resultsReady(order)
  }

  // --- numbers --------------------------------------------------------------------------------------------------------------

  /** Mean wait in minutes (ready to called) of the draws finished so far in a ticket class, or null. */
  meanWaitMin(cls: 'P' | 'V'): number | null {
    const r = this.records.filter((x) => x.cls === cls)
    return r.length === 0 ? null : r.reduce((a, x) => a + x.waitedMin, 0) / r.length
  }

  /** Test hook: replace the random stream a station plans its next draws from (to force a failure branch). */
  setPlanRng(station: number, rng: PlanRng): void {
    this.robots[station].planRng = rng
  }

  /** The tube kinds of the draw in progress at a station (tests). */
  tubesAt(i: number): readonly TubeKind[] {
    return this.stations[i].tubes
  }
}
