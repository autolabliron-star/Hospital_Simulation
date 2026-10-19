/**
 * W4 lab: the scientist (agent L). Arjun (content W4_STAFF 'lab-sci-1', role 'labScientist') is on site around the clock, a real person in
 * the crowd. He stands at the review terminal (anim 'tablet') and does the manual reviews there, and every 30-45 minutes he walks to a tech
 * spot to load reagents ('give', 40-70 s) and comes back. He only starts a review while he is at the terminal; a trip never interrupts one.
 */
import { W4_STAFF, type StaffMember } from '@/content/staff'
import { Actor } from '../er/actor'
import type { World } from '../er/world'
import type { PeopleContext } from '../people'
import { LAB } from '../places'
import type { Rng } from '../rng'
import type { Walker } from '../walker'
import type { Reviewer } from './verify'

export const SCIENTIST_ID = 'lab-sci-1'
/** Minutes between reagent trips and how long one takes (seconds). */
export const TRIP_EVERY_SECONDS: readonly [number, number] = [1800, 2700]
export const LOADING_SECONDS: readonly [number, number] = [40, 70]

/** After this long away (a crowd, a door) he reviews from his tablet wherever he is: a fail-safe, so the lab can never stall on him. */
export const AWAY_LIMIT_SECONDS = 300

type Phase = 'desk' | 'toTech' | 'loading' | 'back'

export class LabScientist extends Actor implements Reviewer {
  /** A review is running (set by the lab every step): no trip starts now. */
  reviewing = false
  /** Reagent trips made so far. */
  trips = 0
  private phase: Phase = 'desk'
  private timer = 0
  private nextTripAt = Infinity
  private spot = 0
  private awaySince = 0
  private lastT = 0

  constructor(
    readonly world: World,
    readonly staff: StaffMember,
    walker: Walker,
    private readonly srng: Rng,
  ) {
    super(staff.id, 'labScientist', staff.name, LAB.terminal.at, LAB.terminal.heading, walker, 'role')
    this.idleAnim = 'tablet'
    this.entity.anim = 'tablet'
  }

  /** At the terminal, standing still, free to start a review. */
  get available(): boolean {
    if (this.phase === 'desk') return this.done && this.mode === 'static'
    return this.lastT - this.awaySince > AWAY_LIMIT_SECONDS
  }
  get name(): string {
    return this.staff.name
  }
  /** At a tech spot loading reagents. */
  get atTech(): boolean {
    return this.phase === 'loading'
  }
  /** On a reagent trip (walking there, loading, or walking back). */
  get away(): boolean {
    return this.phase !== 'desk'
  }

  /** Plan the first trip (and any after a warm start) from sim time `t`. */
  reset(t: number): void {
    this.nextTripAt = t + this.srng.between(TRIP_EVERY_SECONDS)
  }

  think(dt: number, ctx: PeopleContext): void {
    this.lastT = ctx.t
    switch (this.phase) {
      case 'desk':
        if (this.done && this.mode === 'static') {
          if (this.entity.anim !== 'tablet') this.entity.anim = 'tablet'
          if (ctx.t >= this.nextTripAt && !this.reviewing) {
            const s = LAB.tech[this.spot++ % LAB.tech.length]
            this.moveTo(s.at, { face: s.heading })
            this.phase = 'toTech'
            this.awaySince = ctx.t
          }
        }
        break
      case 'toTech':
        if (this.done) {
          this.phase = 'loading'
          this.timer = this.srng.between(LOADING_SECONDS)
          this.entity.anim = 'give'
        } else if (ctx.t - this.awaySince > AWAY_LIMIT_SECONDS) {
          // not getting there: give the trip up and go back
          this.moveTo(LAB.terminal.at, { face: LAB.terminal.heading })
          this.phase = 'back'
        }
        break
      case 'loading':
        this.timer -= dt
        if (this.timer <= 0) {
          this.moveTo(LAB.terminal.at, { face: LAB.terminal.heading })
          this.phase = 'back'
        }
        break
      case 'back':
        if (this.done) {
          this.phase = 'desk'
          this.trips++
          this.nextTripAt = ctx.t + this.srng.between(TRIP_EVERY_SECONDS)
          this.entity.anim = 'tablet'
        }
        break
    }
  }
}

/** Create the scientist at the terminal and add her to the hospital. */
export function spawnScientist(world: World, rng: Rng): LabScientist {
  const staff = W4_STAFF.find((s) => s.id === SCIENTIST_ID)
  if (!staff) throw new Error(`No lab staff ${SCIENTIST_ID}`)
  const sci = new LabScientist(world, staff, world.walkerFor(staff.id), rng)
  sci.reset(world.t)
  world.hooks.add(sci)
  return sci
}
