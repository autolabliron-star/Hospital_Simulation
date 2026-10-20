/**
 * The people of M1 and what they do. Each is a small hand-written state machine (skill: role behaviours).
 *   Doctor      rounds: walk to each occupied bedside of the ward, examine, prescribe on the tablet (or sign the planned
 *               discharge), next room; after a round, a break at the doctors' base.
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
import { patientInRoom } from '@/content/catalogue'
import { STAFF, type StaffMember } from '@/content/staff'
import { recordOfPlan } from './beds/bedBook'
import { Patient } from './beds/inpatient'
import { CONFIG } from './config'
import { COMMAND_SEATS, DOCTORS_BASE, HANDOVER, NURSE_HUB, PHARMACY, ROOMS, roomById, type RoomSpec } from './places'
import { newEntity, Person, type PeopleContext } from './person'
import type { Entity, RoomId, Vec2, WardId } from './types'
import { makeWalker, type Walker } from './walker'

export { newEntity, Person, type PeopleContext } from './person'
export { Patient }

// ---------------------------------------------------------------------------------------------

type DoctorState = 'toBedside' | 'examining' | 'between' | 'toBase' | 'resting'

/**
 * Where each ward's doctor rests in the doctors' office. The two doctors used to share DOCTORS_BASE exactly; two walkers
 * standing on the same spot can block each other in the crowd, so the ward B doctor rests 1.4 m to the east.
 */
function restSpot(ward: WardId): Vec2 {
  return ward === 'A' ? DOCTORS_BASE.at : { x: DOCTORS_BASE.at.x + 1.4, z: DOCTORS_BASE.at.z }
}

export class Doctor extends Person {
  private state: DoctorState = 'resting'
  private readonly rest: Vec2
  private timer = 5
  private round: RoomId[] = []
  /** Whom the doctor is examining (the entity id), so an order never goes to somebody who is no longer in the bed. */
  private examined: string | null = null
  private pollT = 0

  constructor(
    readonly staff: StaffMember,
    private readonly ward: WardId,
    walker?: Walker,
  ) {
    super(newEntity(staff.id, 'doctor', staff.name, restSpot(ward), DOCTORS_BASE.heading), walker)
    this.rest = restSpot(ward)
  }

  /** S1 showcase opening: stay at the desk in the doctors' office this long before the first round (notes, the day's list). */
  holdAtBase(seconds: number): void {
    if (this.state === 'resting') this.timer = Math.max(this.timer, seconds)
  }

  update(dt: number, ctx: PeopleContext): void {
    this.tickEmote(ctx)
    switch (this.state) {
      case 'resting':
        this.entity.anim = 'idle'
        this.timer -= dt
        // a planned discharge that is due to be signed ends the rest early
        this.pollT += dt
        if (this.pollT >= 1) {
          this.pollT = 0
          if (this.timer > 1 && ctx.world.beds?.signDue(this.ward, ctx.t)) this.timer = 1
        }
        if (this.timer <= 0) {
          this.round = ctx.rng.shuffle(this.roomsToVisit(ctx))
          this.nextRoom(ctx)
        }
        break
      case 'toBedside':
        if (this.walk(dt, ctx)) {
          const id = this.round[0]
          const board = ctx.world.beds
          // the bed may have emptied (or not yet filled) on the way: nothing to examine
          if (board && !board.isInBed(id)) {
            this.round.shift()
            this.entity.roomId = undefined
            this.state = 'between'
            this.timer = 0
            break
          }
          const room = roomById(id)
          this.walker.face(room.bedsideHeading)
          this.entity.roomId = room.id
          this.examined = board ? (board.occupantOf(id)?.id ?? null) : null
          this.state = 'examining'
          this.timer = CONFIG.people.doctorBedsideSeconds
          this.emote(ctx, 'tablet', this.timer)
        }
        break
      case 'examining':
        this.entity.anim = this.timer > CONFIG.people.doctorBedsideSeconds * 0.45 ? 'talk' : 'tablet'
        this.timer -= dt
        if (this.timer <= 0) {
          this.finishVisit(ctx, this.round.shift()!)
          this.entity.roomId = undefined
          this.state = 'between'
          const g = CONFIG.people.doctorGapSeconds
          this.timer = ctx.rng.range(g.min, g.max)
        }
        break
      case 'between':
        this.entity.anim = 'idle'
        this.timer -= dt
        if (this.timer <= 0) this.nextRoom(ctx)
        break
      case 'toBase':
        if (this.walk(dt, ctx)) {
          this.walker.face(DOCTORS_BASE.heading)
          this.state = 'resting'
          this.timer = ctx.rng.range(60, 120)
        }
        break
    }
  }

  /** The rooms of the ward with a patient in bed (all of them for a hospital with no bed board). */
  private roomsToVisit(ctx: PeopleContext): RoomId[] {
    const board = ctx.world.beds
    if (board) return board.occupiedRooms(this.ward)
    return ROOMS.filter((r) => r.ward === this.ward).map((r) => r.id)
  }

