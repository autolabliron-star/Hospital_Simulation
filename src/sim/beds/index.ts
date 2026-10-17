/**
 * Beds that turn over: the bed board, the bed manager, discharges and admissions (L1 bed-flow builder).
 * Wired into Simulation by the orchestrator: constructed once per hospital, `warmStart` right after construction
 * (only for a start later than 07:30), then `step` every fixed step after the director.
 *
 * What lives where:
 *   board.ts            the 16 beds' lifecycle and the bed manager's rules (pure bookkeeping, tested on its own)
 *   bedBook.ts          the bed book: today's discharge plans, admission profiles and the warm-start state of each room
 *   inpatient.ts        the ward patient (an Actor) and its discharge journey (discharge.machine.ts)
 *   spots.ts            where people stand inside a room
 *   this file           the glue the Simulation steps: families sent in to collect a patient, ER patients turned into ward
 *                       patients when the stretcher has slid them onto the bed, boarding limits, the warm start
 *
 * The doctors sign (people.ts), nurses explain the take-home medicines and do the admission check (people.ts), porters
 * bring wheelchairs, stretchers and linen (er/porter.ts), cleaners clean the rooms (er/cleaner.ts), the ER patient (er/patient.ts)
 * boards and rides. They all reach the board through `world.beds`.
 */
import { STAFF } from '@/content/staff'
import { CONFIG } from '../config'
import { windowSpots } from '../er/spots'
import type { ErPatient } from '../er/patient'
import type { World } from '../er/world'
import type { LivingDay } from '../life'
import type { MedSystem } from '../meds/system'
import { planRoute, routeLength } from '../nav/graph'
import { ARRIVALS, roomById, type RoomSpec } from '../places'
import { Visitor, type Party, type Place } from '../population/visitor'
import type { Rng } from '../rng'
import type { PropKind, RoomId, Vec2 } from '../types'
import { admissionRecord, bedBook, type WarmRoom } from './bedBook'
import { BedBoard, type BedRecord, type DischargeRun } from './board'
import { Patient } from './inpatient'
import { familyFallbackSpot } from './spots'

export { BedBoard } from './board'
export type { BedAssignment, BedRecord, BedStage, BoardLog, DischargeRun, Reservation } from './board'
export { Patient } from './inpatient'
export { bedBook, dischargePlans, SIGN_LEAD_SECONDS } from './bedBook'
export type { DischargePlan, WardRecord } from './bedBook'

export interface LifeServiceDeps {
  world: World
  life: LivingDay
  meds: MedSystem
  rng: Rng
}

/** How often the slow bookkeeping runs (sim seconds). */
const POLL_SECONDS = 0.25

export class BedFlow {
  readonly board: BedBoard
  /** Families sent in to collect a patient, until they have all left. */
  private readonly families: Party[] = []
  private poll = 0

  constructor(readonly deps: LifeServiceDeps) {
    const { world, life, meds, rng } = deps
    this.board = new BedBoard(life, world, meds, rng.fork('board'))
    world.beds = this.board
    // the medicine pipeline writes orders for the patient who lies in the bed now, and visits go to occupied beds only
    meds.setOccupancy(this.board)
    world.visits.openRoom = (room) => this.board.isInBed(room)
  }

  /**
   * Who lies in a room right now, for a visitor's party: the name of the patient in the bed, or null when nobody does (the
   * bed is empty, reserved, being cleaned, or the patient has got up to go home). The Director's `occupantName` seam.
   */
  occupantName(roomId: RoomId): string | null {
    return this.board.occupantOf(roomId)?.name ?? null
  }

  /**
   * The regular medicines of the patient lying in a room (catalogue ids), or null when nobody does: the dose waves' seam
   * (`DoseWaves.occupantMeds`), so a new admission gets the medicines of their ward record and an empty bed none.
   */
  occupantMeds(roomId: RoomId): readonly string[] | null {
    return this.board.recordOf(roomId)?.usualMeds ?? null
  }

  /**
   * The day's bed numbers, including what the warm start already did (the HUD reads these instead of counting events):
   * patients gone home today and how many before noon, patients admitted to a ward bed today, ER patients boarding now
   * and the longest boarding wait (a finished one, or the longest still going).
   */
  get stats(): { dischargesToday: number; dischargesBeforeNoon: number; admissionsToday: number; boardingNow: number; longestBoardingSeconds: number } {
    const s = this.board.stats
    return {
      dischargesToday: s.discharged,
      dischargesBeforeNoon: s.dischargedBeforeNoon,
      admissionsToday: s.admitted,
      boardingNow: this.board.boardingNow,
      longestBoardingSeconds: Math.max(s.longestBoardingSeconds, this.board.longestBoardingNow(this.deps.world.t)),
    }
  }

