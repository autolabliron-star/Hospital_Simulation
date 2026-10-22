/**
 * The people of M1 and what they do. Each is a small hand-written state machine (skill: role behaviours).
 *   Doctor      Wave 1: ONE morning round (08:30-11:00, 6-10 min a bed, the nurse at the bedside when free), planned discharges
 *               signed when due, a review of new admissions in the afternoon and on call at night; otherwise at the desk.
 *   Nurse       charting at the hub until a MedDrawer's dose is due, then walks to that bedside, opens the drawer (wristband
 *               scan) and gives the medicines (or explains the take-home medicines of a discharge); or does the admission
 *               check of a new patient; then back to the hub.
 *   Pharmacist  at the verify desk in the core, busy while an order is being checked.
 *   Patient     whoever lies in a bed (beds/inpatient.ts): the ward is no longer tied to the M1 catalogue, the bed board says
 *               who is in which room.
 *   Coordinator seated in the command center; the first one is the bed manager (a tablet while assigning a bed).
 * Visitors, porters, cleaners and the ER pathway arrive in M3.
 *
 * The base classes (`Person`, `newEntity`) live in person.ts and are re-exported here.
 */
import { isPrn, MEDICINES, patientInRoom } from '@/content/catalogue'
import { HUDDLE_TOPICS } from '@/content/day'
import { STAFF, type StaffMember } from '@/content/staff'
import { recordOfPlan } from './beds/bedBook'
import { Patient } from './beds/inpatient'
import { CONFIG } from './config'
import { clockHourAt, huddleEvent, nightRounds, safetyHuddle, timeOfClockHour } from './day/roster'
import { staffRegistry } from './day/staffRegistry'
import type { World } from './er/world'
import { COMMAND_SEATS, DOCTORS_BASE, HANDOVER, NURSE_HUB, PHARMACY, ROOMS, roomById, type RoomSpec, type Spot } from './places'
import { newEntity, Person, type PeopleContext } from './person'
import type { Entity, RoomId, Vec2, WardId } from './types'
import { makeWalker, type Walker } from './walker'

export { newEntity, Person, type PeopleContext } from './person'
export { Patient }

// ---------------------------------------------------------------------------------------------

type DoctorState = 'desk' | 'toBedside' | 'visiting' | 'between' | 'toDesk'
export type VisitKind = 'round' | 'sign' | 'review'

/** One bedside visit of a doctor, kept for the tests and the KPIs (the sim itself never reads it). */
export interface DoctorVisit {
  t: number
  roomId: RoomId
  patientId: string
  kind: VisitKind
}

interface Planned {
  roomId: RoomId
  kind: VisitKind
}

/** Where a ward doctor works at the doctors' office: doc-A / the on-call doctor at the base, doc-B 1.4 m to the east (two walkers on one spot can block each other). */
export function deskSpot(index: number): Spot {
  return { at: { x: DOCTORS_BASE.at.x + 1.4 * index, z: DOCTORS_BASE.at.z }, heading: DOCTORS_BASE.heading }
}

/** The ward day starts with the morning round: ward day k runs from 08:30 on day k to 08:30 the next morning. */
function wardDayAt(t: number): number {
  return Math.floor((clockHourAt(t) - CONFIG.people.round.startHour) / 24)
}

/** Which patients a doctor has seen in the current ward day, shared by all doctors of a world (patient id -> ward day). */
const SEEN = new WeakMap<object, Map<string, number>>()
function seenOf(world: World): Map<string, number> {
  let m = SEEN.get(world)
  if (!m) SEEN.set(world, (m = new Map()))
  return m
}

/**
 * The ward doctor (one per ward by day, one on-call doctor for both wards at night).
 *   morning     ONE ward round between people.round.startHour and endHour: every occupied bed once, `bedsideSeconds` each, the ward
 *               nurse at the bedside when she is free; signs the planned discharge of a bed that is due; writes a medicine order
 *               at a visit only with probability `changeChance` (a new or an as-needed medicine, never a duplicate)
 *   afternoon   from `afternoonHour` (and all night, on call) a short review of patients admitted since the round
 *   otherwise   at the desk in the doctors' office (planned discharges that fall due are signed whenever they do)
 */
