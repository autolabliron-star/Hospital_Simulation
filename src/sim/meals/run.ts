/**
 * One meal run of one ward: a MealBot and its ward host, either serving trays (`serve`) or taking them back (`collect`).
 *
 *   lift      the bot and the host fade in at the service lift
 *   drive     the bot drives to the next stop with a room to handle, the host follows 1.7 m behind
 *   open      the cabinet door slides open
 *   pick      serve: the host takes a tray from the shelf          (collect skips it)
 *   toRoom    the host walks to the bedside (carrying the tray when serving)
 *   inRoom    serve: sets the tray on the over-bed table (the bed head rises, the patient gets the meal emote);
 *             collect: lifts the tray off the table
 *   back      the host walks back to the bot
 *   stow      collect (or a tray nobody took): the host puts the tray on the shelf
 *   close     the cabinet door slides shut; next stop, or home
 *   home      the bot drives back to the service lift, the host follows
 *   fadeOut   both fade out at the lift; the bot goes back downstairs
 *
 * Rooms are checked again at every step that matters (when the host picks the tray, when it reaches the bedside), so a
 * patient who has gone for a scan or home in the meantime is skipped and the tray goes back on the shelf.
 * The bot only stops at meal stops (outside every doorway, by the contract's own test).
 */
import { CONFIG } from '../config'
import type { Rng } from '../rng'
import { roomById, type RoomSpec } from '../places'
import type { MealKind, RoomId, Vec2, WardId } from '../types'
import { BotUnit } from './bot'
import { WardHost, HOST_PACE } from './host'
import { STOPS_OF, hostSpot, liftBotSpot, liftHostSpot } from './plan'

export type RunMode = 'serve' | 'collect'

type Phase = 'lift' | 'drive' | 'open' | 'pick' | 'toRoom' | 'inRoom' | 'back' | 'stow' | 'close' | 'home' | 'fadeOut' | 'done'

/** What a run needs from the meal service. */
export interface RunServices {
  readonly rng: Rng
  /** Can this room be served now? (a patient in the bed, no tray yet) */
  servable(roomId: RoomId): boolean
  /** Is there a tray to take from this room? */
  collectible(roomId: RoomId): boolean
  /** How many rooms of the ward can be served now / have a tray. */
  countServable(ward: WardId): number
  serveRoom(roomId: RoomId, meal: MealKind, host: WardHost, t: number): void
  collectRoom(roomId: RoomId, meal: MealKind, host: WardHost, t: number): void
  beginRecline(roomId: RoomId): void
  abortRecline(roomId: RoomId): void
  spawnHost(ward: WardId, at: { at: Vec2; heading: number }, fadeIn: boolean): WardHost
  /** R2: hold the lift lobby's stretcher slot (the MealBot and its host stand in the lobby); false when a stretcher party has it. */
  claimLobby(ward: WardId): boolean
  releaseLobby(ward: WardId): void
}

const PICK_SECONDS = 1.5
const LIFT_PAUSE = 0.8
const FOLLOW_GAP = 1.7
/** Taking a tray off a table is quicker than setting one with care. */
const COLLECT_FACTOR = 0.6
/** In `toRoom`/`back`/`drive` for this long without arriving: plan the walk again; after GIVE_UP, abandon the room. */
const STALL_REPLAN = 75
const STALL_GIVE_UP = 240
/** Catch-up passes for rooms that were empty or out when the bot first passed (serve only). */
const MAX_PASSES = 2
/** No catch-up pass starts within this long of the window's end. */
const CATCH_UP_MARGIN = 300
/** R2: a bot back at the lift waits this long for the lobby's stretcher slot before it fades out anyway (s). */
const LOBBY_PATIENCE = 90

function dist(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz)
}

export class Run {
  phase: Phase = 'lift'
  done = false
  /** Set by `startAtLift` / `startAtStop` (one of them is always called right after construction). */
  host!: WardHost
  /** Sim time the first room was served (serve runs), or -1. */
  firstServedAt = -1
  /** Rooms handled by this run. */
  handled = 0

