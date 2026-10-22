/**
 * The shift manager (L1 day rhythm): turns the roster's changes (roster.ts `shiftChanges`) into people walking in and out.
 *
 * One `Run` per change. A run follows its people:
 *
 *   comer     fades in at the entrance `arriveEarlySeconds` before the hour, changes at a staff-room locker, waits seated
 *             in the staff room, walks to the spot beside the post (`meetSpot`), hands over, steps onto the post and is
 *             then swapped for the real controller of the post (same id and look, on the same spot: nobody pops)
 *   leaver    stops taking new work at the hour, and when it is at rest (kits.ts `atRest`) is swapped for a ShiftActor,
 *             hands over (two people talking, `bedsideHandoverSeconds`), walks to a locker, changes, walks to the entrance
 *             and fades out
 *   stayer    the colleague on the same job who stays on: swapped for a ShiftActor for the length of the talk and swapped
 *             back (a fresh controller, at rest on the same spot)
 *
 * Posts are never empty during a change: a comer takes over only after the talk, standing beside the post, and the
 * leaver leaves the post only when the comer is there. If the person handing over never gets to rest (`PATIENCE` seconds
 * after the comer is ready) the talk is skipped and the comer takes the post; the leaver goes when it is at rest at last.
 *
 * Everything is a deterministic function of the seed: each run draws its times from `rng.fork(run key)`.
 */
import { fillDayTemplate } from '@/content/day'
import { CONFIG } from '../config'
import type { Actor } from '../er/actor'
import type { World } from '../er/world'
import { Doctor, Nurse, type Person } from '../people'
import { ARRIVALS, DEPARTURES, type Spot } from '../places'
import { hashString, type Rng } from '../rng'
import type { Vec2 } from '../types'
import { kitOf, LEAVE_SEAT_LEAD, postSeat, stop } from './kits'
import { POST_LABELS, clockHourAt, handoverPairs, shiftChanges, timeOfClockHour, worksAt, type Change, type RotaEntry } from './roster'
import { ShiftActor, type ShiftRole, type Step } from './shiftActor'
import { LOCKER_SPOTS, LOCKER_WAIT, dist, meetSpot } from './spots'
import { staffRegistry, type StaffRegistry } from './staffRegistry'

/** A change is over this long after its hour: the leaver is gone and the comer has taken over. */
export const SETTLE_SECONDS = 300
/** A ward change (hub huddle, then a bedside handover in each of the eight rooms) is over this long after its hour. */
export const WARD_SETTLE_SECONDS = 1500
/** How long a comer waits for the person handing over to be at rest before it takes the post without the talk. */
export const PATIENCE_SECONDS = 240
/** The handover starts a little after the hour, a little different for every pair (seconds, 0 to this). */
const STAGGER_SECONDS = 90
/** The leaver stops taking work this long before its handover time. */
const STOP_LEAD = 45
const POLL_SECONDS = 0.25

export interface ShiftDeps {
  world: World
  rng: Rng
  /** The live list of everybody in the simulation (needed for the coordinators, who are built by people.ts). */
  people?: readonly Person[]
}

type RunState = 'pending' | 'running' | 'done'
type TalkState = 'none' | 'talking' | 'done' | 'skipped'

/** One shift change in progress (exported read-only for the tests). */
export interface Run {
  readonly change: Change
  readonly hourT: number
  readonly arriveT: number
  readonly stopAt: number
  readonly goT: number
  readonly talkSeconds: number
  /** Ward changes only: the huddle at the hub before the bedside handovers (seconds). */
  readonly huddleSeconds: number
  /** Ward changes only: how many rooms each of the two (host, visitor) has reached on the bedside tour. */
  readonly progress: [number, number]
  /** Seconds after the hour that the change is over (for a warm start). */
  readonly settleSeconds: number
  readonly lockerSeconds: number
  readonly entranceZ: number
  /** The spot beside the host's post where the visitor of a handover stands. */
  readonly meet: Spot | null
  state: RunState
  talk: TalkState
  /** Sim times the talk started and ended (Infinity before). */
  talkStartT: number
  talkEndT: number
  /** The comer's actor (until it is swapped for the real controller), or null. */
  comer: ShiftActor | null
  comerSpawned: boolean
  comerReady: boolean
  comerAtPost: boolean
  comerSwapped: boolean
  /** The leaver's actor once it was taken off duty. */
  leaverAct: ShiftActor | null
  leaverReady: boolean
  stopped: boolean
  leaverLaunched: boolean
  /** The colleague handing over (leaver of a relief, or the stayer), as an actor, while they talk. */
  host: ShiftActor | null
  hostReady: boolean
  /** Sim time the visitor became ready and the host was first waited for. */
  waitingSince: number
}

