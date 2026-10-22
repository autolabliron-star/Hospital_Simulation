/**
 * W1 walk-in: how the hospital reacts to you, the doctor who walks in it. The API is the contract with the scene and the HUD:
 *   - `step(t, dt)`          every fixed step (the Simulation calls it before the people update);
 *   - `talkTo(id)`           the person stops, faces you and holds for CONFIG.player.talkHoldSeconds; returns their line;
 *   - `drainBubbles(cb)`     lines to show over people's heads since the last call: greetings, and patients and visitors
 *                            greeting back (a `talkTo` line is returned, not queued). The scene shows them with
 *                            src/scene/fx/bubbleStore `say()`. The sim never imports scene code.
 *
 * What it does
 *   Noticing   Somebody within `noticeRadius` who is standing, sitting or walking at an ordinary pace, and who has you roughly
 *              in front of them, looks at your head for a few seconds (`entity.lookAt`; the crowd renderer turns the head with a
 *              spring, clamped to what a neck can do). They look away after a glance, and again when you leave. Nobody who is
 *              busy looks: riding, lying down, being scanned, giving medicines, examining, cleaning, running.
 *   Greetings  Staff within `greetRadius` greet you ("Morning, Doctor"), at most once per `greetCooldownSeconds` per person;
 *              patients and visitors sometimes greet back. Hospital-wide it stays gentle: never two greetings within a second
 *              or so, at most two in any four seconds.
 *   Courtesy   A walker whose way would bring them within about a metre of you, inside about 3 m, steps aside and eases off: the
 *              crowd moves them to one side of the corridor (`CrowdWalker.setCourtesy`, a sidestep of up to half a metre beyond
 *              their keep-right offset, to the side that clears you best, smoothly and within the same caps as keep-right: only
 *              where there is room between the walls and the furniture, never in a doorway) and they walk at a gentler pace. It is for every
 *              ambulatory person, patients and visitors the most, staff less; not for riders, pushers of stretchers, chairs and
 *              carts, nor for people in a hurry (paramedics, emergency staff, anybody running). It ends when you have passed.
 *              A short wait is never needed and nobody is stopped inside a doorway.
 *   talkTo     See the method. The hold lives in `Person` (person.ts) and `Actor`: it only delays, never skips a step.
 *   Pods       (W2) The pods hang from a ceiling rail above everybody: they never stop for you and nobody waits for them, so
 *              there is nothing to wire here.
 *
 * Wiring. The Simulation hands over what it owns (`people`, `meds`, `life`, `meals`); every one is optional so a bare Reactions
 * is inert. Without a player (`deps.player()` returns null) nothing here changes the day: no random numbers are drawn, no
 * person is touched, and the replay of a seed stays identical.
 *
 * No allocations per step: each person's reaction state is made once, on first contact; the hospital-wide bubble queue is a
 * fixed pair of arrays. All copy comes from src/content/barks.json.
 */
import { barkEvent, fillBark, greetLines, helloFor, talkLines, urgentTalkKey, greetsBack, type TalkKey } from '@/content/barks'
import { protocolById } from '@/content/imaging'
import { NIGHT_STAFF, HOSTS, STAFF } from '@/content/staff'
import { CONFIG } from './config'
import { Patient } from './beds/inpatient'
import { Actor } from './er/actor'
import { Companion } from './er/companion'
import type { ErPatient } from './er/patient'
import type { World } from './er/world'
import { hourOf } from './events'
import { CrowdWalker } from './nav/crowd'
import { ImagingOperator, OPERATOR_MODALITY } from './imaging/operator'
import { Outpatient } from './imaging/outpatient'
import type { MedSystem } from './meds/system'
import { ROOMS } from './places'
import { Ambient } from './population/ambient'
import { Visitor } from './population/visitor'
import type { Meals } from './meals'
import { isNilByMouthWardReason } from './meals/plan'
import type { Person } from './person'
import type { Rng } from './rng'
import type { ImagingModality, LivingDayView, PlayerMode, Vec3 } from './types'
import type { Walker } from './walker'

export interface ReactionsDeps {
  world: World
  rng: Rng
  /** You, or null (read through it every step; the sim owns the object). `mode` 'overview' pauses the social reactions. */
  player: () => { x: number; z: number; heading: number; speed: number; mode?: PlayerMode } | null
  /** Everybody in the simulation (the live array; people come and go). Without it nobody reacts. */
  people?: readonly Person[]
  /** The medicine system: nurses and patients know about the drawers. */
  meds?: MedSystem
  /** Beds and meals, for what a ward patient says. */
  life?: LivingDayView
  meals?: Meals
}