export class Doctor extends Person {
  private state: DoctorState = 'desk'
  private timer = 0
  private hold = 5
  private readonly queue: Planned[] = []
  private current: Planned | null = null
  private examined: string | null = null
  private roundDay = -99
  private pollT = 0
  private escort: Nurse | null = null
  /** Every bedside visit so far, in order. */
  readonly visits: DoctorVisit[] = []
  /** Set by the shift change: take no new visit (the visit in hand is finished). */
  retiring = false

  constructor(
    readonly staff: StaffMember,
    /** The ward this doctor covers; null for the on-call doctor (both wards). */
    readonly ward: WardId | null,
    private readonly home: Spot,
    walker?: Walker,
  ) {
    super(newEntity(staff.id, 'doctor', staff.name, home.at, home.heading), walker)
  }

  /** S1 showcase opening: stay at the desk in the doctors' office this long before anything else (notes, the day's list). */
  holdAtBase(seconds: number): void {
    if (this.state === 'desk') this.hold = Math.max(this.hold, seconds)
  }

  /** Nothing in hand: at the desk (the shift change may take the doctor off duty). */
  get atRest(): boolean {
    return this.state === 'desk'
  }

  /**
   * A warm start at clock hour `hour`: the patients already in bed were seen on the morning round that has gone by, and a start in the
   * middle of the round puts the doctor mid-visit at the bed the round has reached.
   */
  warmStart(ctx: PeopleContext, hour: number): void {
    const board = ctx.world.beds
    if (!board) return
    const r = CONFIG.people.round
    const seen = seenOf(ctx.world)
    const day = wardDayAt(ctx.t)
    const rooms = this.rooms(ctx)
    if (this.ward !== null && hour >= r.startHour && hour < r.endHour) {
      this.roundDay = day
      const perBed = (r.bedsideSeconds[0] + r.bedsideSeconds[1] + r.gapSeconds[0] + r.gapSeconds[1]) / 2
      const k = Math.floor(((hour - r.startHour) * 3600) / perBed)
      rooms.forEach((id, i) => {
        if (i < k) seen.set(board.occupantOf(id)?.id ?? id, day)
      })
      const rest = rooms.slice(k)
      for (const id of rest) this.queue.push({ roomId: id, kind: 'round' })
      const first = this.queue[0]
      if (first && board.isInBed(first.roomId)) {
        const room = roomById(first.roomId)
        this.walker.place(room.bedside.x, room.bedside.z, room.bedsideHeading)
        this.startVisit(ctx, ctx.rng.range(0.1, 0.9) * (r.bedsideSeconds[0] + r.bedsideSeconds[1]) * 0.5)
      }
      return
    }
    if (hour >= r.endHour || hour < r.startHour) {
      this.roundDay = hour >= r.endHour ? day : this.roundDay
      for (const id of rooms) {
        const o = board.occupantOf(id)
        if (o) seen.set(o.id, day)
      }
    }
  }

  update(dt: number, ctx: PeopleContext): void {
    this.tickEmote(ctx)
    switch (this.state) {
      case 'desk':
        this.entity.anim = 'tablet'
        if (this.hold > 0) this.hold -= dt
        this.pollT += dt
        if (this.pollT >= 1) {
          this.pollT = 0
          if (this.hold <= 0 && !this.retiring) this.plan(ctx)
        }
        break
      case 'toBedside':
        if (this.walk(dt, ctx)) {
          const id = this.queue[0].roomId
          const board = ctx.world.beds
          // the bed may have emptied on the way: nothing to examine
          if (board && !board.isInBed(id)) {
            this.queue.shift()
            this.state = 'between'
            this.timer = 0
            break
          }
          this.walker.face(roomById(id).bedsideHeading)
          this.startVisit(ctx, -1)
        }
        break
      case 'visiting': {
        const e = this.entity
        e.anim = this.timer > this.visitSeconds * 0.45 ? 'talk' : 'tablet'
        this.attend(ctx)
        this.timer -= dt
        if (this.timer <= 0) {
          this.finishVisit(ctx)
          e.roomId = undefined
          this.releaseEscort()
          this.state = 'between'
          const g = CONFIG.people.round.gapSeconds
          this.timer = ctx.rng.range(g[0], g[1])
        }
        break
      }
      case 'between':
        this.entity.anim = 'tablet'
        this.timer -= dt
        if (this.timer <= 0) this.nextRoom(ctx)
        break
      case 'toDesk':
        if (this.walk(dt, ctx)) {
          this.walker.face(this.home.heading)
          this.state = 'desk'
        }
        break
    }
  }

