/**
 * The director: decides who arrives when (the arrival schedule) and creates the people. Walk-in patients (with their
 * companions) and ambulances for the ER, visiting parties for the ward patients, and the ambient seated people. All
 * randomness comes from forks of one Rng, so the same seed gives the same day.
 *
 * L1 (the living day): the arrival curves are the full-day tables `CONFIG.day.*` (the ER evening peak, ambulances until
 * `day.ambulanceLastHour`, the visitor dip in the quiet hour), visitors are gone by `day.visitorsLeaveByHour` except at
 * most `overnightCompanionsPerWard` per ward, and the café is closed (its seats held) outside `day.cafeHours`. A start
 * at another hour (`t0`, a Jump) begins with the visitors already mid-visit and a busier door.
 */
import { patientInRoom } from '@/content/catalogue'
import { AMBULANCE_REASONS, ER_REASONS, VISITOR_RELATIONS } from '@/content/roster'
import { STAFF } from '@/content/staff'
import { CONFIG } from '../config'
import { Companion } from '../er/companion'
import { ErPatient } from '../er/patient'
import { Paramedic } from '../er/paramedic'
import { isCafeOpen, visitingOpen } from '../day/roster'
import { headingTo, windowSpots } from '../er/spots'
import type { World } from '../er/world'
import type { Person } from '../people'
import { ARRIVALS, ROOMS, VEHICLE_AHEAD } from '../places'
import type { Rng } from '../rng'
import type { PropKind, RoomId, SeatSpec, Vec2, WardId } from '../types'
import type { Walker } from '../walker'
import { AmbientManager } from './ambient'
import { AmbulanceSchedule, ArrivalProcess, hourAt, rateAt } from './schedule'
import type { VisitBook } from './visitBook'
import { Visitor, type Party, type Place } from './visitor'

/** The ER takes no more walk-ins than this at once (a safety valve, not a tuning knob). */
const MAX_ER_CASES = 34

/** The occupant id of a café seat held by the closed sign. */
const CAFE_CLOSED = 'closed:cafe'

const FAMILY = new Set(['daughter', 'son', 'partner', 'grandson', 'granddaughter', 'brother', 'sister', 'parent'])

export class Director {
  /** Who visits which room: the world's book, shared with the families who come to collect a patient (bed flow). */
  readonly book: VisitBook
  readonly ambient: AmbientManager
  readonly parties: Party[] = []
  /** Patients created, in order (the tests and the KPIs read them). */
  walkIns = 0
  ambulances = 0
  private readonly erProcess: ArrivalProcess
  private readonly visitorProcess: ArrivalProcess
  private readonly ambulanceSchedule: AmbulanceSchedule
  private nextWalkIn: number
  private nextParty: number
  private nextAmbulance: number
  private readonly opening: number[]
  private readonly rng: Rng
  private readonly rooms = ROOMS.map((r) => r.id)
  /**
   * L1 seam for the bed-flow builder: who lies in a room right now (null: the bed is empty, nobody visits it). The default
   * is the content's inpatient, which is what M1 and M3 always did.
   */
  occupantName: (roomId: RoomId) => string | null = (roomId) => patientInRoom(roomId).name
  /** Visiting parties kept overnight (one companion per ward): their ids. */
  private readonly keepers = new Set<string>()
  private gateTimer = 0
  private readonly cafeHeld = new Set<string>()