function postLabel(r: RotaEntry): string {
  return r.post!.kind === 'wardNurse' ? `ward ${r.member.ward}` : POST_LABELS[r.post!.kind]
}

class Lockers {
  private readonly owner: (string | null)[] = LOCKER_SPOTS.map(() => null)

  claim(id: string): Spot | null {
    const mine = this.owner.indexOf(id)
    if (mine >= 0) return LOCKER_SPOTS[mine]
    const free = this.owner.indexOf(null)
    if (free < 0) return null
    this.owner[free] = id
    return LOCKER_SPOTS[free]
  }

  spotOf(id: string): Spot {
    const i = this.owner.indexOf(id)
    return LOCKER_SPOTS[i >= 0 ? i : 0]
  }

  release(id: string): void {
    const i = this.owner.indexOf(id)
    if (i >= 0) this.owner[i] = null
  }

  /** Where to wait for a locker: one step behind one of them. */
  waitSpot(id: string): Spot {
    return LOCKER_WAIT[hashString(id) % LOCKER_WAIT.length]
  }
}

export class ShiftManager {
  readonly runs: Run[] = []
  /** Staff ids that came in (faded in at the entrance) and went out (faded out), in order, for the tests and the KPIs. */
  readonly arrived: string[] = []
  readonly departed: string[] = []
  private readonly world: World
  private readonly rng: Rng
  private readonly registry: StaffRegistry
  private readonly lockers = new Lockers()
  private readonly counts = new Map<string, number>()
  private ready = false
  private enabled = false
  private t0 = 0
  private isDefault = true
  private poll = 0
  private people: readonly Person[] | null

  constructor(deps: ShiftDeps) {
    this.world = deps.world
    this.rng = deps.rng
    this.people = deps.people ?? null
    this.registry = staffRegistry(deps.world)
  }

  /**
   * Give the manager the live list of everybody. The coordinators (built by people.ts) are found in it; call it right after
   * the simulation is built (a warm start has already placed everybody else: the coordinators are brought into line now).
   */
  attachPeople(people: readonly Person[]): void {
    this.people = people
    if (this.ready && this.enabled) {
      this.importCoordinators()
      this.reconcile()
    }
  }

  // --- setting up -----------------------------------------------------------------------------------------

  /**
   * Bring the hospital's staff into line with the roster at sim time `t0`. The default start (07:30) keeps the staff that
   * `createErStaff` built (everyone on post, the office-hours imaging team included, as in M3) and only schedules what
   * comes later. A warm start puts the shift on duty at that hour at its posts and lets the change in progress play out.
   */
  init(t0: number, isDefault: boolean): void {
    if (this.ready) return
    this.ready = true
    this.t0 = t0
    this.isDefault = isDefault
    this.importCoordinators()
    this.enabled = this.registry.size > 0
    if (!this.enabled) return
    this.reconcile()
  }