  private visitSeconds = 0

  private rooms(ctx: PeopleContext): RoomId[] {
    const board = ctx.world.beds
    if (!board) return ROOMS.filter((r) => this.ward === null || r.ward === this.ward).map((r) => r.id)
    const out: RoomId[] = []
    for (const w of this.ward === null ? (['A', 'B'] as const) : [this.ward]) out.push(...board.occupiedRooms(w))
    return out.sort()
  }

  /** At the desk, once a second: a planned discharge to sign, the morning round, or a review of the new admissions. */
  private plan(ctx: PeopleContext): void {
    const board = ctx.world.beds
    const r = CONFIG.people.round
    const hour = clockHourAt(ctx.t)
    const day = wardDayAt(ctx.t)
    if (board && this.ward !== null) {
      const due = board.signDue(this.ward, ctx.t)
      if (due !== null) {
        this.queue.unshift({ roomId: due, kind: 'sign' })
        this.nextRoom(ctx)
        return
      }
    }
    if (this.ward !== null && this.roundDay !== day && hour >= r.startHour && hour < r.endHour) {
      this.roundDay = day
      for (const id of this.rooms(ctx)) this.queue.push({ roomId: id, kind: 'round' })
    } else if (board && (this.ward === null || hour >= r.afternoonHour)) {
      const seen = seenOf(ctx.world)
      for (const id of this.rooms(ctx)) {
        const o = board.occupantOf(id)
        if (o && seen.get(o.id) !== day) this.queue.push({ roomId: id, kind: 'review' })
      }
    }
    if (this.queue.length > 0) this.nextRoom(ctx)
  }

  private nextRoom(ctx: PeopleContext): void {
    const board = ctx.world.beds
    // a planned discharge that is due to be signed goes first
    if (board && this.ward !== null && !this.retiring) {
      const due = board.signDue(this.ward, ctx.t)
      if (due !== null) {
        const k = this.queue.findIndex((q) => q.roomId === due)
        if (k > 0) this.queue.unshift(this.queue.splice(k, 1)[0])
        else if (k < 0) this.queue.unshift({ roomId: due, kind: 'sign' })
      }
    }
    // a bed that emptied since it was planned is dropped
    while (this.queue.length > 0 && board && !board.isInBed(this.queue[0].roomId)) this.queue.shift()
    if (this.queue.length === 0 || this.retiring) {
      this.queue.length = 0
      this.walker.goTo(this.home.at)
      this.state = 'toDesk'
      return
    }
    this.walker.goTo(roomById(this.queue[0].roomId).bedside)
    this.state = 'toBedside'
  }

  private startVisit(ctx: PeopleContext, remaining: number): void {
    const planned = this.queue[0]
    const board = ctx.world.beds
    const room = roomById(planned.roomId)
    this.current = planned
    this.entity.roomId = room.id
    const occ = board?.occupantOf(room.id) ?? null
    this.examined = occ?.id ?? null
    const secs = CONFIG.people.round
    const total = planned.kind === 'round' ? ctx.rng.between(secs.bedsideSeconds) : ctx.rng.between(secs.reviewSeconds)
    this.visitSeconds = total
    this.timer = remaining >= 0 ? Math.min(remaining, total) : total
    this.state = 'visiting'
    this.emote(ctx, 'tablet', this.timer)
    this.visits.push({ t: ctx.t, roomId: room.id, patientId: occ?.id ?? room.id, kind: planned.kind })
  }

  /** The ward nurse comes to the bedside when she is free (she goes back to her work the moment a dose falls due). */
  private attend(ctx: PeopleContext): void {
    const cur = this.current
    if (!cur) return
    if (this.escort === null || !this.escort.canAttend(ctx.t)) {
      const ward = roomById(cur.roomId).ward
      this.escort = null
      for (const p of staffRegistry(ctx.world).values()) {
        if (p instanceof Nurse && p.ward === ward && p.canAttend(ctx.t)) {
          this.escort = p
          break
        }
      }
    }
    this.escort?.attend(cur.roomId, ctx.t + 20)
  }

