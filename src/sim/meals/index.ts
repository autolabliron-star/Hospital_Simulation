/**
 * Breakfast, lunch and dinner: MealBots, ward hosts, trays and the recline at meals (L1 meals builder).
 * Wired into Simulation by the orchestrator: constructed once per hospital, `warmStart` right after construction
 * (only for a start later than 07:30), then `step` every fixed step after the director, `sync(alpha)` from Simulation.sync.
 *
 * What happens, per ward and per window of CONFIG.meals.windows (see run.ts for one run):
 *   - at the window start a MealBot comes up the service lift with the ward host, drives to the meal stops, and the host
 *     carries a tray into every room whose patient is in bed (`RoomStatus.meal` = served, the bed head rises, the patient
 *     gets the meal emote, a `mealServed` event);
 *   - `collectAfterSeconds` after the first room was served a second run (another bot when one is free) takes the trays back
 *     (`meal` = none, a `trayCollected` event); a patient who finished eating is `eaten` in between;
 *   - hosts exist only while a run does; the bots live in `life.mealBots` for good (offsite and invisible between runs).
 * A bot is a wide member of the crowd on the people nav graph (bot.ts). MealBots are ≤ botsPerWard per ward + spareBots;
 * runs take the ward's own bots in turn and the spare when both are busy.
 */
import { fillDayTemplate } from '@/content/day'
import { HOSTS } from '@/content/staff'
import type { Dish } from '@/content/meals'
import { CONFIG } from '../config'
import { routeLength, planRoute } from '../nav/graph'
import { ROOMS, SERVICE_LIFT } from '../places'
import type { LivingDay } from '../life'
import type { MedSystem } from '../meds/system'
import type { Rng } from '../rng'
import type { World } from '../er/world'
import type { MealKind, RoomId, Vec2, WardId } from '../types'
import { WARDS } from '../types'
import { BotUnit, crowdOf, type BotEnv } from './bot'
import { WardHost } from './host'
import { MEAL_WINDOWS, STOPS_OF, clockHour, dishFor, liftBotSpot, liftHostSpot, simTimeOf, type MealWindow } from './plan'
import { RoomMeals, holdsPatient, servableBed } from './rooms'
import { Run, type RunMode, type RunServices } from './run'

export { dishFor } from './plan'
export { MEAL_WINDOWS } from './plan'

export interface LifeServiceDeps {
  world: World
  life: LivingDay
  meds: MedSystem
  rng: Rng
}

/** How long a patient's meal emote shows after the tray is set down (s). */
const EMOTE_SECONDS = 15
/** A bot comes up the lift only when nobody is this close to its spot (m). */
const LIFT_CLEAR = 1.6
/** Late arrivals: look every this many seconds, and not within this long of the window's end. */
const LATE_POLL = 15
const LATE_MARGIN = 300
/** Collection rounds a ward may need before housekeeping clears what is left. */
const MAX_COLLECT_TRIES = 4

type GroupState = 'waiting' | 'serving' | 'resting' | 'collecting' | 'done'

/** One ward's one meal of one day: its serve run, the wait while patients eat, and its collection run. */
class Group {
  state: GroupState = 'waiting'
  run: Run | null = null
  firstServedAt = -1
  collectAt = Infinity
  retries = 0
  /** When to look next for a patient who came to a bed after the bot had been round. */
  nextLate = 0

  constructor(
    readonly day: number,
    readonly window: MealWindow,
    readonly ward: WardId,
    /** Sim time the serving window ends. */
    readonly windowEnd: number,
  ) {}
}

/** Nominal times (s after the run starts) of a run through a full ward, for a warm start. */
interface Timeline {
  arrive: number[]
  leave: number[]
  end: number
  /** When the first room is served. */
  first: number
}

export class Meals implements RunServices {
  readonly rng: Rng
  /** Every MealBot (their `bot` records are in `life.mealBots`). */
  readonly units: BotUnit[] = []
  private readonly seed: number
  private readonly rooms: RoomMeals
  private readonly pool: Record<WardId, BotUnit[]> = { A: [], B: [] }
  private readonly spares: BotUnit[] = []
  private readonly next: Record<WardId, number> = { A: 0, B: 0 }
  private readonly groups: Group[] = []
  /** (day, window, ward) triples already started or handled, as day * 64 + window * 2 + ward. */
  private readonly started = new Set<number>()
  private readonly timelines = new Map<string, Timeline>()

