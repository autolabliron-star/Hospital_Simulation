/**
 * R4: the cryoablation team (CRYO_STAFF without the porter): the interventional radiologist, the CT radiographer and the sedation nurse. They
 * are on level 2 from CONFIG.cryoSuite.teamFromHour to teamToHour, appearing and leaving in the control room (`staff.base`). Each one's place is
 * a pure function of the room's situation (`CryoContext`), so a warm start and a live run agree:
 *
 *   radiologist   talks to the patient at the robot's side in sedation; at the robot station (control room) to plan; pushes each needle through
 *                 the guide; at the cryo console for the freezes and thaws; takes the needles out and dresses the sites; at the control seats
 *                 for every scan
 *   radiographer  helps the patient across at the table's foot, runs the CT from its console seat, wipes the room down in the turnover,
 *                 and does the CT's checks at the table between cases
 *   nurse         gives the sedation at the head end and watches from there (the case borrows her to push the stretcher to recovery)
 *
 * The case borrows a person (`acquire`) and gives them back; meanwhile their routine is suspended. The ward porter is not here: he exists only
 * during his transfers (index.ts).
 */
import { CRYO_STAFF } from '@/content/staff'
import type { World } from '../er/world'
import type { Spot } from '../places'
import type { CryoStep, SeatSpec } from '../types'
import { Staffer, type Task, type Title } from '../surgery/actors'
import type { SeatRef } from '../surgery/sites'
import type { CryoSites } from './sites'

/** The situation the routine reads, written by the suite (reused, allocation-free). */
export interface CryoContext {
  now: number
  /** The room's step ('idle' when nobody is in the room and no turnover runs). */
  step: CryoStep
  since: number
  until: number | null
  /** The working day is over and nobody is in the room: everybody goes to the control room and leaves. */
  dayOver: boolean
}

export function newCryoContext(): CryoContext {
  return { now: 0, step: 'idle', since: 0, until: null, dayOver: false }
}

type TeamTitle = Extract<Title, 'ir' | 'ctRadiographer' | 'sedation'>
const TEAM_TITLES: readonly TeamTitle[] = ['ir', 'ctRadiographer', 'sedation']
/** Which control-room base spot each one uses. */
const BASE_INDEX: Record<TeamTitle, number> = { ir: 1, ctRadiographer: 0, sedation: 2 }

interface Want {
  key: string
  spot: Spot
  anim: Task['anim']
  seat?: SeatRef
}

export class CryoTeam {
  readonly staffers: Staffer[] = []
  private readonly byTitle = new Map<Title, Staffer>()
  private readonly held = new Map<string, SeatRef>()

  constructor(
    readonly world: World,
    readonly sites: CryoSites,
  ) {}

  get present(): boolean {
    return this.staffers.length > 0
  }

  get(title: Title): Staffer | null {
    return this.byTitle.get(title) ?? null
  }

  /** Create the three in the control room (`fadeIn`) or, for a warm start, where their routine puts them. */
  spawn(ctx: CryoContext, warm: boolean): void {
    if (this.staffers.length > 0) return
    for (const member of CRYO_STAFF) {
      if (!TEAM_TITLES.includes(member.title as TeamTitle)) continue
      const title = member.title as TeamTitle
      const spot = this.sites.spots.base[BASE_INDEX[title] % this.sites.spots.base.length]
      const outfit = title === 'ctRadiographer' ? 'role' : 'theatre'
      const s = new Staffer(this.world, member, title, spot.at, spot.heading, this.world.walkerFor(member.id), outfit)
      this.staffers.push(s)
      this.byTitle.set(title, s)
      this.world.hooks.add(s)
      if (!warm) s.fadeIn()
    }
    if (warm) this.settleAll(ctx)
  }

  /** Warm start: everybody not lent out to their place now, at once. */
  settleAll(ctx: CryoContext): void {
    for (const s of this.staffers) {
      if (s.engagedBy !== null) continue
      s.settleTask(this.taskFor(s, this.want(s, ctx)))
    }
  }

  /** Lend a person out for `owner`'s job; null when lent to somebody else or leaving. */
  acquire(title: Title, owner: string): Staffer | null {
    const s = this.byTitle.get(title)
    if (!s || s.gone || s.fadingOut) return null
    if (s.engagedBy !== null && s.engagedBy !== owner) return null
    s.engagedBy = owner
    // (a borrowed person gives up the seat the routine gave them)
    const old = this.held.get(s.staff.id)
    if (old !== undefined) {
      this.sites.release(old, s.staff.id)
      this.held.delete(s.staff.id)
    }
    return s
  }

  release(title: Title, owner: string): void {
    const s = this.byTitle.get(title)
    if (s && s.engagedBy === owner) s.engagedBy = null
  }