  private releaseEscort(): void {
    this.escort = null
  }

  /** End of the visit: sign the planned discharge if it is due, else maybe change the patient's medicines. */
  private finishVisit(ctx: PeopleContext): void {
    const planned = this.queue.shift()
    this.current = null
    if (!planned) return
    const board = ctx.world.beds
    const roomId = planned.roomId
    if (!board) {
      this.maybeChange(ctx, roomId)
      return
    }
    // the patient must still be the one the doctor came to see
    const occ = board.occupantOf(roomId)
    if (!occ || occ.id !== this.examined) return
    seenOf(ctx.world).set(occ.id, wardDayAt(ctx.t))
    if (board.canSign(roomId, ctx.t) && board.sign(roomId, this.staff.id, ctx.t)) return
    if (planned.kind !== 'sign' && board.get(roomId).stage === 'occupied') this.maybeChange(ctx, roomId)
  }

  /**
   * With probability `changeChance`: an as-needed medicine, or a new regular one added to the patient's list (given from its next dose
   * hour). Never a medicine the patient already has (MedSystem.prescribe also refuses duplicates and doses inside the interval).
   */
  private maybeChange(ctx: PeopleContext, roomId: RoomId): void {
    if (!ctx.rng.chance(CONFIG.people.round.changeChance)) return
    const record = ctx.world.beds?.recordOf(roomId) ?? null
    const have: readonly string[] = record ? record.usualMeds : patientInRoom(roomId).usualMeds
    const as = MEDICINES.filter((m) => isPrn(m.id)).map((m) => m.id)
    const regular = MEDICINES.filter((m) => !isPrn(m.id) && !have.includes(m.id)).map((m) => m.id)
    const prn = ctx.rng.chance(0.5) || regular.length === 0 || have.length >= 6
    if (prn) {
      const pool = as.filter((id) => ctx.meds.pendingFor(roomId, id) === false)
      if (pool.length === 0) return
      ctx.meds.prescribe({ roomId, items: [{ medId: ctx.rng.pick(pool), qty: 1 }], prescriberId: this.staff.id, source: 'sim' })
      return
    }
    const medId = ctx.rng.pick(regular)
    const r = ctx.meds.prescribe({ roomId, items: [{ medId, qty: 1 }], prescriberId: this.staff.id, source: 'sim' })
    if (r.ok && record) record.usualMeds = [...record.usualMeds, medId]
  }
}

// ---------------------------------------------------------------------------------------------

type NurseState = 'charting' | 'toRoom' | 'giving' | 'toHub' | 'toCheck' | 'checking' | 'toAttend' | 'attending' | 'huddle' | 'toLook' | 'looking'

/** Safety-huddle events already written, per world ("A:<day>"). */
const HUDDLES = new WeakMap<object, Set<string>>()

/** The night rounds of a ward over the simulated days (computed once). */
const NIGHT_ROUNDS: Record<WardId, ReturnType<typeof nightRounds>> = {
  A: nightRounds('A', timeOfClockHour(0), timeOfClockHour(72)),
  B: nightRounds('B', timeOfClockHour(0), timeOfClockHour(72)),
}
/** A night round still starts this long after its time (the nurse was busy). */
const NIGHT_ROUND_GRACE = 1800

export class Nurse extends Person {
  private state: NurseState = 'charting'
  private timer = 0
  private room: RoomSpec | null = null
  /** The nurse explains take-home medicines (a discharge) instead of just handing them over. */
  private teaching = false
  private pollT = 0
  /** Set by the shift change: take no new work. */
  retiring = false
  private attendRoom: RoomId | null = null
  private attendUntil = -Infinity
  private checkRoom: RoomId | null = null
  private checkLeft = 0
  private huddleDay = -99
  private doneRound = -Infinity
  private lookIndex = 0
  private lookRound: ReturnType<typeof nightRounds>[number] | null = null
  /** Every quiet look into a room on a night round, in order (for the tests and the KPIs). */
  readonly nightLooks: { t: number; roomId: RoomId }[] = []

  constructor(
    readonly staff: StaffMember,
    readonly ward: WardId,
    private readonly spot: { at: Vec2; heading: number },
    walker?: Walker,
  ) {
    super(newEntity(staff.id, 'nurse', staff.name, spot.at, spot.heading), walker)
  }

