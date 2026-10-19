/**
 * The supervising nurse (Nurse Hana, `W4_STAFF` 'draw-nurse'): on site 24/7, one for the three robots. A real person entity. She watches the
 * robots from her spot (anim 'tablet') and works a FIFO of alerts, one at a time (she never handles two at once):
 *
 *   tray     walk to the prep machine, take the patient's labelled tray, carry it to the called robot, put it down, walk back
 *   assist   walk to the robot's chair; the station runs her part (a hand draw, or calming a patient whose arm moved); then, if she drew
 *            tubes by hand, carry them to the manual send station (the pneumatic tube's seventh station, source 3) and send them
 *
 * An alert that no longer fits (its station moved on to another ticket) is skipped. A walk that takes longer than `WALK_TIMEOUT` is
 * finished by placing her at the spot (counted in `stuckFixes`), so a jammed crowd can never freeze a robot's draw.
 */
import { W4_STAFF } from '@/content/staff'
import { bloodText, tubeWord } from '@/content/bloodCopy'
import { Actor } from '../er/actor'
import type { World } from '../er/world'
import type { PeopleContext } from '../people'
import { DRAW_CENTRE, type Spot } from '../places'
import type { Vec2 } from '../types'
import type { Walker } from '../walker'
import type { NursePort, RobotStation } from './station'

type Alert =
  | { kind: 'tray'; station: RobotStation; ticket: string }
  | { kind: 'assist'; station: RobotStation; ticket: string; mode: 'manual' | 'reassure' }

type State = 'idle' | 'toPrep' | 'takingTray' | 'toRobot' | 'handingTray' | 'toAssist' | 'assisting' | 'toSend' | 'sending' | 'returning'

/** A leg of her walk that is not done after this many seconds is finished where she is sent. */
const WALK_TIMEOUT = 45
const TRAY_SECONDS = 1.5
const SEND_SECONDS = 2.5

/** Where she stands at the manual send station: in front of it, on the room side. */
export const MANUAL_SEND_STAND: Spot = { at: { x: DRAW_CENTRE.manualSend.x - 0.45, z: DRAW_CENTRE.manualSend.z - 0.8 }, heading: Math.PI / 2 }

export interface NurseServices {
  /** Is the ticket's labelled tray in the prep rack yet? (The presenter's demo patient is called before its tray is made.) */
  hasTray(ticket: string): boolean
  /** Take a ticket's tray out of the prep rack. */
  takeTray(ticket: string): boolean
  /** A tube she drew by hand goes into the pneumatic tube from the manual send station (source 3). */
  sendByHand(sampleIds: readonly string[]): void
  say(text: string, refs: { subjectId?: string; actorId?: string }): void
}

export class DrawNurse extends Actor implements NursePort {
  readonly onSite = true
  private readonly alerts: Alert[] = []
  private state: State = 'idle'
  private current: Alert | null = null
  private timer = 0
  private legT = 0
  private target: Spot | null = null
  private assistDone = false
  private carrying: string[] = []
  private carryName = ''
  private carryId = ''
  /** Alerts she is working on right now (0 or 1; the test checks it never reaches 2). */
  active = 0
  maxActive = 0
  alertsHandled = 0
  trays = 0
  handDraws = 0
  stuckFixes = 0

  constructor(
    readonly world: World,
    walker: Walker,
    private readonly svc: NurseServices,
  ) {
    const staff = W4_STAFF.find((s) => s.id === 'draw-nurse')!
    super(staff.id, 'nurse', staff.name, DRAW_CENTRE.nurse.at, DRAW_CENTRE.nurse.heading, walker, 'role')
    this.placeAt(DRAW_CENTRE.nurse.at.x, DRAW_CENTRE.nurse.at.z, DRAW_CENTRE.nurse.heading)
    this.entity.anim = 'tablet'
  }

  get id(): string {
    return this.entity.id
  }
  get name(): string {
    return this.entity.name
  }

  /** Alerts waiting (not counting the one she is on). */
  get queued(): number {
    return this.alerts.length
  }
  get busy(): boolean {
    return this.state !== 'idle' && this.state !== 'returning'
  }

  // --- the stations' side ----------------------------------------------------------------------------------------

  bringTray(station: RobotStation, ticket: string): void {
    this.alerts.push({ kind: 'tray', station, ticket })
  }

  assist(station: RobotStation, ticket: string, mode: 'manual' | 'reassure'): void {
    this.alerts.push({ kind: 'assist', station, ticket, mode })
  }

  release(station: RobotStation): void {
    if (this.current?.kind === 'assist' && this.current.station === station) {
      this.assistDone = true
      // the tubes she drew are hers now: the station may move on to its next patient while she walks to the send station
      if (station.handTubes.length > 0) {
        this.carrying = station.handTubes.slice()
        this.carryName = station.state.patientName ?? ''
        this.carryId = station.state.patientId ?? ''
        station.handTubes.length = 0
      }
    }
  }

  // --- per step ---------------------------------------------------------------------------------------------------