  constructor(readonly deps: LifeServiceDeps) {
    this.rng = deps.rng
    this.seed = deps.rng.seed
    this.rooms = new RoomMeals(deps.life, deps.rng)
    // the hospital's crowd, found through the walker of anybody already in it (a new walker would take a crowd slot)
    const anyone = deps.world.wardPatients.values().next().value
    const env: BotEnv = {
      walkerFor: deps.world.walkerFor,
      crowd: anyone ? crowdOf(anyone.walker) : null,
      pairs: deps.world.pairs,
    }
    for (const ward of WARDS) {
      for (let i = 1; i <= CONFIG.meals.botsPerWard; i++) this.addBot(`mealbot-${ward}${i}`, ward, env, this.pool[ward])
    }
    for (let i = 1; i <= CONFIG.meals.spareBots; i++) this.addBot(`mealbot-S${i}`, 'A', env, this.spares)
  }

  private addBot(id: string, ward: WardId, env: BotEnv, into: BotUnit[]): void {
    const u = new BotUnit(id, ward, env, SERVICE_LIFT[ward])
    into.push(u)
    this.units.push(u)
    this.deps.life.mealBots.set(id, u.bot)
  }

  // ---------------------------------------------------------------------------------------------
  // The patient's choice (for the bedside screen) and the room checks the runs use
  // ---------------------------------------------------------------------------------------------

  /** The dish the patient in `roomId` chose for `meal` (null for an empty bed). */
  chosenDish(meal: MealKind, roomId: RoomId): Dish | null {
    const st = this.deps.life.rooms.get(roomId)
    if (!st || st.patientId === null) return null
    return dishFor(this.seed, meal, st.patientId)
  }

  /** The tray on a room's table, or null. */
  tray(roomId: RoomId): { meal: MealKind; dish: string | null } | null {
    return this.rooms.tray(roomId)
  }

  private patientOf(roomId: RoomId) {
    const st = this.deps.life.rooms.get(roomId)
    const p = this.deps.world.wardPatients.get(roomId)
    return st && p && p.entity.id === st.patientId ? p : null
  }

  servable(roomId: RoomId): boolean {
    const st = this.deps.life.rooms.get(roomId)
    if (!st || !servableBed(st.bed) || st.patientId === null || st.meal !== 'none') return false
    // a patient we can see who is not lying in the bed (away for a scan, up and about) gets no tray
    const p = this.patientOf(roomId)
    if (p) {
      const seated = p.entity.seated
      if (!seated || seated.seatId !== `bed:${roomId}`) return false
    }
    return true
  }

  /** The patient has finished and the tray is still on the table (nobody takes a tray from somebody who is eating). */
  collectible(roomId: RoomId): boolean {
    const st = this.deps.life.rooms.get(roomId)
    return !!st && st.meal === 'eaten' && holdsPatient(st.bed)
  }

  /** There is a tray in the room, eaten or not. */
  private hasTray(roomId: RoomId): boolean {
    const st = this.deps.life.rooms.get(roomId)
    return !!st && st.meal !== 'none' && holdsPatient(st.bed)
  }

  countServable(ward: WardId): number {
    let n = 0
    for (const r of ROOMS) if (r.ward === ward && this.servable(r.id)) n++
    return n
  }

  private countCollectible(ward: WardId): number {
    let n = 0
    for (const r of ROOMS) if (r.ward === ward && this.collectible(r.id)) n++
    return n
  }

  private countTrays(ward: WardId): number {
    let n = 0
    for (const r of ROOMS) if (r.ward === ward && this.hasTray(r.id)) n++
    return n
  }

  /** Take every leftover tray of a ward away without a run (nobody left to collect it from, or it was missed). */
  private clearTrays(ward: WardId): void {
    for (const r of ROOMS) if (r.ward === ward && this.deps.life.rooms.get(r.id)?.meal !== 'none') this.rooms.collected(r.id)
  }

