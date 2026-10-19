/**
 * W4 health kiosks: the guide (W4_STAFF 'kiosk-guide', Nurse Ingrid), on site around the clock. She waits at HEALTH_GUIDE; when a session is assisted
 * (somebody 75 or older, or about one user in seven) she walks to a spot beside that user's platform, talks them through it, and goes
 * back to her post. One guide helps one kiosk at a time (the service reserves her), and an assisted session runs CONFIG.vitals.assistFactor slower.
 */
import type { StaffMember } from '@/content/staff'
import { CONFIG } from '../config'
import { Actor } from '../er/actor'
import { headingTo } from '../er/spots'
import type { PeopleContext } from '../people'
import { HEALTH_GUIDE, HEALTH_KIOSKS, type Spot } from '../places'
import type { Walker } from '../walker'
import { TUNING } from './tuning'

export interface GuideHost {
  /** The kiosk the guide is helping, or -1. */
  guideTarget(): number
}

type State = 'post' | 'toUser' | 'helping' | 'toPost'

/** Where the guide stands to help the user of kiosk `index`: beside the platform on the outer side, clear of every route to it, facing it. */
export function guideSpotFor(index: number): Spot {
  const stand = HEALTH_KIOSKS[index].stand
  const o = TUNING.guideOffset[index] ?? TUNING.guideOffset[0]
  const at = { x: stand.at.x + o.x, z: stand.at.z + o.z }
  return { at, heading: headingTo(at, stand.at) }
}

export class KioskGuide extends Actor {
  state: State = 'post'
  /** The kiosk she is walking to or helping (-1: none). */
  helping = -1

  constructor(
    staff: StaffMember,
    walker: Walker,
    private readonly host: GuideHost,
  ) {
    super(staff.id, 'nurse', staff.name, HEALTH_GUIDE.at, HEALTH_GUIDE.heading, walker, 'role')
    this.cruise = CONFIG.people.walkSpeed * (0.95 + (this.entity.variant % 11) / 100)
  }

  think(_dt: number, _ctx: PeopleContext): void {
    const target = this.host.guideTarget()
    switch (this.state) {
      case 'post':
        if (target >= 0) this.go(target)
        break
      case 'toUser':
      case 'helping': {
        if (target !== this.helping) {
          if (target >= 0) this.go(target)
          else this.goBack()
          break
        }
        if (this.state === 'toUser' && this.done) {
          this.state = 'helping'
          this.entity.anim = 'talk'
        } else if (this.state === 'helping') this.entity.anim = 'talk'
        break
      }
      case 'toPost':
        if (target >= 0) this.go(target)
        else if (this.done) {
          this.state = 'post'
          this.helping = -1
        }
        break
    }
  }

  private go(index: number): void {
    const spot = guideSpotFor(index)
    this.helping = index
    this.state = 'toUser'
    this.moveTo(spot.at, { face: spot.heading })
  }

  private goBack(): void {
    this.helping = -1
    this.state = 'toPost'
    this.moveTo(HEALTH_GUIDE.at, { face: HEALTH_GUIDE.heading })
  }
}