  /** Place this service's part of the hospital in a plausible state for a start at clock hour `hour`. */
  warmStart(hour: number): void {
    const { world, meds } = this.deps
    const t = world.t
    // the sim and the machines' clock jump to the start hour before anything that has a timer is created
    world.clock.advanceTo(t * 1000)
    meds.syncClock(t)
    const day = bedBook(this.deps.rng.seed, hour)
    for (const w of day.rooms) this.warmRoom(w, t)
  }

  private warmRoom(w: WarmRoom, t: number): void {
    const { world } = this.deps
    const board = this.board
    const rec = board.get(w.roomId)
    switch (w.kind) {
      case 'occupied':
        return
      case 'signed':
      case 'leaving': {
        const doctor = STAFF.find((s) => s.role === 'doctor' && s.ward === rec.ward)
        board.sign(w.roomId, doctor?.id ?? 'doc-A', t, { kind: w.kind, elapsed: w.elapsed })
        if (w.kind === 'leaving' && rec.discharge) this.spawnFamily(rec, rec.discharge, true)
        return
      }
      case 'needsCleaning':
      case 'ready':
      case 'readmitted': {
        const plan = rec.plan
        if (plan) {
          board.stats.discharged++
          if (plan.leaveHour < 12) board.stats.dischargedBeforeNoon++
        }
        // the planned patient has gone home: out of the room without a trace (a warm start has no past to replay)
        const old = rec.person
        if (old) world.hooks.remove(old)
        if (w.kind === 'readmitted') {
          const occupant = w.occupant!
          const room = roomById(w.roomId)
          world.claimName(occupant.name)
          const seat = world.seats.byId(`bed:${room.id}`)
          const patient = new Patient(room, occupant, world.walkerFor(occupant.id))
          patient.settleInBed(seat)
          world.seats.claimId(seat.id, patient.entity.id)
          world.hooks.add(patient)
          board.warmSet(w.roomId, { stage: 'occupied', since: t - w.elapsed, person: patient, record: occupant })
          board.stats.admitted++
        } else if (w.kind === 'ready') {
          board.warmSet(w.roomId, { stage: 'ready', since: t - w.elapsed, person: null, record: null })
        } else {
          board.warmSet(w.roomId, { stage: 'needsCleaning', since: t - w.elapsed, person: null, record: null, clean: { seconds: w.cleanSeconds } })
        }
        return
      }
    }
  }

  step(t: number, dt: number): void {
    const world = this.deps.world
    // an ER patient lying in their new bed: make them a ward patient (between steps, never inside the people loop)
    while (world.bedHandovers.length > 0) this.admitToWard(world.bedHandovers.shift()!, t)
    this.poll += dt
    if (this.poll < POLL_SECONDS) return
    this.poll = 0
    this.board.step(t)
    for (const rec of this.board.rooms.values()) {
      const d = rec.discharge
      if (!d || d.familyTried || d.family) continue
      d.familySpawnAt ??= d.familyAt - this.walkSeconds(rec.roomId)
      if (t >= d.familySpawnAt) this.spawnFamily(rec, d, false)
    }
    for (let i = this.families.length - 1; i >= 0; i--) if (this.families[i].members.every((m) => m.gone)) this.families.splice(i, 1)
  }

  // --- admissions: the ER patient becomes a ward patient ---------------------------------------------------------------

  /**
   * The stretcher has slid the ER patient onto the ward bed and the porter has stepped back. The ER patient object ends
   * (without a fade: nobody sees it) and a ward patient with the same id, name, look and pose takes its place, with a ward
   * record from one of the admission profiles for their ER reason.
   */
  private admitToWard(p: ErPatient, t: number): void {
    const { world, rng } = this.deps
    const board = this.board
    const rec = board.reservationOf(p.c.id)
    if (!rec || !p.bed) {
      board.log.violations.push(`${p.c.id} reached a ward bed they were not assigned`)
      return
    }
    const room = roomById(rec.roomId)
    const seat = world.seats.byId(`bed:${room.id}`)
    const record = admissionRecord(rng.fork(`admit:${p.c.id}`), p.c.reason, p.entity.id, p.entity.name)
    const variant = p.entity.variant
    const id = p.entity.id
    p.becameInpatient = true
    world.hooks.remove(p)
    const patient = new Patient(room, record, world.walkerFor(id), { variant })
    patient.settleInBed(seat)
    world.seats.claimId(seat.id, id)
    world.hooks.add(patient)
    board.occupy(room.id, patient, record, t)
  }

