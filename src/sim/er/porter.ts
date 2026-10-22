/**
 * Porter: takes jobs from the PorterBoard (admissions first), fetches the patient with a wheelchair or stretcher,
 * pushes them to the destination and returns to the porter base beside the lobby spine. When idle (and another
 * porter is free) a porter sometimes pushes a linen cart from the clean supply room to a ward corridor and back, and
 * drops the cart at once if a patient job is waiting and nobody else can take it.
 *
 *   idle -> toPickup (pushing the empty vehicle) -> loading -> pushing -> unloading -> idle / next job
 *   W4 blood draws: a patient whose bloods go through the draw centre is pushed to a holding spot in the draw room (drawHold) and waits
 *   there, on the wheelchair, until a robot is called for them; then they are pushed to that robot's chair and lifted onto it
 *   idle -> linenGet -> linenOut -> linenDrop -> linenBack -> idle
 *
 * L1 bed flow adds, after the ER jobs in priority:
 *   admit to a ward bed   the same 'admit' job, but the stretcher goes into the room and the patient slides onto the bed
 *   wheelchair home       wcTo (empty wheelchair to the room) -> wcWait -> wcLoading -> wcPush (to the entrance) -> wcUnload
 *   fresh linen           linGet (cart at the clean supply room) -> linOut (to the room) -> linWork (make the bed)
 */
import type { StaffMember } from '@/content/staff'
import { staffName } from '@/content/staff'
import { bloodText } from '@/content/bloodCopy'
import { ER_EVENTS, erLine } from '@/content/erEvents'
import { CONFIG } from '../config'
import { linenSpot, porterSpot } from '../beds/spots'
import type { PeopleContext } from '../person'
import { DEPARTURES } from '../places'
import type { Rng } from '../rng'
import type { RoomId, SeatSpec, Vec2 } from '../types'
import type { Walker } from '../walker'
import { Actor } from './actor'
import type { Patient } from '../beds/inpatient'
import type { ErPatient } from './patient'
import type { PorterJob } from './porterBoard'
import { headingTo, LINEN_DROPS, LINEN_PICKUP, PORTER_BASES, type Post } from './spots'
import type { World } from './world'


type State =
  | 'idle'
  | 'toPickup'
  | 'loading'
  | 'pushing'
  | 'drawHold'
  | 'unloading'
  | 'returning'
  | 'linenGet'
  | 'linenOut'
  | 'linenDrop'
  | 'linenBack'
  | 'wcTo'
  | 'wcWait'
  | 'wcLoading'
  | 'wcPush'
  | 'wcUnload'
  | 'linGet'
  | 'linOut'
  | 'linWork'

export class Porter extends Actor {
  private state: State = 'idle'
  private job: PorterJob | null = null
  private patient: ErPatient | null = null
  private timer = 0
  private idleFor = 0
  private linenAt: Vec2 = LINEN_PICKUP
  /** S1 showcase: the opening's linen run loads its cart in the clean supply room until this sim time. */
  private loadUntil = -Infinity
  /** The ward room of the bed-flow errand in progress (a wheelchair home or fresh linen). */
  private errandRoom: RoomId | null = null
  /** The patient being taken home by wheelchair (the bed board forgets them once they are out of the room). */
  private errandPatient: Patient | null = null
  private readonly base: Post

  constructor(
    readonly world: World,
    readonly staff: StaffMember,
    readonly index: number,
    walker: Walker,
    private readonly srng: Rng,
  ) {
    super(staff.id, 'porter', staff.name, PORTER_BASES[index].at, PORTER_BASES[index].heading, walker, 'role')
    this.base = PORTER_BASES[index]
    this.cruise = CONFIG.er.wheelSpeed
    this.world.idlePorters.add(staff.id)
  }

  get busy(): boolean {
    return this.state !== 'idle' && this.state !== 'returning'
  }

