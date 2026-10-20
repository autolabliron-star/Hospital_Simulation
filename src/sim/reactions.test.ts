/**
 * W1 "Life reacts": the people react to the doctor you play (the pods do not: since W2 they ride a ceiling rail above everybody).
 * Node tests on the real Simulation.
 *
 * Reactions is wired here the way Simulation.ts must wire it (`people`, `meds`, `life`, `meals`): `rig()` builds a Simulation and
 * swaps in a fully wired Reactions, so these tests prove the behaviour. The first test checks that Simulation.ts itself does the
 * wiring; it is the one place this file depends on the orchestrator's glue.
 */
import { describe, expect, it, vi } from 'vitest'
import { talkLines, greetLines, helloFor, fillBark, TALK_KEYS } from '@/content/barks'
import { CONFIG } from './config'
import { NIGHT_STAFF, HOSTS, STAFF } from '@/content/staff'
import { Actor } from './er/actor'
import { inDoorway } from './er/spots'
import { CrowdWalker } from './nav/crowd'
import { mayStandAt, newEntity, Person, type PeopleContext } from './person'
import type { Spot } from './places'
import { Reactions } from './reactions'
import { Rng } from './rng'
import { Simulation } from './Simulation'
import type { Role, SimEvent, Vec2, VehicleKind } from './types'
import type { Walker } from './walker'

// these tests run minutes of sim time on the whole hospital: the default 5 s is too tight on a busy machine
vi.setConfig({ testTimeout: 180_000 })

const DT = CONFIG.sim.step
const hour = (h: number) => (h - CONFIG.sim.startHour) * 3600
const TAU = Math.PI * 2
const wrapPi = (a: number) => a - TAU * Math.round(a / TAU)

/** A Simulation with a fully wired Reactions (see the file comment). */
function rig(seed: number, startHour?: number): { sim: Simulation; r: Reactions } {
  const sim = new Simulation(seed, startHour === undefined ? {} : { startHour })
  if (sim.director) sim.director.occupantName = (room) => sim.beds.occupantName(room)
  const r = new Reactions({
    world: sim.world,
    rng: new Rng(seed).fork('reactions'),
    player: () => sim.player,
    people: sim.people,
    meds: sim.meds,
    life: sim.life,
    meals: sim.meals,
  })
  Object.assign(sim, { reactions: r })
  return { sim, r }
}

const spot = (x: number, z: number, heading = 0): Spot => ({ at: { x, z }, heading })

/** Put the player at (x, z) (adding the avatar the first time). */
function stand(sim: Simulation, x: number, z: number, heading = 0): void {
  if (!sim.player) sim.addPlayer(spot(x, z, heading))
  sim.movePlayer(x, z, heading, 0)
}

function run(sim: Simulation, seconds: number, each?: () => void): void {
  const n = Math.round(seconds / DT)
  for (let i = 0; i < n; i++) {
    sim.step(DT)
    each?.()
  }
}

interface Heard {
  t: number
  id: string
  text: string
}

/** Collect every bubble line as it is said. */
function listen(sim: Simulation, r: Reactions): Heard[] {
  const heard: Heard[] = []
  const hook = () => r.drainBubbles((id, text) => heard.push({ t: sim.t, id, text }))
  // run a drain after every step: wrap step
  const step = sim.step.bind(sim)
  sim.step = (dt: number) => {
    step(dt)
    hook()
  }
  return heard
}

const playerOf = (sim: Simulation) => sim.player!

describe('W1 Life reacts: wiring and the plain day', () => {
  it('Simulation.ts hands Reactions the people and the medicine system (the glue this module needs)', () => {
    const sim = new Simulation(1)
    expect(sim.reactions.wired, 'new Reactions({ world, rng, player, people: this.people, meds: this.meds, life: this.life, meals: this.meals })').toBe(true)
  })

  it('without a player the day is exactly the same, wired or not', () => {
    const plain = new Simulation(11)
    const { sim: wired } = rig(11)
    run(plain, 15 * 60)
    run(wired, 15 * 60)
    const text = (s: Simulation) => s.log.events.map((e: SimEvent) => `${e.id} ${e.t.toFixed(3)} ${e.type} ${e.text}`)
    expect(text(wired)).toEqual(text(plain))
    for (const p of plain.people) {
      const q = wired.people.find((x) => x.entity.id === p.entity.id)!
      expect(q.walker.x).toBe(p.walker.x)
      expect(q.walker.z).toBe(p.walker.z)
      expect(q.entity.lookAt ?? null).toBeNull()
      expect(q.pace).toBe(1)
      expect(q.holdUntil).toBe(-Infinity)
    }
  })
})

describe('W1 Life reacts: a warm start before 07:30 (the sim clock is negative)', () => {
  it('leaves the plain day alone, and reacts to you all the same', () => {
    const a = new Simulation(4, { startHour: 6.8 })
    const { sim: b, r } = rig(4, 6.8)
    expect(b.t).toBeLessThan(0)
    run(a, 120)
    run(b, 120)
    for (const p of a.people) {
      const q = b.people.find((x) => x.entity.id === p.entity.id)!
      expect(q.walker.x).toBe(p.walker.x)
      expect(q.walker.z).toBe(p.walker.z)
    }
    expect(b.log.events.map((e) => e.text)).toEqual(a.log.events.map((e) => e.text))
    // now with you in the lobby: somebody greets and somebody looks
    const heard = listen(b, r)
    stand(b, -50, 0, Math.PI / 2)
    run(b, 600)
    expect(b.t).toBeLessThan(0)
    expect(heard.length).toBeGreaterThan(0)
  }, 120_000)
})

