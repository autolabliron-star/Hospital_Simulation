/**
 * R2: YOU at the teaching console (walk mode). E at the console runs the interaction system's `sitAt` on the seat `console:or:teach` (the same claim, glide and seated
 * pose as any seat), then tells the sim you are teaching (`sim.surgery.setTeaching(true)`) and opens the console card (source 'seat'); the avatar is drawn in the
 * crowd's 'console' pose (head in the viewer, both hands on the controllers) instead of the plain seated one. You leave by E again, a move key or Tab (the
 * interaction system stands you up) or by closing the card (Esc, its close button): this controller sees the seat go, closes the card and clears the flag, and a
 * closed card stands you up. It is view only: nothing you do here changes the sim.
 *
 * The things it reads and writes (the sim, the interaction system's seat, the card's store) come through `TeachingEnv`, so the node tests drive it with fakes;
 * the real ones are the layer's (SurgeryLayer.tsx). `tick` allocates nothing. The interactable (surgeryRegs.ts) reaches the controller through `teachingRegistry`.
 */
import type { AnimState, Entity, PlayerMode, SeatSpec } from '@/sim/types'

/** The teaching console's seat id (scene/rooms/surgery/or.ts). */
export const TEACH_SEAT = 'console:or:teach'

/** The part of the sim this controller reads and writes (a real `Simulation` satisfies it). */
export interface TeachingSim {
  player: { mode: PlayerMode } | null
  readonly playerAvatar: Entity | null
  seats: { byId(id: string): SeatSpec; occupant(id: string): string | null }
  surgery: { setTeaching(on: boolean): void }
}

export interface TeachingEnv {
  sim(): TeachingSim
  /** Sit you on this seat (the interaction system's `sitAt`): false when it is refused. */
  sitAt(seat: SeatSpec): boolean
  /** The seat you are on, or null. */
  seatedOn(): SeatSpec | null
  standUp(): void
  card: { isOpen(): boolean; source(): 'seat' | 'panel'; show(source: 'seat' | 'panel'): void; close(): void }
}

/** What the interactables ask of the controller (so they are tested without it). */
export interface TeachingLike {
  press(): void
  /** You are sitting at the teaching console now. */
  readonly active: boolean
}

/** The running controller, set by the layer while it is mounted (null before, and in tests that do not need it). */
export const teachingRegistry: { current: TeachingLike | null } = { current: null }

const OWN_ANIM: AnimState = 'console'

export class TeachingSession implements TeachingLike {
  active = false
  private simRef: TeachingSim | null = null
  /** Frames since you sat: the card is allowed to be closed by something else only after it had a chance to open. */
  private frames = 0

  constructor(private readonly env: TeachingEnv) {}

  /** E at the teaching console: sit down (or, when you are already there, stand up). */
  press(): void {
    const sim = this.env.sim()
    if (sim !== this.simRef) this.adopt(sim)
    if (this.active) {
      this.env.standUp()
      return
    }
    const me = sim.player
    if (!me || me.mode !== 'walk') return
    const seat = sim.seats.byId(TEACH_SEAT)
    if (sim.seats.occupant(seat.id) !== null) return
    if (!this.env.sitAt(seat)) return
    this.active = true
    this.frames = 0
    sim.surgery.setTeaching(true)
    this.env.card.show('seat')
  }

  /** The session is over (you stood up, or something took you off the seat): clear the flag and the card. */
  private end(sim: TeachingSim): void {
    if (!this.active) return
    this.active = false
    sim.surgery.setTeaching(false)
    if (this.env.card.isOpen() && this.env.card.source() === 'seat') this.env.card.close()
    const av = sim.playerAvatar
    if (av && av.anim === OWN_ANIM) av.anim = 'idle'
  }

  /** A Jump replaced the hospital: nothing of the old one carries over (the old sim's flag died with it). */
  private adopt(sim: TeachingSim): void {
    const swapped = this.simRef !== null
    this.simRef = sim
    this.active = false
    this.frames = 0
    if (swapped && this.env.card.isOpen() && this.env.card.source() === 'seat') this.env.card.close()
  }

  /** Per frame, after the interaction system has seated or stood you: keep the console pose, and end the session when you are no longer on the seat. */
  tick(): void {
    const sim = this.env.sim()
    if (sim !== this.simRef) this.adopt(sim)
    if (!this.active) return
    const me = sim.player
    const seat = this.env.seatedOn()
    const onSeat = seat !== null && seat.id === TEACH_SEAT
    if (!me || me.mode !== 'walk' || !onSeat) {
      this.end(sim)
      return
    }
    // the card was closed (Esc, its button): stand up, and the next look ends the session
    if (this.frames > 2 && !this.env.card.isOpen()) {
      this.env.standUp()
      this.end(sim)
      return
    }
    this.frames++
    const av = sim.playerAvatar
    if (av) av.anim = OWN_ANIM
  }
}