  constructor(
    private readonly world: World,
    rng: Rng,
    private readonly walkerFor: (id: string) => Walker,
    private readonly add: (p: Person) => void,
    /** Sim time the day starts at: 0 normally, later for a warm start (L1 Jump); arrivals before it never happen. */
    private readonly t0 = 0,
  ) {
    this.book = world.visits
    this.rng = rng.fork('director')
    this.erProcess = new ArrivalProcess(rng.fork('erArrivals'), CONFIG.day.erArrivalsPerHour, t0)
    this.visitorProcess = new ArrivalProcess(rng.fork('visitorArrivals'), CONFIG.day.visitorPartiesPerHour, t0)
    this.ambulanceSchedule = new AmbulanceSchedule(rng.fork('ambulanceArrivals'), Math.min(0, t0))
    this.nextWalkIn = this.erProcess.next()
    this.nextParty = this.visitorProcess.next()
    this.nextAmbulance = t0 > 0 ? this.ambulanceSchedule.skipTo(t0) : this.ambulanceSchedule.next()
    this.opening = CONFIG.er.openingArrivals.map((s) => t0 + s)
    if (t0 !== 0) {
      // a warm start: the door is as busy as the hour says (the usual four in the first minute, then more every half minute)
      const extra = Math.min(8, Math.max(0, Math.round(rateAt(CONFIG.day.erArrivalsPerHour, hourAt(t0)) / 5) - this.opening.length))
      for (let i = 0; i < extra; i++) this.opening.push(t0 + 75 + 30 * (i + 1))
    }
    this.ambient = new AmbientManager(world, rng.fork('ambient'), walkerFor, (a) => add(a))
    world.ambient = this.ambient
  }

  /**
   * The first moments of the day: seats already have people in them. For a start at another hour (L1 Jump) the visitors are
   * already mid-visit too, and the café is open or closed as the hour says.
   */
  start(): void {
    this.gateCafe()
    this.ambient.seedStart()
    if (this.t0 !== 0) this.seedVisitors()
  }

  step(t: number, dt: number): void {
    this.gateTimer += dt
    if (this.gateTimer >= 1) {
      this.gateTimer = 0
      this.gateCafe()
      this.enforceVisitingHours(t)
    }
    while (this.opening.length > 0 && t >= this.opening[0]) {
      this.opening.shift()
      this.spawnWalkIn()
    }
    while (t >= this.nextWalkIn) {
      this.spawnWalkIn()
      this.nextWalkIn = this.erProcess.next()
    }
    if (t >= this.nextAmbulance) {
      if (this.world.crewsOnSite === 0) {
        this.spawnAmbulance()
        this.nextAmbulance = this.ambulanceSchedule.next()
      } else {
        this.nextAmbulance = t + 30
      }
    }
    while (t >= this.nextParty) {
      this.spawnParty()
      this.nextParty = this.visitorProcess.next()
    }
    this.ambient.step(t, dt)
    // forget parties whose members have all left
    for (let i = this.parties.length - 1; i >= 0; i--) if (this.parties[i].members.every((m) => m.gone)) this.parties.splice(i, 1)
  }

  /** People from visiting parties on site now. */
  get visitorsOnSite(): number {
    let n = 0
    for (const p of this.parties) for (const m of p.members) if (!m.gone) n++
    return n
  }

  // --- the ER ---------------------------------------------------------------------------------------

  private pickReason() {
    return this.rng.weighted(ER_REASONS, ER_REASONS.map((r) => CONFIG.er.reasonWeightByAcuity[r.acuity - 1]))
  }

  private entranceSpot(): Vec2 {
    return { x: ARRIVALS.entrance.at.x, z: ARRIVALS.entrance.at.z + this.rng.range(-0.8, 0.8) }
  }

  spawnWalkIn(): ErPatient | null {
    const w = this.world
    if (w.er.cases.size >= MAX_ER_CASES) return null
    const id = w.id('er')
    const name = w.uniqueName(this.rng)
    const at = this.entranceSpot()
    const patient = new ErPatient({
      world: w,
      id,
      name,
      reason: this.pickReason(),
      ambulance: false,
      at,
      heading: ARRIVALS.entrance.heading,
      walker: this.walkerFor(id),
      rng: this.rng.fork(id),
    })
    patient.fadeIn()
    this.add(patient)
    patient.start()
    this.walkIns++
    if (this.rng.chance(CONFIG.er.companionChance)) {
      const cid = w.id('comp')
      const comp = new Companion(
        w,
        patient,
        cid,
        w.uniqueName(this.rng),
        { x: at.x, z: Math.min(1.1, Math.max(-1.1, at.z + (at.z > 0 ? -0.9 : 0.9))) },
        ARRIVALS.entrance.heading,
        this.walkerFor(cid),
        this.rng.fork(cid),
      )
      comp.fadeIn()
      this.add(comp)
    }
    return patient
  }