describe('W1 Life reacts: noticing', () => {
  it('people in front of you within the notice radius look at your head, and nobody else does', () => {
    const { sim } = rig(3, 9.5)
    // somebody sitting in the lobby
    const sitter = sim.people.find((p) => p.entity.seated && sim.seats.all.find((s) => s.id === p.entity.seated!.seatId)?.kind === 'waiting')!
    expect(sitter).toBeDefined()
    const seat = sim.seats.all.find((s) => s.id === sitter.entity.seated!.seatId)!
    // stand on the seat's approach spot, facing the sitter
    stand(sim, seat.approach.x, seat.approach.z, Math.atan2(seat.x - seat.approach.x, seat.z - seat.approach.z))
    run(sim, 1)
    const look = sitter.entity.lookAt
    expect(look, 'the sitter looks at you').toBeTruthy()
    expect(look!.x).toBeCloseTo(seat.approach.x, 6)
    expect(look!.z).toBeCloseTo(seat.approach.z, 6)
    expect(look!.y).toBeCloseTo(CONFIG.player.camera.pivotHeight, 6)
    // the rule holds for everybody, every step, for a minute
    const p = playerOf(sim)
    const rr = CONFIG.player.noticeRadius * 1.3 + 0.1
    run(sim, 60, () => {
      for (const q of sim.people) {
        const e = q.entity
        if (!e.lookAt) continue
        expect(Math.hypot(e.position.x - p.x, e.position.z - p.z) <= rr + 0.5 || Math.hypot(q.walker.x - p.x, q.walker.z - p.z) <= rr, `${e.name} looks from too far`).toBe(true)
        expect(e.riding, `${e.name} is riding`).toBeFalsy()
        expect(e.seated?.pose === 'lie' || e.seated?.pose === 'recline', `${e.name} is lying`).toBe(false)
        expect(['give', 'clean', 'lie', 'run']).not.toContain(e.anim)
      }
    })
  })

  it('a glance is short, and they stop looking when you leave or when you are taken out', () => {
    const { sim } = rig(3, 9.5)
    const sitter = sim.people.find((p) => p.entity.seated && sim.seats.all.find((s) => s.id === p.entity.seated!.seatId)?.kind === 'waiting')!
    const seat = sim.seats.all.find((s) => s.id === sitter.entity.seated!.seatId)!
    stand(sim, seat.approach.x, seat.approach.z, Math.atan2(seat.x - seat.approach.x, seat.z - seat.approach.z))
    run(sim, 1)
    expect(sitter.entity.lookAt).toBeTruthy()
    // it is only a glance: within 4 s they look away, however long you stay
    run(sim, 4)
    expect(sitter.entity.lookAt ?? null).toBeNull()
    // you leave: nobody anywhere keeps looking
    stand(sim, 0, -14)
    run(sim, 2)
    for (const q of sim.people) if (Math.hypot(q.walker.x - 0, q.walker.z + 14) > CONFIG.player.noticeRadius * 1.5) expect(q.entity.lookAt ?? null).toBeNull()
    // back among them, then taken out: every look ends at once
    // (somebody who has just looked away waits out a cooldown before looking again)
    stand(sim, seat.approach.x, seat.approach.z, 0)
    for (let i = 0; i < 30 / DT && !sim.people.some((q) => q.entity.lookAt); i++) sim.step(DT)
    expect(sim.people.some((q) => q.entity.lookAt)).toBe(true)
    sim.removePlayer()
    run(sim, 0.1)
    expect(sim.people.filter((q) => q.entity.lookAt)).toEqual([])
  })

  it('does not look while hurrying, riding, lying or being scanned', () => {
    const { sim, r } = rig(3, 9.5)
    const people = sim.people.filter((p) => p.mobile)
    stand(sim, 0, -14)
    const p = people[0]
    const w = p.walker
    // a person right in front of you, in each busy state
    const place = () => {
      w.place(0, -14 + 1.2, Math.PI)
      stand(sim, 0, -14, 0)
    }
    place()
    p.entity.riding = true
    r.step(sim.t, DT)
    expect(p.entity.lookAt ?? null).toBeNull()
    p.entity.riding = false
    p.entity.anim = 'give'
    r.step(sim.t, DT)
    expect(p.entity.lookAt ?? null).toBeNull()
    p.entity.anim = 'idle'
    p.entity.seated = { seatId: sim.seats.all.find((s) => s.kind === 'scanTable')!.id, pose: 'lie' }
    r.step(sim.t, DT)
    expect(p.entity.lookAt ?? null).toBeNull()
    p.entity.seated = undefined
    // and with nothing in the way, they do
    place()
    r.step(sim.t, DT)
    expect(p.entity.lookAt).toBeTruthy()
  })
})

describe('W1 Life reacts: greetings', () => {
  function greetings(sim: Simulation, r: Reactions, x: number, z: number, minutes: number): Heard[] {
    const heard = listen(sim, r)
    stand(sim, x, z, Math.PI / 2)
    run(sim, minutes * 60)
    return heard
  }

  /** The gentle-greeting rules, for any list of bubble lines. */
  function expectGentle(sim: Simulation, heard: Heard[], opts: { perPerson: boolean }): void {
    for (let i = 1; i < heard.length; i++) expect(heard[i].t - heard[i - 1].t, `${heard[i - 1].text} / ${heard[i].text}`).toBeGreaterThanOrEqual(1.2 - 1e-6)
    for (let i = 2; i < heard.length; i++) expect(heard[i].t - heard[i - 2].t, 'at most two in four seconds').toBeGreaterThanOrEqual(4 - 1e-6)
    if (opts.perPerson) {
      const last = new Map<string, number>()
      for (const h of heard) {
        const before = last.get(h.id)
        if (before !== undefined) expect(h.t - before, `${h.id} greeted twice within the cooldown`).toBeGreaterThanOrEqual(CONFIG.player.greetCooldownSeconds - 1e-6)
        last.set(h.id, h.t)
      }
    }
    const roles = new Map(sim.people.map((p) => [p.entity.id, p.entity.role]))
    for (const h of heard) {
      const role = roles.get(h.id)
      if (role === undefined) continue
      const allowed = greetLines(role).map((l) => fillBark(l, { hello: helloFor(((h.t / 3600) + CONFIG.sim.startHour) % 24) }))
      expect(allowed, `${h.id} (${role}) said "${h.text}"`).toContain(h.text)
    }
  }

  it('staff greet you in a corridor by the nurse hub for 20 minutes, gently and within the cooldown', () => {
    const { sim, r } = rig(21, 8.0)
    const heard = greetings(sim, r, 0, -14, 20)
    expect(heard.length).toBeGreaterThan(0)
    expectGentle(sim, heard, { perPerson: true })
    // staff, mostly
    expect(heard.some((h) => sim.people.find((p) => p.entity.id === h.id)?.entity.role === 'nurse' || sim.people.find((p) => p.entity.id === h.id)?.entity.role === 'cleaner' || sim.people.find((p) => p.entity.id === h.id)?.entity.role === 'doctor')).toBe(true)
  }, 120_000)

  it('in the busy lobby every person still greets at most once a minute, and the hospital stays gentle', () => {
    const { sim, r } = rig(8, 9.5)
    const heard = greetings(sim, r, -50, 0, 20)
    expect(heard.length).toBeGreaterThan(10)
    expectGentle(sim, heard, { perPerson: true })
    // some patients and visitors greet back, but staff greet more often than they do
    const role = (id: string) => sim.people.find((p) => p.entity.id === id)?.entity.role
    const staffGreets = heard.filter((h) => role(h.id) !== 'patient' && role(h.id) !== 'visitor' && role(h.id) !== undefined).length
    expect(staffGreets).toBeGreaterThan(0)
    // the same person does greet again once a minute has passed (the cooldown is not a ban)
    const per = new Map<string, number>()
    for (const h of heard) per.set(h.id, (per.get(h.id) ?? 0) + 1)
    expect(Math.max(...per.values())).toBeGreaterThanOrEqual(2)
  }, 120_000)

  it('a greeting shows the talking pose while it is said, then the old pose returns', () => {
    const { sim, r } = rig(21, 7.5)
    // porter 1 waits at the lobby base facing north; you stand a step in front of him
    const porter = sim.people.find((p) => p.entity.id === 'porter-1')!
    expect(porter.entity.anim).toBe('idle')
    const w = porter.walker
    const heard = listen(sim, r)
    stand(sim, w.x + Math.sin(w.heading) * 1.5, w.z + Math.cos(w.heading) * 1.5, w.heading + Math.PI)
    let spoke = -1
    let posed = 0
    run(sim, 6, () => {
      if (spoke < 0 && heard.some((h) => h.id === 'porter-1')) spoke = sim.t
      if (spoke >= 0 && sim.t < spoke + 2.2 && porter.entity.anim === 'talk') posed++
    })
    expect(spoke, 'the porter greets you').toBeGreaterThan(0)
    expect(posed, 'and talks while he does').toBeGreaterThan(30)
    expect(porter.entity.anim).toBe('idle')
    // the greeting is not a hold: he did not turn to you, and he was never held
    expect(porter.holdUntil).toBe(-Infinity)
  })

  it('is silent in the overview and without a player', () => {
    const { sim, r } = rig(8, 9.5)
    const heard = listen(sim, r)
    run(sim, 120)
    expect(heard).toEqual([])
    stand(sim, -50, 0)
    sim.player!.mode = 'overview'
    run(sim, 120)
    expect(heard).toEqual([])
    expect(sim.people.filter((q) => q.entity.lookAt)).toEqual([])
  })
})

