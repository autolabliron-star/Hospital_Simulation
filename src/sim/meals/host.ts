/**
 * The ward host: the hospitality staff member who walks with the MealBot, takes a tray from its cabinet to each room and
 * brings it back. A plain Actor: the meal run (run.ts) tells it where to go and what it is doing; it has no thinking of its
 * own. It appears at the service lift with the bot and fades out there at the end of the run.
 */
import type { StaffMember } from '@/content/staff'
import type { PeopleContext } from '../people'
import { Actor } from '../er/actor'
import type { Spot } from '../places'
import type { Walker } from '../walker'

/** Pace while following the bot or carrying a tray (a ward host does not hurry). */
export const HOST_PACE = 1.2

export class WardHost extends Actor {
  constructor(
    readonly staff: StaffMember,
    walker: Walker,
    at: Spot,
  ) {
    super(staff.id, 'host', staff.name, at.at, at.heading, walker, 'role')
    this.cruise = HOST_PACE
  }

  think(_dt: number, _ctx: PeopleContext): void {}

  /** Hold a tray (the hand prop and the carrying pose) or put it down. */
  carry(on: boolean): void {
    this.entity.prop = on ? 'tray' : 'none'
    this.walkAnim = on ? 'carry' : 'walk'
    this.idleAnim = on ? 'carry' : 'idle'
  }

  get carrying(): boolean {
    return this.entity.prop === 'tray'
  }
}