  think(dt: number, _ctx: PeopleContext): void {
    switch (this.state) {
      case 'idle':
        this.entity.anim = 'idle'
        this.idleFor += dt
        if (this.due(dt)) {
          if (!this.takeJob()) this.maybeLinen()
        }
        break
      case 'returning':
        if (this.due(dt) && this.takeJob()) break
        if (this.state === 'returning' && this.done) {
          this.stand(this.base.heading)
          this.world.idlePorters.add(this.staff.id)
          this.idleFor = 0
          this.state = 'idle'
        }
        break
      case 'toPickup': {
        if (!this.done) break
        const p = this.patient!
        // on the way back from a scan the table may still be moving: wait until the patient can be collected
        if (!p.pickupReady(this.job!.kind)) {
          this.entity.anim = 'push'
          break
        }
        const seat = this.pickupSeat(p)
        if (seat) this.walker.face(headingTo(this.pos, seat))
        this.entity.anim = 'give'
        p.loadOn(this, this.vehicleFor(this.job!, p))
        this.announce(p)
        this.state = 'loading'
        break
      }
      case 'loading': {
        const p = this.patient!
        if (!p.mounted) break
        this.timer += dt
        if (this.timer < CONFIG.er.loadSeconds) break
        // R2: a patient admitted "to a ward upstairs" is faded at a lift lobby: wait (loaded, in the bay) until that lobby's stretcher slot is free,
        // so a lobby never holds two stretchers or a stretcher and a MealBot (the lifts' LobbyGate)
        if (this.job!.kind === 'admit' && p.bed === null && !this.claimLift(p)) break
        this.timer = 0
        this.entity.anim = 'push'
        this.cruise = CONFIG.er.wheelSpeed
        const dest = this.destination(p)
        this.moveTo(dest.at, { face: dest.face })
        this.state = 'pushing'
        break
      }
      case 'pushing':
        if (this.done) {
          const p = this.patient!
          if (this.job!.kind === 'toDiagnostics' && p.liveBlood && p.labSeat === null) {
            // W4: at the draw room's holding spot: the patient may now be called, the porter waits with them
            this.entity.anim = 'push'
            p.drawArrived()
            this.state = 'drawHold'
            break
          }
          this.entity.anim = 'give'
          this.timer = 0
          this.unload(p)
          this.state = 'unloading'
        }
        break
      case 'drawHold': {
        const p = this.patient!
        const chair = p.labSeat
        if (chair !== null) {
          // a robot was called for them: on to its chair
          this.moveTo(chair.approach, { face: headingTo(chair.approach, chair) })
          this.state = 'pushing'
        }
        break
      }
      case 'unloading': {
        const p = this.patient!
        // a patient discharged while still riding back from a scan never settles on a seat: `gone` ends the job too
        const finished = this.job!.kind === 'admit' && p.bed === null ? p.gone : (p.settled && p.seat !== null) || p.gone
        if (!finished) break
        this.timer += dt
        if (this.timer < 0.4) break
        this.finishJob()
        break
      }
      case 'wcTo':
        if (this.done) {
          this.world.beds?.wheelchairHere(this.errandRoom!)
          this.entity.anim = 'push'
          this.state = 'wcWait'
        }
        break
      case 'wcWait': {
        const p = this.world.beds?.get(this.errandRoom!).person ?? null
        // the patient walks to the chair and waits next to it; then they get on
        if (p && p.readyForChair) {
          this.faceTowards(p.pos)
          this.entity.anim = 'give'
          p.loadOnWheelchair(this)
          this.errandPatient = p
          this.timer = 0
          this.state = 'wcLoading'
        }
        break
      }
      case 'wcLoading': {
        const p = this.errandPatient!
        if (!p.mounted) break
        this.timer += dt
        if (this.timer < CONFIG.er.loadSeconds) break
        this.timer = 0
        this.entity.anim = 'push'
        this.cruise = CONFIG.er.wheelSpeed
        this.moveTo(DEPARTURES.entrance)
        this.state = 'wcPush'
        break
      }
      case 'wcPush':
        if (this.done) {
          this.entity.anim = 'give'
          this.timer = 0
          this.errandPatient!.unloadAtExit()
          this.state = 'wcUnload'
        }
        break
      case 'wcUnload': {
        const p = this.errandPatient!
        if (!p.settled) break
        this.timer += dt
        if (this.timer < 0.4) break
        this.finishErrand()
        break
      }
      case 'linGet':
        if (this.done) {
          this.setVehicle('linenCart')
          const s = linenSpot(this.errandRoom!)
          this.moveTo(s.at, { face: s.heading })
          this.state = 'linOut'
        }
        break
      case 'linOut':
        if (this.done) {
          this.entity.anim = 'give'
          this.timer = this.srng.between(CONFIG.beds.linenSeconds)
          this.state = 'linWork'
        }
        break
      case 'linWork':
        this.timer -= dt
        if (this.timer <= 0) {
          this.world.beds?.linenDelivered(this.errandRoom!, this.world.t)
          this.finishErrand()
        }
        break
      case 'linenGet':
        if (this.due(dt) && this.world.porters.pending > 0 && this.takeJob()) {
          this.world.linenRun = false
          break
        }
        if (this.state === 'linenGet' && this.done && this.world.t < this.loadUntil) {
          this.entity.anim = 'give'
          break
        }
        if (this.state === 'linenGet' && this.done) {
          this.setVehicle('linenCart')
          this.walkAnim = 'push'
          this.idleAnim = 'push'
          this.cruise = CONFIG.er.wheelSpeed
          this.moveTo(this.linenAt)
          this.state = 'linenOut'
        }
        break
      case 'linenOut':
        if (this.due(dt) && this.world.porters.pending > 0 && this.world.idlePorters.size === 0) this.dropCart()
        else if (this.done) {
          this.entity.anim = 'give'
          this.timer = this.srng.between(CONFIG.staffLife.linenDropSeconds)
          this.state = 'linenDrop'
        }
        break
      case 'linenDrop':
        this.timer -= dt
        if (this.timer <= 0) {
          this.moveTo(LINEN_PICKUP)
          this.state = 'linenBack'
        }
        break
      case 'linenBack':
        if (this.due(dt) && this.world.porters.pending > 0 && this.world.idlePorters.size === 0) this.dropCart()
        else if (this.done) {
          this.dropCart()
        }
        break
    }
  }

