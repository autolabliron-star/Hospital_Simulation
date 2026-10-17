/**
 * The interaction system (W1): one object that runs "press E" once a frame (R3F priority -8, after the player and the chase camera
 * have moved you). Plain state, no React; `tick` allocates nothing per frame (candidates live in a pool, the arrays it scans are
 * rebuilt only when the registry, the roster or the hospital changes, and the prompt is built at 10 Hz at most).
 *
 *   each frame    drain the speech lines the hospital wants shown (greetings), keep your seated pose, say whether an overlay
 *                 owns your input (`walkCam.inputBlocked`: you stand still), and, in walk mode with nothing open, pick the best
 *                 target (picker.ts) from the registered interactables, the free seats and the people around you
 *   4 Hz          follow your order (yourOrder.ts) and write the objective line
 *   10 Hz         write the prompt ("E · Prescribe for Grace Adeyemi") when it changed
 *   E             `press()` runs the target: an interactable's action, sit down, or talk
 *   a Jump        (`generation` changed) forget the prompt, the objective, your order and your seat
 *
 * Everything the world gives it comes through `SystemEnv`, so node tests drive it with a real Simulation and a fake clock.
 */
import { WALK, fillWalk, keyLabel } from '@/content/walk'
import { say } from '@/scene/fx/bubbleStore'
import { labelOf, type Interactable } from '@/scene/interact.store'
import { useWalk, walkCam } from '@/scene/player/state'
import { CONFIG } from '@/sim/config'
import { roomById } from '@/sim/places'
import type { Simulation } from '@/sim/Simulation'
import { DEFAULT_KEYMAP, type Entity, type PlayerMode, type SeatSpec } from '@/sim/types'
import { useDrawerCard } from '@/ui/walk/drawerCard.store'
import { useRx } from '@/ui/walk/rx.store'
import { showToast } from '@/ui/walk/toast.store'
import { CandidatePool, addItems, addPeople, addSeats, newPickResult, pickBest, sittableSeats, type Candidate, type Facing, type PickResult, type TargetKind } from './picker'
import { drawerFaceZ } from './registrations'
import { SeatSession } from './seats'
import { YourOrder, simOrderHost, type OrderHost, type YourOrderView } from './yourOrder'
import { useYourOrder } from './yourOrder.store'

/** How long a greeting stays over a head (real seconds). Replies to you stay as long as the hold on the person you talked to. */
export const GREETING_SECONDS = 3.5

/** The prompt is written at most this often. */
export const PROMPT_EVERY_MS = 100
/** Your order is looked at this often. */
export const ORDER_EVERY_MS = 250
/** The drawer card closes when you are further than this from the drawer. */
export const DRAWER_CARD_FAR = 3.2

export interface SystemEnv {
  /** The running hospital (a live binding: a Jump swaps it). */
  sim(): Simulation
  /** Bumped on every Jump. */
  generation(): number
  /** Real time in milliseconds. */
  now(): number
  /** The interactable registry's items (the same Map object until something registers). */
  items(): ReadonlyMap<string, Interactable>
  /** A panel, menu or tablet is open and owns the keyboard and mouse. */
  overlayOpen(): boolean
  /** Close the room panel, the prescribing tablet and the drawer card (the overview's panels do not follow you into walk mode). */
  closeOverlays(): void
  /** Put the player system's own position (and so the camera) here: on a seat, and in front of it when you stand up. */
  placePlayer?(x: number, z: number, heading: number): void
}

/** Shown over a head. A module function, so the drain callback is made once, not per frame. */
function showBubble(entityId: string, text: string): void {
  say(entityId, text, GREETING_SECONDS)
}

export class InteractionSystem {
  readonly seat: SeatSession
  readonly order = new YourOrder()
  private readonly orderHost: OrderHost

  private readonly pool = new CandidatePool()
  private readonly who: Facing = { x: 0, z: 0, heading: 0 }
  private readonly res: PickResult = newPickResult()
  private items: Interactable[] = []
  private itemsRef: ReadonlyMap<string, Interactable> | null = null
  private people: Entity[] = []
  private peopleSim: Simulation | null = null
  private peopleVersion = -1
  private seats: readonly SeatSpec[] = []
  private simRef: Simulation | null = null
  private generation = Number.NaN

  private curId: string | null = null
  private curKind: TargetKind | null = null
  private curRef: Candidate['ref'] = null
  private curEnabled = false

  private promptShown: string | null = null
  private objectiveShown: string | null = null
  private nextPromptAt = 0
  private nextOrderAt = 0
  private lastMode: PlayerMode | null = null
  /** Your avatar is holding the tablet (the prescribing panel is open). */
  private tabletOn = false
  private readonly keyCap = keyLabel(DEFAULT_KEYMAP.interact)
  private readonly isFree = (id: string): boolean => this.simRef !== null && this.simRef.seats.occupant(id) === null

