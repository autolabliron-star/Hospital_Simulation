/**
 * W4: YOU at a health kiosk (walk mode). E at the kiosk calls `sim.vitals.beginPlayer(i)`; the vitals service runs the session (phases, readings, the cuff) and
 * this controller is the scene's half: it steps you onto the weighing platform, poses your avatar for each phase, seats you on the BP stool for the cuff
 * (the interaction system's SeatSession, `sitAt`), stands you up for the forehead thermometer and the report, lifts you 5 cm while you stand on the platform,
 * and tells the health card to open. It never decides anything about the measurements.
 *
 *   login            you step onto the platform facing the tower, finger out to the reader      anim 'finger'
 *   height, weight   standing under the ultrasonic sensor, still on the platform                 anim 'idle'
 *   bodyFat          both hands on the handles                                                   anim 'grip'
 *   sit              you glide to the stool                                                      anim 'sit' then 'armIn'
 *   spo2, bp, bpRest the left arm in the cuff tunnel                                              anim 'armIn'
 *   temp             you stand up and step back onto the platform                                anim 'idle'
 *   report           finger out for the printed slip                                             anim 'finger'
 *
 * You leave the session by walking away (the service ends it itself beyond 1.5 m from the platform), by E at the kiosk, by standing up from the stool
 * (E or a move key) or by Esc on the card: the reading so far is kept and the card turns into a partial slip. `tick` allocates nothing; the node tests drive it
 * with a fake environment (healthCheck.test.ts).
 *
 * The controller is created and ticked by the kiosk layer (src/scene/kiosks/KioskLayer.tsx); the interactables reach it through `healthCheckRegistry`, so the
 * registrations never import the layer.
 */
import { KIOSK_UI } from '@/content/kioskUi'
import { PLATFORM } from '@/scene/kiosks/layout'
import { HEALTH_KIOSKS } from '@/sim/places'
import type { AnimState, Entity, HealthKioskPhase, HealthKioskState, PlayerMode, SeatSpec } from '@/sim/types'

/** The seconds it takes to step onto the platform or from the stool back to it. */
export const GLIDE_SECONDS = 0.7
/** The platform lifts you (and lets you down) at its own height over this long (the service's `platformRiseSeconds`). */
export const PLATFORM_RISE_SECONDS = 0.4
/** The card closes when you are further than this from the platform you used (m). */
export const CARD_FAR = 3.2
/** A session that has not shown a phase after this long (s) is taken as never started. */
export const START_GRACE_SECONDS = 1.5
/** The stool glide takes this long; the arm goes in after it. */
export const SIT_ARM_SECONDS = 0.6
/** The stool's seat id for kiosk `i` (built once: the frame path compares them every frame). */
const STOOL_IDS: readonly string[] = HEALTH_KIOSKS.map((_, i) => `kioskBp:${i}`)
export const stoolId = (i: number): string => STOOL_IDS[i]

/** The part of the sim this controller reads and writes (a real `Simulation` satisfies it). */
export interface HealthSim {
  player: { x: number; z: number; heading: number; speed: number; mode: PlayerMode } | null
  readonly playerAvatar: Entity | null
  vitals: { kiosks: readonly HealthKioskState[]; beginPlayer(index: number): 'started' | 'busy'; cancelPlayer(): void }
  seats: { byId(id: string): SeatSpec; occupant(id: string): string | null; release(id: string, occupantId?: string): void }
  movePlayer(x: number, z: number, heading: number, speed: number): void
}

export interface HealthEnv {
  sim(): HealthSim
  /** Sit you on this seat (the interaction system's `sitAt`): false when it is refused. */
  sitAt(seat: SeatSpec): boolean
  /** The seat you are on, or null. */
  seatedOn(): SeatSpec | null
  standUp(): void
  /** Put the player system's own position (and so the camera) here. */
  place(x: number, z: number, heading: number): void
  toast(text: string): void
  card: { isOpen(): boolean; kiosk(): number; show(kiosk: number): void; close(): void }
}

/** What the kiosk interactables ask of the controller (so they are tested without it). */
export interface HealthCheckLike {
  press(kiosk: number): void
  /** Your session is running on this kiosk. */
  runningOn(kiosk: number): boolean
  /** Your card is open for this kiosk. */
  cardOpenFor(kiosk: number): boolean
}

/** The running controller, set by the kiosk layer while it is mounted (null before, and in tests that do not need it). */
export const healthCheckRegistry: { current: HealthCheckLike | null } = { current: null }

const OWN_ANIMS: ReadonlySet<AnimState> = new Set<AnimState>(['finger', 'grip', 'armIn'])

/** The pose of each phase while you are standing (the seated phases are handled in `poseFor`). */
function standingAnim(phase: HealthKioskPhase): AnimState {
  switch (phase) {
    case 'login':
    case 'report':
      return 'finger'
    case 'bodyFat':
      return 'grip'
    default:
      return 'idle'
  }
}