  // --- jobs -------------------------------------------------------------------------------------------

  private takeJob(): boolean {
    const job = this.world.porters.claim(this.staff.id)
    if (!job) return this.takeErrand()
    const patient = this.world.patients.get(job.caseId)
    if (!patient) {
      this.world.porters.complete(job)
      return this.takeErrand()
    }
    this.job = job
    this.patient = patient
    patient.c.porterId = this.staff.id
    this.world.idlePorters.delete(this.staff.id)
    this.setVehicle(this.vehicleFor(job, patient))
    this.walkAnim = 'push'
    this.idleAnim = 'push'
    this.cruise = CONFIG.er.wheelSpeed * 1.2
    const seat = this.pickupSeat(patient)
    if (!seat) {
      // nothing to fetch from (should not happen): give the job back by finishing it
      this.finishJob()
      return false
    }
    this.moveTo(seat.approach, { face: headingTo(seat.approach, seat) })
    this.timer = 0
    this.state = 'toPickup'
    return true
  }

  /** After the ER jobs: a wheelchair for a patient going home, then fresh linen for a room being cleaned. */
  private takeErrand(): boolean {
    const board = this.world.beds
    if (!board) return false
    const chair = board.claimWheelchair()
    if (chair !== null) {
      this.errandRoom = chair
      this.world.idlePorters.delete(this.staff.id)
      this.setVehicle('wheelchair')
      this.walkAnim = 'push'
      this.idleAnim = 'push'
      this.cruise = CONFIG.er.wheelSpeed * 1.2
      const s = porterSpot(chair)
      this.moveTo(s.at, { face: s.heading })
      this.state = 'wcTo'
      return true
    }
    const linen = board.claimLinen()
    if (linen !== null) {
      this.errandRoom = linen
      this.world.idlePorters.delete(this.staff.id)
      this.setVehicle('none')
      this.walkAnim = 'push'
      this.idleAnim = 'push'
      this.cruise = CONFIG.er.wheelSpeed * 1.2
      this.moveTo(LINEN_PICKUP)
      this.state = 'linGet'
      return true
    }
    return false
  }