describe('W1 Life reacts: courtesy', () => {
  it('walkers heading your way slow down a little, and speed up again; then they stop making way', () => {
    const { sim } = rig(8, 9.5)
    stand(sim, -52, 0, Math.PI / 2)
    let slowed = 0
    const roles = new Set<string>()
    run(sim, 20 * 60, () => {
      for (const p of sim.people) {
        if (p.pace !== 1) {
          slowed++
          expect(p.pace).toBeGreaterThan(0.5)
          roles.add(p.entity.role)
          // never somebody in a hurry, riding, or pushing a vehicle
          expect(p.entity.role).not.toBe('paramedic')
          expect(p.entity.riding).not.toBe(true)
          expect(p.entity.vehicle ?? 'none').toBe('none')
        }
      }
    })
    expect(slowed).toBeGreaterThan(0)
    expect(roles.has('visitor')).toBe(true)
    // you leave: everybody is back at their own pace, and in the middle of their own way
    stand(sim, 30, 0)
    run(sim, 5)
    expect(sim.people.filter((p) => p.pace !== 1).map((p) => p.entity.name)).toEqual([])
    expect(sim.people.filter((p) => p.walker instanceof CrowdWalker && p.walker.courtesy !== 0).map((p) => p.entity.name)).toEqual([])
  }, 120_000)
})