  spawnAmbulance(): ErPatient {
    const w = this.world
    const id = w.id('er')
    const name = w.uniqueName(this.rng)
    const base = ARRIVALS.ambulance.at
    const leadAt = { x: base.x, z: base.z - 0.5 }
    const patient = new ErPatient({
      world: w,
      id,
      name,
      reason: this.rng.pick(AMBULANCE_REASONS),
      ambulance: true,
      at: leadAt,
      heading: ARRIVALS.ambulance.heading,
      walker: this.walkerFor(id),
      rng: this.rng.fork(id),
    })
    const crew: { lead: Paramedic | null; leaving: boolean } = { lead: null, leaving: false }
    const paramedics = STAFF.filter((s) => s.role === 'paramedic')
    const lead = new Paramedic(w, paramedics[0], this.walkerFor(paramedics[0].id), crew, patient, true, leadAt)
    const second = new Paramedic(w, paramedics[1], this.walkerFor(paramedics[1].id), crew, patient, false, { x: base.x, z: base.z + 0.9 })
    const h = ARRIVALS.ambulance.heading
    patient.placeAt(leadAt.x + Math.sin(h) * VEHICLE_AHEAD.stretcher, leadAt.z + Math.cos(h) * VEHICLE_AHEAD.stretcher, h)
    patient.startRiding(lead, 'stretcher')
    w.attach(lead, patient)
    for (const p of [patient, lead, second]) {
      p.fadeIn()
      this.add(p)
    }
    patient.start()
    w.crewsOnSite++
    this.ambulances++
    return patient
  }

  // --- visitors ----------------------------------------------------------------------------------------

  /**
   * A visiting party arrives. `opts` is for a start at another hour (L1): `ward` limits the rooms, `solo` makes it one person
   * (an overnight companion), `quiet` leaves out the "arrived" sentence (they were already here). `lounge` (S1 showcase)
   * seats the whole party in the wing's lounge (loungeA / quietB), as overflow visitors would sit.
   */
  spawnParty(opts: { ward?: WardId; solo?: boolean; quiet?: boolean; lounge?: boolean } = {}): Party | null {
    const w = this.world
    if (this.visitorsOnSite >= CONFIG.visitors.maxOnSite) return null
    const order = this.rng.shuffle([...this.rooms])
    // only a bed with somebody in it is visited (L1: the bed flow decides who that is)
    const roomId = this.book.leastVisited(order.filter((r) => this.occupantName(r) !== null && (opts.ward === undefined || r.startsWith(opts.ward))))
    if (!roomId) return null
    const room = ROOMS.find((r) => r.id === roomId)!
    const leaderId = w.id('vis')
    const pair = this.rng.chance(CONFIG.visitors.pairChance) && !opts.solo
    const partnerId = pair ? w.id('vis') : null
    const leaderPlace = opts.lounge ? this.loungeFor(leaderId, room) : this.placeFor(leaderId, room, true)
    if (!leaderPlace) return null
    const partnerPlace = partnerId ? (opts.lounge ? this.loungeFor(partnerId, room) : this.placeFor(partnerId, room, false)) : null

    const patientName = this.occupantName(room.id) ?? patientInRoom(room.id).name
    const party: Party = {
      id: w.id('party'),
      room,
      patientName,
      phase: 'arriving',
      visitStartedAt: 0,
      visitUntil: Infinity,
      visitMinutes: 1,
      cafeUntil: Infinity,
      cafeSeats: new Map<string, SeatSpec>(),
      members: [],
    }
    this.book.addParty(room.id)
    const at = this.entranceSpot()
    const gift = (p: number, kinds: PropKind[]): PropKind => (this.rng.chance(p) ? this.rng.pick(kinds) : 'none')
    const leaderName = w.uniqueName(this.rng)
    const leader = new Visitor(
      w, this.book, party, leaderId, leaderName, leaderPlace, at, ARRIVALS.entrance.heading, this.walkerFor(leaderId), this.rng.fork(leaderId),
      gift(CONFIG.visitors.giftChance, ['flowers', 'bag']),
    )
    leader.fadeIn()
    this.add(leader)
    if (!opts.quiet) w.say('visitorArrived', `${leaderName} arrived to visit ${patientName} in ${room.id}.`, { subjectId: leaderId, roomId: room.id })
    if (partnerId && partnerPlace) {
      const relation = this.rng.pick(VISITOR_RELATIONS)
      let name = w.uniqueName(this.rng)
      if (FAMILY.has(relation)) name = `${name.split(' ')[0]} ${leaderName.split(' ')[1]}`
      const partner = new Visitor(
        w, this.book, party, partnerId, name, partnerPlace, { x: at.x, z: at.z + (at.z > 0 ? -0.9 : 0.9) }, ARRIVALS.entrance.heading,
        this.walkerFor(partnerId), this.rng.fork(partnerId), gift(0.2, ['bag']),
      )
      partner.fadeIn()
      this.add(partner)
    }
    this.parties.push(party)
    return party
  }