  /** Build the runs of every change this world can enact and bring the staff into line with the roster at `t0`. */
  private reconcile(): void {
    const t0 = this.t0
    const hour0 = clockHourAt(t0)
    const fresh: Run[] = []
    for (const c of shiftChanges(hour0 - 1, hour0 + 24)) {
      if (this.runs.some((run) => run.change.key === c.key)) continue
      const run = this.makeRun(c)
      if (run) fresh.push(run)
    }
    this.runs.push(...fresh)
    const phaseOf = (run: Run): 'complete' | 'inProgress' | 'pending' =>
      t0 >= run.hourT + run.settleSeconds ? 'complete' : t0 >= Math.min(run.arriveT, run.stopAt) ? 'inProgress' : 'pending'
    for (const run of fresh) {
      const phase = phaseOf(run)
      if (phase === 'complete') run.state = 'done'
      else if (phase === 'inProgress') run.state = 'running'
    }
    // who is on post at t0: decided by the latest change of the person that has started, else by the first one to come
    const entries: RotaEntry[] = []
    for (const run of fresh) for (const r of [run.change.comer, run.change.leaver]) if (r && !entries.includes(r)) entries.push(r)
    for (const r of entries) {
      const mine = this.runs.filter((run) => run.change.comer === r || run.change.leaver === r)
      let started: Run | null = null
      for (const run of mine) if (phaseOf(run) !== 'pending') started = run
      let present: boolean
      if (started) present = phaseOf(started) === 'complete' ? started.change.comer === r : started.change.leaver === r
      else if (mine.length > 0) present = mine[0].change.leaver === r
      else present = worksAt(r, hour0)
      const existing = this.registry.get(r.member.id)
      if (this.isDefault) {
        // the M3 population stands as built (the office-hours imaging team is already at its consoles): somebody who is
        // here already has nothing to arrive for
        if (existing && !present) for (const run of mine) if (run.change.comer === r && run.state === 'pending') run.state = 'done'
        continue
      }
      if (present && !existing) this.createReal(r)
      else if (!present && existing) this.removeInstant(r, existing)
    }
    // the comers whose change is already under way arrive where the clock says they are
    for (const run of fresh) if (run.state === 'running' && run.change.comer && t0 >= run.arriveT) this.spawnComer(run, t0, true)
  }

  private importCoordinators(): void {
    if (this.people === null) return
    for (const p of this.people) {
      const ward = p instanceof Nurse || p instanceof Doctor
      if ((p.entity.role === 'coordinator' || ward) && !this.registry.has(p.entity.id)) this.registry.set(p.entity.id, p)
    }
  }

  /** Can this world enact the post (imaging needs the imaging suite, the command desks need the people list)? */
  private usable(r: RotaEntry | null): boolean {
    if (r === null || r.post === null) return false
    if (r.post.kind === 'imaging') return this.world.imaging !== null
    if (r.post.kind === 'command' || r.post.kind === 'wardNurse' || r.post.kind === 'wardDoctor') return this.registry.has(r.member.id) || this.people !== null
    return true
  }

  private makeRun(c: Change): Run | null {
    const entries = [c.comer, c.leaver, c.stayer]
    for (const e of entries) if (e !== null && !this.usable(e)) return null
    const r = this.rng.fork(`run:${c.key}`)
    const d = CONFIG.day
    const hourT = timeOfClockHour(c.hour)
    const stagger = r.range(0, STAGGER_SECONDS)
    const early = r.between(d.arriveEarlySeconds)
    const hostEntry = c.kind === 'relief' ? c.leaver : c.stayer
    const meet = hostEntry && (c.kind === 'relief' || c.kind === 'leaveStayer' || c.kind === 'comeStayer') ? meetSpot(kitOf(hostEntry.post!.kind).post(this.world, hostEntry)) : null
    return {
      change: c,
      hourT,
      arriveT: c.comer ? hourT - early : Infinity,
      stopAt: hourT + stagger - STOP_LEAD,
      goT: hourT + stagger - LEAVE_SEAT_LEAD,
      talkSeconds: r.between(d.bedsideHandoverSeconds),
      huddleSeconds: r.between(d.huddleSeconds),
      progress: [0, 0],
      settleSeconds: c.kind === 'relief' && hostEntry?.post?.kind === 'wardNurse' ? WARD_SETTLE_SECONDS : SETTLE_SECONDS,
      lockerSeconds: r.between(d.lockerSeconds),
      entranceZ: r.range(-0.8, 0.8),
      meet,
      state: 'pending',
      talk: 'none',
      talkStartT: Infinity,
      talkEndT: Infinity,
      comer: null,
      comerSpawned: false,
      comerReady: false,
      comerAtPost: false,
      comerSwapped: false,
      leaverAct: null,
      leaverReady: false,
      stopped: false,
      leaverLaunched: false,
      host: null,
      hostReady: false,
      waitingSince: Infinity,
    }
  }

  // --- people in and out --------------------------------------------------------------------------------

  private swap(old: Person, next: Person): void {
    this.world.hooks.add(next)
    this.world.hooks.remove(old)
  }

  private nextRng(id: string): Rng {
    const n = (this.counts.get(id) ?? 0) + 1
    this.counts.set(id, n)
    return this.rng.fork(`ctl:${id}:${n}`)
  }