  private stopIdx = -1
  private passes = 0
  private queue: RoomId[] = []
  private room: RoomSpec | null = null
  /** The host holds a tray it did not set down: one taken off a table, or one a room did not take. */
  private tray = false
  private timer = 0
  private phaseT = 0
  /** R2: this run holds the lift lobby's stretcher slot (from the lift to the first stop, and again from the lift back to the fade-out). */
  private lobbyHeld = false
  private lobbyWait = 0
  private nextReplan = STALL_REPLAN * 2
  private readonly failed = new Set<RoomId>()
  private readonly spot: Vec2 = { x: 0, z: 0 }

  constructor(
    private readonly svc: RunServices,
    readonly ward: WardId,
    readonly mode: RunMode,
    readonly meal: MealKind,
    readonly unit: BotUnit,
    /** Sim time the serving window ends (no catch-up pass after it). */
    private readonly windowEnd: number,
  ) {}

  /** The normal start: come up the lift. */
  startAtLift(): void {
    const b = this.unit.bot
    this.unit.deploy(liftBotSpot(this.ward), this.ward, true)
    this.host = this.svc.spawnHost(this.ward, liftHostSpot(this.ward), true)
    this.linkHost()
    b.meal = this.meal
    b.state = 'toWard'
    b.trays = this.mode === 'serve' ? Math.min(CONFIG.meals.shelves, this.svc.countServable(this.ward)) : 0
    this.phase = 'lift'
    this.timer = CONFIG.fade.seconds + LIFT_PAUSE
    // (the meal service claimed the lobby before it started this run)
    this.lobbyHeld = true
  }

  /** A warm start: already at stop `k`, the cabinet about to open. */
  startAtStop(k: number, trays: number): void {
    const stop = STOPS_OF[this.ward][k]
    const b = this.unit.bot
    this.unit.deploy({ at: stop.at, heading: stop.heading }, this.ward, false)
    this.unit.parkHeading = stop.heading
    this.host = this.svc.spawnHost(this.ward, { at: hostSpot(stop, { x: 0, z: 0 }), heading: stop.heading }, false)
    this.linkHost()
    b.meal = this.meal
    b.state = this.mode === 'serve' ? 'serving' : 'collecting'
    b.trays = Math.min(CONFIG.meals.shelves, trays)
    this.stopIdx = k
    this.unit.setDoor(true)
    this.phase = 'open'
    this.phaseT = 0
  }

  private linkHost(): void {
    this.unit.hostSlot = (this.host.walker as unknown as { slot?: number }).slot ?? -1
  }

  private releaseLobby(): void {
    if (!this.lobbyHeld) return
    this.lobbyHeld = false
    this.svc.releaseLobby(this.ward)
  }

  private eligible(id: RoomId): boolean {
    if (this.failed.has(id)) return false
    return this.mode === 'serve' ? this.svc.servable(id) : this.svc.collectible(id)
  }

  private roomsAt(k: number): RoomId[] {
    const out: RoomId[] = []
    for (const id of STOPS_OF[this.ward][k].rooms) if (this.eligible(id)) out.push(id)
    return out
  }

  /** The next stop to drive to, or -1: later stops first, then (serve, with time left) earlier ones that now have a room. */
  private pickStop(t: number): number {
    const n = STOPS_OF[this.ward].length
    for (let k = this.stopIdx + 1; k < n; k++) if (this.roomsAt(k).length > 0) return k
    if (this.mode === 'serve' && this.passes < MAX_PASSES && t < this.windowEnd - CATCH_UP_MARGIN) {
      for (let k = 0; k < n; k++) {
        if (k !== this.stopIdx && this.roomsAt(k).length > 0) {
          this.passes++
          return k
        }
      }
    }
    return -1
  }

  private follow(): void {
    const h = this.host
    // the bot has stopped (parked, or at the lift): the host walks on to its own spot at its own pace
    if (this.unit.arrived) {
      h.cruise = HOST_PACE
      return
    }
    const d = dist(h.x, h.z, this.unit.x, this.unit.z)
    const v = this.unit.bot.speed + (d - FOLLOW_GAP) * 1.2
    const cap = HOST_PACE * 1.3
    h.cruise = v < 0 ? 0 : v > cap ? cap : v
  }