// ---------------------------------------------------------------------------------------------
// Tuning (local on purpose: the contract's CONFIG.player carries the radii and the hold time; these are the manners)
// ---------------------------------------------------------------------------------------------

const DEG = Math.PI / 180
/** You count as "roughly in front" within this angle of somebody's heading; they lose you beyond the neck's reach. */
const COS_NOTICE = Math.cos(100 * DEG)
const COS_LOSE = Math.cos(125 * DEG)
/** People stop looking this much further out than they start (no flicker at the edge). */
const RELEASE_FACTOR = 1.3
/** A glance lasts this long [s], and the same person looks again no sooner than the cooldown [s]. */
const GLANCE: readonly [number, number] = [1.8, 3.6]
const GLANCE_COOLDOWN: readonly [number, number] = [10, 22]
/** Faster than this (m/s) somebody is hurrying and has no eyes for you. */
const MAX_NOTICE_SPEED = 1.7
/** Gentle: never two greetings within GREET_GAP seconds, and at most two within GREET_WINDOW seconds, in the whole hospital. */
const GREET_GAP = 1.2
const GREET_WINDOW = 4
/** Patients and visitors answer with these odds, rolled once per cooldown. */
const BACK_CHANCE = 0.3
/**
 * Courtesy. A walker is on a collision course with you when you are ahead of it, within COURTESY_RADIUS metres, and the two of
 * you, going as you are, would pass within COURSE_MISS metres of each other within COURSE_SECONDS (a person's keep-right passing is
 * about 0.7 m; this is "close enough that somebody should give way"). It then steps aside by the metres below (beyond its
 * keep-right offset) and walks at this fraction of its pace: patients and visitors the most, staff less.
 */
const COURTESY_RADIUS = 3
const COURSE_SECONDS = 3.5
const COURSE_MISS = 1.2
const COURTESY_PACE = 0.6
const COURTESY_PACE_STAFF = 0.85
const SIDESTEP = 0.5
const SIDESTEP_STAFF = 0.3
/** It lasts until you have passed (this far behind them, m), you are further than this many times the radius, or you would miss by this much. */
const PASSED = -0.5
const COURTESY_LEAVE = 1.3
const KEEP_MISS = 1.9
/** Which side is best is looked at again this often (s), until you are this close (m): never swap sides in the squeeze. */
const REPICK_EVERY = 0.5
const REPICK_FROM = 1.8
/** Somebody this slow (m/s) is not walking anywhere yet. */
const MIN_WALK_SPEED = 0.2
/** You walked this far from somebody you were talking to: they carry on. */
const HOLD_ABORT = 6
/** A greeting: they look at you, and speak, this long (s). */
const GREET_SECONDS = 2.4
/** Their eyes stay on you this long after a conversation ends. */
const LOOK_TAIL = 0.4
const MAX_PENDING = 8

const SCAN_KINDS = new Set(['scanTable', 'xrayTable', 'usCouch'])
const POST = new Map([...STAFF, ...NIGHT_STAFF, ...HOSTS].map((s) => [s.id, s]))
const MODALITY_NAME: Record<ImagingModality, string> = { mri: 'MRI', ct: 'CT scan', xray: 'X-ray', us: 'ultrasound' }

/** One person's reactions to you. Made on first contact, kept for as long as the person exists. */
class Mind {
  // (-Infinity, not 0: a warm start before 07:30 runs the sim clock at negative times)
  looking = false
  lookUntil = -Infinity
  nextLookAt = -Infinity
  greetReadyAt = -Infinity
  active = false
  /** The point their head turns to; `entity.lookAt` is this object while they look (never reallocated). */
  readonly look: Vec3 = { x: 0, y: CONFIG.player.camera.pivotHeight, z: 0 }
  /** Courtesy: making way for you (a slower pace, and a sidestep if the walker is in the crowd). */
  yielding = false
  /** The side (+1 right, -1 left, 0 none), the extra metres, the walker it was set on, and when the side is next looked at. */
  court: -1 | 0 | 1 = 0
  metres = 0
  cw: CrowdWalker | null = null
  nextPickAt = -Infinity
  /** True when you came up behind them (you overtake): then it lasts until you are ahead of them. */
  behind = false
  constructor(readonly p: Person) {}
}

