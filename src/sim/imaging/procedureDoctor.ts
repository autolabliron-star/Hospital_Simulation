/**
 * R5 wave 3: the breast radiologist who performs a ProSense cryoablation (IMAGING_STAFF in src/content/staff.ts). She is not on the day rota: the
 * imaging department brings her to the ultrasound room when a ProSense case begins (she fades in in the imaging hall in front of the door, walks to
 * her stool at the treated side) and takes her away when it ends (she walks out to the hall and fades). Between those moments the case's script
 * (./prosense.ts) tells her where to stand and what to do; she has no routine of her own.
 *
 * She is not removed between cases: after the walk out she fades out (kept in the simulation) and waits, invisible, in the room's quiet corner
 * (`IMAGING.us.procedure.park`), and fades in at the hall door for the next case. (A person who comes and goes frees and reuses a slot of the
 * crowd, which reorders everybody added later: the whole day's ER would move with every case.)
 *
 * She holds the ultrasound transducer in her left hand and the cryoprobe, syringe or scalpel in her right (the script's `left` / `right`); the
 * sonographer (the room's `ImagingOperator`) runs the console and helps the patient.
 */
import type { StaffMember } from '@/content/staff'
import { CONFIG } from '../config'
import { Actor } from '../er/actor'
import type { World } from '../er/world'
import type { PeopleContext } from '../person'
import type { Entity, Vec2 } from '../types'
import type { Walker } from '../walker'
import { ActOverlay } from './overlay'

/** Seconds after the case ends she waits for the walk out before she fades where she stands. */
const DISMISS_LIMIT = 40
/** The least `leavesIn()` ever says while she is still on her way out (s): a case waits for her until she is parked, so no projection may read "out of the way" before that. */
export const STILL_LEAVING_SECONDS = 1

export class ProcedureDoctor extends Actor {
  /** The overlay on her entity (the script's action, tools, work point and gaze). */
  readonly overlay = new ActOverlay()
  /** The key of the spot she was sent to last (an anchor name), or null while free. */
  spotKey: string | null = null
  /** Out of sight in her corner between cases. */
  parked = false
  private dismissing = false
  private dismissT = 0

  constructor(
    readonly world: World,
    readonly staff: StaffMember,
    at: Vec2,
    heading: number,
    walker: Walker,
    /** Where she waits, invisible, between cases. */
    private readonly park: { at: Vec2; heading: number },
  ) {
    super(staff.id, staff.role, staff.name, at, heading, walker, 'role')
    this.crowdWalker = world.walkerFor
  }

  /** Walk to a spot (an anchor of the script), facing `face`; the same key again does nothing. */
  goToSpot(key: string, spot: { at: Vec2; heading: number }): void {
    if (this.spotKey === key || this.dismissing) return
    this.spotKey = key
    this.moveTo(spot.at, { face: spot.heading })
  }

  /** Standing still at the spot she was sent to (arrived, not walking, not sliding). */
  get settled(): boolean {
    return this.done && this.mode === 'static'
  }

  /** On her way out (walking to the hall, fading): not available for a case yet. */
  get leaving(): boolean {
    return this.dismissing
  }

  /**
   * Seconds until she is out of the way (parked) from now, 0 when she is not on her way out: `CONFIG.imaging.cryo.doctorLeaveSeconds` after she was dismissed,
   * and never less than `STILL_LEAVING_SECONDS` while she is still leaving (a slow walk past the allowance, up to `DISMISS_LIMIT`: the next case still waits
   * for her, so the answer is never "now" until she is parked).
   */
  leavesIn(): number {
    return this.dismissing ? Math.max(STILL_LEAVING_SECONDS, CONFIG.imaging.cryo.doctorLeaveSeconds - this.dismissT) : 0
  }

  /** The next case: she appears in the hall at `entry` (from her corner), facing `heading`. */
  engage(entry: Vec2, heading: number): void {
    this.parked = false
    this.dismissing = false
    this.spotKey = null
    this.placeAt(entry.x, entry.z, heading)
    this.fadeIn()
  }

  /** The case is over: walk to `out` (the imaging hall in front of the door), fade out and wait in her corner. */
  dismiss(out: Vec2): void {
    if (this.dismissing) return
    this.dismissing = true
    this.dismissT = 0
    this.spotKey = 'leaving'
    this.overlay.clear(this.entity)
    this.moveTo(out)
  }

  think(dt: number, _ctx: PeopleContext): void {
    if (!this.dismissing) return
    this.dismissT += dt
    if (this.hidden) {
      // out of sight: put in her corner, kept in the simulation for the next case
      this.placeAt(this.park.at.x, this.park.at.z, this.park.heading)
      this.dismissing = false
      this.parked = true
      this.spotKey = null
      return
    }
    if (this.fadingOut) return
    if ((this.done && this.mode === 'static') || this.dismissT > DISMISS_LIMIT) this.fadeOut(true)
  }

  /** The entity (for the view's role list and the tests). */
  get e(): Entity {
    return this.entity
  }
}