  constructor(private readonly env: SystemEnv) {
    this.seat = new SeatSession(env.placePlayer)
    this.orderHost = simOrderHost(() => env.sim(), () => env.now())
  }

  // --- what the HUD and the tests can ask ------------------------------------------------------

  /** The target E would run now (null: nothing in reach, or an overlay is open, or you are seated). */
  get target(): { id: string; kind: TargetKind; enabled: boolean } | null {
    return this.curId === null || this.curKind === null ? null : { id: this.curId, kind: this.curKind, enabled: this.curEnabled }
  }

  /** The prompt as it would read now, built fresh (the HUD gets it through `useWalk.prompt` at 10 Hz). */
  promptNow(): string | null {
    if (this.seat.active) return `${this.keyCap} · ${WALK.prompt.standUp}`
    if (this.curKind === null) return null
    const label = this.labelOfTarget()
    return this.curEnabled ? `${this.keyCap} · ${label}` : label
  }

  /** Your order, for the minimap. */
  yourOrder(): YourOrderView | null {
    return this.order.current()
  }

  // --- per frame -------------------------------------------------------------------------------

  tick(dt: number): void {
    const sim = this.env.sim()
    const now = this.env.now()
    const generation = this.env.generation()
    if (sim !== this.simRef || generation !== this.generation) this.adopt(sim, generation)

    sim.reactions.drainBubbles(showBubble)

    const me = sim.player
    const mode = me ? me.mode : null
    if (mode !== this.lastMode) {
      // the panels of the overview do not follow you into walk mode
      if ((mode === 'toWalk' || mode === 'walk') && this.lastMode !== 'toWalk' && this.lastMode !== 'walk') this.env.closeOverlays()
      this.lastMode = mode
    }
    const walking = me !== null && mode === 'walk'

    // seated: keep the pose; stand up if you left walk mode
    if (this.seat.active) {
      if (walking) this.seat.step(sim, dt)
      else if (me) this.seat.stand(sim)
      else this.seat.forget()
    }

    this.holdTablet(sim, walking)

    const overlay = this.env.overlayOpen()
    this.syncBlock(overlay)

    if (now >= this.nextOrderAt) {
      this.nextOrderAt = now + ORDER_EVERY_MS
      this.followOrder()
    }

    if (walking && me && !overlay && !this.seat.active) {
      this.who.x = me.x
      this.who.z = me.z
      this.who.heading = me.heading
      this.gather(sim)
    } else if (this.curId !== null) {
      this.clearTarget()
      this.nextPromptAt = 0
    }

    if (walking && me) this.watchDrawerCard(me.x, me.z)
    else if (useDrawerCard.getState().roomId !== null) useDrawerCard.getState().close()

    if (now >= this.nextPromptAt) {
      this.nextPromptAt = now + PROMPT_EVERY_MS
      this.publishPrompt(walking ? this.promptNow() : null)
    }
  }

  // --- E ---------------------------------------------------------------------------------------

  /** Run what E would do now. True if it did something (the key is consumed). */
  press(): boolean {
    const sim = this.env.sim()
    const me = sim.player
    if (!me || me.mode !== 'walk' || this.env.overlayOpen()) return false
    if (this.seat.active) {
      this.standUp()
      return true
    }
    if (this.curKind === null || !this.curEnabled) return false
    const kind = this.curKind
    const ref = this.curRef
    this.clearTarget()
    this.nextPromptAt = 0
    if (kind === 'item') (ref as Interactable).onInteract()
    else if (kind === 'seat') this.sit(sim, ref as SeatSpec)
    else this.talk(sim, ref as Entity)
    return true
  }

  /** Stand up from a seat (a move key, or E again). */
  standUp(): void {
    if (!this.seat.active) return
    this.seat.stand(this.env.sim())
    this.nextPromptAt = 0
  }

  /** While the prescribing panel is open you are drawn with the tablet out; the player system leaves a pose like that alone while you stand still. */
  private holdTablet(sim: Simulation, walking: boolean): void {
    const av = sim.playerAvatar
    if (!av) {
      this.tabletOn = false
      return
    }
    if (walking && this.seat.active === null && useRx.getState().open) {
      av.anim = 'tablet'
      this.tabletOn = true
    } else if (this.tabletOn) {
      this.tabletOn = false
      if (av.anim === 'tablet') av.anim = av.speed > 0.05 ? 'walk' : 'idle'
    }
  }