/** Is a point on the weighing platform of either kiosk? */
export function onPlatform(x: number, z: number): boolean {
  for (let i = 0; i < HEALTH_KIOSKS.length; i++) {
    const s = HEALTH_KIOSKS[i].stand.at
    if (Math.abs(x - s.x) <= PLATFORM.w / 2 && Math.abs(z - s.z) <= PLATFORM.d / 2) return true
  }
  return false
}

export class HealthCheck implements HealthCheckLike {
  /** The kiosk of your running session, or -1. */
  kiosk = -1
  private simRef: HealthSim | null = null
  private elapsed = 0
  private sawActive = false
  private everSeated = false
  /** Your avatar's height above the floor from the platform (0 or `PLATFORM.h`, eased). */
  y = 0
  // the glide onto the platform or back to it: preallocated, nothing is created per frame
  private gliding = false
  private gt = 0
  private fx = 0
  private fz = 0
  private fh = 0
  private tx = 0
  private tz = 0
  private th = 0

  constructor(private readonly env: HealthEnv) {}

  get active(): boolean {
    return this.kiosk >= 0
  }
  runningOn(kiosk: number): boolean {
    return this.kiosk === kiosk
  }
  cardOpenFor(kiosk: number): boolean {
    return this.env.card.isOpen() && this.env.card.kiosk() === kiosk
  }

  // --- E ---------------------------------------------------------------------------------------

  /** E at kiosk `i`: begin your session, or (your session running there) leave it, or (the report open) close the report. */
  press(i: number): void {
    const sim = this.env.sim()
    if (sim !== this.simRef) this.adopt(sim)
    if (this.kiosk === i) {
      this.cancel(sim)
      this.env.card.close()
      return
    }
    if (this.kiosk < 0 && this.cardOpenFor(i)) {
      this.env.card.close()
      return
    }
    this.begin(sim, i)
  }

  private begin(sim: HealthSim, i: number): void {
    const me = sim.player
    if (!me || me.mode !== 'walk') return
    if (this.kiosk >= 0) this.cancel(sim)
    if (sim.vitals.beginPlayer(i) === 'busy') {
      this.env.toast(KIOSK_UI.prompt.busyToast)
      return
    }
    this.kiosk = i
    this.elapsed = 0
    this.sawActive = false
    this.everSeated = false
    this.env.card.show(i)
    const stand = HEALTH_KIOSKS[i].stand
    this.startGlide(me.x, me.z, me.heading, stand.at.x, stand.at.z, stand.heading)
    this.env.place(stand.at.x, stand.at.z, stand.heading)
  }

  // --- leaving ---------------------------------------------------------------------------------

  /** Cut your session short (the reading so far is kept) and let go of the stool. */
  cancel(sim: HealthSim): void {
    if (this.kiosk < 0) return
    sim.vitals.cancelPlayer()
    this.finish(sim)
  }

  /** The session is over (it ended, or you cut it short): stand up from the stool, put your pose back. The card stays: it is now the report. */
  private finish(sim: HealthSim): void {
    const i = this.kiosk
    this.kiosk = -1
    this.gliding = false
    const seat = this.env.seatedOn()
    if (seat !== null && seat.id === stoolId(i)) this.env.standUp()
    const av = sim.playerAvatar
    if (av && OWN_ANIMS.has(av.anim)) av.anim = 'idle'
  }

  /** A Jump replaced the hospital: nothing of the old one carries over. */
  private adopt(sim: HealthSim): void {
    const swapped = this.simRef !== null
    this.simRef = sim
    this.kiosk = -1
    this.gliding = false
    this.y = 0
    this.elapsed = 0
    // (the first sim this controller sees is not a Jump: whatever card is open stays)
    if (swapped && this.env.card.isOpen()) this.env.card.close()
  }

  // --- per frame -------------------------------------------------------------------------------

  tick(dt: number): void {
    const sim = this.env.sim()
    if (sim !== this.simRef) this.adopt(sim)
    const me = sim.player
    const av = sim.playerAvatar
    if (!me || !av) {
      this.kiosk = -1
      return
    }
    if (me.mode !== 'walk') {
      // the overview has no cards (like the MedDrawer card): the session ends and the card goes
      if (this.kiosk >= 0) this.cancel(sim)
      if (this.env.card.isOpen()) this.env.card.close()
      return
    }
    if (this.kiosk >= 0) this.session(sim, me, av, dt)
    this.liftOnPlatform(av, me.x, me.z, dt)
    if (this.env.card.isOpen()) this.watchCard(me.x, me.z)
  }