export class Reactions {
  private readonly minds = new WeakMap<Person, Mind>()
  /** Minds with something to keep doing: looking, held, turning back, or walking at a courtesy pace. */
  private readonly active: Mind[] = []
  private readonly scanSeats = new Set<string>()
  private readonly noticeR2: number
  private readonly releaseR2: number
  private readonly greetR2: number
  private readonly lastPick = new Map<string, number>()
  // the hospital-wide greeting gate: the times of the last two greetings
  private g0 = -Infinity
  private g1 = -Infinity
  /** Where you are and how you move, as of this step (for the collision course). */
  private plx = 0
  private plz = 0
  private plVx = 0
  private plVz = 0
  /** With this off the courtesy is only the slow-down, with no sidestep (tests compare the two). */
  sidestep = true
  // the bubble queue (fixed size, no allocation)
  private readonly bId: string[] = new Array<string>(MAX_PENDING).fill('')
  private readonly bText: string[] = new Array<string>(MAX_PENDING).fill('')
  private bN = 0

  constructor(readonly deps: ReactionsDeps) {
    const r = CONFIG.player
    this.noticeR2 = r.noticeRadius * r.noticeRadius
    this.releaseR2 = this.noticeR2 * RELEASE_FACTOR * RELEASE_FACTOR
    this.greetR2 = r.greetRadius * r.greetRadius
    for (const s of deps.world.seats.all) if (SCAN_KINDS.has(s.kind)) this.scanSeats.add(s.id)
  }

  /** True when the Simulation has handed over the people (otherwise nobody reacts: see the module comment). */
  get wired(): boolean {
    return this.deps.people !== undefined
  }

  // ---------------------------------------------------------------------------------------------
  // Every step
  // ---------------------------------------------------------------------------------------------