  private nextRoom(ctx: PeopleContext): void {
    // a planned discharge that is due to be signed goes first
    const due = ctx.world.beds?.signDue(this.ward, ctx.t) ?? null
    if (due !== null) {
      const k = this.round.indexOf(due)
      if (k > 0) this.round.splice(k, 1)
      if (k !== 0) this.round.unshift(due)
    }
    const id = this.round[0]
    if (id === undefined) {
      this.walker.goTo(this.rest)
      this.state = 'toBase'
      return
    }
    this.walker.goTo(roomById(id).bedside)
    this.state = 'toBedside'
  }

  /** At the end of the bedside visit: sign the planned discharge, or write the rounds order for the patient in the bed. */
  private finishVisit(ctx: PeopleContext, roomId: RoomId): void {
    const board = ctx.world.beds
    if (!board) {
      this.prescribe(ctx, roomId, patientInRoom(roomId).usualMeds)
      return
    }
    // the patient must still be the one the doctor came to see
    if (board.occupantOf(roomId)?.id !== this.examined) return
    if (board.canSign(roomId, ctx.t) && board.sign(roomId, this.staff.id, ctx.t)) return
    const usual = board.recordOf(roomId)?.usualMeds
    if (usual && board.get(roomId).stage === 'occupied') this.prescribe(ctx, roomId, usual)
  }

  /** Rounds order: one to three of the patient's usual medicines (demo data, no clinical logic). */
  private prescribe(ctx: PeopleContext, roomId: RoomId, usual: readonly string[]): void {
    const count = ctx.rng.int(1, Math.min(3, usual.length))
    // shuffle is in place: never shuffle the catalogue's own array
    const chosen = ctx.rng.shuffle([...usual]).slice(0, count)
    // keep the patient's list order so the same seed reads naturally in the log
    const items = usual.filter((m) => chosen.includes(m)).map((medId) => ({ medId, qty: 1 }))
    ctx.meds.prescribe({ roomId, items, prescriberId: this.staff.id, source: 'sim' })
  }
}

// ---------------------------------------------------------------------------------------------

type NurseState = 'charting' | 'toRoom' | 'giving' | 'toHub' | 'toCheck' | 'checking'

export class Nurse extends Person {
  private state: NurseState = 'charting'
  private timer = 0
  private room: RoomSpec | null = null
  /** The nurse explains take-home medicines (a discharge) instead of just handing them over. */
  private teaching = false
  private pollT = 0

  constructor(
    readonly staff: StaffMember,
    private readonly ward: WardId,
    private readonly spot: { at: Vec2; heading: number },
    walker?: Walker,
  ) {
    super(newEntity(staff.id, 'nurse', staff.name, spot.at, spot.heading), walker)
  }

  update(dt: number, ctx: PeopleContext): void {
    this.tickEmote(ctx)
    switch (this.state) {
      case 'charting': {
        this.entity.anim = 'tablet'
        const due = ctx.meds.dueDrawers(this.ward)[0]
        if (due) {
          ctx.meds.claim(due.roomId, this.staff.id)
          this.room = roomById(due.roomId)
          this.walker.goTo(this.room.drawerSpot)
          this.state = 'toRoom'
          break
        }
        // nothing due: a new patient on the ward gets the admission check (wristband and tablet)
        this.pollT += dt
        if (this.pollT >= 1) {
          this.pollT = 0
          const id = ctx.world.beds?.claimCheck(this.ward, this.staff.id)
          if (id) {
            this.room = roomById(id)
            this.walker.goTo(HANDOVER[id][1].at)
            this.state = 'toCheck'
          }
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
          this.walker.goTo(this.spot.at)
          this.state = 'toHub'
        }
        break
      case 'toCheck':
        if (this.walk(dt, ctx)) {
          const room = this.room!
          this.walker.face(HANDOVER[room.id][1].heading)
          this.entity.roomId = room.id
          this.state = 'checking'
          this.timer = ctx.rng.between(CONFIG.beds.admissionCheckSeconds)
          this.emote(ctx, 'scan', 4)
        }
        break
      case 'checking':
        this.entity.anim = this.timer > 15 ? 'tablet' : 'talk'
        this.timer -= dt
        if (this.timer <= 0) {
          const room = this.room!
          ctx.world.beds?.completeCheck(room.id, this.staff.id, ctx.t)
          this.entity.roomId = undefined
          this.room = null
          this.walker.goTo(this.spot.at)
          this.state = 'toHub'
        }
        break
      case 'toHub':
        if (this.walk(dt, ctx)) {
          this.walker.face(this.spot.heading)
          this.state = 'charting'
        }
        break
    }
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
    if (s.role === 'doctor' && s.ward) people.push(new Doctor(s, s.ward, walkerFor(s.id)))
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