  private makeController(r: RotaEntry): Person {
    return kitOf(r.post!.kind).make(this.world, r, this.world.walkerFor(r.member.id), this.nextRng(r.member.id))
  }

  /** A real controller on its post, put there at once (a warm start before anybody is looking). */
  private createReal(r: RotaEntry): void {
    const kit = kitOf(r.post!.kind)
    const p = this.makeController(r)
    this.world.hooks.add(p)
    this.registry.set(r.member.id, p)
    kit.attach(this.world, p, r)
  }

  private removeInstant(r: RotaEntry, p: Person): void {
    this.world.hooks.remove(p)
    kitOf(r.post!.kind).release(this.world, p, r)
    this.registry.delete(r.member.id)
  }

  /** The real controller steps off its post: a ShiftActor takes its place on the same spot. */
  private toActor(ctl: Person, r: RotaEntry, role: ShiftRole): ShiftActor {
    const w = ctl.walker
    const id = ctl.entity.id
    const a = new ShiftActor(r.member, role, { x: w.x, z: w.z }, w.heading, this.world.walkerFor(id))
    const seatId = ctl.entity.seated?.seatId
    if (seatId) a.placeOnSeat(this.world.seats.byId(seatId))
    const vehicle = ctl.entity.vehicle
    if (vehicle !== undefined && vehicle !== 'none') {
      a.setVehicle(vehicle)
      a.walkAnim = 'push'
    }
    a.onGone = () => {
      this.lockers.release(id)
      this.departed.push(id)
    }
    this.swap(ctl, a)
    kitOf(r.post!.kind).release(this.world, ctl, r)
    this.registry.delete(id)
    return a
  }

  /** A fresh controller takes the actor's place on the same spot. */
  private toReal(a: ShiftActor, r: RotaEntry): Person {
    // the actor is replaced, not leaving: nothing to hand back at its removal but the locker
    a.onGone = null
    this.lockers.release(r.member.id)
    const kind = r.post!.kind
    const kit = kitOf(kind)
    const real = this.makeController(r)
    // a controller that seats itself (a console, a command desk) already stands where the comer sat down
    if (kind === 'wardNurse' || kind === 'wardDoctor') {
      real.walker.place(a.walker.x, a.walker.z, a.walker.heading)
      real.snapshot()
    } else if (kind !== 'command' && !(kind === 'imaging' && postSeat(this.world, r) !== null)) {
      ;(real as Actor).placeAt(a.walker.x, a.walker.z, a.walker.heading)
    }
    this.swap(a, real)
    this.registry.set(r.member.id, real)
    kit.attach(this.world, real, r)
    return real
  }

  // --- scripts ------------------------------------------------------------------------------------------

  private claimLockerSteps(id: string, a: ShiftActor, seconds: number): Step[] {
    const wait = this.lockers.waitSpot(id)
    return [
      { kind: 'walk', to: wait.at, face: wait.heading },
      { kind: 'do', run: () => this.parkCart(a) },
      { kind: 'until', test: () => this.lockers.claim(id) !== null },
      { kind: 'walk', to: () => this.lockers.spotOf(id).at, face: LOCKER_SPOTS[0].heading },
      { kind: 'wait', seconds },
      { kind: 'do', run: () => this.lockers.release(id) },
    ]
  }

  /** A cleaner or porter leaves the cart at the staff-room door. */
  private parkCart(a: ShiftActor): void {
    if (a.entity.vehicle !== undefined && a.entity.vehicle !== 'none') {
      a.setVehicle('none')
      a.walkAnim = 'walk'
    }
  }

  /** From the entrance to the post: lockers, a seat in the staff room, then the spot beside the host (or the post itself). */
  private comerScript(run: Run, a: ShiftActor, from: 'entrance' | 'seated' | 'meet'): Step[] {
    const r = run.change.comer!
    const id = r.member.id
    const world = this.world
    const steps: Step[] = []
    if (from === 'entrance') {
      steps.push({ kind: 'until', test: () => a.visibleFully })
      steps.push(...this.claimLockerSteps(id, a, run.lockerSeconds))
      steps.push({ kind: 'sitIf', pick: () => world.seats.claim(id, { kind: 'lounge', area: 'staffA' }, LOCKER_SPOTS[0].at) })
    }
    if (from !== 'meet') {
      steps.push({ kind: 'until', test: () => world.t >= run.goT })
      steps.push({ kind: 'stand' })
      steps.push({ kind: 'do', run: () => world.seats.releaseBy(id) })
      if (run.meet) steps.push({ kind: 'walk', to: run.meet.at, face: run.meet.heading })
      else steps.push(...this.toPostSteps(run, r))
    }
    if (run.meet) steps.push({ kind: 'do', run: () => (run.comerReady = true) })
    return steps
  }