  /** Nothing in hand, at the hub. */
  get atRest(): boolean {
    return this.state === 'charting'
  }

  /** Free to join the doctor at a bedside (not giving medicines, not in an admission check, not leaving). */
  canAttend(t: number): boolean {
    if (this.retiring) return false
    if (this.state === 'toAttend' || this.state === 'attending') return true
    return this.state === 'charting' && t >= this.attendUntil
  }

  /** The doctor is at `roomId`'s bedside: be there until `until` (the doctor renews it while the visit lasts). */
  attend(roomId: RoomId, until: number): void {
    this.attendUntil = until
    if (this.state === 'charting' || this.state === 'toAttend' || this.state === 'attending') {
      if (this.attendRoom !== roomId || this.state === 'charting') {
        this.attendRoom = roomId
        this.walker.goTo(HANDOVER[roomId][1].at)
        this.state = 'toAttend'
      }
    }
  }

  update(dt: number, ctx: PeopleContext): void {
    this.tickEmote(ctx)
    switch (this.state) {
      case 'charting': {
        this.entity.anim = 'tablet'
        if (this.retiring) break
        const due = ctx.meds.dueDrawers(this.ward)[0]
        if (due) {
          this.startGiving(ctx, due.roomId)
          break
        }
        this.pollT += dt
        if (this.pollT < 1) break
        this.pollT = 0
        if (this.maybeNightRound(ctx) || this.maybeHuddle(ctx)) break
        // nothing due: a new patient on the ward gets the admission check (wristband and tablet), 25-40 minutes
        const id = ctx.world.beds?.claimCheck(this.ward, this.staff.id)
        if (id) {
          this.room = roomById(id)
          this.checkRoom = id
          this.checkLeft = ctx.rng.between(CONFIG.beds.admissionCheckSeconds)
          this.walker.goTo(HANDOVER[id][1].at)
          this.state = 'toCheck'
        }
        break
      }
      case 'toRoom':
        if (this.walk(dt, ctx, CONFIG.people.walkSpeed)) {
          const room = this.room!
          this.walker.face(room.ward === 'A' ? Math.PI : 0)
          this.state = 'giving'
          this.teaching = this.hasTakeHome(ctx, room.id)
          this.timer = this.teaching ? ctx.rng.between(CONFIG.beds.dischargeTeachSeconds) : CONFIG.people.nurseGiveSeconds
          this.entity.roomId = room.id
          this.emote(ctx, 'scan', 3)
        }
        break
      case 'giving':
        this.entity.anim = this.teaching ? 'talk' : 'give'
        this.timer -= dt
        if (!this.teaching && this.timer < CONFIG.people.nurseGiveSeconds - 3 && this.entity.emote === 'none') this.emote(ctx, 'pill', 20)
        if (this.teaching && this.timer < 30 && this.entity.emote === 'none') this.emote(ctx, 'pill', 25)
        if (this.timer <= 0) {
          const room = this.room!
          ctx.meds.give(room.id, this.staff.id)
          ctx.world.wardPatients.get(room.id)?.relieved(ctx)
          this.entity.roomId = undefined
          this.room = null
          this.teaching = false
          // an admission check that was interrupted by the dose is taken up again
          if (this.checkRoom !== null && ctx.world.beds?.get(this.checkRoom).check === 'claimed') {
            this.room = roomById(this.checkRoom)
            this.walker.goTo(HANDOVER[this.checkRoom][1].at)
            this.state = 'toCheck'
          } else {
            this.checkRoom = null
            this.walker.goTo(this.spot.at)
            this.state = 'toHub'
          }
        }
        break
      case 'toCheck':
        if (this.walk(dt, ctx)) {
          const room = this.room!
          this.walker.face(HANDOVER[room.id][1].heading)
          this.entity.roomId = room.id
          this.state = 'checking'
          this.timer = this.checkLeft
          this.emote(ctx, 'scan', 4)
        }
        break
      case 'checking': {
        this.entity.anim = this.timer > 15 ? 'tablet' : 'talk'
        this.timer -= dt
        this.checkLeft = this.timer
        // a dose falls due while the nurse is at the bedside: give it first, then come back to the check
        const due = !this.retiring && this.timer > 60 ? ctx.meds.dueDrawers(this.ward)[0] : undefined
        if (due && due.roomId !== this.room!.id) {
          this.entity.roomId = undefined
          this.startGiving(ctx, due.roomId)
          break
        }
        if (this.timer <= 0) {
          const room = this.room!
          ctx.world.beds?.completeCheck(room.id, this.staff.id, ctx.t)
          this.entity.roomId = undefined
          this.room = null
          this.checkRoom = null
          this.walker.goTo(this.spot.at)
          this.state = 'toHub'
        }
        break
      }
      case 'toAttend':
        if (this.walk(dt, ctx)) {
          this.walker.face(HANDOVER[this.attendRoom!][1].heading)
          this.state = 'attending'
        }
        if (this.attendEnded(ctx)) this.leaveAttend()
        break
      case 'attending':
        this.entity.anim = 'tablet'
        if (this.attendEnded(ctx)) this.leaveAttend()
        break
      case 'huddle':
        this.entity.anim = 'talk'
        {
          // a dose that falls due cuts the huddle short
          const due = this.retiring ? undefined : ctx.meds.dueDrawers(this.ward)[0]
          if (due) {
            this.startGiving(ctx, due.roomId)
            break
          }
        }
        if (ctx.t >= safetyHuddle(this.ward).endT + 86400 * Math.max(0, this.huddleDay)) this.state = 'charting'
        break
      case 'toLook':
        if (this.walk(dt, ctx)) {
          const round = this.lookRound!
          this.walker.face(round.checks[this.lookIndex].spot.heading)
          this.entity.anim = 'idle'
          this.timer = round.checks[this.lookIndex].seconds
          this.nightLooks.push({ t: ctx.t, roomId: round.checks[this.lookIndex].roomId })
          this.state = 'looking'
        }
        break
      case 'looking': {
        this.entity.anim = 'idle'
        this.timer -= dt
        if (this.timer > 0) break
        const round = this.lookRound!
        this.lookIndex++
        const due = ctx.meds.dueDrawers(this.ward)[0]
        if (due) {
          // a dose falls due: give it, the round goes on afterwards
          this.startGiving(ctx, due.roomId)
          this.lookRound = this.lookIndex < round.checks.length ? round : null
          break
        }
        if (this.lookIndex < round.checks.length) {
          this.walker.goTo(round.checks[this.lookIndex].spot.at)
          this.state = 'toLook'
        } else {
          this.lookRound = null
          this.walker.goTo(this.spot.at)
          this.state = 'toHub'
        }
        break
      }
      case 'toHub':
        if (this.walk(dt, ctx)) {
          this.walker.face(this.spot.heading)
          this.state = 'charting'
        }
        break
    }
  }