  private goToStop(k: number): void {
    const stop = STOPS_OF[this.ward][k]
    this.stopIdx = k
    this.unit.goTo(stop.at.x, stop.at.z, stop.heading)
    this.host.moveTo(hostSpot(stop, this.spot), { speed: HOST_PACE, face: stop.heading })
    // the first leg (lift to the first stop) is 'toWard'; from the first stop on the bot is working
    if (this.phase !== 'lift') this.unit.bot.state = this.mode === 'serve' ? 'serving' : 'collecting'
    this.phase = 'drive'
    this.phaseT = 0
    this.nextReplan = STALL_REPLAN * 2
  }

  private goHome(): void {
    const b = this.unit.bot
    const lift = liftBotSpot(this.ward)
    const hostLift = liftHostSpot(this.ward)
    b.state = 'returning'
    this.unit.goTo(lift.at.x, lift.at.z, null)
    this.host.moveTo(hostLift.at, { speed: HOST_PACE, face: hostLift.heading })
    this.phase = 'home'
    this.phaseT = 0
  }

  private nextStop(t: number): void {
    const k = this.pickStop(t)
    if (k < 0) this.goHome()
    else this.goToStop(k)
  }

  /** The next room of this stop, or close the cabinet. */
  private nextRoom(): void {
    const h = this.host
    while (this.queue.length > 0) {
      const id = this.queue.shift()!
      if (!this.eligible(id)) continue
      this.room = roomById(id)
      this.phaseT = 0
      if (this.mode === 'serve') {
        h.faceTowards(this.unit.bot.position)
        h.entity.anim = 'give'
        this.phase = 'pick'
        this.timer = PICK_SECONDS
      } else {
        this.walkToRoom()
      }
      return
    }
    this.room = null
    this.unit.setDoor(false)
    this.phase = 'close'
    this.phaseT = 0
  }

  private walkToRoom(): void {
    const r = this.room!
    this.host.moveTo(r.bedside, { speed: HOST_PACE, face: r.bedsideHeading })
    this.phase = 'toRoom'
    this.phaseT = 0
  }

  private walkBack(): void {
    const stop = STOPS_OF[this.ward][this.stopIdx]
    this.host.moveTo(hostSpot(stop, this.spot), { speed: HOST_PACE, face: stop.heading })
    this.phase = 'back'
    this.phaseT = 0
  }

  private giveUpRoom(): void {
    if (this.room) this.failed.add(this.room.id)
    if (this.room && this.mode === 'serve') this.svc.abortRecline(this.room.id)
    this.host.entity.roomId = undefined
    this.room = null
    this.walkBack()
  }