  beginRecline(roomId: RoomId): void {
    this.rooms.beginRecline(roomId)
  }

  abortRecline(roomId: RoomId): void {
    this.rooms.abortRecline(roomId)
  }

  serveRoom(roomId: RoomId, meal: MealKind, host: WardHost, t: number): void {
    const { world, life } = this.deps
    const st = life.rooms.get(roomId)
    if (!st) return
    const dish = dishFor(this.seed, meal, st.patientId ?? roomId)
    this.rooms.served(roomId, meal, dish.name, t)
    world.say('mealServed', fillDayTemplate('mealServed', { host: host.staff.name, dish: dish.name, room: roomId }), {
      roomId,
      actorId: host.entity.id,
      subjectId: st.patientId ?? undefined,
    })
    const p = this.patientOf(roomId)
    if (p) {
      p.entity.emote = 'meal'
      p.emoteUntil = t + EMOTE_SECONDS
    }
  }

  collectRoom(roomId: RoomId, _meal: MealKind, host: WardHost, _t: number): void {
    const st = this.deps.life.rooms.get(roomId)
    this.rooms.collected(roomId)
    this.deps.world.say('trayCollected', fillDayTemplate('trayCollected', { host: host.staff.name, room: roomId }), {
      roomId,
      actorId: host.entity.id,
      subjectId: st?.patientId ?? undefined,
    })
  }

  spawnHost(ward: WardId, at: { at: Vec2; heading: number }, fadeIn: boolean): WardHost {
    const staff = HOSTS.find((h) => h.ward === ward)
    if (!staff) throw new Error(`No ward host for ward ${ward}`)
    const host = new WardHost(staff, this.deps.world.walkerFor(staff.id), at)
    if (fadeIn) host.fadeIn()
    this.deps.world.hooks.add(host)
    return host
  }

  // ---------------------------------------------------------------------------------------------
  // The bots
  // ---------------------------------------------------------------------------------------------

  /** A free bot for a ward: its own bots in turn, then a spare. */
  private acquire(ward: WardId): BotUnit | null {
    const own = this.pool[ward]
    for (let i = 0; i < own.length; i++) {
      const u = own[(this.next[ward] + i) % own.length]
      if (!u.onDuty) {
        this.next[ward] = (this.next[ward] + i + 1) % own.length
        return u
      }
    }
    for (const u of this.spares) if (!u.onDuty) return u
    return null
  }

  // ---------------------------------------------------------------------------------------------
  // The day
  // ---------------------------------------------------------------------------------------------

  step(t: number, dt: number): void {
    this.startGroups(t)
    for (let i = 0; i < this.groups.length; i++) {
      const g = this.groups[i]
      this.stepGroup(g, t, dt)
      if (g.state === 'done') {
        this.groups.splice(i, 1)
        i--
      }
    }
    for (let i = 0; i < this.units.length; i++) this.units[i].step(dt)
    this.rooms.step(t, dt)
  }

  /** Write MealBot poses interpolated by `alpha` between the last two steps (called from Simulation.sync). */
  sync(alpha: number): void {
    for (let i = 0; i < this.units.length; i++) this.units[i].sync(alpha)
  }

  private key(day: number, window: number, ward: number): number {
    return day * 64 + window * 2 + ward
  }

  /** Start each ward's meal when its window opens (once per day). */
  private startGroups(t: number): void {
    const hour = clockHour(t)
    const day = Math.floor(hour / 24)
    const h = hour - day * 24
    for (let w = 0; w < MEAL_WINDOWS.length; w++) {
      const win = MEAL_WINDOWS[w]
      if (h < win.start - 1e-9) continue
      for (let wi = 0; wi < WARDS.length; wi++) {
        const key = this.key(day, w, wi)
        if (this.started.has(key)) continue
        this.started.add(key)
        if (h >= win.end) continue // a window we jumped past
        this.groups.push(new Group(day, win, WARDS[wi], simTimeOf(day, win.end)))
      }
    }
  }