describe('W1 Life reacts: stepping aside', () => {
  /** Ward A's corridor: 4 m wide, its centre line at z = -14 (W2: the whole width is walkable, there are no robot lanes). */
  const CZ = -14
  const POST = new Map([...STAFF, ...NIGHT_STAFF, ...HOSTS].map((m) => [m.id, m]))
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)
  const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? NaN

  /** Is the point in a doorway? */
  const inPinch = (x: number, z: number): boolean => !mayStandAt(x, z) || inDoorway(x, z, 0)

  interface Pass {
    id: string
    role: string
    /** Distance to you, sideways, when they walk past (m). */
    lat: number
    /** They came towards you (not: you came up behind them). */
    oncoming: boolean
    /** How fast they were walking as they passed (m/s): a walker the crowd had to stop for you passes at about 0. */
    speed: number
  }
  interface Result {
    passes: Pass[]
    /** Who the last-resort "blocked for 4 s" rule fired for near you, as `id (vehicle)`. */
    fallbacks: string[]
    /** The longest anybody within 4 m of you stood still (not seated, not riding) in a doorway (s), and who. */
    pinchSeconds: number
    pinchWho: string
    /** Everybody who made way at some point broke none of the exclusions; the most metres asked of staff and of the public. */
    wrong: string[]
    staffMetres: number
    publicMetres: number
    sides: number
  }

  /**
   * Ten minutes from 10:30 with you in ward A's corridor (standing at x = -4.7, z, or walking up and down it at your walking
   * speed), on a plain Simulation: for every walker who passes you along the corridor, how far from you they pass.
   */
  function corridorRun(seed: number, o: { sidestep: boolean; walking?: boolean; z?: number; player?: boolean; seconds?: number }): Result {
    const sim = new Simulation(seed, { startHour: 10.5 })
    sim.reactions.sidestep = o.sidestep
    const z = o.z ?? CZ
    const withPlayer = o.player ?? true
    let px = o.walking ? -20 : -4.7
    let dir = 1
    if (withPlayer) {
      sim.addPlayer(spot(px, z, Math.PI / 2))
      sim.movePlayer(px, z, Math.PI / 2, 0)
    }
    const res: Result = { passes: [], fallbacks: [], pinchSeconds: 0, pinchWho: '', wrong: [], staffMetres: 0, publicMetres: 0, sides: 0 }
    sim.crowd!.onBlockedFallback = (x, zz) => {
      if (Math.hypot(x - px, zz - z) >= 5) return
      const p = sim.people.find((q) => q.walker.x === x && q.walker.z === zz)
      res.fallbacks.push(`${p?.entity.id ?? '?'} (${p?.entity.vehicle ?? 'none'})`)
    }
    const side = new Map<string, number>()
    const still = new Map<string, number>()
    const t0 = sim.t
    const end = t0 + (o.seconds ?? 600)
    while (sim.t < end) {
      if (withPlayer && o.walking) {
        px += dir * CONFIG.player.walkSpeed * DT
        if (px > 12) dir = -1
        if (px < -22) dir = 1
        sim.movePlayer(px, z, dir > 0 ? Math.PI / 2 : -Math.PI / 2, CONFIG.player.walkSpeed)
      }
      sim.step(DT)
      for (const p of sim.people) {
        const w = p.walker
        const e = p.entity
        // who is making way, and are they the sort who should
        if (w instanceof CrowdWalker && w.courtesy !== 0) {
          res.sides++
          const post = POST.get(e.id)?.post
          if (!p.mobile || e.riding || e.seated || (e.vehicle ?? 'none') !== 'none' || e.role === 'paramedic' || post === 'er' || post === 'triage') {
            if (res.wrong.length < 10) res.wrong.push(`${e.id} ${e.role} ${e.vehicle ?? ''} ${e.riding ? 'riding' : ''}`)
          }
          if (e.role === 'patient' || e.role === 'visitor') res.publicMetres = Math.max(res.publicMetres, w.courtesyMetres)
          else res.staffMetres = Math.max(res.staffMetres, w.courtesyMetres)
        }
        // nobody stands about in a doorway
        const id = e.id
        if (withPlayer && !e.seated && !e.riding && w.speed < 0.05 && Math.hypot(w.x - px, w.z - z) < 4 && inPinch(w.x, w.z)) {
          const secs = (still.get(id) ?? 0) + DT
          still.set(id, secs)
          if (secs > res.pinchSeconds) {
            res.pinchSeconds = secs
            res.pinchWho = `${e.name} (${e.role}) at ${w.x.toFixed(1)}, ${w.z.toFixed(1)} t=${(sim.t - t0).toFixed(0)}`
          }
        } else still.delete(id)
        // passing you along the corridor
        if (!withPlayer) continue
        const dx = w.x - px
        const dz = w.z - z
        if (Math.hypot(dx, dz) > 3 || Math.abs(dz) > 3) {
          side.delete(id)
          continue
        }
        const sgn = Math.sign(dx)
        const prev = side.get(id)
        const along = Math.sin(w.heading)
        // (somebody walking along the corridor, with a route: not somebody standing still that you walk past)
        const walking = p.walkT >= sim.t - 1.5 * DT
        if (prev !== undefined && prev !== sgn && sgn !== 0 && walking && (e.vehicle ?? 'none') === 'none' && Math.abs(along) > 0.7 && Math.abs(dz) < 1.4) {
          res.passes.push({ id, role: e.role, lat: Math.abs(dz), oncoming: !o.walking || along * dir < 0, speed: w.speed })
        }
        side.set(id, sgn)
      }
    }
    return res
  }

  const SEEDS = [3, 7, 11, 2026]
  const pooled = (rs: Result[]) => rs.flatMap((r) => r.passes)

  it('standing in the middle of ward A for 10 minutes at 10:30: oncoming walkers pass you with room to spare, and nobody is held up for it', () => {
    const after = SEEDS.map((s) => corridorRun(s, { sidestep: true }))
    const before = SEEDS.map((s) => corridorRun(s, { sidestep: false }))
    const lat = (rs: Result[]) => pooled(rs).filter((p) => p.oncoming).map((p) => p.lat)
    // the corridor is 4 m wide and all of it is walkable (W2: no lane bands): standing ON the centre line, oncoming walkers
    // pass at their keep-right offset plus whatever they sidestep, about 0.9 m on average; a little off it, the far side has more room
    const offA = SEEDS.map((s) => corridorRun(s, { sidestep: true, z: CZ - 0.2 }))
    const offB = SEEDS.map((s) => corridorRun(s, { sidestep: false, z: CZ - 0.2 }))
    console.log(
      `[W1 sidestep] standing mid-corridor, oncoming passes (${SEEDS.length} seeds x 10 min): ` +
        `on the centre line: after mean ${mean(lat(after)).toFixed(3)} m / median ${median(lat(after)).toFixed(3)} (n=${lat(after).length}), without the sidestep mean ${mean(lat(before)).toFixed(3)} / median ${median(lat(before)).toFixed(3)} (n=${lat(before).length}); ` +
        `0.2 m off it: after mean ${mean(lat(offA)).toFixed(3)}, without ${mean(lat(offB)).toFixed(3)}`,
    )
    expect(lat(after).length).toBeGreaterThan(30)
    expect(mean(lat(after))).toBeGreaterThanOrEqual(0.82)
    expect(Math.min(...lat(after))).toBeGreaterThanOrEqual(0.78)
    // never wider than the sidestep asks (keep-right 0.45 m plus the 0.6 m of courtesy is about 1.05 m, with some avoidance on top), and never narrower than before on average
    expect(Math.max(...lat(after))).toBeLessThan(1.4)
    expect(mean(lat(after))).toBeGreaterThanOrEqual(mean(lat(before)) - 0.03)
    expect(mean(lat(offA))).toBeGreaterThanOrEqual(0.9)
    for (const r of [...after, ...offA]) {
      // nobody who gives way is blocked for 4 s because of it (the cart pushers, who are not asked to, are the ones who may
      // be: they were blocked by you before, too)
      expect(r.fallbacks.filter((f) => /\(none\)/.test(f))).toEqual([])
      expect(r.wrong).toEqual([])
      expect(r.pinchSeconds, r.pinchWho).toBeLessThanOrEqual(2)
    }
    // the ones who give way do it by the book: staff less than patients and visitors
    expect(Math.max(...after.map((r) => r.sides))).toBeGreaterThan(0)
    expect(Math.max(...after.map((r) => r.publicMetres))).toBeGreaterThan(0.45)
    expect(Math.max(...after.map((r) => r.staffMetres))).toBeGreaterThan(0)
    expect(Math.max(...after.map((r) => r.staffMetres))).toBeLessThan(0.35)
  }, 600_000)

  it('walking up and down the corridor at your walking speed: they step aside early and keep walking, instead of being stopped and pushed late', () => {
    const after = SEEDS.map((s) => corridorRun(s, { sidestep: true, walking: true }))
    const before = SEEDS.map((s) => corridorRun(s, { sidestep: false, walking: true }))
    const onc = (rs: Result[]) => pooled(rs).filter((p) => p.oncoming)
    const lat = (rs: Result[]) => onc(rs).map((p) => p.lat)
    // the share of walkers who are still walking (not stopped by you) as they pass
    const moving = (rs: Result[]) => onc(rs).filter((p) => p.speed >= 0.5).length / Math.max(1, onc(rs).length)
    console.log(
      `[W1 sidestep] walking at ${CONFIG.player.walkSpeed} m/s, oncoming passes (${SEEDS.length} seeds x 10 min): after mean ${mean(lat(after)).toFixed(3)} m / median ${median(lat(after)).toFixed(3)}, ` +
        `${(100 * moving(after)).toFixed(0)} % still walking (n=${onc(after).length}); without the sidestep mean ${mean(lat(before)).toFixed(3)} / median ${median(lat(before)).toFixed(3)}, ` +
        `${(100 * moving(before)).toFixed(0)} % still walking (n=${onc(before).length}); overtaken by you: after ${mean(pooled(after).filter((p) => !p.oncoming).map((p) => p.lat)).toFixed(3)}, without ${mean(pooled(before).filter((p) => !p.oncoming).map((p) => p.lat)).toFixed(3)}`,
    )
    expect(onc(after).length).toBeGreaterThan(20)
    // before: about 0.7 m (the two bodies' radii) and the crowd had stopped them for you; now they pass with room to spare, at a walk
    // (at an ordinary 1.4 m/s walk the crowd already gives you a little more room than at the old 2 m/s; the sidestep still adds to it and keeps them walking)
    expect(median(lat(before))).toBeLessThan(0.83)
    expect(median(lat(after))).toBeGreaterThanOrEqual(0.82)
    expect(mean(lat(after))).toBeGreaterThanOrEqual(mean(lat(before)) + 0.06)
    expect(moving(after)).toBeGreaterThanOrEqual(0.7)
    expect(moving(after)).toBeGreaterThanOrEqual(moving(before) + 0.3)
    for (const r of after) {
      expect(r.fallbacks.filter((f) => /\(none\)/.test(f))).toEqual([])
      expect(r.wrong).toEqual([])
      expect(r.pinchSeconds, r.pinchWho).toBeLessThanOrEqual(2)
    }
  }, 600_000)

  it('a 4 m corridor with you in the middle still lets everybody through, as many as without you', () => {
    const crossings = (o: { player: boolean }): number => {
      const sim = new Simulation(7, { startHour: 10.5 })
      if (o.player) {
        sim.addPlayer(spot(-4.7, CZ, Math.PI / 2))
        sim.movePlayer(-4.7, CZ, Math.PI / 2, 0)
      }
      const last = new Map<string, number>()
      let n = 0
      for (let i = 0; i < 600 / DT; i++) {
        sim.step(DT)
        for (const p of sim.people) {
          const w = p.walker
          if (w.z < -16 || w.z > -12) {
            last.delete(p.entity.id)
            continue
          }
          const prev = last.get(p.entity.id)
          const sgn = Math.sign(w.x + 4.7)
          if (prev !== undefined && prev !== sgn && sgn !== 0) n++
          last.set(p.entity.id, sgn)
        }
      }
      return n
    }
    const without = crossings({ player: false })
    const withYou = crossings({ player: true })
    console.log(`[W1 sidestep] crossings of x = -4.7 in ward A's corridor in 10 min: ${without} without you, ${withYou} with you standing there`)
    expect(without).toBeGreaterThan(8)
    expect(withYou).toBeGreaterThanOrEqual(Math.floor(without * 0.8))
  }, 600_000)

  it('everybody makes way for you in the lobby and the halls too, and the exclusions hold (nobody hurrying, riding or pushing)', () => {
    const { sim } = rig(8, 9.5)
    stand(sim, -52, 0, Math.PI / 2)
    let sides = 0
    const wrong: string[] = []
    const roles = new Set<string>()
    run(sim, 20 * 60, () => {
      for (const p of sim.people) {
        const w = p.walker
        if (!(w instanceof CrowdWalker) || w.courtesy === 0) continue
        sides++
        const e = p.entity
        roles.add(e.role)
        const post = POST.get(e.id)?.post
        if (!p.mobile || e.riding || e.seated || (e.vehicle ?? 'none') !== 'none' || e.role === 'paramedic' || post === 'er' || post === 'triage') wrong.push(`${e.id} ${e.role}`)
      }
    })
    expect(wrong).toEqual([])
    expect(sides).toBeGreaterThan(0)
    // you leave: nobody is making way any more
    stand(sim, 30, 0)
    run(sim, 5)
    expect(sim.people.filter((p) => p.walker instanceof CrowdWalker && p.walker.courtesy !== 0).map((p) => p.entity.name)).toEqual([])
  }, 300_000)

  /** A plain person who walks from `from` to `to` at `speed` (a stand-in for the hospital's many kinds, to try each rule on its own). */
  class Stroller extends Person {
    constructor(
      id: string,
      role: Role,
      from: Vec2,
      to: Vec2,
      walker: Walker,
      private readonly speed: number,
      private readonly opts: { vehicle?: VehicleKind; riding?: boolean; run?: boolean } = {},
    ) {
      super(newEntity(id, role, id, from, Math.PI / 2), walker)
      if (opts.vehicle !== undefined) this.entity.vehicle = opts.vehicle
      if (opts.riding) this.entity.riding = true
      this.walker.goTo(to)
    }
    update(dt: number, ctx: PeopleContext): void {
      const st = this.stepWalker(dt, ctx, this.speed)
      this.entity.speed = this.walker.speed
      this.entity.anim = this.opts.run ? 'run' : st === 'moving' || st === 'held' ? 'walk' : 'idle'
    }
  }

  it('who makes way: patients and visitors most, staff less; not the hurrying, riders, pushers, paramedics or emergency staff', () => {
    interface Case {
      name: string
      id: string
      role: Role
      vehicle?: VehicleKind
      riding?: boolean
      run?: boolean
      /** The pace and the sidestep they should show, or null: they walk on as they were. */
      gives: { pace: number; metres: number } | null
    }
    const cases: Case[] = [
      { name: 'a visitor', id: 'vis-t', role: 'visitor', gives: { pace: 0.6, metres: 0.5 } },
      { name: 'a walking patient', id: 'pat-t', role: 'patient', gives: { pace: 0.6, metres: 0.5 } },
      { name: 'a ward doctor', id: 'doc-t', role: 'doctor', gives: { pace: 0.85, metres: 0.3 } },
      { name: 'a ward nurse', id: 'nurse-t', role: 'nurse', gives: { pace: 0.85, metres: 0.3 } },
      { name: 'a porter with no vehicle', id: 'porter-t', role: 'porter', gives: { pace: 0.85, metres: 0.3 } },
      { name: 'a radiographer', id: 'rad-t', role: 'radiographer', gives: { pace: 0.85, metres: 0.3 } },
      { name: 'an emergency doctor', id: 'doc-ER1', role: 'doctor', gives: null },
      { name: 'a triage nurse', id: 'nurse-T1', role: 'nurse', gives: null },
      { name: 'a paramedic', id: 'para-t', role: 'paramedic', gives: null },
      { name: 'a porter pushing a stretcher', id: 'porter-s', role: 'porter', vehicle: 'stretcher', gives: null },
      { name: 'a cleaner with a cart', id: 'cleaner-t', role: 'cleaner', vehicle: 'cleaningCart', gives: null },
      { name: 'a patient on a wheelchair', id: 'pat-w', role: 'patient', vehicle: 'wheelchair', riding: true, gives: null },
      { name: 'somebody running', id: 'vis-h', role: 'visitor', run: true, gives: null },
    ]
    for (const c of cases) {
      const sim = new Simulation(1, { population: false })
      const w = sim.crowd!.createWalker({ id: c.id })
      // the lobby: a walker comes along its middle towards you, standing in the way
      const p = new Stroller(c.id, c.role, { x: -63, z: 0 }, { x: -46, z: 0 }, w, 1.3, { vehicle: c.vehicle, riding: c.riding, run: c.run })
      sim.addPerson(p)
      stand(sim, -54, 0, -Math.PI / 2)
      let side = 0
      let pace = 1
      let metres = 0
      let closest = Infinity
      run(sim, 9, () => {
        closest = Math.min(closest, Math.hypot(w.x + 54, w.z))
        if (w.courtesy !== 0) {
          side = w.courtesy
          pace = Math.min(pace, p.pace)
          metres = Math.max(metres, w.courtesyMetres)
        }
      })
      if (c.gives === null) {
        expect({ who: c.name, side, pace, metres }).toEqual({ who: c.name, side: 0, pace: 1, metres: 0 })
      } else {
        expect({ who: c.name, gave: side !== 0 }).toEqual({ who: c.name, gave: true })
        expect(pace, c.name).toBeCloseTo(c.gives.pace, 6)
        expect(metres, c.name).toBeCloseTo(c.gives.metres, 6)
        // and they went round you, with room (the body radii alone are 0.7 m)
        expect(closest, c.name).toBeGreaterThan(0.85)
      }
      // you have gone: it is all over
      sim.removePlayer()
      run(sim, 1)
      expect(w.courtesy, c.name).toBe(0)
      expect(p.pace, c.name).toBe(1)
    }
  }, 120_000)

  it('without a player nobody makes way, and the day is what it was', () => {
    const sim = new Simulation(7, { startHour: 10.5 })
    for (let i = 0; i < 120 / DT; i++) {
      sim.step(DT)
      for (const p of sim.people) if (p.walker instanceof CrowdWalker) expect(p.walker.courtesy).toBe(0)
    }
  })

  it('every pathway still ends with you pacing the corridor all morning', () => {
    const sim = new Simulation(2026)
    sim.addPlayer(spot(-20, CZ, Math.PI / 2))
    let px = -20
    let dir = 1
    const end = hour(11.5)
    const SAMPLE = 30
    // the last-resort "blocked for 4 s" rule near you: never for somebody who is making way for you. (A visitor who is already
    // standing still, and whom a scripted player walks straight into, is blocked by that, with or without the sidestep.)
    const blockedWhileMakingWay: string[] = []
    let blockedNearYou = 0
    sim.crowd!.onBlockedFallback = (x, z) => {
      if (Math.hypot(x - px, z - CZ) >= 4) return
      const p = sim.people.find((q) => q.walker.x === x && q.walker.z === z)
      if (p === undefined || (p.entity.vehicle ?? 'none') !== 'none' || p.entity.riding) return
      blockedNearYou++
      if (p.walker instanceof CrowdWalker && p.walker.courtesy !== 0) blockedWhileMakingWay.push(`${p.entity.name} (${p.entity.role}) at ${x.toFixed(2)}, ${z.toFixed(2)}, t=${(sim.t / 60).toFixed(1)} min, you at ${px.toFixed(1)}`)
    }
    while (sim.t < end) {
      for (let k = 0; k < SAMPLE; k++) {
        px += dir * CONFIG.player.walkSpeed * DT
        if (px > 12) dir = -1
        if (px < -22) dir = 1
        sim.movePlayer(px, CZ, dir > 0 ? Math.PI / 2 : -Math.PI / 2, CONFIG.player.walkSpeed)
        sim.step(DT)
      }
    }
    expect(blockedWhileMakingWay).toEqual([])
    expect(blockedNearYou).toBeLessThanOrEqual(3)
    const er = sim.world.er
    const stuck = [...er.cases.values()].filter((c) => c.arrivedAt < end - 90 * 60)
    expect(stuck.map((c) => `${c.name} ${c.state} since ${(c.arrivedAt / 60).toFixed(0)} min`)).toEqual([])
    expect(er.finished.length).toBeGreaterThan(20)
    expect(er.maxCleanWait).toBeLessThanOrEqual(5 * 60)
    const orders = [...sim.meds.orders.values()]
    expect(orders.filter((o) => o.createdAt < end - 25 * 60 && o.stage !== 'given')).toEqual([])
    expect(sim.imaging.stuckLog.filter((l) => !/xray stuck in gap/.test(l))).toEqual([])
    expect(sim.beds.board.log.violations).toEqual([])
  }, 900_000)
})

