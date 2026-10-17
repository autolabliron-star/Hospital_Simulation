/**
 * One MealBot: a wide, slow member of the hospital's crowd that drives the people corridor (the MedPods ride a ceiling rail
 * above everybody, so a bot and a pod never wait for each other). It owns the `MealBot` record the renderers read (`life.mealBots`), and moves like this:
 *
 *   - It is a `Walker` in the shared Crowd with a larger body radius (BOT_RADIUS), so people steer round it and it
 *     steers round them (keep right, slow behind slower walkers, single-file doors, hard separation).
 *   - On top of that it yields (`waitingFor: 'person'`, amber light): it stops when somebody is `yieldDistance` ahead of its
 *     nose, when pulling away from rest or arriving at a stop with somebody alongside (the crowd would push it sideways),
 *     and for a stretcher or wheelchair (the crowd sees only the porter, 1.5 m behind the vehicle's front).
 *     A yield is given up after YIELD_PATIENCE s, and the crowd's own rules then squeeze the bot past.
 *   - It never stops of its own accord in a doorway (nose included): there it keeps rolling, and any waiting is done
 *     before it gets there. Near a lift door with a stretcher at it, it steps aside to the lobby's east wall.
 *   - Speed and acceleration come from CONFIG.meals; the PathFollower's own ramp is quicker, so the bot commands a ramped
 *     speed (and does not step its walker at all while held at rest).
 *   - The visual heading is smoothed here (2.2 rad/s) and is not the walker's: a bot parks facing the stop heading and
 *     does not spin through 90 degrees on the last lateral step.
 *
 * Allocation-free in `step` and `sync`.
 */
import { CONFIG } from '../config'
import type { RidePair } from '../er/world'
import type { Crowd } from '../nav/crowd'
import { DOORS, MEALBOT_SIZE, groundHeightAt, type Spot } from '../places'
import type { MealBot, WardId } from '../types'
import type { Walker } from '../walker'

/** Body radius in the crowd (m): covers the 0.6 x 1.1 m footprint well enough that people give it room. */
export const BOT_RADIUS = 0.45
const NOSE = MEALBOT_SIZE.l / 2
const HALF_WIDTH = MEALBOT_SIZE.w / 2
/** Braking when something is ahead (m/s^2). */
const BRAKE = 1.5
/** Visual turn rate (rad/s). */
const TURN_RATE = 2.2
/** The bot waits when its host is further behind than this (m). */
export const HOST_LEASH = 3
/**
 * Waiting for somebody who stands in the way (a cleaner mopping the corridor): the bot waits this long, then ignores people
 * for YIELD_GHOST seconds and lets the crowd's own rules squeeze it past (last resort, so that no standoff lasts for ever).
 */