  /** Send a bot (and its host) up the lift for this group, unless none is free or somebody is in the way at the lift. */
  private startRun(g: Group, mode: RunMode): boolean {
    const u = this.acquire(g.ward)
    if (!u) return false
    // the lift lobby is shared with the porters (patients leave for the wards upstairs from it): wait until it is clear
    const lift = liftBotSpot(g.ward).at
    const hostAt = liftHostSpot(g.ward).at
    if (u.spotBusy(lift.x, lift.z, LIFT_CLEAR) || u.spotBusy(hostAt.x, hostAt.z, 0.6)) return false
    g.run = new Run(this, g.ward, mode, g.window.meal, u, g.windowEnd)
    g.run.startAtLift()
    g.state = mode === 'serve' ? 'serving' : 'collecting'
    return true
  }

  private stepGroup(g: Group, t: number, dt: number): void {
    switch (g.state) {
      case 'waiting':
        // (a tray left from an earlier meal goes first: nobody is served while a stale tray is on the table)
        this.clearTrays(g.ward)
        this.startRun(g, 'serve')
        break

      case 'serving': {
        const run = g.run!
        run.step(dt, t)
        if (run.done) {
          if (g.firstServedAt < 0) g.firstServedAt = run.firstServedAt
          if (g.collectAt === Infinity && g.firstServedAt >= 0) g.collectAt = g.firstServedAt + CONFIG.meals.collectAfterSeconds
          g.run = null
          g.state = 'resting'
        }
        break
      }

      case 'resting': {
        // while the window is open, a patient who came to a bed after the bot had been round still gets this meal
        if (t < g.windowEnd - LATE_MARGIN && t >= g.nextLate) {
          g.nextLate = t + LATE_POLL
          if (this.countServable(g.ward) > 0 && this.startRun(g, 'serve')) return
        }
        if (t < g.collectAt) {
          if (g.collectAt === Infinity && t >= g.windowEnd) g.state = 'done' // nobody was served
          return
        }
        if (this.countTrays(g.ward) === 0) {
          g.state = 'done'
          return
        }
        // somebody is still eating: look again in a couple of minutes
        if (this.countCollectible(g.ward) === 0) {
          g.collectAt = t + 120
          g.retries++
          if (g.retries > MAX_COLLECT_TRIES) {
            this.clearTrays(g.ward)
            g.state = 'done'
          }
          return
        }
        this.startRun(g, 'collect')
        break
      }

      case 'collecting': {
        const run = g.run!
        run.step(dt, t)
        if (run.done) {
          g.run = null
          // a tray missed (a patient still eating, or a room that was out): try again a little later, then let housekeeping clear it
          if (this.countTrays(g.ward) > 0 && g.retries < MAX_COLLECT_TRIES) {
            g.retries++
            g.collectAt = t + 300
            g.state = 'resting'
          } else {
            this.clearTrays(g.ward)
            g.state = 'done'
          }
        }
        break
      }

      case 'done':
        break
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Warm start
  // ---------------------------------------------------------------------------------------------

  /** Nominal timings of a run through a whole ward, from the real route lengths. */
  private timeline(ward: WardId, mode: 'serve' | 'collect'): Timeline {
    const cached = this.timelines.get(`${ward}:${mode}`)
    if (cached) return cached
    const stops = STOPS_OF[ward]
    const lift = liftBotSpot(ward).at
    const v = CONFIG.meals.botSpeed
    const leg = (a: Vec2, b: Vec2) => routeLength(planRoute(a, b)) / v + 4
    const [s0, s1] = CONFIG.meals.serveSeconds
    const perRoom = (mode === 'serve' ? 1.5 + (s0 + s1) / 2 : ((s0 + s1) / 2) * 0.6 + 1.5) + 2 * 8
    const work = 2 * CONFIG.meals.cabinetDoorSeconds + 2 * perRoom
    const arrive: number[] = []
    const leave: number[] = []
    let clock = CONFIG.fade.seconds + 0.8
    for (let k = 0; k < stops.length; k++) {
      clock += leg(k === 0 ? lift : stops[k - 1].at, stops[k].at)
      arrive.push(clock)
      clock += work
      leave.push(clock)
    }
    clock += leg(stops[stops.length - 1].at, lift) + CONFIG.fade.seconds
    const tl: Timeline = { arrive, leave, end: clock, first: arrive[0] + CONFIG.meals.cabinetDoorSeconds + perRoom }
    this.timelines.set(`${ward}:${mode}`, tl)
    return tl
  }

  /** Bots, hosts and trays in the right phase for a start at clock `hour` (the day the sim starts on). */
  warmStart(hour: number): void {
    const day = Math.floor(hour / 24)
    const h = hour - day * 24
    const now = simTimeOf(day, h)
    for (let w = 0; w < MEAL_WINDOWS.length; w++) {
      const win = MEAL_WINDOWS[w]
      if (h <= win.start + 1 / 3600) continue // not started: step() starts it at the window start
      const el = (h - win.start) * 3600
      const start = simTimeOf(day, win.start)
      for (let wi = 0; wi < WARDS.length; wi++) {
        const ward = WARDS[wi]
        this.warmWard(day, w, wi, ward, win, el, start, now)
      }
    }
  }

  private warmWard(day: number, w: number, wi: number, ward: WardId, win: MealWindow, el: number, start: number, now: number): void {
    const key = this.key(day, w, wi)
    const stl = this.timeline(ward, 'serve')
    // the run is on its way to the first stop, or has not left yet: let it start normally
    if (el < stl.arrive[0]) return
    this.started.add(key)
    const windowEnd = simTimeOf(day, win.end)
    const collectStart = stl.first + CONFIG.meals.collectAfterSeconds
    const ctl = this.timeline(ward, 'collect')
    if (el >= collectStart + ctl.end) return // all done: trays are back, nothing is left

    const stops = STOPS_OF[ward]
    const g = new Group(day, win, ward, windowEnd)
    g.firstServedAt = start + stl.first
    g.collectAt = start + collectStart

    // trays on the tables: every room whose patient is in bed was served by the time the serve run had passed it
    const served = el >= stl.end ? stops.length : this.lastStopBefore(stl, el) // stops fully handled
    const pending: RoomId[] = []
    for (let k = 0; k < stops.length; k++) {
      for (let j = 0; j < stops[k].rooms.length; j++) {
        const id = stops[k].rooms[j]
        if (!this.servable(id)) continue
        if (k < served) {
          const when = start + stl.arrive[k] + 10 + j * 40
          this.rooms.warmServed(id, win.meal, dishFor(this.seed, win.meal, this.deps.life.rooms.get(id)?.patientId ?? id).name, when, now)
        } else pending.push(id)
      }
    }

    if (el < stl.end) {
      // mid-serve: the bot is at the first stop it has not finished (the host beside it)
      const k = Math.min(stops.length - 1, this.lastStopBefore(stl, el))
      const u = this.acquire(ward)
      if (!u) return
      g.run = new Run(this, ward, 'serve', win.meal, u, windowEnd)
      g.run.startAtStop(k, pending.length)
      g.state = 'serving'
    } else if (el < collectStart + ctl.arrive[0]) {
      g.state = 'resting'
    } else {
      // mid-collection: earlier stops' trays are back on the shelves, the bot is at the next stop with trays
      const cel = el - collectStart
      const k = Math.min(stops.length - 1, this.lastStopBefore(ctl, cel))
      let carried = 0
      for (let i = 0; i < k; i++) {
        for (const id of stops[i].rooms) {
          if (this.hasTray(id)) {
            this.rooms.collected(id)
            carried++
          }
        }
      }
      const u = this.acquire(ward)
      if (!u) return
      g.run = new Run(this, ward, 'collect', win.meal, u, windowEnd)
      g.run.startAtStop(k, carried)
      g.state = 'collecting'
    }
    this.groups.push(g)
  }

  /** How many stops the run has completely finished at `el` seconds (a stop is finished when the bot leaves it). */
  private lastStopBefore(tl: Timeline, el: number): number {
    let n = 0
    for (let k = 0; k < tl.leave.length; k++) if (tl.leave[k] <= el) n = k + 1
    return n
  }
}