  private toPostSteps(run: Run, r: RotaEntry): Step[] {
    const kit = kitOf(r.post!.kind)
    const seat = postSeat(this.world, r)
    const post = kit.post(this.world, r)
    return [
      seat ? { kind: 'sit', seat } : { kind: 'walk', to: post.at, face: post.heading },
      { kind: 'do', run: () => (run.comerAtPost = true) },
    ]
  }

  private leaveSteps(id: string, a: ShiftActor, seconds: number): Step[] {
    return [
      { kind: 'stand' },
      ...this.claimLockerSteps(id, a, seconds),
      { kind: 'walk', to: DEPARTURES.entrance },
      { kind: 'fadeOut' },
    ]
  }

  /** A ward change: the huddle at the hub, then the two nurses go room to room and hand over at each bedside (outgoing and incoming spots). */
  private wardTalkSteps(run: Run, self: ShiftActor, other: () => ShiftActor | null, me: 0 | 1): Step[] {
    const ward = (run.change.comer ?? run.change.leaver)!.member.ward!
    const steps: Step[] = [
      { kind: 'do', run: () => { const o = other(); if (o) self.faceTowards(o.pos) } },
      { kind: 'wait', seconds: run.huddleSeconds, anim: 'talk' },
    ]
    const deadline = run.hourT + WARD_SETTLE_SECONDS - 60
    handoverPairs(ward).forEach((pair, i) => {
      const spot = me === 0 ? pair.outgoing : pair.incoming
      steps.push({ kind: 'walk', to: spot.at, face: spot.heading })
      steps.push({ kind: 'do', run: () => { run.progress[me] = i + 1 } })
      steps.push({ kind: 'until', test: () => run.progress[1 - me] >= i + 1 || this.world.t > deadline, anim: 'talk' })
      steps.push({ kind: 'wait', seconds: run.talkSeconds, anim: 'talk' })
    })
    return steps
  }

  private talkSteps(run: Run, self: ShiftActor, other: () => ShiftActor | null): Step[] {
    return [
      {
        kind: 'do',
        run: () => {
          const o = other()
          if (o) self.faceTowards(o.pos)
        },
      },
      { kind: 'wait', seconds: run.talkSeconds, anim: 'talk' },
    ]
  }

  // --- the comer ------------------------------------------------------------------------------------------------

  private spawnComer(run: Run, t: number, warm = false): void {
    if (run.comerSpawned) return
    run.comerSpawned = true
    const r = run.change.comer!
    const id = r.member.id
    if (this.registry.has(id)) {
      // already on post (a default start); nothing to arrive for
      run.state = 'done'
      return
    }
    let at: Vec2 = { x: ARRIVALS.entrance.at.x, z: ARRIVALS.entrance.at.z + run.entranceZ }
    let heading: number = ARRIVALS.entrance.heading
    let from: 'entrance' | 'seated' | 'meet' = 'entrance'
    if (warm && t - run.arriveT > 10) {
      // under way already: in the staff room before it is time to go, beside the post after
      if (t < run.goT) {
        at = this.lockers.waitSpot(id).at
        from = 'seated'
      } else if (run.meet) {
        at = run.meet.at
        heading = run.meet.heading
        from = 'meet'
      } else {
        const post = kitOf(r.post!.kind).post(this.world, r)
        at = post.at
        heading = post.heading
        from = 'meet'
      }
    }
    const a = new ShiftActor(r.member, 'comer', at, heading, this.world.walkerFor(id))
    if (from === 'entrance') a.fadeIn()
    a.onGone = () => this.lockers.release(id)
    this.world.hooks.add(a)
    run.comer = a
    this.arrived.push(id)
    run.state = 'running'
    if (from === 'meet' && !run.meet) {
      // a solo comer already at the post
      a.run([{ kind: 'do', run: () => (run.comerAtPost = true) }])
      return
    }
    a.run(this.comerScript(run, a, from))
  }