  // --- the family who come to take a patient home ----------------------------------------------------------------------

  /** Seconds the family need to walk from the entrance to the room (so they reach it at `familyAt`). */
  private walkSeconds(roomId: RoomId): number {
    const room = roomById(roomId)
    return routeLength(planRoute(ARRIVALS.entrance.at, room.doorInside)) / (CONFIG.visitors.walkSpeed * 0.95) + 2
  }

  /**
   * One or two people come in at the entrance (or, for a warm start, are already in the room), go to the patient's room
   * and wait for the patient to be dressed; they leave behind them. Flagged `collecting`.
   */
  private spawnFamily(rec: BedRecord, d: DischargeRun, inRoom: boolean): void {
    const { world, rng } = this.deps
    d.familyTried = true
    const patient = rec.person
    const record = rec.record
    if (!patient || !record) return
    const room = roomById(rec.roomId)
    const vrng = rng.fork(`family:${rec.roomId}:${Math.round(d.signedAt)}`)
    const leaderId = world.id('vis')
    const pair = vrng.chance(CONFIG.visitors.pairChance)
    const partnerId = pair ? world.id('vis') : null
    const leaderPlace = this.placeFor(leaderId, room, true)
    const partnerPlace = partnerId ? this.placeFor(partnerId, room, false) : null
    const party: Party = {
      id: world.id('party'),
      room,
      patientName: record.name,
      collecting: { arrived: false, release: false, escort: () => patient.pusher ?? patient },
      phase: 'arriving',
      visitStartedAt: 0,
      visitUntil: Infinity,
      visitMinutes: 1,
      cafeUntil: Infinity,
      cafeSeats: new Map(),
      members: [],
    }
    const entrance: Vec2 = { x: ARRIVALS.entrance.at.x, z: ARRIVALS.entrance.at.z + vrng.range(-0.8, 0.8) }
    const at = inRoom ? room.doorInside : entrance
    const heading = inRoom ? Math.PI / 2 : ARRIVALS.entrance.heading
    const gift = (p: number): PropKind => (vrng.chance(p) ? 'bag' : 'none')
    const leaderName = world.uniqueName(vrng)
    const leader = new Visitor(world, world.visits, party, leaderId, leaderName, leaderPlace, at, heading, world.walkerFor(leaderId), vrng.fork(leaderId), gift(0.3))
    if (!inRoom) leader.fadeIn()
    world.hooks.add(leader)
    if (!inRoom) {
      world.say('visitorArrived', `${leaderName} arrived to collect ${record.name} from ${room.id}.`, { subjectId: leaderId, roomId: room.id })
    }
    if (partnerId && partnerPlace) {
      const name = `${world.uniqueName(vrng).split(' ')[0]} ${leaderName.split(' ')[1]}`
      const partnerAt = { x: at.x, z: at.z + (inRoom ? 0.5 : at.z > 0 ? -0.9 : 0.9) }
      const partner = new Visitor(world, world.visits, party, partnerId, name, partnerPlace, partnerAt, heading, world.walkerFor(partnerId), vrng.fork(partnerId), 'none')
      if (!inRoom) partner.fadeIn()
      world.hooks.add(partner)
    }
    d.family = party
    this.families.push(party)
  }

  /** The leader sits in the visitor chair if it is free; everyone else stands by the window, or at the room's family spot. */
  private placeFor(id: string, room: RoomSpec, leader: boolean): Place {
    const w = this.deps.world
    if (leader && w.seats.claimId(`visitor:${room.id}`, id)) return { kind: 'chair', seat: w.seats.byId(`visitor:${room.id}`) }
    const slot = w.visits.claimWindow(room.id, id)
    if (slot >= 0) return { kind: 'window', index: slot, at: windowSpots(room)[slot] }
    return { kind: 'window', index: 2, at: familyFallbackSpot(room.id) }
  }
}