  releaseAll(owner: string): void {
    for (const s of this.staffers) if (s.engagedBy === owner) s.engagedBy = null
  }

  /** Give everyone not lent out the place their routine says (setting the same task again is free). */
  assign(ctx: CryoContext): void {
    for (const s of this.staffers) {
      if (s.engagedBy !== null || s.gone || s.fadingOut) continue
      s.setTask(this.taskFor(s, this.want(s, ctx)))
    }
  }

  /** The day is over and everyone is at their base spot: fade them out. True once all are gone. */
  dismiss(): boolean {
    let allGone = true
    for (const s of this.staffers) {
      if (s.gone) continue
      allGone = false
      if (s.engagedBy === null && s.isAt('base') && !s.fadingOut) s.fadeOut()
    }
    return allGone
  }

  /** Forget everyone (the people were removed by the caller). */
  clear(): void {
    for (const s of this.staffers) this.sites.releaseAll(s.staff.id)
    this.staffers.length = 0
    this.byTitle.clear()
    this.held.clear()
  }

  // --- the routine ----------------------------------------------------------------------------------------------------

  private taskFor(s: Staffer, w: Want): Task {
    const id = s.staff.id
    let seat: SeatSpec | null = null
    const old = this.held.get(id)
    if (w.seat !== undefined) {
      if (this.sites.claim(w.seat, id)) {
        seat = w.seat.seat
        if (old !== undefined && old !== w.seat) this.sites.release(old, id)
        this.held.set(id, w.seat)
      }
    } else if (old !== undefined) {
      this.sites.release(old, id)
      this.held.delete(id)
    }
    return { key: w.key, at: seat ? seat.approach : w.spot.at, face: w.spot.heading, anim: w.anim, seat }
  }

  private seatWant(key: string, ref: SeatRef): Want {
    return { key, spot: { at: ref.seat.approach, heading: ref.seat.heading }, anim: 'console', seat: ref }
  }

  private base(s: Staffer): Want {
    const title = s.title as TeamTitle
    return { key: 'base', spot: this.sites.spots.base[BASE_INDEX[title] % this.sites.spots.base.length], anim: 'idle' }
  }

  private want(s: Staffer, c: CryoContext): Want {
    const sp = this.sites.spots
    if (c.dayOver) return this.base(s)
    const step = c.step
    const scan = step === 'planningCt' || step === 'checkCt' || step === 'finalCt'
    switch (s.title) {
      case 'ir':
        switch (step) {
          case 'arrive':
          case 'planning':
            return this.seatWant('ir:station', this.sites.robotStation)
          case 'sedation':
            return { key: 'ir:talk', spot: sp.insert, anim: 'talk' }
          case 'aim':
          case 'needlesOut':
          case 'dressing':
            return { key: 'ir:insert', spot: sp.insert, anim: 'give' }
          case 'freeze1':
          case 'thaw':
          case 'freeze2':
          case 'activeThaw':
            return { key: 'ir:console', spot: sp.atConsole, anim: 'give' }
          case 'idle':
            // between cases: at the robot station, reviewing the next plan
            return this.seatWant('ir:station', this.sites.robotStation)
          default:
            if (scan) return this.seatWant('ir:station', this.sites.robotStation)
            return this.base(s)
        }
      case 'ctRadiographer':
        switch (step) {
          case 'arrive':
          case 'dressing':
            return { key: 'rad:assist', spot: sp.assist, anim: 'give' }
          case 'turnover': {
            const n = sp.clean.length
            const d = c.until !== null ? Math.max(1, c.until - c.since) : 1
            const k = Math.max(0, Math.min(n - 1, Math.floor(((c.now - c.since) / d) * n)))
            return { key: `rad:clean${k}`, spot: sp.clean[k], anim: 'clean' }
          }
          case 'idle':
            // between cases: the CT's daily checks at the table (the scan room is never left empty while the team is on site)
            return { key: 'rad:qa', spot: sp.assist, anim: 'tablet' }
          case 'out':
            return this.base(s)
          default:
            return this.seatWant('rad:ct', this.sites.ctConsole)
        }
      case 'sedation':
        switch (step) {
          case 'arrive':
            return { key: 'nurse:head', spot: sp.sedation, anim: 'idle' }
          case 'sedation':
            return { key: 'nurse:give', spot: sp.sedation, anim: 'give' }
          case 'idle':
          case 'turnover':
          case 'out':
          case 'dressing':
            return this.base(s)
          default:
            return { key: 'nurse:watch', spot: sp.sedation, anim: 'tablet' }
        }
      default:
        return this.base(s)
    }
  }
}