  // --- the manager's step -------------------------------------------------------------------------------------------

  step(t: number, dt: number): void {
    if (!this.enabled) return
    this.poll += dt
    if (this.poll < POLL_SECONDS) return
    this.poll = 0
    for (const run of this.runs) {
      if (run.state === 'done') continue
      this.stepRun(run, t)
    }
  }

  private stepRun(run: Run, t: number): void {
    const c = run.change
    if (run.state === 'pending') {
      if (t < Math.min(run.arriveT, run.stopAt)) return
      run.state = 'running'
    }
    if (c.comer && !run.comerSpawned && t >= run.arriveT) this.spawnComer(run, t)
    if (run.state === 'done') return
    if (c.leaver && !run.stopped && t >= run.stopAt) {
      run.stopped = true
      const ctl = this.registry.get(c.leaver.member.id)
      if (ctl) stop(ctl)
    }

    switch (c.kind) {
      case 'leave':
        this.stepLeave(run)
        break
      case 'come':
        this.stepCome(run)
        break
      default:
        this.stepPair(run, t)
        break
    }
    if (this.finished(run)) run.state = 'done'
  }

  private finished(run: Run): boolean {
    const c = run.change
    const comerDone = !c.comer || run.comerSwapped
    const leaverDone = !c.leaver || run.leaverLaunched
    return comerDone && leaverDone && (run.talk === 'done' || run.talk === 'skipped' || (c.kind === 'leave' || c.kind === 'come'))
  }

  private stepCome(run: Run): void {
    if (run.comerAtPost && !run.comerSwapped) this.swapInComer(run)
  }

  private stepLeave(run: Run): void {
    if (run.stopped && !run.leaverLaunched) this.launchLeaver(run)
  }

  /** Take the leaver off duty as soon as it is at rest, and send it to the lockers and out. */
  private launchLeaver(run: Run): void {
    const r = run.change.leaver!
    const ctl = this.registry.get(r.member.id)
    if (!ctl) {
      run.leaverLaunched = true
      return
    }
    if (!kitOf(r.post!.kind).atRest(this.world, ctl)) return
    const a = this.toActor(ctl, r, 'leaver')
    run.leaverAct = a
    run.leaverLaunched = true
    a.run(this.leaveSteps(r.member.id, a, run.lockerSeconds))
  }

  private swapInComer(run: Run): void {
    const r = run.change.comer!
    const a = run.comer!
    run.comerSwapped = true
    this.toReal(a, r)
    run.comer = null
  }

  // relief, comeStayer and leaveStayer ---------------------------------------------------------------------------------

  private stepPair(run: Run, t: number): void {
    const c = run.change
    const hostEntry = c.kind === 'relief' ? c.leaver! : c.stayer!
    const visitorIsComer = c.kind !== 'leaveStayer'

    // the visitor of a leaveStayer is the leaver: it walks to the stayer's post when it is at rest
    if (c.kind === 'leaveStayer' && run.stopped && run.leaverAct === null && !run.leaverLaunched) {
      const ctl = this.registry.get(c.leaver!.member.id)
      if (!ctl) {
        run.leaverLaunched = true
        run.talk = 'skipped'
        return
      }
      if (kitOf(c.leaver!.post!.kind).atRest(this.world, ctl)) {
        const a = this.toActor(ctl, c.leaver!, 'leaver')
        run.leaverAct = a
        a.run([
          { kind: 'stand' },
          { kind: 'walk', to: run.meet!.at, face: run.meet!.heading },
          { kind: 'do', run: () => (run.leaverReady = true) },
        ])
      }
      return
    }

    const visitorReady = visitorIsComer ? run.comerReady : run.leaverReady
    const visitor = visitorIsComer ? run.comer : run.leaverAct

    if (run.talk === 'none' && visitor && visitorReady && visitor.finished && t >= run.stopAt) {
      if (run.waitingSince === Infinity) run.waitingSince = t
      // the host: converted when it is at rest (and, for a cleaner away from her post, once she is back at it)
      if (run.host === null) {
        const ctl = this.registry.get(hostEntry.member.id)
        if (ctl && kitOf(hostEntry.post!.kind).atRest(this.world, ctl)) {
          const post = kitOf(hostEntry.post!.kind).post(this.world, hostEntry)
          const a = this.toActor(ctl, hostEntry, c.kind === 'relief' ? 'leaver' : 'receiver')
          run.host = a
          if (dist(a.pos, post.at) > 0.8) a.run([{ kind: 'walk', to: post.at, face: post.heading }, { kind: 'do', run: () => (run.hostReady = true) }])
          else run.hostReady = true
        } else if (ctl) {
          // busy: finish what is in hand and take nothing new, so the talk can start (a fresh controller takes over after it)
          stop(ctl)
        }
      }
      if (run.host && run.hostReady && run.host.finished) this.startTalk(run, t, visitor)
      else if (t - run.waitingSince > PATIENCE_SECONDS) this.skipTalk(run)
      return
    }

    if (run.talk === 'talking' && run.host && visitor && run.host.finished && visitor.finished) this.endTalk(run)

    // after the talk (or without it): the comer steps onto the post; a skipped relief's leaver goes when it is at rest
    if (run.comerAtPost && !run.comerSwapped && (run.talk === 'done' || run.talk === 'skipped')) this.swapInComer(run)
    if (c.kind === 'relief' && run.talk === 'skipped' && run.stopped && !run.leaverLaunched) this.launchLeaver(run)
  }