  private finishErrand(): void {
    this.errandRoom = null
    this.errandPatient = null
    this.setVehicle('none')
    this.walkAnim = 'walk'
    this.idleAnim = 'idle'
    this.cruise = CONFIG.people.walkSpeed
    this.timer = 0
    this.entity.anim = 'idle'
    if (!this.takeJob()) {
      this.moveTo(this.base.at, { face: this.base.heading })
      this.state = 'returning'
    }
  }

  private vehicleFor(job: PorterJob, p: ErPatient | null = this.patient): 'wheelchair' | 'stretcher' {
    if (job.kind === 'admit') return 'stretcher'
    if ((job.kind === 'toImaging' || job.kind === 'fromImaging') && p !== null) return p.scanVehicle
    return 'wheelchair'
  }

  private pickupSeat(p: ErPatient): SeatSpec | null {
    switch (this.job!.kind) {
      case 'fromDiagnostics':
        return p.labSeat
      case 'fromImaging':
        return p.scanSeat
      default:
        return p.baySeat
    }
  }

  private destination(p: ErPatient): { at: Vec2; face?: number } {
    switch (this.job!.kind) {
      case 'toDiagnostics': {
        const s = p.labSeat
        if (s) return { at: s.approach, face: headingTo(s.approach, s) }
        // W4: no robot called yet: the draw room's holding spot
        const hold = this.world.blood!.claimHold(p.c.id)
        return { at: hold.at, face: hold.heading }
      }
      case 'fromDiagnostics':
      case 'fromImaging': {
        const s = p.baySeat!
        return { at: s.approach, face: headingTo(s.approach, s) }
      }
      case 'toImaging': {
        const s = p.scanSeat!
        return { at: s.approach, face: headingTo(s.approach, s) }
      }
      case 'admit': {
        if (!p.bed) return { at: this.world.liftFor(p.pos) }
        const s = porterSpot(p.bed.roomId)
        return { at: s.at, face: s.heading }
      }
    }
  }

  private unload(p: ErPatient): void {
    switch (this.job!.kind) {
      case 'toDiagnostics':
        p.unloadAtLab()
        break
      case 'toImaging':
        p.unloadAtScanner()
        break
      case 'fromDiagnostics':
      case 'fromImaging':
        p.unloadAtBay()
        break
      case 'admit':
        if (p.bed) p.unloadAtBed()
        else p.fadeAtLift()
        break
    }
  }

  private announce(p: ErPatient): void {
    const w = this.world
    const me = staffName(this.staff.id)
    const name = p.c.name
    switch (this.job!.kind) {
      case 'toDiagnostics':
        if (p.liveBlood) w.say('porterJob', bloodText('porterToDraw', { porter: me, name }), { subjectId: p.c.id, actorId: this.staff.id })
        else w.say('porterJob', erLine('porter.toDiagnostics', { porter: me, patient: name }), { subjectId: p.c.id, actorId: this.staff.id })
        break
      case 'toImaging':
        w.say('porterJob', erLine('porter.toImaging', { porter: me, patient: name, place: ER_EVENTS.scanPlaces[p.booking?.modality ?? 'ct'] }), { subjectId: p.c.id, actorId: this.staff.id })
        break
      case 'fromDiagnostics':
      case 'fromImaging':
        if (this.job!.kind === 'fromDiagnostics' && p.liveBlood && p.loungeActive) w.say('porterJob', bloodText('porterToLounge', { porter: me, name }), { subjectId: p.c.id, actorId: this.staff.id })
        else if (this.job!.kind === 'fromDiagnostics' && p.liveBlood) w.say('porterJob', bloodText('porterFromDraw', { porter: me, name, bay: p.c.bay + 1 }), { subjectId: p.c.id, actorId: this.staff.id })
        else w.say('porterJob', erLine('porter.fromImaging', { porter: me, patient: name, bay: p.c.bay + 1 }), { subjectId: p.c.id, actorId: this.staff.id })
        break
      case 'admit':
        if (p.bed) w.say('porterJob', erLine('porter.toRoom', { porter: me, patient: name, room: p.bed.roomId }), { subjectId: p.c.id, actorId: this.staff.id, roomId: p.bed.roomId })
        else w.say('porterJob', erLine('porter.toLift', { porter: me, patient: name }), { subjectId: p.c.id, actorId: this.staff.id })
        break
    }
  }