  private startGiving(ctx: PeopleContext, roomId: RoomId): void {
    ctx.meds.claim(roomId, this.staff.id)
    this.room = roomById(roomId)
    this.walker.goTo(this.room.drawerSpot)
    this.state = 'toRoom'
  }

  private attendEnded(ctx: PeopleContext): boolean {
    return ctx.t >= this.attendUntil || this.retiring || ctx.meds.dueDrawers(this.ward).length > 0
  }

  private leaveAttend(): void {
    this.attendRoom = null
    this.walker.goTo(this.spot.at)
    this.state = 'toHub'
  }

  /** The night nurse's quiet look into every room, every two hours (roster.ts `nightRounds`). */
  private maybeNightRound(ctx: PeopleContext): boolean {
    if (this.staff.shift !== 'night') return false
    for (const r of NIGHT_ROUNDS[this.ward]) {
      if (r.startT > ctx.t) break
      if (r.startT <= this.doneRound || ctx.t > r.startT + NIGHT_ROUND_GRACE) continue
      this.doneRound = r.startT
      this.lookRound = r
      this.lookIndex = 0
      this.walker.goTo(r.checks[0].spot.at)
      this.state = 'toLook'
      return true
    }
    return false
  }

  /** The morning safety huddle at the hub (07:33, four minutes): the day nurses stand together and talk. */
  private maybeHuddle(ctx: PeopleContext): boolean {
    if (this.staff.shift !== 'day') return false
    const h = safetyHuddle(this.ward)
    const day = Math.round((ctx.t - h.startT) / 86400)
    const startT = h.startT + 86400 * day
    if (ctx.t < startT || ctx.t >= startT + h.seconds || this.huddleDay === day) return false
    this.huddleDay = day
    const fired = HUDDLES.get(ctx.world) ?? new Set<string>()
    HUDDLES.set(ctx.world, fired)
    const key = `${this.ward}:${day}`
    if (!fired.has(key)) {
      fired.add(key)
      huddleEvent(ctx.world, this.ward, ctx.rng.pick(HUDDLE_TOPICS), this.staff.id)
    }
    this.walker.face(this.spot.heading)
    this.state = 'huddle'
    return true
  }

