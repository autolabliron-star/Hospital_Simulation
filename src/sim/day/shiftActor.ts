/**
 * ShiftActor: a staff member between their post and the street. It plays a short script (walk, sit, stand, wait, talk,
 * fade out) and is how a shift change looks:
 *
 *   comer     fades in at the entrance, walks to the staff-room lockers, changes, waits (seated if there is a seat), walks to the
 *             spot beside the post, talks with the person handing over, steps to the post; the day rhythm then swaps in the
 *             real controller on the same spot (same id, same look: nobody pops)
 *   leaver    (the real controller, swapped for a ShiftActor once it is at rest) hands over, walks to the lockers, changes,
 *             walks to the entrance and fades out
 *   receiver  the colleague who stays: swapped for a ShiftActor for the length of the talk, then swapped back
 *
 * The script is a list of steps built by the shift manager (shifts.ts); the actor only runs it. Allocation happens when
 * a script is built (a few times a day), never per step.
 */
import type { StaffMember } from '@/content/staff'
import { Actor } from '../er/actor'
import type { PeopleContext } from '../people'
import type { World } from '../er/world'
import type { AnimState, SeatSpec, Vec2 } from '../types'
import type { Walker } from '../walker'

export type Step =
  | { kind: 'walk'; to: Vec2 | (() => Vec2); face?: number }
  | { kind: 'sit'; seat: SeatSpec }
  /** Sit on the seat `pick` returns when the step starts, or do nothing if there is none. */
  | { kind: 'sitIf'; pick: () => SeatSpec | null }
  | { kind: 'stand' }
  | { kind: 'wait'; seconds: number; anim?: AnimState }
  | { kind: 'until'; test: () => boolean; anim?: AnimState }
  | { kind: 'do'; run: () => void }
  | { kind: 'fadeOut' }

export type ShiftRole = 'comer' | 'leaver' | 'receiver'

export class ShiftActor extends Actor {
  /** True once every step has run (a fresh actor has no script and is finished). */
  finished = true
  /** The script is at a step that waits for the shift manager (an `until`). */
  private steps: Step[] = []
  private at = 0
  private started = false
  private timer = 0
  private sitting = false
  /** Told when this actor has left the simulation (faded out): the manager gives back lockers and bookkeeping. */
  onGone: (() => void) | null = null

  constructor(
    readonly staff: StaffMember,
    readonly shiftRole: ShiftRole,
    at: Vec2,
    heading: number,
    walker: Walker,
  ) {
    super(staff.id, staff.role, staff.name, at, heading, walker, 'role')
  }

  /** Replace the script and start it (an empty script finishes at once). */
  run(steps: Step[]): void {
    this.steps = steps
    this.at = 0
    this.started = false
    this.finished = steps.length === 0
  }

  /** The index of the step being run (for tests and the manager). */
  get stepIndex(): number {
    return this.at
  }

  think(dt: number, _ctx: PeopleContext): void {
    for (let guard = 0; guard < 8 && !this.finished; guard++) {
      const s = this.steps[this.at]
      if (!this.started) {
        this.begin(s)
        this.started = true
      }
      if (!this.complete(s, dt)) return
      this.at++
      this.started = false
      if (this.at >= this.steps.length) this.finished = true
    }
  }

  private begin(s: Step): void {
    switch (s.kind) {
      case 'walk':
        this.moveTo(typeof s.to === 'function' ? s.to() : s.to, { face: s.face ?? null })
        break
      case 'sit':
        this.sitting = true
        this.sitOn(s.seat)
        break
      case 'sitIf': {
        const seat = s.pick()
        this.sitting = seat !== null
        if (seat) this.sitOn(seat)
        break
      }
      case 'stand':
        if (this.seat) this.standUp()
        break
      case 'wait':
        this.timer = s.seconds
        this.entity.anim = s.anim ?? this.idleAnim
        break
      case 'until':
        this.entity.anim = s.anim ?? this.idleAnim
        break
      case 'do':
        s.run()
        break
      case 'fadeOut':
        this.fadeOut()
        break
    }
  }

  private complete(s: Step, dt: number): boolean {
    switch (s.kind) {
      case 'walk':
        return this.done
      case 'sit':
        return this.done && this.seat !== null
      case 'sitIf':
        return !this.sitting || (this.done && this.seat !== null)
      case 'stand':
        return this.done
      case 'wait':
        this.timer -= dt
        return this.timer <= 0
      case 'until':
        return s.test()
      case 'do':
        return true
      case 'fadeOut':
        return false
    }
  }

  override onRemoved(world: World): void {
    world.seats.releaseBy(this.entity.id)
    this.onGone?.()
  }
}