  /** R2: hold the stretcher slot of the lift lobby the patient is taken to (true when held, or when there are no lifts). */
  private claimLift(p: ErPatient): boolean {
    const lifts = this.world.lifts
    if (lifts === null) return true
    return lifts.claimFade(this.world.liftFor(p.pos).z < 0 ? 'A' : 'B', 1, this.staff.id)
  }

  private finishJob(): void {
    this.world.lifts?.releaseFade(this.staff.id)
    const job = this.job
    // a patient slid onto their ward bed: the bed flow makes them a ward patient on its next step
    if (job && job.kind === 'admit' && this.patient?.bed && !this.patient.handedToBed && this.patient.settled && this.patient.seat !== null) {
      this.patient.handedToBed = true
      this.world.bedHandovers.push(this.patient)
    }
    if (job) this.world.porters.complete(job)
    if (this.patient) this.patient.c.porterId = null
    this.job = null
    this.patient = null
    this.setVehicle('none')
    this.walkAnim = 'walk'
    this.idleAnim = 'idle'
    this.cruise = CONFIG.people.walkSpeed
    this.timer = 0
    this.entity.anim = 'idle'
    if (!this.takeJob()) {
      this.moveTo(this.base.at, { face: this.base.heading })
      this.state = 'returning'
    }
  }

  // --- linen runs ---------------------------------------------------------------------------------------

  /**
   * S1 showcase opening: this porter is already in the clean supply room, loading a linen cart until `until`, then runs it
   * as any linen run (a job that comes up first still wins). False if they are busy or another linen run is under way.
   */
  warmLinenRun(until: number): boolean {
    if (this.state !== 'idle' || this.world.linenRun) return false
    this.world.idlePorters.delete(this.staff.id)
    this.world.linenRun = true
    this.linenAt = this.srng.pick(LINEN_DROPS)
    this.loadUntil = until
    this.placeAt(LINEN_PICKUP.x, LINEN_PICKUP.z, Math.PI)
    this.moveTo(LINEN_PICKUP)
    this.state = 'linenGet'
    return true
  }

  private maybeLinen(): void {
    if (this.idleFor < 45 || this.world.idlePorters.size < 2 || this.world.linenRun) return
    this.idleFor = 0
    if (!this.srng.chance(CONFIG.staffLife.linenRunChance)) return
    this.world.idlePorters.delete(this.staff.id)
    this.world.linenRun = true
    this.linenAt = this.srng.pick(LINEN_DROPS)
    this.moveTo(LINEN_PICKUP)
    this.state = 'linenGet'
  }

  /** Leave the cart where it stands and go back to the base (or straight to a waiting job). */
  private dropCart(): void {
    this.world.linenRun = false
    this.setVehicle('none')
    this.walkAnim = 'walk'
    this.idleAnim = 'idle'
    this.cruise = CONFIG.people.walkSpeed
    if (!this.takeJob()) {
      this.moveTo(this.base.at, { face: this.base.heading })
      this.state = 'returning'
    }
  }
}