  /** Does the drawer hold the take-home medicines of a patient going home? */
  private hasTakeHome(ctx: PeopleContext, roomId: RoomId): boolean {
    const d = ctx.meds.drawers.get(roomId)
    if (!d) return false
    for (const id of d.orderIds) if (ctx.meds.orders.get(id)?.source === 'discharge') return true
    return false
  }
}

// ---------------------------------------------------------------------------------------------

export class Pharmacist extends Person {
  constructor(
    readonly staff: StaffMember,
    private readonly ward: WardId,
    walker?: Walker,
  ) {
    const desk = PHARMACY.desk[ward]
    super(newEntity(staff.id, 'pharmacist', staff.name, desk.spot, desk.heading), walker)
  }

  override get mobile(): boolean {
    return false
  }

  update(_dt: number, ctx: PeopleContext): void {
    const busy = ctx.meds.isVerifying(this.ward)
    this.entity.anim = busy ? 'tablet' : 'idle'
    this.entity.emote = busy ? 'check' : 'none'
  }
}

export class Coordinator extends Person {
  constructor(
    readonly staff: StaffMember,
    seat: { at: Vec2; heading: number },
    walker?: Walker,
    readonly seatId = `command:${staff.id}`,
  ) {
    super(newEntity(staff.id, 'coordinator', staff.name, seat.at, seat.heading), walker)
    this.entity.anim = 'sit'
    this.entity.seated = { seatId, pose: 'sit' }
  }

  override get mobile(): boolean {
    return false
  }

  /** The first coordinator is the bed manager: seated, with the tablet out while a bed is being assigned. */
  update(_dt: number, ctx: PeopleContext): void {
    const board = ctx.world.beds
    if (!board || board.managerId !== this.staff.id) return
    const busy = ctx.t < board.managerBusyUntil
    const anim: Entity['anim'] = busy ? 'tablet' : 'sit'
    if (this.entity.anim !== anim) {
      this.entity.anim = anim
      this.entity.emote = busy ? 'bed' : 'none'
    }
  }
}

/**
 * Everyone on shift at the start of the day, in a stable order. `walkerFor` makes each person's walker (the simulation
 * passes the crowd-aware factory); the default is a plain nav walker.
 */
export function createPeople(walkerFor: (id: string) => Walker = (id) => makeWalker(undefined, { id })): Person[] {
  const people: Person[] = []
  for (const room of ROOMS) {
    const record = recordOfPlan(patientInRoom(room.id))
    people.push(new Patient(room, record, walkerFor(record.id)))
  }
  const nurseIndex: Record<WardId, number> = { A: 0, B: 0 }
  let seat = 0
  for (const s of STAFF) {
    if (s.role === 'doctor' && s.ward) people.push(new Doctor(s, s.ward, deskSpot(s.ward === 'A' ? 0 : 1), walkerFor(s.id)))
    else if (s.role === 'nurse' && s.ward)
      people.push(new Nurse(s, s.ward, NURSE_HUB[s.ward][nurseIndex[s.ward]++ % NURSE_HUB[s.ward].length], walkerFor(s.id)))
    else if (s.role === 'pharmacist' && s.ward) people.push(new Pharmacist(s, s.ward, walkerFor(s.id)))
    else if (s.role === 'coordinator') {
      const i = seat++ % COMMAND_SEATS.length
      // COMMAND_SEATS[i] is exactly where the layout's desk seat `command:desk:i` is
      people.push(new Coordinator(s, COMMAND_SEATS[i], walkerFor(s.id), `command:desk:${i}`))
    }
  }
  return people
}