  // --- the hours of the day (L1) ---------------------------------------------------------------------

  /** Clock hour 0..24 for a sim time. */
  private hourOfDay(t: number): number {
    return (((hourAt(t) % 24) + 24) % 24)
  }

  /**
   * The café: outside `day.cafeHours` every café seat is held by the closed sign (so nobody sits there, and a visitor who
   * would have a coffee goes straight home), and parties still having coffee are sent on their way.
   */
  private gateCafe(): void {
    const seats = this.world.seats
    const t = this.world.t
    if (isCafeOpen(this.hourOfDay(t))) {
      if (this.cafeHeld.size > 0) {
        for (const id of this.cafeHeld) seats.release(id, CAFE_CLOSED)
        this.cafeHeld.clear()
      }
      return
    }
    for (const seat of seats.free({ kind: 'cafe' })) if (seats.claimId(seat.id, CAFE_CLOSED)) this.cafeHeld.add(seat.id)
    for (const party of this.parties) if (party.phase === 'cafe' && party.cafeUntil > t) party.cafeUntil = t
  }

  /**
   * Visiting hours end at `day.visitorsLeaveByHour`: every visit ends now, except at most `overnightCompanionsPerWard` solo
   * companions per ward, who stay at the bedside all night. An hour earlier the keepers are picked among the solo visitors
   * sitting at a bedside, so somebody is there to stay. When visiting opens again they go home too.
   */
  private enforceVisitingHours(t: number): void {
    const h = this.hourOfDay(t)
    const evening = h >= CONFIG.day.visitorsLeaveByHour - 1
    if (!evening && visitingOpen(h)) {
      if (this.keepers.size > 0) {
        for (const party of this.parties) if (this.keepers.has(party.id)) party.visitUntil = t + this.rng.range(60, 600)
        this.keepers.clear()
      }
      return
    }
    this.chooseKeepers()
    const closed = !visitingOpen(h)
    for (const party of this.parties) {
      if (this.keepers.has(party.id)) {
        if (party.phase === 'visit') party.visitUntil = Infinity
      } else if (closed) {
        if (party.phase === 'visit' && party.visitUntil > t) party.visitUntil = t
        else if (party.phase === 'cafe' && party.cafeUntil > t) party.cafeUntil = t
      }
    }
  }

