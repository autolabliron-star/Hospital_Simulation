/**
 * The base of everybody in the simulation: `Person` (an entity, a walker, fading in and out), `newEntity` and the
 * per-step context. Split out of people.ts (L1 bed flow) so that the movement layer
 * (er/actor.ts) and the ward patient (beds/inpatient.ts, an Actor) can both build on it without an import cycle:
 * people.ts re-exports everything here, so importers of './people' are unchanged.
 */
import { CONFIG } from './config'
import { inDoorway } from './er/spots'
import type { MedSystem } from './meds/system'
import { groundHeightAt } from './places'
import type { World } from './er/world'
import type { Rng } from './rng'
import type { AnimState, Entity, Outfit, Role, Vec2 } from './types'
import { makeWalker, type WalkStatus, type Walker } from './walker'

export interface PeopleContext {
  t: number
  meds: MedSystem
  rng: Rng
  /** The M3 population services (ER board, seats, queues, event log). The ward staff never need it. */
  world: World
}

// ---------------------------------------------------------------------------------------------
// W1 talk hold: where a person must not be made to stand still
// ---------------------------------------------------------------------------------------------

/** A stopped body this close to a doorway bridge (m) counts as standing in it. A corridor's centre line stays clear of every door. */
const DOORWAY_PAD = 0.1

/**
 * May somebody stand still at (x, z)? Not in a doorway ("nobody idles in a pinch"). A talk hold delays a person; it must
 * never park them where the next person has to pass.
 */
export function mayStandAt(x: number, z: number): boolean {
  return !inDoorway(x, z, DOORWAY_PAD)
}

/** The path follower's braking (nav/follower.ts DECEL), to know where a held walker would come to rest. */
const BRAKE = 1.5
/** How much further than the braking distance (m) a held walker's possible rest points are checked, in steps of STOP_STEP, STOP_SIDE either side. */
const STOP_SLACK = 0.4
const STOP_STEP = 0.15
const STOP_SIDE = 0.3
/** A held walker counts as standing once slower than this (m/s). */
const STILL_SPEED = 0.05
/** ... and turns to face the player, and shows the talking pose, once slower than these. */
const FACE_SPEED = 0.5
const TALK_SPEED = 0.3
/** How fast a held person turns to the player and back (rad/s): a quick, calm turn, never a snap. */
const HOLD_TURN = 3.6
const TAU = Math.PI * 2

function wrapPi(a: number): number {
  return a - TAU * Math.round(a / TAU)
}

/** `h` turned towards `want` by at most `maxStep` radians. */
function turnToward(h: number, want: number, maxStep: number): number {
  let d = wrapPi(want - h)
  if (d > maxStep) d = maxStep
  else if (d < -maxStep) d = -maxStep
  return wrapPi(h + d)
}

function hashId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return h >>> 0
}

export function newEntity(id: string, role: Role, name: string, at: Vec2, heading: number, outfit?: Outfit): Entity {
  const e: Entity = {
    id,
    role,
    name,
    position: { x: at.x, y: groundHeightAt(at.x, at.z), z: at.z },
    heading,
    speed: 0,
    anim: 'idle',
    emote: 'none',
    mood: 'neutral',
    tier: 'near',
    variant: hashId(id) % 1000,
  }
  if (outfit !== undefined) e.outfit = outfit
  return e
}

export abstract class Person {
  /** Replaced only when a rider steps out of the crowd onto a vehicle and back (see Actor). */
  walker: Walker
  /** Pose at the start of the fixed step, for interpolation. */
  prevX = 0
  prevZ = 0
  prevHeading = 0
  /** Sim time until which the current emote shows. */
  emoteUntil = 0
  /** True once a person has faded out: the simulation removes them. */
  gone = false
  /** Per second: positive while fading in, negative while fading out, 0 otherwise. */
  private fadeRate = 0
  /** A fade-out that ends invisible but keeps the person in the simulation (a patient in the bathroom pod). */
  private keepAfterFade = false

  // --- W1 walk-in: the talk hold and the courtesy pace (written by src/sim/reactions.ts; without a player they stay at rest) ---
  /**
   * Sim time until which the player's conversation holds this person: they stop where it is safe, face the player, then carry on.
   * -Infinity when there is none (a warm start runs the sim clock at negative times, so 0 would read as "held").
   */
  holdUntil = -Infinity
  /** Where the player stands: the held person faces it. */
  holdAtX = 0
  holdAtZ = 0
  /** Sim time until which they show the talking pose without being held (a greeting: the mouth moves only in that pose). */
  chatUntil = -Infinity
  /** 0..1, how briskly they walk (1 = at their own pace). Reactions eases it down for visitors who would meet you head on. */
  pace = 1
  /** Sim time of the last walking step: tells Reactions a walker (who turns inside the step) from somebody standing. */
  walkT = -Infinity
  private heldStill = false
  private turned = false
  private baseHeading = 0
  private setHeading = 0
  private talking = false
  private animBefore: AnimState = 'idle'