  private startTalk(run: Run, t: number, visitor: ShiftActor): void {
    const c = run.change
    const host = run.host!
    run.talk = 'talking'
    run.talkStartT = t
    if (c.kind === 'relief' && c.leaver!.post!.kind === 'wardNurse') {
      host.run(this.wardTalkSteps(run, host, () => visitor, 0))
      visitor.run(this.wardTalkSteps(run, visitor, () => host, 1))
    } else {
      host.run(this.talkSteps(run, host, () => visitor))
      visitor.run(this.talkSteps(run, visitor, () => host))
    }
    const taker = c.kind === 'relief' ? c.comer! : c.kind === 'leaveStayer' ? c.stayer! : c.comer!
    const giver = c.kind === 'relief' ? c.leaver! : c.kind === 'leaveStayer' ? c.leaver! : c.stayer!
    const text = fillDayTemplate('shiftHandover', {
      nurse: taker.member.name,
      ward: postLabel((c.comer ?? c.leaver!)),
      colleague: giver.member.name,
    })
    this.world.say('shiftHandover', text, { actorId: taker.member.id, subjectId: giver.member.id })
  }

  private endTalk(run: Run): void {
    const c = run.change
    run.talk = 'done'
    run.talkEndT = this.world.t
    const host = run.host!
    run.host = null
    if (c.kind === 'relief') {
      // the leaver goes; the comer steps onto the post
      const r = c.leaver!
      run.leaverAct = host
      run.leaverLaunched = true
      host.run(this.leaveSteps(r.member.id, host, run.lockerSeconds))
      run.comer!.run(this.toPostSteps(run, c.comer!))
    } else if (c.kind === 'comeStayer') {
      this.toReal(host, c.stayer!)
      run.comer!.run(this.toPostSteps(run, c.comer!))
    } else {
      // leaveStayer: the stayer is back on post, the leaver goes
      this.toReal(host, c.stayer!)
      const a = run.leaverAct!
      run.leaverLaunched = true
      a.run(this.leaveSteps(c.leaver!.member.id, a, run.lockerSeconds))
    }
  }

  /** Nobody to hand over to in time: the comer takes the post (or the leaver goes) without the talk. */
  private skipTalk(run: Run): void {
    const c = run.change
    run.talk = 'skipped'
    if (c.kind === 'leaveStayer') {
      const a = run.leaverAct!
      run.leaverLaunched = true
      a.run(this.leaveSteps(c.leaver!.member.id, a, run.lockerSeconds))
    } else if (run.comer) {
      run.comer.run(this.toPostSteps(run, c.comer!))
    }
  }

  // --- reading ----------------------------------------------------------------------------------------------------------

  /** Runs that are under way (for the tests and the HUD). */
  get active(): readonly Run[] {
    return this.runs.filter((r) => r.state === 'running')
  }
}
