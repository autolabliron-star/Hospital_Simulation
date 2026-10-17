/**
 * The ward patient: whoever lies in a bed right now. One class for the sixteen patients of the M1 morning, for patients
 * admitted from the ER (a stretcher is slid onto the bed and the ER patient becomes a ward patient with the same id and
 * name), and for the warm start's synthetic admissions. It is an Actor, so it can get up, walk, fade, and ride a wheelchair.
 *
 * In bed it lies still: a heart when the medicines arrive or a visitor sits down, and the bed head raised ('recline') while
 * the room's `RoomStatus.recline` is above one half (the meals builder animates that value; the pose is set here).
 *
 * A planned discharge is run by the xstate machine of discharge.machine.ts, started by the bed board when the doctor signs:
 * the take-home medicines (a bag in hand), the family, changing in the bathroom pod (fade out and in, gown to everyday
 * clothes) and then out of the building on foot with the family or by porter wheelchair. The patient is the machine's host.
 */
import { CONFIG } from '../config'
import { Actor } from '../er/actor'
import type { World } from '../er/world'
import type { PeopleContext } from '../person'
import { DEPARTURES, type RoomSpec } from '../places'
import type { RoomId, SeatSpec } from '../types'
import type { Walker } from '../walker'
import type { WardRecord } from './bedBook'
import type { DischargeRun } from './board'
import { createDischarge, type DischargeActor, type DischargeContext, type DischargeHost, type DischargeState } from './discharge.machine'
import { bathroomSpot, chairSpot } from './spots'

export interface PatientOptions {
  /** Keep this look (the ER patient's variation) instead of deriving one from the id. */
  variant?: number
}

export class Patient extends Actor implements DischargeHost {
  readonly roomId: RoomId
  readonly room: RoomSpec
  record: WardRecord
  /** The discharge journey, once the doctor has signed. */
  run: DischargeRun | null = null
  dState: DischargeState | null = null
  private world: World | null = null
  private dis: DischargeActor | null = null
  private medsSent = false
  private familySent = false
  private vacated = false
  private exitUnloaded = false

  constructor(room: RoomSpec, record: WardRecord, walker: Walker, opts: PatientOptions = {}) {
    super(record.id, 'patient', record.name, room.bed, room.bedHeading, walker, 'gown')
    this.room = room
    this.roomId = room.id
    this.record = record
    if (opts.variant !== undefined) this.entity.variant = opts.variant
    this.entity.anim = 'lie'
    this.entity.roomId = room.id
    this.entity.mood = 'unwell'
    this.entity.seated = { seatId: `bed:${room.id}`, pose: 'lie' }
  }

  /** In a ward bed: lying on it (not yet up for the discharge). */
  get inBed(): boolean {
    return this.entity.seated !== undefined && this.entity.seated.seatId === `bed:${this.roomId}`
  }

  /** A patient lies in a bed: lifting the bed head, a quiet face. Called by the ER hand-over after the slide. */
  settleInBed(seat: SeatSpec): void {
    this.placeOnSeat(seat)
    this.entity.roomId = this.roomId
    this.entity.mood = 'unwell'
  }

  relieved(ctx: PeopleContext): void {
    this.entity.mood = 'happy'
    this.emote(ctx, 'heart', 8)
  }

  /** A visitor is at the bedside: a heart, now and then. */
  visited(ctx: PeopleContext): void {
    this.entity.mood = 'happy'
    this.emote(ctx, 'heart', 5)
  }

  // --- the discharge journey ------------------------------------------------------------------------------------

  /**
   * The doctor has signed (the bed board calls this). `warm`: the medicines are already given and the family is already
   * in the room (a warm start in the middle of a discharge): the patient goes straight to changing.
   */
  beginDischarge(run: DischargeRun, world: World, o: { changeSeconds: number; warm?: boolean }): void {
    this.world = world
    this.run = run
    const warm = o.warm === true
    if (warm) {
      this.medsSent = true
      this.familySent = true
      this.entity.prop = 'bag'
    }
    this.dis = createDischarge(
      { host: this, changeSeconds: o.changeSeconds, wheelchair: this.record.leavesBy === 'wheelchair', medsGiven: warm, familyHere: warm },
      world.clock,
    )
  }

  /** The discharge machine entered a state: do what it means in the room. */
  enter(state: DischargeState, _ctx: DischargeContext): void {
    this.dState = state
    const w = this.world
    if (!w) return
    switch (state) {
      case 'changing.standing': {
        const bed = w.seats.byId(`bed:${this.roomId}`)
        this.seat = bed
        w.seats.release(bed.id, this.entity.id)
        w.beds?.beginLeaving(this.roomId, w.t)
        this.entity.mood = 'happy'
        this.showEmote('check', w.t, 6)
        this.standUp()
        break
      }
      case 'changing.walking': {
        const s = bathroomSpot(this.roomId)
        this.moveTo(s.at, { face: s.heading })
        break
      }
      case 'changing.inside':
        // into the bathroom pod: fade out where the door is, stay in the simulation, invisible
        this.entity.emote = 'none'
        this.fadeOut(true)
        break
      case 'changing.out':
        // out of the pod in everyday clothes, the take-home bag in hand
        this.entity.outfit = 'everyday'
        this.entity.prop = 'bag'
        this.entity.anim = 'idle'
        this.fadeIn()
        break
      case 'leave.walking':
        this.cruise = Math.max(this.cruise, CONFIG.er.walkSpeed)
        this.showEmote('check', w.t, 8)
        this.moveTo(DEPARTURES.entrance)
        break
      case 'leave.wheelchairWaiting': {
        const c = chairSpot(this.roomId)
        this.moveTo(c)
        w.beds?.askWheelchair(this.roomId)
        break
      }
      case 'leave.fading':
        w.beds?.wentHome(this.roomId, this.record, w.t)
        this.entity.prop = 'none'
        this.showEmote('check', w.t, 8)
        this.fadeOut()
        break
      default:
        break
    }
  }