  /**
   * An overlay (the tablet, the room panel, a menu) owns the keyboard and mouse: tell the player system, which stands you still,
   * lets go of the keys and gives the pointer back. Sitting is not one: you can look around from a seat, and the move key that
   * stands you up must still reach the player (so it walks you off).
   */
  private syncBlock(overlay: boolean): void {
    if (walkCam.inputBlocked !== overlay) walkCam.inputBlocked = overlay
  }

  /** Forget everything and give the player their input back (the layer unmounts). */
  dispose(): void {
    const sim = this.env.sim()
    if (this.seat.active) this.seat.stand(sim)
    this.holdTablet(sim, false)
    this.order.reset()
    this.clearTarget()
    this.publishPrompt(null)
    this.publishObjective(null)
    useYourOrder.getState().set(null)
    if (walkCam.inputBlocked) walkCam.inputBlocked = false
    this.simRef = null
    this.generation = Number.NaN
  }

  // --- internals -------------------------------------------------------------------------------

  /** A new hospital (the first frame, or a Jump): nothing of the old one carries over. */
  private adopt(sim: Simulation, generation: number): void {
    const first = this.simRef === null
    this.simRef = sim
    this.generation = generation
    this.seat.forget()
    this.tabletOn = false
    this.order.reset()
    this.clearTarget()
    this.seats = sittableSeats(sim.seats.all)
    this.peopleVersion = -1
    this.nextOrderAt = 0
    this.nextPromptAt = 0
    if (!first) {
      this.publishPrompt(null)
      this.publishObjective(null)
      useYourOrder.getState().set(null)
      useDrawerCard.getState().close()
    }
  }

  private followOrder(): void {
    const view = this.order.poll(this.orderHost)
    this.publishObjective(view?.text ?? null)
    if (useYourOrder.getState().view !== view) useYourOrder.getState().set(view)
  }

  private gather(sim: Simulation): void {
    const items = this.env.items()
    if (items !== this.itemsRef) {
      this.itemsRef = items
      this.items = [...items.values()]
    }
    if (sim !== this.peopleSim || sim.rosterVersion !== this.peopleVersion) {
      this.peopleSim = sim
      this.peopleVersion = sim.rosterVersion
      this.people.length = 0
      for (const e of sim.entities.values()) this.people.push(e)
    }
    const pool = this.pool
    pool.begin()
    addItems(pool, this.who, this.items)
    addSeats(pool, this.who, this.seats, this.isFree)
    addPeople(pool, this.who, this.people)
    if (pickBest(this.who, pool.items, pool.count, this.curId, this.res)) {
      const c = pool.items[this.res.index]
      this.curId = c.id
      this.curKind = c.kind
      this.curRef = c.ref
      this.curEnabled = c.enabled
    } else if (this.curId !== null) {
      this.clearTarget()
    }
  }

  private clearTarget(): void {
    this.curId = null
    this.curKind = null
    this.curRef = null
    this.curEnabled = false
  }

  private labelOfTarget(): string {
    const ref = this.curRef
    switch (this.curKind) {
      case 'item':
        return labelOf(ref as Interactable, !this.curEnabled)
      case 'seat':
        return WALK.prompt.sit
      case 'person':
        return fillWalk(WALK.prompt.talk, { name: (ref as Entity).name })
      default:
        return ''
    }
  }

  private sit(sim: Simulation, seat: SeatSpec): void {
    if (!this.seat.sit(sim, seat)) showToast(WALK.toast.seatTaken)
  }

  /** Talk: the person stops and answers, in a bubble over their head. A line said a moment ago is shown as a toast instead. */
  private talk(sim: Simulation, person: Entity): void {
    const line = sim.reactions.talkTo(person.id)?.trim() ?? ''
    if (line === '') {
      showToast(fillWalk(WALK.toast.busy, { name: person.name }))
      return
    }
    if (!say(person.id, line, CONFIG.player.talkHoldSeconds)) showToast(`${person.name}: ${line}`)
  }

  private watchDrawerCard(x: number, z: number): void {
    const roomId = useDrawerCard.getState().roomId
    if (roomId === null) return
    const room = roomById(roomId)
    if (Math.hypot(room.drawer.x - x, drawerFaceZ(room) - z) > DRAWER_CARD_FAR) useDrawerCard.getState().close()
  }

  private publishPrompt(text: string | null): void {
    if (text === this.promptShown) return
    this.promptShown = text
    useWalk.getState().set({ prompt: text })
  }

  private publishObjective(text: string | null): void {
    if (text === this.objectiveShown) return
    this.objectiveShown = text
    useWalk.getState().set({ objective: text })
  }
}