  think(dt: number, _ctx: PeopleContext): void {
    switch (this.state) {
      case 'idle':
        this.entity.anim = 'tablet'
        if (this.alerts.length > 0) this.startNext()
        break
      case 'returning':
        if (this.alerts.length > 0) {
          this.startNext()
          break
        }
        if (this.arrived(dt)) {
          this.stand(DRAW_CENTRE.nurse.heading)
          this.entity.anim = 'tablet'
          this.state = 'idle'
        }
        break
      case 'toPrep':
        if (this.arrived(dt)) {
          this.entity.anim = 'give'
          this.timer = TRAY_SECONDS
          this.state = 'takingTray'
        }
        break
      case 'takingTray': {
        const a = this.current as Extract<Alert, { kind: 'tray' }>
        // she waits at the machine until the tray comes out
        if (!this.svc.hasTray(a.ticket) && a.station.state.ticket === a.ticket) break
        this.timer -= dt
        if (this.timer <= 0) {
          this.svc.takeTray(a.ticket)
          this.entity.prop = 'tray'
          this.entity.anim = 'walk'
          this.go(DRAW_CENTRE.robots[a.station.index].assist)
          this.state = 'toRobot'
        }
        break
      }
      case 'toRobot':
        if (this.arrived(dt)) {
          this.entity.anim = 'give'
          this.timer = TRAY_SECONDS
          this.state = 'handingTray'
        }
        break
      case 'handingTray':
        this.timer -= dt
        if (this.timer <= 0) {
          const a = this.current as Extract<Alert, { kind: 'tray' }>
          this.entity.prop = 'none'
          if (a.station.state.ticket === a.ticket) a.station.trayDelivered()
          this.trays++
          this.endAlert()
          this.toNextOrHome()
        }
        break
      case 'toAssist':
        if (this.arrived(dt)) {
          const a = this.current as Extract<Alert, { kind: 'assist' }>
          this.faceTowards(a.station.seat)
          this.entity.anim = a.mode === 'manual' ? 'give' : 'talk'
          this.assistDone = false
          a.station.nurseArrived(this.id)
          this.state = 'assisting'
        }
        break
      case 'assisting': {
        const a = this.current as Extract<Alert, { kind: 'assist' }>
        // the station may have dropped the ticket under her (a safety net): do not wait for a release that never comes
        if (a.station.state.ticket !== a.ticket && !this.assistDone) this.assistDone = true
        if (!this.assistDone) break
        if (a.mode === 'manual') this.handDraws++
        if (this.carrying.length > 0) {
          this.entity.anim = 'walk'
          this.go(MANUAL_SEND_STAND)
          this.state = 'toSend'
        } else {
          this.endAlert()
          this.toNextOrHome()
        }
        break
      }
      case 'toSend':
        if (this.arrived(dt)) {
          this.entity.anim = 'give'
          this.timer = SEND_SECONDS
          this.state = 'sending'
        }
        break
      case 'sending':
        this.timer -= dt
        if (this.timer <= 0) {
          this.svc.sendByHand(this.carrying)
          this.svc.say(bloodText('samplesSentByNurse', { nurse: this.name, tubes: this.carrying.length, tubeWord: tubeWord(this.carrying.length), name: this.carryName }), {
            subjectId: this.carryId || undefined,
            actorId: this.id,
          })
          this.carrying = []
          this.endAlert()
          this.toNextOrHome()
        }
        break
    }
  }

  // --- the alert queue ---------------------------------------------------------------------------------------------

  /** Pop the next alert that still fits and start it. */
  private startNext(): void {
    while (this.alerts.length > 0) {
      const a = this.alerts.shift()!
      if (a.station.state.ticket !== a.ticket) continue // the station moved on: the alert is stale
      this.current = a
      this.active++
      if (this.active > this.maxActive) this.maxActive = this.active
      if (a.kind === 'tray') {
        this.entity.anim = 'walk'
        this.go(DRAW_CENTRE.prep.nurse)
        this.state = 'toPrep'
      } else {
        this.entity.anim = 'walk'
        this.go(DRAW_CENTRE.robots[a.station.index].assist)
        this.state = 'toAssist'
      }
      return
    }
    this.state = this.state === 'idle' ? 'idle' : 'returning'
  }

  private endAlert(): void {
    if (this.current !== null) {
      this.active--
      this.alertsHandled++
    }
    this.current = null
  }

  private toNextOrHome(): void {
    if (this.alerts.length > 0) {
      this.startNext()
      if (this.current !== null) return
    }
    this.entity.anim = 'walk'
    this.go(DRAW_CENTRE.nurse)
    this.state = 'returning'
  }

  // --- walking -------------------------------------------------------------------------------------------------------

  private go(spot: Spot): void {
    this.target = spot
    this.legT = 0
    this.moveTo(spot.at, { face: spot.heading })
  }

  /** The current leg is finished (arrived, or timed out and placed at the spot). */
  private arrived(dt: number): boolean {
    if (this.done) return true
    this.legT += dt
    if (this.legT > WALK_TIMEOUT && this.target !== null) {
      this.stuckFixes++
      const at: Vec2 = this.target.at
      this.placeAt(at.x, at.z, this.target.heading)
      return true
    }
    return false
  }
}