  step(dt: number, t: number): void {
    if (this.done) return
    this.phaseT += dt
    const unit = this.unit
    const host = this.host
    unit.hostGap = this.phase === 'drive' || this.phase === 'home' ? dist(host.x, host.z, unit.x, unit.z) : -1

    switch (this.phase) {
      case 'lift':
        this.timer -= dt
        if (this.timer <= 0) {
          this.releaseLobby()
          this.nextStop(t)
        }
        break

      case 'drive': {
        this.follow()
        if (unit.arrived && host.done && dist(host.x, host.z, unit.x, unit.z) < 3) {
          unit.setDoor(true)
          unit.bot.state = this.mode === 'serve' ? 'serving' : 'collecting'
          this.phase = 'open'
          this.phaseT = 0
        } else if (this.phaseT > this.nextReplan) {
          // stuck for a long time: plan both walks again
          this.nextReplan += STALL_REPLAN * 2
          const stop = STOPS_OF[this.ward][this.stopIdx]
          if (!unit.arrived) unit.goTo(stop.at.x, stop.at.z, stop.heading)
          if (!host.done) host.moveTo(hostSpot(stop, this.spot), { speed: HOST_PACE, face: stop.heading })
        }
        break
      }

      case 'open':
        if (unit.bot.door >= 1) {
          this.queue = this.roomsAt(this.stopIdx)
          this.nextRoom()
        }
        break

      case 'pick':
        this.timer -= dt
        if (this.timer <= 0) {
          unit.bot.trays = Math.max(0, unit.bot.trays - 1)
          host.carry(true)
          this.walkToRoom()
        }
        break

      case 'toRoom': {
        const room = this.room!
        if (host.done) {
          const ok = this.mode === 'serve' ? this.svc.servable(room.id) : this.svc.collectible(room.id)
          if (!ok) {
            if (this.mode === 'serve') this.tray = true
            this.giveUpRoom()
            break
          }
          host.entity.roomId = room.id
          host.entity.anim = 'give'
          if (this.mode === 'serve') this.svc.beginRecline(room.id)
          const s = this.svc.rng.between(CONFIG.meals.serveSeconds)
          this.timer = this.mode === 'serve' ? s : s * COLLECT_FACTOR
          this.phase = 'inRoom'
          this.phaseT = 0
        } else if (this.phaseT > STALL_GIVE_UP) {
          if (this.mode === 'serve') this.tray = true
          this.giveUpRoom()
        } else if (this.phaseT > STALL_REPLAN && this.phaseT - dt <= STALL_REPLAN) {
          host.moveTo(room.bedside, { speed: HOST_PACE, face: room.bedsideHeading })
        }
        break
      }

      case 'inRoom': {
        this.timer -= dt
        if (this.timer > 0) break
        const room = this.room!
        if (this.mode === 'serve') {
          if (this.svc.servable(room.id)) {
            this.svc.serveRoom(room.id, this.meal, host, t)
            if (this.firstServedAt < 0) this.firstServedAt = t
            this.handled++
            host.carry(false)
            this.tray = false
          } else {
            // the patient left while the host was setting the table: the tray goes back
            this.svc.abortRecline(room.id)
            this.failed.add(room.id)
            this.tray = true
          }
        } else {
          this.svc.collectRoom(room.id, this.meal, host, t)
          this.handled++
          host.carry(true)
          this.tray = true
        }
        host.entity.roomId = undefined
        this.room = null
        this.walkBack()
        break
      }

      case 'back':
        if (host.done) {
          if (this.tray) {
            host.faceTowards(unit.bot.position)
            host.entity.anim = 'give'
            this.phase = 'stow'
            this.timer = PICK_SECONDS
            this.phaseT = 0
          } else this.nextRoom()
        } else if (this.phaseT > STALL_REPLAN && this.phaseT - dt <= STALL_REPLAN) {
          const stop = STOPS_OF[this.ward][this.stopIdx]
          host.moveTo(hostSpot(stop, this.spot), { speed: HOST_PACE, face: stop.heading })
        }
        break

      case 'stow':
        this.timer -= dt
        if (this.timer <= 0) {
          unit.bot.trays = Math.min(CONFIG.meals.shelves, unit.bot.trays + 1)
          host.carry(false)
          this.tray = false
          this.nextRoom()
        }
        break

      case 'close':
        if (unit.bot.door <= 0) this.nextStop(t)
        break

      case 'home':
        this.follow()
        if (unit.arrived && host.done) {
          // R2: back in the lobby, wait for its stretcher slot (a porter fading a patient "upstairs" has it), but not for ever
          if (!this.lobbyHeld) {
            this.lobbyWait += dt
            if (this.svc.claimLobby(this.ward)) this.lobbyHeld = true
            else if (this.lobbyWait < LOBBY_PATIENCE) break
          }
          unit.fadeOut()
          host.fadeOut()
          this.phase = 'fadeOut'
          this.phaseT = 0
        }
        break

      case 'fadeOut':
        if (unit.fadedOut) {
          this.releaseLobby()
          unit.undeploy()
          this.phase = 'done'
          this.done = true
        }
        break

      case 'done':
        break
    }
  }
}