const YIELD_PATIENCE = 45
const YIELD_GHOST = 6

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  else if (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

function turnToward(from: number, to: number, maxStep: number): number {
  let d = (to - from) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  else if (d < -Math.PI) d += Math.PI * 2
  if (d > maxStep) d = maxStep
  else if (d < -maxStep) d = -maxStep
  return from + d
}

/** What a bot needs from the hospital. */
export interface BotEnv {
  /** A crowd-aware walker for an id (World.walkerFor). */
  walkerFor: (id: string) => Walker
  /** The hospital's crowd (null for solo walkers). */
  crowd: Crowd | null
  /**
   * Patients riding a stretcher or wheelchair. The crowd sees only the porter pushing it; the vehicle reaches 1.5 m or more
   * ahead of the porter, so the bot looks at the rider too.
   */
  pairs: readonly RidePair[]
}

/**
 * A rider on a stretcher or wheelchair counts as a body this wide (m) when the bot decides whether to wait, and the bot
 * starts waiting this much sooner (the vehicle's front end reaches about a metre beyond the rider's centre).
 */
const RIDER_RADIUS = 0.55
const RIDER_EXTRA_REACH = 1.0
/** Every doorway (not the wide openings), as a rectangle in the wall: a bot never stops in one. */
const DOORWAYS = DOORS.filter((d) => d.kind !== 'opening').map((d) => {
  const half = d.width / 2
  return d.wallAxis === 'x'
    ? { x0: d.center.x - half, x1: d.center.x + half, z0: d.center.z - 0.35, z1: d.center.z + 0.35 }
    : { x0: d.center.x - 0.35, x1: d.center.x + 0.35, z0: d.center.z - half, z1: d.center.z + half }
})
/** The two service-lift doors: a patient on a stretcher leaves through them, and the bot must not meet it in the doorway. */
const LIFT_DOORS = DOORS.filter((d) => d.id === 'liftA' || d.id === 'liftB').map((d) => d.center)
/**
 * A bot within LIFT_NEAR of a lift door (and not in the doorway) steps aside to the east wall of the lobby or spine and waits
 * there while a stretcher or wheelchair is within LIFT_WATCH of the door: the vehicle is a head-on 2 m longer than the
 * porter the crowd sees, and a lobby is where it is taken to.
 */
const LIFT_NEAR = 4.4
const LIFT_WATCH = 3.4
const ASIDE_X = -40.9

function inAnyDoorway(x: number, z: number, pad: number): boolean {
  for (let i = 0; i < DOORWAYS.length; i++) {
    const r = DOORWAYS[i]
    if (x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad) return true
  }
  return false
}

/** Near its stop the bot waits while somebody is closer than this to the parking spot (m). */
const STOP_CLEAR = 0.95
/** ... starting this far (path-straight metres) from the spot. */
const STOP_APPROACH = 2.5

/** The Crowd a walker belongs to (the walker keeps it private; null for a solo walker). */
export function crowdOf(w: Walker): Crowd | null {
  return (w as unknown as { crowd?: Crowd | null }).crowd ?? null
}

export class BotUnit {
  readonly bot: MealBot
  walker: Walker | null = null
  /** True once the last `goTo` is done (and while nothing is commanded). */
  arrived = true
  /** The heading to park with, or null to follow the path. */
  parkHeading: number | null = null
  /** How far behind its host the bot is (m); -1: no host to wait for. */
  hostGap = -1
  /** The crowd slot of the host (so the bot never yields to its own host), or -1. */
  hostSlot = -1
  /** True once a fade-out has finished. */
  fadedOut = false

  /** Stepping aside for a vehicle at a lift door (see LIFT_NEAR), and whether the side spot has been reached. */
  private aside = false
  private asideDone = false
  private crowd: Crowd | null = null
  /** The hospital's crowd, kept for `spotBusy` while the bot is offsite. */
  private crowdRef: Crowd | null = null
  private slot = -1
  private prevX = 0
  private prevZ = 0
  private prevH = 0
  private curH = 0
  private cmd = 0
  private destX = 0
  private destZ = 0
  private fadeRate = 0
  private doorTarget = 0
  private clock = 0
  private yieldFor = 0
  private ignoreYieldUntil = -1

  constructor(
    id: string,
    ward: WardId,
    private readonly env: BotEnv,
    home: Spot,
  ) {
    this.bot = {
      id,
      ward,
      position: { x: home.at.x, y: groundHeightAt(home.at.x, home.at.z), z: home.at.z },
      heading: home.heading,
      speed: 0,
      state: 'offsite',
      light: 'white',
      meal: null,
      trays: 0,
      fade: 0,
      door: 0,
      waitingFor: null,
    }
    this.crowdRef = env.crowd
  }

  get onDuty(): boolean {
    return this.walker !== null
  }

  get x(): number {
    return this.walker ? this.walker.x : this.bot.position.x
  }

  get z(): number {
    return this.walker ? this.walker.z : this.bot.position.z
  }

  /**
   * Is anybody (a person, a patient on a stretcher) within `radius` of (x, z)? Used before a bot comes up the lift: a bot
   * that fades in on top of a porter's stretcher would overlap it.
   */
  spotBusy(x: number, z: number, radius: number): boolean {
    const c = this.crowdRef
    if (c !== null) {
      for (let i = 0; i < c.count; i++) {
        if (c.act[i] === 0 || i === this.slot) continue
        const dx = c.sx[i] - x
        const dz = c.sz[i] - z
        const r = radius + c.rad[i]
        if (dx * dx + dz * dz < r * r) return true
      }
    }
    const pairs = this.env.pairs
    for (let i = 0; i < pairs.length; i++) {
      const r = pairs[i].rider
      if (r.mode === 'ride' && Math.hypot(r.walker.x - x, r.walker.z - z) < radius + RIDER_RADIUS) return true
    }
    return false
  }

  /** Cabinet door target: 1 = open, 0 = shut. */
  setDoor(open: boolean): void {
    this.doorTarget = open ? 1 : 0
  }

  /** Come up the lift: appear at `at` (fading in) as a crowd member. */
  deploy(at: Spot, ward: WardId, fadeIn: boolean): void {
    const w = this.env.walkerFor(this.bot.id)
    w.setRadius?.(BOT_RADIUS)
    w.place(at.at.x, at.at.z, at.heading)
    this.walker = w
    this.crowd = crowdOf(w)
    this.slot = (w as unknown as { slot?: number }).slot ?? -1
    const b = this.bot
    b.ward = ward
    b.position.x = at.at.x
    b.position.z = at.at.z
    b.position.y = groundHeightAt(at.at.x, at.at.z)
    b.heading = at.heading
    b.speed = 0
    b.door = 0
    b.waitingFor = null
    this.doorTarget = 0
    this.curH = this.prevH = at.heading
    this.prevX = at.at.x
    this.prevZ = at.at.z
    this.cmd = 0
    this.arrived = true
    this.parkHeading = null
    this.hostGap = -1
    this.hostSlot = -1
    this.aside = false
    this.asideDone = false
    this.fadedOut = false
    this.yieldFor = 0
    this.ignoreYieldUntil = -1
    if (fadeIn) {
      b.fade = 0
      this.fadeRate = 1 / CONFIG.fade.seconds
    } else {
      b.fade = 1
      this.fadeRate = 0
    }
  }

  /** Drive to (x, z), parking with `parkHeading` (null: follow the path). */
  goTo(x: number, z: number, parkHeading: number | null): void {
    if (!this.walker) return
    this.destX = x
    this.destZ = z
    this.parkHeading = parkHeading
    this.arrived = false
    this.walker.goTo({ x, z })
  }

  fadeOut(): void {
    this.fadeRate = -1 / CONFIG.fade.seconds
    this.fadedOut = false
  }

  /** Back downstairs: out of the crowd and invisible. */
  undeploy(): void {
    this.walker?.remove()
    this.walker = null
    this.crowd = null
    this.slot = -1
    const b = this.bot
    b.state = 'offsite'
    b.light = 'white'
    b.meal = null
    b.trays = 0
    b.fade = 0
    b.door = 0
    b.speed = 0
    b.waitingFor = null
    this.fadeRate = 0
    this.doorTarget = 0
    this.cmd = 0
    this.arrived = true
  }

  step(dt: number): void {
    const w = this.walker
    if (w === null) return
    const b = this.bot
    this.clock += dt
    this.prevX = w.x
    this.prevZ = w.z
    this.prevH = this.curH

    // fade at the lift
    if (this.fadeRate !== 0) {
      let f = b.fade + this.fadeRate * dt
      if (this.fadeRate > 0) {
        if (f >= 1) {
          f = 1
          this.fadeRate = 0
        }
      } else if (f <= 0) {
        f = 0
        this.fadeRate = 0
        this.fadedOut = true
      }
      b.fade = f
    }

    // cabinet door
    if (b.door !== this.doorTarget) {
      const k = dt / CONFIG.meals.cabinetDoorSeconds
      b.door = b.door < this.doorTarget ? Math.min(this.doorTarget, b.door + k) : Math.max(this.doorTarget, b.door - k)
    }

    // drive
    let waitingFor: MealBot['waitingFor'] = null
    if (!this.arrived && this.fadeRate <= 0 && !this.fadedOut) {
      let target: number = CONFIG.meals.botSpeed
      // A bot never stops of its own accord in a doorway (nor with its nose in one): it keeps rolling through, and any
      // waiting is done before it gets there.
      const canStop = this.mayStopHere(w.x, w.z, Math.sin(w.heading), Math.cos(w.heading))
      const vehicle = canStop && this.vehicleNearLift(w.x, w.z)
      if (vehicle && !this.aside) {
        this.aside = true
        this.asideDone = false
        w.goTo({ x: ASIDE_X, z: w.z })
      } else if (!vehicle && this.aside && canStop) {
        this.aside = false
        w.goTo({ x: this.destX, z: this.destZ })
      }
      if (this.aside && this.asideDone) {
        target = 0
        waitingFor = 'person'
      } else if (canStop && this.hostGap > HOST_LEASH) {
        target = 0
        waitingFor = 'host'
      } else if (canStop && this.mustYield(dt)) {
        target = 0
        waitingFor = 'person'
      }
      if (this.cmd < target) this.cmd = Math.min(target, this.cmd + CONFIG.meals.botAccel * dt)
      else this.cmd = Math.max(target, this.cmd - BRAKE * dt)
      if (this.cmd === 0 && target === 0 && w.speed < 0.01) {
        // held at rest: the walker is not stepped at all. (A stepped walker with a route is pushed sideways by anybody close
        // alongside, even at speed 0, and a parked bot must not be.)
      } else {
        const st = w.step(dt, this.cmd)
        if (st === 'arrived') {
          this.cmd = 0
          if (this.aside) this.asideDone = true
          else this.arrived = true
        } else if (st === 'waiting' && waitingFor === null) {
          waitingFor = 'person'
        }
      }
    } else {
      this.cmd = 0
      this.yieldFor = 0
    }

    // visual heading: the path's, except that a bot near its stop turns to the parking heading
    let desired = w.heading
    if (this.parkHeading !== null && (this.arrived || Math.hypot(w.x - this.destX, w.z - this.destZ) < 1.0)) desired = this.parkHeading
    this.curH = turnToward(this.curH, desired, TURN_RATE * dt)

    b.speed = w.speed
    b.waitingFor = waitingFor
    b.light = waitingFor !== null ? 'amber' : b.trays > 0 ? 'peach' : 'white'
  }

  /** Write the pose interpolated by `alpha` between the last two steps. */
  sync(alpha: number): void {
    const w = this.walker
    if (w === null) return
    const b = this.bot
    b.position.x = this.prevX + (w.x - this.prevX) * alpha
    b.position.z = this.prevZ + (w.z - this.prevZ) * alpha
    b.position.y = groundHeightAt(b.position.x, b.position.z)
    b.heading = lerpAngle(this.prevH, this.curH, alpha)
  }

  // --- yielding ---------------------------------------------------------------------------------

  /**
   * Is somebody (not the host) in the way? Somebody within the yield distance of the nose; when pulling away from rest or
   * arriving at a stop, anybody alongside as well (the crowd would push the bot sideways).
   */
  private mustYield(dt: number): boolean {
    const c = this.crowd
    const w = this.walker
    if (c === null || w === null) return false
    if (this.clock < this.ignoreYieldUntil) return false
    const fx = Math.sin(w.heading)
    const fz = Math.cos(w.heading)
    const fromRest = this.cmd < 0.05
    const nearStop = this.parkHeading !== null && Math.hypot(w.x - this.destX, w.z - this.destZ) < STOP_APPROACH
    let blocked = false
    for (let i = 0; i < c.count && !blocked; i++) {
      if (c.act[i] === 0 || i === this.slot || i === this.hostSlot) continue
      blocked = this.inTheWay(c.sx[i], c.sz[i], c.rad[i], c.svx[i], c.svz[i], w.x, w.z, fx, fz, fromRest, nearStop, 0)
    }
    const pairs = this.env.pairs
    for (let i = 0; i < pairs.length && !blocked; i++) {
      const { pusher, rider } = pairs[i]
      if (rider.mode !== 'ride') continue
      const ph = pusher.walker.heading
      const ps = pusher.walker.speed
      blocked = this.inTheWay(rider.walker.x, rider.walker.z, RIDER_RADIUS, Math.sin(ph) * ps, Math.cos(ph) * ps, w.x, w.z, fx, fz, fromRest, nearStop, RIDER_EXTRA_REACH)
    }
    // never stop in a doorway for somebody: the crowd's single-file rule at the door decides who goes first
    if (blocked && inAnyDoorway(w.x, w.z, 0.2)) blocked = false
    if (!blocked) {
      this.yieldFor = 0
      return false
    }
    this.yieldFor += dt
    if (this.yieldFor > YIELD_PATIENCE) {
      this.yieldFor = 0
      this.ignoreYieldUntil = this.clock + YIELD_GHOST
      return false
    }
    return true
  }

  /** Is a stretcher or wheelchair at a lift door the bot is near (and the bot not in the doorway itself)? */
  private vehicleNearLift(x: number, z: number): boolean {
    const pairs = this.env.pairs
    if (pairs.length === 0 || inAnyDoorway(x, z, 0.2)) return false
    for (let d = 0; d < LIFT_DOORS.length; d++) {
      const door = LIFT_DOORS[d]
      if (Math.hypot(x - door.x, z - door.z) > LIFT_NEAR) continue
      for (let i = 0; i < pairs.length; i++) {
        const r = pairs[i].rider
        if (r.mode === 'ride' && Math.hypot(r.walker.x - door.x, r.walker.z - door.z) < LIFT_WATCH) return true
      }
    }
    return false
  }

  /** Does a body at (x, z) (radius, velocity) make the bot at (bx, bz) heading (fx, fz) wait? */
  private inTheWay(x: number, z: number, rad: number, vx: number, vz: number, bx: number, bz: number, fx: number, fz: number, fromRest: boolean, nearStop: boolean, extra: number): boolean {
    const ox = x - bx
    const oz = z - bz
    if (fromRest && ox * ox + oz * oz < (BOT_RADIUS + rad + 0.2) ** 2) return true
    if (nearStop) {
      const sx = x - this.destX
      const sz = z - this.destZ
      if (sx * sx + sz * sz < (STOP_CLEAR + rad - 0.25) ** 2) return true
    }
    const ahead = ox * fx + oz * fz
    if (ahead <= 0 || ahead > CONFIG.meals.yieldDistance + NOSE + rad + extra) return false
    const side = ox * fz - oz * fx
    if ((side < 0 ? -side : side) > HALF_WIDTH + rad + 0.1) return false
    // somebody walking away from the bot at pace is no reason to wait
    return vx * fx + vz * fz <= 0.5
  }

  /** May the bot stop of its own accord with its centre at (x, z) heading (fx, fz)? Not in a doorway, nose included. */
  private mayStopHere(x: number, z: number, fx: number, fz: number): boolean {
    const nx = x + fx * (NOSE + 0.4)
    const nz = z + fz * (NOSE + 0.4)
    return !(inAnyDoorway(x, z, 0.2) || inAnyDoorway(nx, nz, 0.1))
  }
}