describe('W1 Life reacts: talkTo', () => {
  /** Find somebody walking along at a good pace, away from every doorway, who can talk. */
  function aWalker(sim: Simulation, r: Reactions): Actor {
    for (let i = 0; i < 40 * 60 * 5; i++) {
      sim.step(DT)
      if (i % 30 !== 0) continue
      for (const p of sim.people) {
        if (!(p instanceof Actor) || p.mode !== 'walk' || p.walker.speed < 1.0 || p.entity.vehicle !== undefined && p.entity.vehicle !== 'none') continue
        if (p.entity.role === 'visitor' && p.entity.prop === 'flowers') continue
        const w = p.walker
        let clear = true
        for (let k = 0; k <= 4; k += 0.5) if (!mayStandAt(w.x + Math.sin(w.heading) * k, w.z + Math.cos(w.heading) * k)) clear = false
        if (!clear) continue
        // you are 1.4 m behind them
        stand(sim, w.x - Math.sin(w.heading) * 1.4, w.z - Math.cos(w.heading) * 1.4, w.heading)
        if (r.talkTo(p.entity.id) !== null) return p
      }
    }
    throw new Error('nobody to talk to')
  }

  it('stops a walker, faces you, keeps their eyes on you, then lets them carry on', () => {
    const { sim, r } = rig(5, 9.0)
    sim.player ?? stand(sim, 0, -14)
    const p = aWalker(sim, r)
    const e = p.entity
    const w = p.walker
    const t0 = sim.t
    // `aWalker` already called talkTo: the hold has started
    expect(p.holdUntil).toBeCloseTo(t0 + CONFIG.player.talkHoldSeconds, 6)
    expect(sim.log.events.some((ev) => ev.type === 'talkedTo' && ev.subjectId === e.id && ev.text === `You spoke with ${e.name}.`)).toBe(true)
    // the line is returned to the caller, not queued as a bubble as well
    const queued: string[] = []
    r.drainBubbles((id) => queued.push(id))
    expect(queued).not.toContain(e.id)
    run(sim, 1.5)
    const at = { x: w.x, z: w.z }
    expect(e.lookAt).toBeTruthy()
    // stood still for the middle of the hold
    let moved = 0
    run(sim, 2.5, () => {
      moved = Math.max(moved, Math.hypot(w.x - at.x, w.z - at.z))
      expect(w.speed).toBeLessThan(0.05)
    })
    expect(moved).toBeLessThan(0.05)
    expect(e.anim).toBe('talk')
    // facing you
    const pl = playerOf(sim)
    expect(Math.abs(wrapPi(Math.atan2(pl.x - w.x, pl.z - w.z) - w.heading))).toBeLessThan(0.15)
    // the hold ends and they walk on (or have arrived)
    run(sim, 3)
    const after = { x: w.x, z: w.z }
    run(sim, 6)
    expect(Math.hypot(w.x - after.x, w.z - after.z) > 0.5 || p.done).toBe(true)
    expect(e.anim).not.toBe('talk')
  }, 120_000)

  it('turns a person who stands at their post to face you, and back again when you are done', () => {
    const { sim, r } = rig(5, 9.0)
    stand(sim, 0, -9, Math.PI)
    // a pharmacist at the verify desk (a Person that never walks): she faces the island, you stand behind her
    const ph = sim.people.find((p) => p.entity.role === 'pharmacist' && p.entity.id === 'pharm-A')!
    const w = ph.walker
    stand(sim, w.x + 1.5, w.z - 1.5, 0)
    run(sim, 1)
    const heading0 = w.heading
    const anim0 = ph.entity.anim
    expect(r.talkTo(ph.entity.id)).not.toBeNull()
    run(sim, 3)
    const pl = playerOf(sim)
    expect(Math.abs(wrapPi(Math.atan2(pl.x - w.x, pl.z - w.z) - w.heading))).toBeLessThan(0.15)
    expect(ph.entity.lookAt).toBeTruthy()
    // the hold ends; she turns back to her desk and the old pose returns
    run(sim, CONFIG.player.talkHoldSeconds + 2)
    expect(Math.abs(wrapPi(w.heading - heading0))).toBeLessThan(0.05)
    expect(ph.entity.anim).toBe(anim0)
    expect(ph.entity.lookAt ?? null).toBeNull()
    // a seated coordinator stays in her chair and keeps her pose afterwards
    const co = sim.people.find((p) => p.entity.role === 'coordinator' && p.entity.id === 'coord-2')!
    const cw = co.walker
    const ch0 = cw.heading
    stand(sim, cw.x + 1.2, cw.z, 0)
    expect(r.talkTo(co.entity.id)).not.toBeNull()
    run(sim, 2)
    expect(Math.abs(wrapPi(cw.heading - ch0))).toBeLessThan(1e-9)
    expect(co.entity.seated).toBeDefined()
    run(sim, CONFIG.player.talkHoldSeconds + 1)
    expect(['sit', 'tablet']).toContain(co.entity.anim)
  })

  it('holds the ward staff too: a nurse walking to a bedside stops, then goes on and gives the medicines', () => {
    const { sim, r } = rig(5, 8.0)
    stand(sim, 0, -14)
    const res = sim.prescribe('A3', [{ medId: 'paracetamol', qty: 1 }])
    if (!res.ok) throw new Error(res.reason)
    const order = res.order
    let nurse: Person | null = null
    for (let i = 0; i < 900 * 60 && nurse === null; i++) {
      sim.step(DT)
      for (const p of sim.people) {
        if (p.entity.role !== 'nurse' || !p.entity.id.startsWith('nurse-A') || p.walker.speed < 1.0) continue
        const w = p.walker
        // in the open corridor, with room to stop
        let clear = true
        for (let k = 0; k <= 3; k += 0.25) if (!mayStandAt(w.x + Math.sin(w.heading) * k, w.z + Math.cos(w.heading) * k)) clear = false
        if (!clear) continue
        stand(sim, w.x - Math.sin(w.heading) * 1.4, w.z - Math.cos(w.heading) * 1.4, w.heading)
        if (r.talkTo(p.entity.id) !== null) nurse = p
        break
      }
    }
    expect(nurse, 'a nurse on her way').not.toBeNull()
    const w = nurse!.walker
    run(sim, 1.5)
    const at = { x: w.x, z: w.z }
    run(sim, 2.5, () => expect(w.speed).toBeLessThan(0.05))
    expect(Math.hypot(w.x - at.x, w.z - at.z)).toBeLessThan(0.05)
    expect(nurse!.entity.anim).toBe('talk')
    // later she carries on, and the order is given
    stand(sim, 0, -14)
    for (let i = 0; i < 20 * 60 / DT && order.stage !== 'given'; i++) sim.step(DT)
    expect(order.stage).toBe('given')
  }, 120_000)

  it('says something kind for the situation, and something else the next time', () => {
    const { sim, r } = rig(5, 9.5)
    stand(sim, -50, 0)
    const said = new Map<string, string[]>()
    for (let n = 0; n < 12; n++) {
      run(sim, 20)
      for (const p of sim.people) {
        const line = r.talkTo(p.entity.id)
        if (line === null) continue
        expect(line, `${p.entity.name}`).not.toMatch(/[{}]/)
        expect(line.length).toBeGreaterThan(5)
        const list = said.get(p.entity.id) ?? []
        list.push(line)
        said.set(p.entity.id, list)
        // the second line the same person says in a row is not the first again (when the situation has not changed)
        const again = r.talkTo(p.entity.id)
        expect(again).not.toBeNull()
        if (list.length === 1) expect(again, `${p.entity.name} repeated`).not.toBe(line)
        list.push(again!)
      }
    }
    expect(said.size).toBeGreaterThan(30)
  }, 180_000)

  it('says the right thing by role and moment', () => {
    // a ward nurse: "A3's medicines are in the drawer"
    const { sim, r } = rig(5, 8.0)
    stand(sim, 0, -14)
    const res = sim.prescribe('A3', [{ medId: 'paracetamol', qty: 1 }])
    expect(res.ok).toBe(true)
    let nurse: Person | undefined
    for (let i = 0; i < 600 * 60 && !nurse; i++) {
      sim.step(DT)
      const loaded = sim.meds.drawers.get('A3')!.state === 'loaded'
      if (!loaded) continue
      nurse = sim.people.find((p) => p.entity.role === 'nurse' && p.entity.id.startsWith('nurse-A') && p.entity.roomId === undefined)
    }
    expect(nurse, 'a nurse at the hub while A3 holds medicines').toBeDefined()
    const line = r.talkTo(nurse!.entity.id)!
    expect(line).toContain('A3')
    expect(talkLines('nurse.drawerLoaded').map((l) => fillBark(l, { room: 'A3' }))).toContain(line)
  }, 120_000)

  it('talks about the scan in progress, and about lunch once it is eaten', () => {
    const { sim, r } = rig(5, 8.0)
    stand(sim, -36, 0)
    sim.imaging.startDemoScan('xray')
    let op = sim.people.find((p) => p.entity.id === 'rad-XR')!
    for (let i = 0; i < 30 * 60 && sim.imaging.scanners.xray.exam === null; i++) sim.step(DT)
    expect(sim.imaging.scanners.xray.exam).not.toBeNull()
    op = sim.people.find((p) => p.entity.id === 'rad-XR')!
    const scan = r.talkTo(op.entity.id)!
    expect(scan).toContain(sim.imaging.scanners.xray.exam!.protocol)

    // a ward patient after lunch
    const { sim: s2, r: r2 } = rig(9, 11.9)
    stand(s2, 0, -14)
    let lunch: string | null = null
    for (let i = 0; i < 90 * 60 * 60 && lunch === null; i += 30 * 60) {
      run(s2, 30)
      for (const [room, st] of s2.life.rooms) {
        if (st.meal !== 'eaten') continue
        const pat = s2.world.wardPatients.get(room)
        if (!pat || !pat.inBed || pat.dState !== null) continue
        const l = r2.talkTo(pat.entity.id)
        if (l !== null) {
          lunch = l
          break
        }
      }
    }
    expect(lunch, 'a patient who has eaten').not.toBeNull()
    expect(['ward.eaten.breakfast', 'ward.eaten.lunch', 'ward.eaten.dinner', 'ward.medsGiven', 'ward.medsReady'].flatMap((k) => talkLines(k as never))).toContain(lunch)
  }, 300_000)

  it('cannot talk to somebody riding, mid-transfer, being scanned, fading, gone, or without a player', () => {
    const { sim, r } = rig(5, 9.5)
    const people = sim.people.filter((p) => p instanceof Actor && p.entity.role !== 'doctor') as Actor[]
    expect(r.talkTo(people[0].entity.id), 'no player yet').toBeNull()
    stand(sim, 0, -14)
    expect(r.talkTo('no-such-person')).toBeNull()
    expect(r.talkTo('player')).toBeNull()
    const [a, b, c, d] = people
    a.entity.riding = true
    expect(r.talkTo(a.entity.id)).toBeNull()
    a.entity.riding = false
    b.slideTo(b.walker.x + 0.3, b.walker.z, 0, 1, 'none')
    expect(r.talkTo(b.entity.id)).toBeNull()
    c.entity.seated = { seatId: sim.seats.all.find((s) => s.kind === 'xrayTable')!.id, pose: 'lie' }
    expect(r.talkTo(c.entity.id)).toBeNull()
    c.entity.seated = undefined
    d.fadeOut()
    expect(r.talkTo(d.entity.id)).toBeNull()
    // and the ones who are free can
    const free = people.find((p) => p !== a && p !== b && p !== c && p !== d && p.entity.fade === undefined && p.mode === 'static')!
    expect(r.talkTo(free.entity.id)).not.toBeNull()
  })

  it('every line comes from barks.json', () => {
    const { sim, r } = rig(5, 9.5)
    stand(sim, -50, 0)
    const pool = new Set<string>()
    const everything = TALK_KEYS.flatMap((k) => talkLines(k))
    for (const l of everything) pool.add(l.replace(/\{\w+\}/g, '').trim())
    run(sim, 30)
    let n = 0
    for (const p of sim.people) {
      const line = r.talkTo(p.entity.id)
      if (line === null) continue
      n++
      // the filled line must be one of the templates with its placeholders replaced: check every fixed part appears in the line
      const ok = everything.some((tpl) => {
        const parts = tpl.split(/\{\w+\}/).filter((s) => s.length > 0)
        let at = 0
        for (const part of parts) {
          const i = line.indexOf(part, at)
          if (i < 0) return false
          at = i + part.length
        }
        return true
      })
      expect(ok, line).toBe(true)
    }
    expect(n).toBeGreaterThan(10)
  })
})