  /** The porter with the wheelchair is here and the patient is next to it: get on. */
  loadOnWheelchair(pusher: Actor): void {
    this.world!.attach(pusher, this)
    this.mountOn(pusher, 'wheelchair')
  }

  /** At the entrance: get off the wheelchair (the porter calls this). */
  unloadAtExit(): void {
    this.world!.detach(this)
    this.dismount(this.walker.x, this.walker.z, this.walker.heading, null)
    this.exitUnloaded = true
  }

  /** Waiting at the chair spot for the porter (so he may load them). */
  get readyForChair(): boolean {
    return this.dState === 'leave.wheelchairWaiting' && this.mode === 'static' && this.done
  }

  get mounted(): boolean {
    return this.mode === 'ride' && this.done
  }

  /** Off every vehicle and standing. */
  get settled(): boolean {
    return this.mode === 'static' && this.done && this.pusher === null
  }

  // --- per step -------------------------------------------------------------------------------------------------

  think(dt: number, ctx: PeopleContext): void {
    if (this.entity.mood === 'happy' && this.entity.emote === 'none' && this.dState === null && ctx.t > this.emoteUntil + 120) this.entity.mood = 'neutral'
    if (this.dState === null) {
      this.thinkBed(ctx)
      return
    }
    const dis = this.dis
    if (!dis) return
    const run = this.run!
    switch (this.dState) {
      case 'signed':
        this.thinkBed(ctx)
        if (!this.due(dt, 0.5)) break
        if (!this.medsSent && this.takeHomeDone(ctx)) {
          this.medsSent = true
          this.entity.prop = 'bag'
          this.entity.mood = 'happy'
          this.emote(ctx, 'heart', 6)
          dis.send({ type: 'MEDS_GIVEN' })
        }
        if (!this.familySent && this.familyIsHere(ctx.t, run)) {
          this.familySent = true
          dis.send({ type: 'FAMILY_HERE' })
        }
        break
      case 'changing.standing':
      case 'changing.walking':
        if (this.done) dis.send({ type: this.dState === 'changing.standing' ? 'STOOD' : 'AT_BATH' })
        break
      case 'changing.out':
        if (this.visibleFully) {
          const c = run.family?.collecting
          if (c) c.release = true
          dis.send({ type: 'DRESSED' })
        }
        break
      case 'leave.walking':
        this.checkLeftRoom(ctx)
        if (this.done && !this.fadingOut) dis.send({ type: 'AT_EXIT' })
        break
      case 'leave.wheelchairWaiting':
        if (this.mounted) dis.send({ type: 'PICKED_UP' })
        break
      case 'leave.riding':
        this.checkLeftRoom(ctx)
        if (this.exitUnloaded && this.done) dis.send({ type: 'AT_EXIT' })
        break
      default:
        break
    }
  }

  /** In bed: raise the bed head with the meals builder's `recline`. */
  private thinkBed(ctx: PeopleContext): void {
    const seated = this.entity.seated
    if (!seated || this.mode !== 'static') return
    const status = ctx.world.beds?.life.rooms.get(this.roomId)
    if (!status) return
    const want = status.recline > 0.5 ? 'recline' : 'lie'
    if (seated.pose !== want) seated.pose = want
  }

  private takeHomeDone(ctx: PeopleContext): boolean {
    const id = this.run!.orderId
    if (id === null) return true
    const o = ctx.meds.orders.get(id)
    return o === undefined || o.stage === 'given' || o.cancelledAt !== undefined
  }

  /** The family is in the room (or never came: after a while the patient goes without them). */
  private familyIsHere(t: number, run: DischargeRun): boolean {
    const c = run.family?.collecting
    if (c?.arrived) return true
    return run.family === null && t > run.familyAt + 240
  }

  /** Past the room's wall: the bed is empty and waits for a cleaner. */
  private checkLeftRoom(ctx: PeopleContext): void {
    if (this.vacated || Math.abs(this.walker.z) >= 15.6) return
    this.vacated = true
    this.entity.roomId = undefined
    ctx.world.beds?.vacate(this.roomId, ctx.t)
  }

  override onRemoved(world: World): void {
    this.dis?.stop()
    world.detach(this)
    world.seats.releaseBy(this.entity.id)
    world.releaseName(this.entity.name)
    if (world.wardPatients.get(this.roomId) === this) world.wardPatients.delete(this.roomId)
  }
}