  constructor(
    readonly entity: Entity,
    walker?: Walker,
  ) {
    this.walker = walker ?? makeWalker()
    this.walker.place(entity.position.x, entity.position.z, entity.heading)
    this.snapshot()
  }

  /**
   * True while the talk hold itself has brought this walker to a standstill (not a crowd, a door or a body in the way): the hold
   * only does that where it is safe (`mayStandAt`, never in a doorway), and the tests look at it to prove so.
   */
  get stoppedByHold(): boolean {
    return this.heldStill
  }

  /** Appear where they stand (fade 0 -> 1 over about 0.6 s). Nobody pops. */
  fadeIn(): void {
    this.entity.fade = 0
    this.fadeRate = 1 / CONFIG.fade.seconds
    this.keepAfterFade = false
  }

  /**
   * Disappear where they stand; `gone` turns true when invisible, unless `keep` is set (then the person stays in the
   * simulation, invisible, until `fadeIn()`: a patient changing inside the bathroom pod).
   */
  fadeOut(keep = false): void {
    if (this.fadeRate < 0) return
    this.keepAfterFade = keep
    this.entity.fade ??= 1
    this.fadeRate = -1 / CONFIG.fade.seconds
  }

  get fadingOut(): boolean {
    return this.fadeRate < 0
  }

  get visibleFully(): boolean {
    return this.fadeRate === 0 && (this.entity.fade ?? 1) >= 1
  }

  /** Invisible and staying that way (faded out with `keep`). */
  get hidden(): boolean {
    return this.fadeRate === 0 && (this.entity.fade ?? 1) <= 0
  }

  stepFade(dt: number): void {
    if (this.fadeRate === 0) return
    const f = (this.entity.fade ?? 1) + this.fadeRate * dt
    if (this.fadeRate > 0) {
      if (f >= 1) {
        this.entity.fade = 1
        this.fadeRate = 0
      } else this.entity.fade = f
    } else if (f <= 0) {
      this.entity.fade = 0
      this.fadeRate = 0
      if (!this.keepAfterFade) this.gone = true
    } else this.entity.fade = f
  }

  /** Called by the simulation when the person is taken out of it (after fading out). */
  onRemoved(_world: World): void {}

  snapshot(): void {
    this.prevX = this.walker.x
    this.prevZ = this.walker.z
    this.prevHeading = this.walker.heading
  }

  /** Does this person ever walk? */
  get mobile(): boolean {
    return true
  }

  abstract update(dt: number, ctx: PeopleContext): void

  protected walk(dt: number, ctx: PeopleContext, speed = CONFIG.people.walkSpeed): boolean {
    const st = this.stepWalker(dt, ctx, speed)
    const e = this.entity
    e.speed = this.walker.speed
    if (st === 'held') {
      e.anim = this.walker.speed < TALK_SPEED ? 'talk' : 'walk'
      return false
    }
    e.anim = st === 'moving' ? 'walk' : 'idle'
    return st === 'arrived'
  }

  /**
   * One step of walking, honouring the talk hold and the courtesy pace (the only place a walker is stepped, so every kind of
   * person obeys both). While `holdUntil` is in the future the walker brakes to a standstill and faces the player, and the
   * crowd sees it as somebody standing; a hold only DELAYS the walk: the route and the controller's state are untouched. A
   * walker whose standstill would fall inside a doorway keeps walking until it would stop clear of
   * them, so a hold never parks anybody in a pinch. Returns the walker's status, or 'held' while held and still on its route.
   */
  protected stepWalker(dt: number, ctx: PeopleContext, cruise: number): WalkStatus | 'held' {
    const w = this.walker
    this.walkT = ctx.t
    if (ctx.t < this.holdUntil && this.stopOk()) {
      // (the follower turns the body back towards the next waypoint inside `step`, faster than a calm turn to you: turn from
      // the heading the walker had BEFORE the step, so that turn is discarded and not fought)
      const h0 = w.heading
      const st = w.step(dt, 0)
      if (st === 'arrived') return st
      if (w.speed < STILL_SPEED) {
        this.heldStill = true
        w.setStatic(true)
      }
      if (w.speed < FACE_SPEED && this.mayTurn()) w.face(turnToward(h0, Math.atan2(this.holdAtX - w.x, this.holdAtZ - w.z), HOLD_TURN * dt))
      return 'held'
    }
    if (this.heldStill) {
      this.heldStill = false
      w.setStatic(false)
    }
    return w.step(dt, cruise * this.pace)
  }