  private session(sim: HealthSim, me: NonNullable<HealthSim['player']>, av: Entity, dt: number): void {
    const i = this.kiosk
    const k = sim.vitals.kiosks[i]
    this.elapsed += dt
    const mine = k.kind === 'player' && k.phase !== 'idle'
    if (mine) this.sawActive = true
    else if (this.sawActive || this.elapsed > START_GRACE_SECONDS) {
      // finished, cancelled by the service (you walked away) or never started
      this.finish(sim)
      return
    }
    const phase = k.phase
    const seatedPhase = phase === 'sit' || phase === 'spo2' || phase === 'bp' || phase === 'bpRest'
    const seat = this.env.seatedOn()
    const onStool = seat !== null && seat.id === stoolId(i)
    if (seatedPhase) {
      if (!onStool) {
        if (this.everSeated) {
          // you stood up (E or a move key) in the middle of the cuff: the session ends with what it has
          this.cancel(sim)
          return
        }
        if (!this.sit(sim, i)) {
          this.cancel(sim)
          return
        }
        this.everSeated = true
        this.gliding = false
      }
    } else if (this.everSeated && onStool) {
      // temp and report are standing: up from the stool, back onto the platform
      this.env.standUp()
      const stand = HEALTH_KIOSKS[i].stand
      this.startGlide(me.x, me.z, me.heading, stand.at.x, stand.at.z, stand.heading)
      this.env.place(stand.at.x, stand.at.z, stand.heading)
    }

    if (this.gliding) this.stepGlide(sim, dt)
    else if (!seatedPhase && this.tooFar(me.x, me.z, i)) {
      this.cancel(sim)
      return
    }
    this.pose(av, me.speed, k)
  }

  /** Sit on the stool: the service never claims it for you, but if it did, give it back first. */
  private sit(sim: HealthSim, i: number): boolean {
    const id = stoolId(i)
    if (sim.seats.occupant(id) === 'player') sim.seats.release(id, 'player')
    return this.env.sitAt(sim.seats.byId(id))
  }

  private tooFar(x: number, z: number, i: number): boolean {
    const s = HEALTH_KIOSKS[i].stand.at
    return this.elapsed > 2.5 && Math.hypot(x - s.x, z - s.z) > 1.5
  }

  private startGlide(fx: number, fz: number, fh: number, tx: number, tz: number, th: number): void {
    this.gliding = true
    this.gt = 0
    this.fx = fx
    this.fz = fz
    this.fh = fh
    this.tx = tx
    this.tz = tz
    this.th = th
  }

  /** The avatar glides from where you were to the platform (the player's own body is already there): a quick walk, turning to face the tower. */
  private stepGlide(sim: HealthSim, dt: number): void {
    this.gt += dt
    const k = this.gt >= GLIDE_SECONDS ? 1 : this.gt / GLIDE_SECONDS
    const e = k * k * (3 - 2 * k)
    let dh = (this.th - this.fh) % (Math.PI * 2)
    if (dh > Math.PI) dh -= Math.PI * 2
    else if (dh < -Math.PI) dh += Math.PI * 2
    const dist = Math.hypot(this.tx - this.fx, this.tz - this.fz)
    sim.movePlayer(this.fx + (this.tx - this.fx) * e, this.fz + (this.tz - this.fz) * e, this.fh + dh * e, k >= 1 ? 0 : dist / GLIDE_SECONDS)
    if (k >= 1) this.gliding = false
  }

  /** Your pose for this phase. The player system owns it while you walk; a glide is a walk. */
  private pose(av: Entity, speed: number, k: HealthKioskState): void {
    if (this.gliding) {
      av.anim = 'walk'
      return
    }
    if (speed > 0.05) return
    const phase = k.phase
    if (phase === 'sit') av.anim = k.phaseTime >= SIT_ARM_SECONDS ? 'armIn' : 'sit'
    else if (phase === 'spo2' || phase === 'bp' || phase === 'bpRest') av.anim = 'armIn'
    else av.anim = standingAnim(phase)
  }

  /** The weighing platform raises you 5 cm while you stand on it (and lets you down when you step off or sit). The player system puts your height back to the floor every frame, so it is written every frame while you are up. */
  private liftOnPlatform(av: Entity, x: number, z: number, dt: number): void {
    const seat = this.env.seatedOn()
    const target = seat === null && onPlatform(x, z) ? PLATFORM.h : 0
    if (this.y !== target) {
      const step = (PLATFORM.h / PLATFORM_RISE_SECONDS) * dt
      const d = target - this.y
      this.y = Math.abs(d) <= step ? target : this.y + Math.sign(d) * step
    }
    if (this.y > 0) av.position.y = this.y
  }

  /** The card follows you: it closes once you are well away from the kiosk it shows. */
  private watchCard(x: number, z: number): void {
    const s = HEALTH_KIOSKS[this.env.card.kiosk()]?.stand.at
    if (s && Math.hypot(x - s.x, z - s.z) > CARD_FAR) this.env.card.close()
  }
}