  step(t: number, dt: number): void {
    const d = this.deps
    const pl = d.player()
    const people = d.people
    if (pl === null || people === undefined) {
      if (this.active.length > 0) this.settle(t, dt)
      return
    }
    const px = pl.x
    const pz = pl.z
    this.plx = px
    this.plz = pz
    this.plVx = Math.sin(pl.heading) * pl.speed
    this.plVz = Math.cos(pl.heading) * pl.speed
    const social = pl.mode !== 'overview'
    if (social) {
      const r2 = this.noticeR2
      for (let i = 0; i < people.length; i++) {
        const p = people[i]
        const w = p.walker
        const dx = px - w.x
        const dz = pz - w.z
        const d2 = dx * dx + dz * dz
        if (d2 > r2) continue
        this.consider(this.mindOf(p), t, dt, dx, dz, d2)
      }
    }
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (!this.maintain(this.active[i], t, dt, px, pz, social)) this.retire(i)
    }
  }

  private mindOf(p: Person): Mind {
    let m = this.minds.get(p)
    if (m === undefined) {
      m = new Mind(p)
      this.minds.set(p, m)
    }
    return m
  }

  private activate(m: Mind): void {
    if (m.active) return
    m.active = true
    this.active.push(m)
  }

  private retire(i: number): void {
    const m = this.active[i]
    m.active = false
    const last = this.active.pop()!
    if (last !== m) this.active[i] = last
  }

  /** The player is gone (or has left for the overview with no avatar): end every look, hold and slow-down, then turn people back. */
  private settle(t: number, dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const m = this.active[i]
      const p = m.p
      this.stopLook(m, t, false)
      this.endYield(m)
      if (p.holdUntil > t) p.holdUntil = t
      if (p.chatUntil > t) p.chatUntil = t
      if (!p.holdStanding(dt, t)) this.retire(i)
    }
  }

  /** Could this person react to you at all right now? Not when busy: riding, lying, being scanned, giving, examining, running. */
  private free(p: Person): boolean {
    const e = p.entity
    if (p.gone || p.fadingOut || (e.fade !== undefined && e.fade < 1)) return false
    if (e.riding) return false
    const s = e.seated
    if (s !== undefined && (s.pose !== 'sit' || this.scanSeats.has(s.seatId))) return false
    const a = e.anim
    if (a === 'give' || a === 'clean' || a === 'lie' || a === 'run') return false
    // at a bedside: examining or giving medicines
    if (e.roomId !== undefined && (e.role === 'doctor' || e.role === 'nurse')) return false
    // a radiographer or sonographer with a scan running
    if (p instanceof ImagingOperator && p.working) return false
    return true
  }

  /** A person within the notice radius: do they look, greet, slow down? */
  private consider(m: Mind, t: number, dt: number, dx: number, dz: number, d2: number): void {
    const p = m.p
    const w = p.walker
    if (!this.free(p)) return
    const dist = Math.sqrt(d2)
    // the cosine of the angle between where they face and where you are
    const ahead = dist < 1e-3 ? 1 : (dx * Math.sin(w.heading) + dz * Math.cos(w.heading)) / dist
    const inFront = ahead >= COS_NOTICE
    const walking = p.walkT >= t - 1.5 * dt
    if (!m.looking && inFront && t >= m.nextLookAt && w.speed <= MAX_NOTICE_SPEED) {
      this.startLook(m, t, this.deps.rng.between(GLANCE))
    }
    if (inFront && d2 <= this.greetR2 && t >= m.greetReadyAt) this.maybeGreet(m, t)
    // courtesy: somebody whose way leads right at you steps aside and gives you time
    if (walking && !m.yielding && dist <= COURTESY_RADIUS) this.maybeYield(m, t, dx, dz)
  }

  /**
   * Is this person on a collision course with you, and the sort who gives way? Then they start: a slower pace and (a walker in the
   * crowd) a sidestep to the side that clears you best. Not riders, nor pushers of vehicles, nor people in a hurry, nor anybody busy.
   */
  private maybeYield(m: Mind, t: number, dx: number, dz: number): void {
    const p = m.p
    const w = p.walker
    if (w.speed < MIN_WALK_SPEED || t < p.holdUntil || !this.courteous(p)) return
    const sh = Math.sin(w.heading)
    const ch = Math.cos(w.heading)
    // the two of you are closing (you ahead of them, or coming up behind them) to pass within COURSE_MISS of each other soon
    const fwd = dx * sh + dz * ch
    if (fwd < 0.2 && fwd > -0.2) return
    const rvx = this.plVx - sh * w.speed
    const rvz = this.plVz - ch * w.speed
    const vv = rvx * rvx + rvz * rvz
    if (vv < 1e-3) return
    const tca = -(dx * rvx + dz * rvz) / vv
    if (tca <= 0 || tca > COURSE_SECONDS) return
    const mx = dx + rvx * tca
    const mz = dz + rvz * tca
    if (mx * mx + mz * mz > COURSE_MISS * COURSE_MISS) return
    const staff = p.entity.role !== 'patient' && p.entity.role !== 'visitor'
    m.yielding = true
    m.behind = fwd < 0
    p.pace = staff ? COURTESY_PACE_STAFF : COURTESY_PACE
    if (this.sidestep && w instanceof CrowdWalker) {
      m.cw = w
      m.metres = staff ? SIDESTEP_STAFF : SIDESTEP
      // (which side has room is judged where you will meet, not where you are: you may be walking towards them)
      m.court = w.courtesyPick(this.plx + this.plVx * tca, this.plz + this.plVz * tca, m.metres, 0)
      w.setCourtesy(m.court, m.metres)
      m.nextPickAt = t + REPICK_EVERY
    }
    this.activate(m)
  }

  /** Seconds until you and this walker are closest, if you both go on as you are, limited to 0..COURSE_SECONDS. */
  private meetIn(w: Walker, dx: number, dz: number): number {
    const rvx = this.plVx - Math.sin(w.heading) * w.speed
    const rvz = this.plVz - Math.cos(w.heading) * w.speed
    const vv = rvx * rvx + rvz * rvz
    const t = vv < 1e-3 ? 0 : -(dx * rvx + dz * rvz) / vv
    return t < 0 ? 0 : t > COURSE_SECONDS ? COURSE_SECONDS : t
  }

  /** Does this person give way to you? Anybody walking about their business, but not riders, pushers, the hurrying or the busy. */
  private courteous(p: Person): boolean {
    if (!p.mobile || !this.free(p)) return false
    const e = p.entity
    if (e.seated !== undefined || e.role === 'paramedic') return false
    // pushing a stretcher, a wheelchair or a cart (a rider is not `free`)
    if (e.vehicle !== undefined && e.vehicle !== 'none') return false
    // mid-transfer on or off a vehicle
    if (p instanceof Actor && (p.mode === 'slide' || p.mode === 'ride')) return false
    // hurrying (running, or with a hurried gait: braking for the crowd must not make somebody look relaxed), and the emergency
    // department's own staff
    if (p.walker.speed > MAX_NOTICE_SPEED || (p instanceof Actor && p.cruise > MAX_NOTICE_SPEED)) return false
    const post = POST.get(e.id)?.post
    return post !== 'er' && post !== 'triage'
  }

  /** End a courtesy: back to their own pace and the keep-right offset. */
  private endYield(m: Mind): void {
    if (!m.yielding) return
    m.yielding = false
    m.p.pace = 1
    if (m.cw !== null) {
      m.cw.setCourtesy(0, 0)
      m.cw = null
    }
    m.court = 0
  }

  private startLook(m: Mind, t: number, seconds: number): void {
    const e = m.p.entity
    m.looking = true
    m.lookUntil = t + seconds
    e.lookAt = m.look
    this.activate(m)
  }

  private stopLook(m: Mind, t: number, cooldown: boolean): void {
    if (!m.looking) return
    const e = m.p.entity
    m.looking = false
    if (e.lookAt === m.look) e.lookAt = null
    if (cooldown) m.nextLookAt = t + this.deps.rng.between(GLANCE_COOLDOWN)
  }

  /** Keep a mind going: follow you with the eyes, hold, turn back, pace. Returns false when there is nothing left to do. */
  private maintain(m: Mind, t: number, dt: number, px: number, pz: number, social: boolean): boolean {
    const p = m.p
    const w = p.walker
    const dx = px - w.x
    const dz = pz - w.z
    const d2 = dx * dx + dz * dz
    let keep = false

    const held = t < p.holdUntil
    if (held) {
      p.holdAtX = px
      p.holdAtZ = pz
      // you have walked away from them: they carry on
      if (d2 > HOLD_ABORT * HOLD_ABORT) p.holdUntil = t
    }
    if (p.holdStanding(dt, t)) keep = true

    if (m.looking) {
      const dist = Math.sqrt(d2)
      const ahead = dist < 1e-3 ? 1 : (dx * Math.sin(w.heading) + dz * Math.cos(w.heading)) / dist
      let stop = false
      if (t < p.holdUntil) m.lookUntil = Math.max(m.lookUntil, p.holdUntil + LOOK_TAIL)
      else if (t >= m.lookUntil || !social || d2 > this.releaseR2 || ahead < COS_LOSE || !this.free(p)) stop = true
      if (stop) this.stopLook(m, t, true)
      else {
        m.look.x = px
        m.look.z = pz
        keep = true
      }
    }

    if (m.yielding) {
      const sh = Math.sin(w.heading)
      const ch = Math.cos(w.heading)
      const dist = Math.sqrt(d2)
      // it lasts until you have passed (they have you ahead of them until then; or, if you came up behind them, you ahead of them)
      const fwd = dx * sh + dz * ch
      const walking = p.walkT >= t - 1.5 * dt
      const passed = m.behind ? fwd > -PASSED : fwd < PASSED
      if (!social || !walking || held || passed || dist > COURTESY_RADIUS * COURTESY_LEAVE || Math.abs(dx * ch - dz * sh) > KEEP_MISS || !this.courteous(p)) {
        this.endYield(m)
      } else {
        keep = true
        // which side is best is looked at again now and then, until you are close
        if (m.cw !== null && t >= m.nextPickAt && dist > REPICK_FROM) {
          m.nextPickAt = t + REPICK_EVERY
          const tca = this.meetIn(w, dx, dz)
          const side = m.cw.courtesyPick(px + this.plVx * tca, pz + this.plVz * tca, m.metres, m.court)
          if (side !== m.court) {
            m.court = side
            m.cw.setCourtesy(side, m.metres)
          }
        }
      }
    }
    return keep
  }

  // ---------------------------------------------------------------------------------------------
  // Greetings
  // ---------------------------------------------------------------------------------------------

  /** Is the hospital-wide greeting gate open? (Gentle: no two within GREET_GAP s, at most two in GREET_WINDOW s.) */
  private gateOpen(t: number): boolean {
    return t - this.g0 >= GREET_GAP && t - this.g1 >= GREET_WINDOW
  }

  private maybeGreet(m: Mind, t: number): void {
    if (!this.gateOpen(t)) return
    const p = m.p
    const e = p.entity
    const role = e.role
    const rng = this.deps.rng
    const cooldown = CONFIG.player.greetCooldownSeconds
    const erp = role === 'patient' ? this.deps.world.patients.get(e.id) : undefined
    if (erp !== undefined && !greetsBack(erp.c.acuity)) {
      m.greetReadyAt = t + cooldown
      return
    }
    if (role === 'patient' || role === 'visitor') {
      // patients and visitors only sometimes greet back; one roll per cooldown
      m.greetReadyAt = t + cooldown
      if (!rng.chance(BACK_CHANCE)) return
    } else m.greetReadyAt = t + cooldown
    const lines = greetLines(role)
    const line = fillBark(this.pickLine(`greet:${role}`, lines), { hello: helloFor(hourOf(t)) })
    this.g1 = this.g0
    this.g0 = t
    this.say(e.id, line)
    // they look at you while they say it, and (if they are standing about or sitting) show the talking pose
    if (!m.looking) this.startLook(m, t, GREET_SECONDS)
    else if (m.lookUntil < t + 2) m.lookUntil = t + 2
    p.chatUntil = t + GREET_SECONDS
    this.activate(m)
  }

  /** A line from `lines`, never the one this key said last. */
  private pickLine(key: string, lines: readonly string[]): string {
    const n = lines.length
    let i = n > 1 ? this.deps.rng.int(0, n - 1) : 0
    const last = this.lastPick.get(key)
    if (n > 1 && i === last) i = (i + 1) % n
    this.lastPick.set(key, i)
    return lines[i]
  }

  private say(entityId: string, text: string): void {
    if (this.bN === MAX_PENDING) {
      // nobody is draining (the overview, a test): the oldest line goes
      for (let i = 1; i < MAX_PENDING; i++) {
        this.bId[i - 1] = this.bId[i]
        this.bText[i - 1] = this.bText[i]
      }
      this.bN--
    }
    this.bId[this.bN] = entityId
    this.bText[this.bN] = text
    this.bN++
  }

  /** Hand every pending speech line to `cb` (entity id, text) and forget them. */
  drainBubbles(cb: (entityId: string, text: string) => void): void {
    const n = this.bN
    this.bN = 0
    for (let i = 0; i < n; i++) cb(this.bId[i], this.bText[i])
  }

  // ---------------------------------------------------------------------------------------------
  // Talking
  // ---------------------------------------------------------------------------------------------

  /**
   * Talk to the person with entity id `id`. They stop where it is safe (never in a doorway: a walker keeps
   * on until it would come to rest somewhere clear), face you, keep their eyes on you and hold for `talkHoldSeconds`, then carry
   * on with exactly what they were doing: the hold only delays. Returns what they say, from barks.json by role and situation
   * ("I'm waiting for my X-ray results", "A3's medicines are in the drawer", "Lunch was lovely, thank you"), and writes a
   * `talkedTo` event. Null when they cannot talk: riding, in the middle of a transfer, being scanned, fading, gone, or there is no
   * player. Talking to somebody who is already holding renews the hold and says something else.
   */
  talkTo(id: string): string | null {
    const d = this.deps
    const pl = d.player()
    if (pl === null) return null
    const p = this.find(id)
    if (p === null || !this.canTalk(p)) return null
    const sit = this.situation(p)
    const key = `${id}:${sit.key}`
    const line = fillBark(this.pickLine(key, talkLines(sit.key)), sit.fields)
    const t = d.world.t
    const e = p.entity
    p.holdUntil = t + CONFIG.player.talkHoldSeconds
    p.holdAtX = pl.x
    p.holdAtZ = pl.z
    const m = this.mindOf(p)
    m.look.x = pl.x
    m.look.z = pl.z
    this.startLook(m, t, CONFIG.player.talkHoldSeconds + LOOK_TAIL)
    m.lookUntil = p.holdUntil + LOOK_TAIL
    d.world.say('talkedTo', barkEvent('talkedTo', { name: e.name }), { actorId: 'player', subjectId: e.id, ...(e.roomId !== undefined ? { roomId: e.roomId } : {}) })
    // (the line is RETURNED, and not queued as a bubble as well: the caller shows it)
    return line
  }

  private find(id: string): Person | null {
    const people = this.deps.people
    if (people === undefined || id === 'player') return null
    for (let i = 0; i < people.length; i++) if (people[i].entity.id === id) return people[i]
    return null
  }

  /** Can this person talk right now? Not when riding, mid-transfer, being scanned, fading or gone. */
  private canTalk(p: Person): boolean {
    if (p.gone || p.fadingOut || p.hidden) return false
    const e = p.entity
    if (e.fade !== undefined && e.fade < 0.99) return false
    if (e.riding) return false
    if (p instanceof Actor && (p.mode === 'slide' || p.mode === 'ride')) return false
    const s = e.seated
    if (s !== undefined && this.scanSeats.has(s.seatId)) return false
    return true
  }

  // ---------------------------------------------------------------------------------------------
  // What they say: the situation of a person
  // ---------------------------------------------------------------------------------------------

  private situation(p: Person): { key: TalkKey; fields: Record<string, string | number> } {
    const e = p.entity
    const none: Record<string, string | number> = {}
    switch (e.role) {
      case 'patient':
        return this.patientSays(p)
      case 'visitor':
        return this.visitorSays(p)
      case 'receptionist':
        return { key: 'receptionist.desk', fields: none }
      case 'pharmacist':
        return { key: e.anim === 'tablet' ? 'pharmacist.verifying' : 'pharmacist.idle', fields: none }
      case 'coordinator': {
        const ready = this.deps.world.beds?.count('ready') ?? 0
        return ready > 0 ? { key: 'coordinator.beds', fields: { ready } } : { key: 'coordinator.idle', fields: none }
      }
      case 'nurse':
        return this.nurseSays(p)
      case 'doctor': {
        const post = POST.get(e.id)?.post
        if (post === 'er') return { key: 'doctor.er', fields: none }
        if (e.roomId !== undefined) return { key: 'doctor.examining', fields: { room: e.roomId } }
        return { key: p.walker.speed > 0.3 ? 'doctor.rounds' : 'doctor.resting', fields: none }
      }
      case 'porter': {
        const v = e.vehicle
        if (v === 'stretcher') return { key: 'porter.stretcher', fields: none }
        if (v === 'wheelchair') return { key: 'porter.wheelchair', fields: none }
        if (v === 'linenCart') return { key: 'porter.linen', fields: none }
        return { key: 'porter.idle', fields: none }
      }
      case 'cleaner':
        if (e.roomId !== undefined) return { key: 'cleaner.room', fields: { room: e.roomId } }
        return { key: e.anim === 'clean' ? 'cleaner.mopping' : 'cleaner.cart', fields: none }
      case 'radiographer':
      case 'sonographer': {
        const modality = OPERATOR_MODALITY[e.id]
        const sc = modality === undefined ? undefined : this.deps.world.imaging?.scanners[modality]
        if (sc !== undefined && sc.exam !== null && sc.phase !== 'idle') {
          return { key: 'radiographer.scanning', fields: { protocol: sc.exam.protocol, minutes: Math.max(1, Math.round(sc.remaining / 60)) } }
        }
        return { key: 'radiographer.idle', fields: none }
      }
      case 'host': {
        const tray = e.roomId !== undefined ? this.deps.meals?.tray(e.roomId) : null
        return tray && tray.dish !== null ? { key: 'host.serving', fields: { dish: tray.dish } } : { key: 'host.idle', fields: none }
      }
      case 'paramedic':
        return { key: e.anim === 'talk' ? 'paramedic.handover' : 'paramedic.idle', fields: none }
      case 'labScientist':
        return { key: 'labScientist.working', fields: none }
    }
  }

  private nurseSays(p: Person): { key: TalkKey; fields: Record<string, string | number> } {
    const e = p.entity
    const none: Record<string, string | number> = {}
    const staff = POST.get(e.id)
    if (staff?.post === 'triage') return { key: 'nurse.triage', fields: none }
    if (staff?.post === 'er') return { key: 'nurse.er', fields: none }
    const meds = this.deps.meds
    if (e.roomId !== undefined) {
      // at a bedside: giving medicines while the drawer is still loaded, otherwise the admission check
      const loaded = meds?.drawers.get(e.roomId)?.state === 'loaded'
      return { key: loaded ? 'nurse.giving' : 'nurse.checking', fields: { room: e.roomId } }
    }
    // charting at the hub: a drawer on her ward holds medicines for a room
    if (meds !== undefined && staff?.ward !== undefined) {
      for (const r of ROOMS) {
        if (r.ward === staff.ward && meds.drawers.get(r.id)?.state === 'loaded') return { key: 'nurse.drawerLoaded', fields: { room: r.id } }
      }
    }
    return { key: p.walker.speed > 0.3 ? 'nurse.walking' : 'nurse.charting', fields: none }
  }

  private patientSays(p: Person): { key: TalkKey; fields: Record<string, string | number> } {
    const e = p.entity
    const none: Record<string, string | number> = {}
    // an ER patient, by where they are on the pathway
    const er: ErPatient | undefined = this.deps.world.patients.get(e.id)
    if (er !== undefined) {
      const says = this.erSays(er)
      return { key: urgentTalkKey(says.key, er.c.acuity), fields: says.fields }
    }
    if (p instanceof Outpatient) {
      const modality = MODALITY_NAME[p.booking.modality]
      switch (p.state) {
        case 'queueing':
        case 'serving':
          return { key: 'outpatient.checkIn', fields: none }
        case 'afterScan':
        case 'changeBack':
        case 'changing':
        case 'toExit':
        case 'gone':
          return { key: 'outpatient.after', fields: none }
        default:
          return { key: 'outpatient.waiting', fields: { modality } }
      }
    }
    if (p instanceof Patient) return this.wardPatientSays(p)
    return { key: 'generic.patient', fields: none }
  }

  private erSays(er: ErPatient): { key: TalkKey; fields: Record<string, string | number> } {
    const none: Record<string, string | number> = {}
    const s = er.state
    const modality = (): string => {
      const m = er.booking?.modality ?? (er.protocolId !== null ? protocolById(er.protocolId).modality : null)
      return m === null ? 'scan' : MODALITY_NAME[m]
    }
    if (s === 'arriving') return { key: 'er.arriving', fields: none }
    if (s.startsWith('checkIn')) return { key: 'er.checkIn', fields: none }
    if (s === 'waitingTriage') return { key: 'er.waitingTriage', fields: none }
    if (s.startsWith('triage')) return { key: 'er.triage', fields: none }
    if (s === 'waitingDoctor') return { key: 'er.waitingDoctor', fields: none }
    if (s === 'inBay.exam') return { key: 'er.exam', fields: none }
    if (s.startsWith('inBay')) return { key: 'er.inBay', fields: none }
    if (s === 'tests.awaitingResults') {
      return er.testKind === 'imaging' ? { key: 'er.scanResults', fields: { modality: modality() } } : { key: 'er.bloodResults', fields: none }
    }
    if (s.startsWith('tests')) {
      return er.testKind === 'imaging' ? { key: 'er.scanWaiting', fields: { modality: modality() } } : { key: 'er.bloodTest', fields: none }
    }
    if (s === 'decision') return { key: 'er.decision', fields: none }
    if (s === 'leaving.lwbs') return { key: 'er.leavingTired', fields: none }
    if (s.startsWith('leaving')) return { key: 'er.leavingHome', fields: none }
    if (s.startsWith('admittedOut')) return { key: 'er.admitted', fields: none }
    return { key: 'generic.patient', fields: none }
  }

  private wardPatientSays(p: Patient): { key: TalkKey; fields: Record<string, string | number> } {
    const e = p.entity
    const none: Record<string, string | number> = {}
    const roomId = p.roomId
    const ds = p.dState
    if (ds === 'signed') return { key: 'ward.dischargeSigned', fields: none }
    if (ds !== null) return { key: 'ward.leaving', fields: none }
    if (!p.inBed) return { key: 'ward.up', fields: none }
    if (e.mood === 'happy' && e.emote === 'heart') return { key: 'ward.medsGiven', fields: none }
    const status = this.deps.life?.rooms.get(roomId)
    // F-29: nil by mouth gets no tray and says so (never "Lunch was lovely"); the medicines in the drawer still come first
    if (isNilByMouthWardReason(status?.patientReason) && this.deps.meds?.drawers.get(roomId)?.state !== 'loaded') return { key: 'ward.nilByMouth', fields: none }
    const tray = this.deps.meals?.tray(roomId) ?? null
    if (status !== undefined && tray !== null) {
      if (status.meal === 'served') {
        const key = `ward.served.${tray.meal}` as const
        return { key, fields: { dish: tray.dish ?? 'meal' } }
      }
      if (status.meal === 'eaten') return { key: `ward.eaten.${tray.meal}` as const, fields: none }
    }
    if (this.deps.meds?.drawers.get(roomId)?.state === 'loaded') return { key: 'ward.medsReady', fields: none }
    return { key: 'ward.rested', fields: none }
  }

  private visitorSays(p: Person): { key: TalkKey; fields: Record<string, string | number> } {
    const e = p.entity
    const none: Record<string, string | number> = {}
    if (p instanceof Visitor) {
      const party = p.party
      const fields = { patient: party.patientName }
      if (party.collecting) return { key: 'visitor.collecting', fields }
      switch (party.phase) {
        case 'arriving':
          return { key: 'visitor.arriving', fields }
        case 'visit':
          return { key: 'visitor.visit', fields }
        case 'cafe':
          return { key: 'visitor.cafe', fields: none }
        default:
          return { key: 'visitor.leaving', fields: none }
      }
    }
    if (p instanceof Companion) {
      const fields = { patient: p.patient.entity.name }
      return { key: e.seated !== undefined ? 'companion.waiting' : 'companion.standing', fields }
    }
    if (p instanceof Ambient) {
      return { key: p.groupId === 'cafe' ? 'ambient.cafe' : p.groupId === 'benches' ? 'ambient.resting' : 'ambient.waiting', fields: none }
    }
    return { key: 'generic.visitor', fields: none }
  }
}
