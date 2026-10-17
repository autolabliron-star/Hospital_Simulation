/**
 * Test helpers for the meal service: a monitor that samples a running Simulation for the things MealBots and hosts must
 * never do (stop in a doorway, touch a person, wander away from their bot).
 * Used by meals.test.ts only.
 */
import { CONFIG } from '../config'
import { DOORS, MEAL_STOPS, areaAt } from '../places'
import type { Simulation } from '../Simulation'

export const DT = CONFIG.sim.step
export const hourT = (h: number) => (h - CONFIG.sim.startHour) * 3600

export interface Rect {
  x0: number
  x1: number
  z0: number
  z1: number
}

export const inRect = (r: Rect, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1

/** Every doorway as a small rectangle in the wall opening. */
const DOORWAYS: Rect[] = DOORS.filter((d) => d.kind !== 'opening').map((d) => {
  const half = d.width / 2
  return d.wallAxis === 'x'
    ? { x0: d.center.x - half, x1: d.center.x + half, z0: d.center.z - 0.35, z1: d.center.z + 0.35 }
    : { x0: d.center.x - 0.35, x1: d.center.x + 0.35, z0: d.center.z - half, z1: d.center.z + half }
})

/** What a long run must never do, sampled every third step. */
export class Watch {
  minPersonDistance = Infinity
  minPersonWho = ''
  readonly problems: string[] = []
  maxBots = 0
  maxHosts = 0
  hostSamples = 0
  /** Longest a bot or host stood still inside a doorway, seconds. */
  longestStill = 0
  longestStillWho = ''
  private readonly still = new Map<string, number>()
  private n = 0

  constructor(private readonly sim: Simulation) {}

  private note(msg: string): void {
    if (this.problems.length < 12) this.problems.push(`${this.sim.t.toFixed(0)}s ${msg}`)
  }

  sample(): void {
    if (++this.n % 3 !== 0) return
    const sim = this.sim
    const dt = DT * 3
    let bots = 0
    for (const u of sim.meals.units) {
      if (!u.onDuty) continue
      bots++
      const { x, z } = u
      const doorway = DOORWAYS.some((r) => inRect(r, x, z))
      // never stopped in a doorway
      const key = u.bot.id
      if (doorway && u.bot.speed < 0.05) {
        const held = (this.still.get(key) ?? 0) + dt
        this.still.set(key, held)
        if (held > this.longestStill) {
          this.longestStill = held
          this.longestStillWho = `${key} at (${x.toFixed(1)}, ${z.toFixed(1)}) ${sim.t.toFixed(0)}s`
        }
        if (held > 1) this.note(`${u.bot.id} stopped ${held.toFixed(1)} s in a doorway at (${x.toFixed(1)}, ${z.toFixed(1)})`)
      } else this.still.delete(key)
      // never closer than 0.4 m to a person
      for (const p of sim.people) {
        if (p.entity.fade !== undefined && p.entity.fade <= 0) continue
        const d = Math.hypot(p.walker.x - x, p.walker.z - z)
        if (d < this.minPersonDistance) {
          this.minPersonDistance = d
          this.minPersonWho = `${p.entity.id} at ${sim.t.toFixed(0)}s`
        }
      }
    }
    this.maxBots = Math.max(this.maxBots, bots)

    // the host is always within a few metres of its bot, or inside one of the stop's rooms
    let hosts = 0
    for (const p of sim.people) {
      if (p.entity.role !== 'host') continue
      hosts++
      const ward = p.entity.id === 'host-A' ? 'A' : 'B'
      const bot = sim.meals.units.find((u) => u.onDuty && u.bot.ward === ward)
      if (!bot) {
        this.note(`${p.entity.id} is on the floor without a bot`)
        continue
      }
      this.hostSamples++
      const stop = MEAL_STOPS.filter((s) => s.ward === ward).sort((a, b) => Math.hypot(a.at.x - bot.x, a.at.z - bot.z) - Math.hypot(b.at.x - bot.x, b.at.z - bot.z))[0]
      const area = areaAt(p.walker.x, p.walker.z)
      const inStopRoom = area !== null && stop.rooms.some((r) => area.id === `room:${r}`)
      const d = Math.hypot(p.walker.x - bot.x, p.walker.z - bot.z)
      if (d > 5 && !inStopRoom) this.note(`${p.entity.id} is ${d.toFixed(1)} m from ${bot.bot.id} (${area?.id})`)
      // nobody holds still in a doorway
      const doorway = DOORWAYS.some((r) => inRect(r, p.walker.x, p.walker.z))
      const key = p.entity.id
      if (doorway && p.walker.speed < 0.05) {
        const held = (this.still.get(key) ?? 0) + dt
        this.still.set(key, held)
        if (held > this.longestStill) {
          this.longestStill = held
          this.longestStillWho = `${key} at (${p.walker.x.toFixed(1)}, ${p.walker.z.toFixed(1)}) ${sim.t.toFixed(0)}s`
        }
        if (held > 3) this.note(`${key} stood ${held.toFixed(1)} s in a doorway at (${p.walker.x.toFixed(1)}, ${p.walker.z.toFixed(1)})`)
      } else this.still.delete(key)
    }
    this.maxHosts = Math.max(this.maxHosts, hosts)
  }
}

export function runWatched(sim: Simulation, seconds: number, watch: Watch, each?: () => void): void {
  const n = Math.round(seconds / DT)
  for (let i = 0; i < n; i++) {
    sim.step(DT)
    watch.sample()
    each?.()
  }
}


/**
 * Samples every ward room once a second, so a test can ask "was this room's patient in bed for the whole window?" without
 * depending on how the bed flow evolves: a room that stayed occupied through a meal's window must have been served.
 */
export class RoomTracker {
  /** Rooms that had no patient in bed at some sample inside [from, to]. */
  private readonly missing = new Set<string>()
  /** The sample times at which a room had no patient (leaving or empty). */
  private readonly vacated = new Map<string, number[]>()
  private n = 0

  constructor(
    private readonly sim: Simulation,
    private readonly from: number,
    private readonly to: number,
  ) {}

  sample(): void {
    if (++this.n % 60 !== 0) return
    const t = this.sim.t
    for (const r of this.sim.life.rooms.values()) {
      const inBed = (r.bed === 'occupied' || r.bed === 'dischargeSigned') && r.patientId !== null
      if (!inBed && t >= this.from && t <= this.to) this.missing.add(r.roomId)
      const holds = inBed || r.bed === 'leaving'
      if (!holds) {
        const list = this.vacated.get(r.roomId)
        if (list) list.push(t)
        else this.vacated.set(r.roomId, [t])
      }
    }
  }

  /** Rooms whose patient was in bed for the whole window. */
  alwaysOccupied(): string[] {
    return [...this.sim.life.rooms.keys()].filter((id) => !this.missing.has(id))
  }

  /** Did the room have no patient at some time at or after `since`? (A tray left in it is cleared with the room.) */
  vacatedSince(id: string, since: number): boolean {
    return (this.vacated.get(id) ?? []).some((t) => t >= since)
  }
}