  /**
   * Would a walker braking now come to rest somewhere it may stand (see `mayStandAt`)? The rest point is only an estimate (the
   * path may bend, the crowd nudges the body sideways), so every spot in a small band is checked: from here to the braking
   * distance plus STOP_SLACK along the heading, and STOP_SIDE either side. Anybody who is in or near a pinch walks on.
   */
  private stopOk(): boolean {
    const w = this.walker
    const reach = (w.speed * w.speed) / (2 * BRAKE) + STOP_SLACK
    const sx = Math.sin(w.heading)
    const cz = Math.cos(w.heading)
    for (let d = 0; d <= reach + 1e-9; d += STOP_STEP) {
      const x = w.x + sx * d
      const z = w.z + cz * d
      if (!mayStandAt(x, z) || !mayStandAt(x + cz * STOP_SIDE, z - sx * STOP_SIDE) || !mayStandAt(x - cz * STOP_SIDE, z + sx * STOP_SIDE)) return false
    }
    return true
  }

  /** Can this person turn to face the player? Not when seated or lying, and not when pushing a vehicle (it would swing round). */
  private mayTurn(): boolean {
    const e = this.entity
    if (e.seated !== undefined) return false
    const v = e.vehicle
    return v === undefined || v === 'none' || e.riding === true
  }

  /**
   * The talk hold for somebody NOT walking this step (a walker is held inside `stepWalker`). Called by Reactions every step
   * while it returns true: while held, turn to face the player (not seated people, not pushers) and show the talking pose
   * if they were idle or sitting; when the hold ends, turn back to where they were facing and put the old pose back. If the
   * person's own code turned them or started them walking in between, theirs wins. Returns true while it still has work.
   */
  holdStanding(dt: number, now: number): boolean {
    const w = this.walker
    const e = this.entity
    const walking = this.walkT >= now - 1.5 * dt
    const held = now < this.holdUntil
    if (held || now < this.chatUntil) {
      // (a walker is held, and keeps its walking pose, inside `stepWalker`)
      if (walking) return true
      if (held && this.mayTurn()) {
        if (!this.turned) {
          this.turned = true
          this.baseHeading = w.heading
        } else if (Math.abs(wrapPi(w.heading - this.setHeading)) > 1e-4) this.baseHeading = w.heading
        w.face(turnToward(w.heading, Math.atan2(this.holdAtX - w.x, this.holdAtZ - w.z), HOLD_TURN * dt))
        this.setHeading = w.heading
      }
      this.talkPose()
      return true
    }
    if (this.talking) {
      this.talking = false
      if (e.anim === 'talk') e.anim = this.animBefore
    }
    if (this.turned) {
      if (walking || Math.abs(wrapPi(w.heading - this.setHeading)) > 1e-4) this.turned = false
      else {
        w.face(turnToward(w.heading, this.baseHeading, HOLD_TURN * dt))
        this.setHeading = w.heading
        if (Math.abs(wrapPi(this.baseHeading - w.heading)) < 0.01) this.turned = false
      }
    }
    return this.turned
  }

  /**
   * The talking pose for somebody who would otherwise be standing about or sitting (the face's mouth moves only in it). The
   * old pose is remembered and put back by `holdStanding` when the conversation or greeting is over. People who are busy
   * (tablet, give, push, clean) keep what they are doing.
   */
  talkPose(): void {
    const e = this.entity
    if (e.anim !== 'idle' && e.anim !== 'sit') return
    if (!this.talking) this.animBefore = e.anim
    this.talking = true
    e.anim = 'talk'
  }

  /** True while a conversation or a greeting wants the talking pose (the movement layer re-applies it after the controller thinks). */
  wantsTalkPose(now: number): boolean {
    return (now < this.holdUntil || now < this.chatUntil) && this.walkT !== now
  }

  protected emote(ctx: PeopleContext, e: Entity['emote'], seconds: number): void {
    this.entity.emote = e
    this.emoteUntil = ctx.t + seconds
  }

  protected tickEmote(ctx: PeopleContext): void {
    if (this.entity.emote !== 'none' && ctx.t >= this.emoteUntil) this.entity.emote = 'none'
  }
}