  /** A ward without a keeper yet gets one: the first solo visitor sitting in a bedside chair. */
  private chooseKeepers(): void {
    for (const ward of ['A', 'B'] as const) {
      let have = 0
      for (const party of this.parties) if (this.keepers.has(party.id) && party.room.ward === ward) have++
      for (const party of this.parties) {
        if (have >= CONFIG.day.overnightCompanionsPerWard) break
        const leader = party.members[0]
        if (this.keepers.has(party.id) || party.room.ward !== ward || party.phase !== 'visit') continue
        if (party.members.length === 1 && leader && !leader.gone && leader.place.kind === 'chair') {
          this.keepers.add(party.id)
          have++
        }
      }
    }
  }

  /** A start at another hour: the visitors who would be on the wards by then are already at their bedsides. */
  private seedVisitors(): void {
    const h = hourAt(this.t0)
    const wrapped = this.hourOfDay(this.t0)
    if (!visitingOpen(wrapped)) {
      // the night: one companion per ward, now and then
      for (const ward of ['A', 'B'] as const) {
        if (!this.rng.chance(0.75)) continue
        const party = this.spawnParty({ ward, solo: true, quiet: true })
        if (!party) continue
        this.keepers.add(party.id)
        this.placeMidVisit(party)
      }
      return
    }
    // people on site = parties arriving per hour x about 24 min (visit, then coffee for some)
    const rate = Math.max(rateAt(CONFIG.day.visitorPartiesPerHour, h), rateAt(CONFIG.day.visitorPartiesPerHour, h - 0.25))
    for (let i = 0, n = Math.round(rate * 0.4); i < n; i++) {
      const party = this.spawnParty({ quiet: true })
      if (!party) break
      this.placeMidVisit(party)
    }
  }

  /**
   * S1 showcase opening (07:30, t0 = 0): `CONFIG.opening.visitorParties` early parties are already mid-visit when the
   * hospital fades in, so the bedside chairs and the ward lounges show visitors. Quiet (no "arrived" lines); they leave the
   * normal way. Later warm starts do this through `seedVisitors` instead. Returns how many parties were placed.
   */
  seedOpening(): number {
    if (this.t0 !== 0) return 0
    let placed = 0
    for (let i = 0; i < CONFIG.opening.visitorParties; i++) {
      const party = this.spawnParty({ quiet: true })
      if (!party) break
      this.placeMidVisit(party)
      placed++
    }
    // and one party in each wing's lounge (loungeA, quietB), so those rooms are not empty at the opening either
    for (const ward of ['A', 'B'] as WardId[]) {
      const party = this.spawnParty({ ward, quiet: true, lounge: true })
      if (!party) continue
      this.placeMidVisit(party)
      placed++
    }
    return placed
  }

  /** Put a party that has just been created where its visit is (at the bedside already), and let the visit begin. */
  private placeMidVisit(party: Party): void {
    for (const m of party.members) {
      const pl = m.place
      if (pl.kind === 'window') m.placeAt(pl.at.x, pl.at.z, headingTo(pl.at, party.room.bed))
      else m.placeAt(pl.seat.approach.x, pl.seat.approach.z, pl.seat.heading)
    }
  }

  /** S1: a seat in the wing's lounge. */
  private loungeFor(id: string, room: (typeof ROOMS)[number]): Place | null {
    const lounge = this.world.seats.claim(id, { kind: 'lounge', area: room.ward === 'A' ? 'loungeA' : 'quietB' })
    return lounge ? { kind: 'lounge', seat: lounge } : null
  }

  /** The leader gets the visitor chair if it is free; everyone else the window, then the wing's lounge. */
  private placeFor(id: string, room: (typeof ROOMS)[number], leader: boolean): Place | null {
    const w = this.world
    if (leader && w.seats.claimId(`visitor:${room.id}`, id)) return { kind: 'chair', seat: w.seats.byId(`visitor:${room.id}`) }
    const slot = this.book.claimWindow(room.id, id)
    if (slot >= 0) return { kind: 'window', index: slot, at: windowSpots(room)[slot] }
    const lounge = w.seats.claim(id, { kind: 'lounge', area: room.ward === 'A' ? 'loungeA' : 'quietB' })
    if (lounge) return { kind: 'lounge', seat: lounge }
    return null
  }
}