describe('W1 Life reacts: a morning of conversations', () => {
  /** Is the point in a doorway? */
  const inPinch = (x: number, z: number): boolean => !mayStandAt(x, z) || inDoorway(x, z, 0)

  it('every pathway still ends, and nobody is held where the next person has to pass', () => {
    const { sim, r } = rig(2026)
    // you stand in a corridor near the hub; now and then somebody who is about to walk through a doorway is stopped
    stand(sim, 0, -14, Math.PI / 2)
    const stillHeld = new Map<string, number>()
    const problems: string[] = []
    let talks = 0
    let holdsInPinch = 0
    const end = hour(12.5)
    const SAMPLE = 30
    let next = 0
    while (sim.t < end) {
      for (let k = 0; k < SAMPLE; k++) sim.step(DT)
      r.drainBubbles(() => {})
      // every few seconds: stop somebody who is about to cross a doorway
      if (sim.t >= next) {
        next = sim.t + 4
        for (const p of sim.people) {
          if (!(p instanceof Actor) || p.mode !== 'walk' || p.walker.speed < 0.5 || p.holdUntil > sim.t) continue
          const w = p.walker
          let aboutTo = false
          for (const k of [0.4, 0.8, 1.2, 1.6]) if (inPinch(w.x + Math.sin(w.heading) * k, w.z + Math.cos(w.heading) * k)) aboutTo = true
          if (!aboutTo) continue
          // you walk up to them (the player is a person: it does not stand in a pinch either)
          stand(sim, w.x - Math.sin(w.heading) * 1.3, w.z - Math.cos(w.heading) * 1.3, w.heading)
          if (r.talkTo(p.entity.id) !== null) talks++
          break
        }
      }
      const sample = SAMPLE * DT
      for (const p of sim.people) {
        const e = p.entity
        // held by the conversation: standing still because of the hold (a walker the hold has stopped, or somebody who was
        // not walking anyway). A walker whom the crowd, a door or you in the way has stopped while the hold ran is not stopped
        // BY the hold: it still walks on to clear the doorway as soon as it can (the whole-morning gate checks those, too)
        const held = p.holdUntil > sim.t && (p.stoppedByHold || p.walkT < sim.t - 1.5 * DT)
        if (held && inPinch(p.walker.x, p.walker.z) && p.walker.speed < 0.05) holdsInPinch++
        const key = e.id
        if (!held || e.seated || e.riding || p.walker.speed >= 0.05 || !inPinch(p.walker.x, p.walker.z)) {
          stillHeld.delete(key)
          continue
        }
        const secs = (stillHeld.get(key) ?? 0) + sample
        stillHeld.set(key, secs)
        if (secs > 2 + 1e-9 && problems.length < 20) problems.push(`${sim.t.toFixed(0)}s ${e.name} (${e.role}) held in a doorway for ${secs.toFixed(1)} s`)
      }
    }
    expect(problems).toEqual([])
    expect(talks).toBeGreaterThan(100)
    // the same promises as the whole-morning gate: everybody who came in good time is through, and the medicine story ran
    const er = sim.world.er
    const stuck = [...er.cases.values()].filter((c) => c.arrivedAt < end - 90 * 60)
    expect(stuck.map((c) => `${c.name} ${c.state} since ${(c.arrivedAt / 60).toFixed(0)} min`)).toEqual([])
    expect(er.finished.length).toBeGreaterThan(40)
    expect(er.maxCleanWait).toBeLessThanOrEqual(5 * 60)
    const orders = [...sim.meds.orders.values()]
    expect(orders.length).toBeGreaterThan(20)
    expect(orders.filter((o) => o.createdAt < end - 25 * 60 && o.stage !== 'given')).toEqual([])
    // no scanner step had to be forced because somebody held up by a conversation did not arrive (the plain day already logs a
    // few X-ray "gap" watchdog fixes of its own, with no player: those are not ours)
    expect(sim.imaging.stuckLog.filter((l) => !/xray stuck in gap/.test(l))).toEqual([])
    expect(sim.beds.board.log.violations).toEqual([])
    console.log(`[W1] ${talks} conversations in a morning, ${holdsInPinch} held-in-a-doorway samples, ER finished ${er.finished.length}`)
  }, 900_000)
})
