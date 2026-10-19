/**
 * The lifts (R2): lobby gates, a ride (walkers and a stretcher), claimFade, the player's display ride, and a stress test of 60 random parties
 * that must all be served without a deadlock and without two stretchers in one lobby. Runs in a MiniHospital (testkit.ts): no ER, no crowd of
 * ambient people, just the lifts and the people a test starts.
 */
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { l2, levelOf, type LevelId } from '../levels'
import { LIFTS, type ShaftId } from '../places'
import { Rng } from '../rng'
import { LobbyGate, lobbyKey, lobbyName, LOBBY_KEYS, type LiftTrip } from './index'
import { DT, MiniHospital, testPerson, type TestPerson } from './testkit'


function stretcherParty(h: MiniHospital, id: string, spot: { x: number; z: number }): { pusher: TestPerson; rider: TestPerson } {
  const pusher = testPerson(h, `${id}-pusher`, spot, 0)
  const rider = testPerson(h, `${id}-rider`, spot, 0)
  pusher.setVehicle('stretcher')
  pusher.walkAnim = 'push'
  rider.startRiding(pusher, 'stretcher')
  h.world.attach(pusher, rider)
  return { pusher, rider }
}

describe('lobby gates', () => {
  it('number the four lobbies A1 < A2 < B1 < B2', () => {
    expect(LOBBY_KEYS.map((k) => lobbyName(k))).toEqual(['A1', 'A2', 'B1', 'B2'])
    expect(lobbyKey('A', 1)).toBe(0)
    expect(lobbyKey('A', 2)).toBe(1)
    expect(lobbyKey('B', 1)).toBe(2)
    expect(lobbyKey('B', 2)).toBe(3)
  })

  it('hold one stretcher party and lobbyWalkers walkers, all or nothing', () => {
    const g = new LobbyGate(0)
    expect(g.fits(true, 0)).toBe(true)
    g.take('s1', true, 0)
    expect(g.fits(true, 0)).toBe(false)
    expect(g.fits(false, CONFIG.lifts.lobbyWalkers)).toBe(true)
    const slots = g.take('w1', false, 3)
    expect(slots).toEqual([0, 1, 2])
    expect(g.fits(false, 2)).toBe(false)
    expect(g.fits(false, 1)).toBe(true)
    g.release('s1')
    expect(g.fits(true, 0)).toBe(true)
    g.release('w1')
    expect(g.freeWalkers).toBe(CONFIG.lifts.lobbyWalkers)
  })
})

describe('the cars', () => {
  it('start idle on level 1, two per shaft', () => {
    const h = new MiniHospital(1, { crowd: false })
    expect(h.lifts.state.cars).toHaveLength(4)
    for (const c of h.lifts.state.cars) {
      expect(c.level).toBe(1)
      expect(c.phase).toBe('idle')
      expect(c.doors).toBe(0)
    }
    expect(h.lifts.state.cars.filter((c) => c.shaft === 'A')).toHaveLength(CONFIG.lifts.carsPerShaft)
  })

  it('carry a walking party up and down: the car cycles, the party is hidden in the car and appears at the same spots of the other level', () => {
    const h = new MiniHospital(2, { crowd: true })
    const a = testPerson(h, 'a', { x: -46, z: -4.6 })
    const b = testPerson(h, 'b', { x: -46.5, z: -4.4 })
    const trip = h.lifts.trip({ ownerId: 'up', shaft: 'A', from: 1, to: 2, walkers: [a, b] })
    const phases: string[] = []
    const carPhases: string[] = []
    let hiddenWhileRiding = true
    let sawRiding = false
    const car = () => h.lifts.state.cars.find((c) => c.shaft === 'A' && c.phase !== 'idle') ?? h.lifts.state.cars[0]
    expect(
      h.runUntil(() => {
        if (phases[phases.length - 1] !== trip.phase) phases.push(trip.phase)
        const cp = car().phase
        if (carPhases[carPhases.length - 1] !== cp) carPhases.push(cp)
        if (trip.phase === 'inCar' || trip.phase === 'riding') {
          sawRiding = true
          for (const p of [a, b]) if (p.entity.fade !== 0) hiddenWhileRiding = false
        }
        return trip.done
      }, 120),
    ).toBe(true)
    // ('waiting' lasts one step when the car already stands open: it may not be seen between steps)
    expect(phases.filter((p) => p !== 'waiting')).toEqual(['queued', 'toLobby', 'boarding', 'inCar', 'riding', 'arriving', 'done'])
    expect(sawRiding).toBe(true)
    expect(hiddenWhileRiding).toBe(true)
    // the car went idle -> opening -> open -> closing -> moving -> opening (the party appears as the doors open on level 2)
    expect(carPhases.slice(0, 6)).toEqual(['idle', 'opening', 'open', 'closing', 'moving', 'opening'])
    // both stand on level 2 now, at the car spots of lobby A, visible
    for (const p of [a, b]) {
      expect(levelOf(p.x)).toBe(2)
      expect(p.entity.fade).toBe(1)
      expect(p.z).toBeLessThan(-19)
    }
    expect(trip.waitedSeconds(h.t)).toBeLessThan(90)
    // and back down
    for (const p of [a, b]) p.walker.place(p.x, p.z, p.walker.heading)
    const down = h.lifts.trip({ ownerId: 'down', shaft: 'A', from: 2, to: 1, walkers: [a, b] })
    expect(h.runUntil(() => down.done, 120)).toBe(true)
    for (const p of [a, b]) expect(levelOf(p.x)).toBe(1)
    expect(h.lifts.stuckFixes, h.lifts.stuckLog.join('\n')).toBe(0)
    // the slots are free again once the arrival time is over
    h.run(5)
    for (const g of h.lifts.gates) expect(g.freeWalkers).toBe(CONFIG.lifts.lobbyWalkers)
  })

  it('carry a stretcher party: the pusher and the rider are hidden together and the rider follows the pusher on the other level', () => {
    const h = new MiniHospital(3, { crowd: false })
    const { pusher, rider } = stretcherParty(h, 's', { x: l2(-42), z: 19 })
    const trip = h.lifts.trip({ ownerId: 'bed', shaft: 'B', from: 2, to: 1, pusher })
    let hiddenWhileInside = true
    expect(
      h.runUntil(() => {
        if (trip.phase === 'inCar' || trip.phase === 'riding') {
          if (pusher.entity.fade !== 0 || rider.entity.fade !== 0) hiddenWhileInside = false
        }
        return trip.done
      }, 120),
    ).toBe(true)
    expect(hiddenWhileInside).toBe(true)
    expect(levelOf(pusher.x)).toBe(1)
    expect(levelOf(rider.x)).toBe(1)
    expect(pusher.x).toBeCloseTo(LIFTS.B[1].stretcher.at.x, 1)
    expect(pusher.z).toBeCloseTo(LIFTS.B[1].stretcher.at.z, 1)
    // the stretcher is 1.45 m ahead of the pusher, on the lobby side
    expect(Math.hypot(rider.x - pusher.x, rider.z - pusher.z)).toBeCloseTo(1.45, 1)
    expect(rider.entity.fade).toBe(1)
    expect(h.lifts.stuckFixes).toBe(0)
  })

  it('claimFade holds a lobby\'s stretcher slot for one owner at a time, and a stretcher trip waits for it', () => {
    const h = new MiniHospital(4, { crowd: false })
    expect(h.lifts.claimFade('B', 1, 'porter-1')).toBe(true)
    expect(h.lifts.claimFade('B', 1, 'porter-1')).toBe(true)
    expect(h.lifts.claimFade('B', 1, 'mealbot-B1')).toBe(false)
    expect(h.lifts.claimFade('B', 2, 'mealbot-B1')).toBe(true)
    // a stretcher trip into lobby B1 cannot be granted while the fade holds it
    const { pusher } = stretcherParty(h, 'w', { x: l2(-42), z: 19 })
    const trip = h.lifts.trip({ ownerId: 'bed', shaft: 'B', from: 2, to: 1, pusher })
    h.run(30)
    expect(trip.phase).toBe('queued')
    h.lifts.releaseFade('porter-1')
    // (B2 is still held by the MealBot: the trip needs both lobbies)
    h.run(5)
    expect(trip.phase).toBe('queued')
    h.lifts.releaseFade('mealbot-B1')
    expect(h.runUntil(() => trip.done, 150)).toBe(true)
    expect(h.lifts.claimFade('A', 1, 'x')).toBe(true)
    h.lifts.releaseFade('x')
    expect(h.lifts.claimFade('A', 1, 'y')).toBe(true)
  })

  it('keeps a fade (a MealBot, an admitted patient\'s stretcher) and a landing party out of each other\'s lobby', () => {
    const h = new MiniHospital(7, { crowd: false })
    const a = testPerson(h, 'a', { x: l2(-42), z: -12 })
    // a ride DOWN into lobby A1 reserves its landing room at once: nobody may claim the lobby for a fade until it has stepped out
    const trip = h.lifts.trip({ ownerId: 'down', shaft: 'A', from: 2, to: 1, walkers: [a] })
    h.run(1)
    expect(trip.phase).not.toBe('queued')
    expect(h.lifts.claimFade('A', 1, 'meals:A')).toBe(false)
    expect(h.runUntil(() => trip.done, 150)).toBe(true)
    expect(h.lifts.claimFade('A', 1, 'meals:A')).toBe(false)
    h.run(4)
    expect(h.lifts.claimFade('A', 1, 'meals:A')).toBe(true)
    // while the fade holds A1, a ride into it waits (queued) and goes once the fade is released
    const b = testPerson(h, 'b', { x: l2(-42), z: -12 })
    const trip2 = h.lifts.trip({ ownerId: 'down2', shaft: 'A', from: 2, to: 1, walkers: [b] })
    h.run(20)
    expect(trip2.phase).toBe('queued')
    h.lifts.releaseFade('meals:A')
    expect(h.runUntil(() => trip2.done, 150)).toBe(true)
    expect(h.lifts.stuckFixes).toBe(0)
  })

  it('show the player\'s ride: a car opens, closes, travels and opens on the other level, with nobody in it', () => {
    const h = new MiniHospital(5, { crowd: false })
    h.lifts.playerRide('A', 1, 2)
    const seen = new Set<string>()
    h.run(60, DT, () => {
      for (const c of h.lifts.state.cars) if (c.shaft === 'A') seen.add(`${c.level}:${c.phase}`)
    })
    expect(seen.has('1:open')).toBe(true)
    expect(seen.has('1:moving')).toBe(true)
    expect(seen.has('2:open')).toBe(true)
    // all quiet again
    for (const c of h.lifts.state.cars) expect(c.phase === 'idle' || c.phase === 'open' || c.phase === 'closing').toBe(true)
    expect(h.lifts.trips.filter((t) => !t.ghost)).toHaveLength(0)
    for (const g of h.lifts.gates) expect(g.stretcherBy).toBeNull()
  })

  it('lets walkers of the same direction share a car and never a stretcher with anybody', () => {
    const h = new MiniHospital(6, { crowd: false })
    const ws = [0, 1, 2].map((i) => testPerson(h, `w${i}`, { x: -42, z: -12 + i }))
    const trips = ws.map((w, i) => h.lifts.trip({ ownerId: `t${i}`, shaft: 'A', from: 1, to: 2, walkers: [w] }))
    expect(h.runUntil(() => trips.every((t) => t.done), 200)).toBe(true)
    const cars = new Set(trips.map((t) => t.car))
    expect(cars.size).toBeLessThanOrEqual(2)
    expect(h.lifts.stuckFixes).toBe(0)
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------
// The stress test
// ---------------------------------------------------------------------------------------------------------------------------------

interface Party {
  trip: LiftTrip | null
  members: TestPerson[]
  rider: TestPerson | null
  at: number
  shaft: ShaftId
  from: LevelId
  stretcher: boolean
  started: boolean
}

/** A random spot in the corridor near the lifts that nobody stands within 0.9 m of (people never spawn on top of each other). */
function freeSpot(h: MiniHospital, rng: Rng, base: number, sign: number): { x: number; z: number } {
  for (let r = 0; r < 80; r++) {
    const x = base + rng.range(-2, 1.4)
    const z = sign * rng.range(3.4, 12)
    if (!h.people.some((p) => Math.hypot(p.walker.x - x, p.walker.z - z) < 0.9)) return { x, z }
  }
  return { x: base, z: sign * 4.6 }
}

function stress(seed: number, parties: number, minutes: number): { h: MiniHospital; list: Party[]; invariantProblems: string[] } {
  const h = new MiniHospital(seed, { crowd: true })
  const rng = new Rng(seed ^ 0xbeef)
  const spawnRng = new Rng(seed ^ 0xf00d)
  const list: Party[] = []
  for (let i = 0; i < parties; i++) {
    const stretcher = rng.chance(0.25)
    list.push({
      trip: null,
      members: [],
      rider: null,
      at: rng.range(0, minutes * 60),
      shaft: rng.chance(0.5) ? 'A' : 'B',
      from: rng.chance(0.5) ? 1 : 2,
      stretcher,
      started: false,
    })
  }
  list.sort((a, b) => a.at - b.at)
  const problems: string[] = []
  const maxSteps = Math.round(((minutes + 12) * 60) / DT)
  let spawned = 0
  for (let step = 0; step < maxSteps; step++) {
    h.step(DT)
    while (spawned < list.length && list[spawned].at <= h.t) {
      const p = list[spawned]
      const k = spawned
      const base = p.from === 1 ? -45 : l2(-42)
      const sign = p.shaft === 'A' ? -1 : 1
      if (p.stretcher) {
        const { pusher, rider } = stretcherParty(h, `p${k}`, freeSpot(h, spawnRng, base, sign))
        p.members = [pusher]
        p.rider = rider
        p.trip = h.lifts.trip({ ownerId: `p${k}`, shaft: p.shaft, from: p.from, to: p.from === 1 ? 2 : 1, pusher })
      } else {
        const n = 1 + (k % 3)
        for (let i = 0; i < n; i++) p.members.push(testPerson(h, `p${k}-${i}`, freeSpot(h, spawnRng, base, sign)))
        p.trip = h.lifts.trip({ ownerId: `p${k}`, shaft: p.shaft, from: p.from, to: p.from === 1 ? 2 : 1, walkers: p.members })
      }
      p.started = true
      spawned++
    }
    // the owners send arrived parties away
    if (step % 30 === 0) {
      for (const p of list) {
        if (p.trip !== null && p.trip.done && p.members[0].entity.fade === 1) {
          for (const m of p.members) m.fadeOut()
          p.rider?.fadeOut()
          p.trip = null
        }
      }
      // invariants: at most one stretcher party stands at a lobby's stretcher spot; riders of a hidden party are hidden
      for (const shaft of ['A', 'B'] as const) {
        for (const level of [1, 2] as const) {
          const spot = LIFTS[shaft][level].stretcher.at
          let n = 0
          for (const p of list) {
            if (!p.stretcher || p.trip === null) continue
            if (p.trip.phase === 'queued' || p.trip.phase === 'inCar' || p.trip.phase === 'riding') continue
            const m = p.members[0]
            if (m.entity.fade !== undefined && m.entity.fade < 1) continue
            if (Math.hypot(m.x - spot.x, m.z - spot.z) < 1.2) n++
          }
          if (n > 1) problems.push(`${h.t.toFixed(0)}s ${n} stretcher parties at ${shaft}${level}`)
        }
      }
      for (const p of list) {
        const tr = p.trip
        if (tr === null) continue
        if ((tr.phase === 'inCar' || tr.phase === 'riding') && p.members.some((m) => m.entity.fade !== 0)) problems.push(`${h.t.toFixed(0)}s party ${tr.ownerId} visible in the car`)
        if ((tr.phase === 'inCar' || tr.phase === 'riding') && p.rider && p.rider.entity.fade !== 0) problems.push(`${h.t.toFixed(0)}s rider of ${tr.ownerId} visible in the car`)
      }
    }
    if (spawned === list.length && h.lifts.trips.length === 0 && list.every((p) => p.trip === null)) break
  }
  return { h, list, invariantProblems: problems }
}

describe('lift stress test', () => {
  it('serves 60 random parties: no deadlock, nobody waits 3 minutes, never two stretchers in a lobby, riders are hidden', () => {
    const { h, invariantProblems } = stress(11, 60, 30)
    expect(invariantProblems).toEqual([])
    expect(h.lifts.stuckFixes, h.lifts.stuckLog.join('\n')).toBe(0)
    expect(h.lifts.history.filter((t) => !t.ghost)).toHaveLength(60)
    for (const t of h.lifts.history) {
      expect(t.done, `${t.ownerId} is ${t.phase}`).toBe(true)
      expect(t.arrivedAt - t.requestedAt, `${t.ownerId} (${t.shaft}${t.from}->${t.to})`).toBeLessThan(180)
    }
    // every gate is free at the end
    for (const g of h.lifts.gates) {
      expect(g.stretcherBy).toBeNull()
      expect(g.freeWalkers).toBe(CONFIG.lifts.lobbyWalkers)
    }
  }, 120_000)

  it('survives a burst (40 parties in 6 minutes): everybody is served in the end, with no safety net fired', () => {
    const { h, invariantProblems } = stress(12, 40, 6)
    expect(invariantProblems).toEqual([])
    expect(h.lifts.stuckFixes, h.lifts.stuckLog.join('\n')).toBe(0)
    for (const t of h.lifts.history) expect(t.done, `${t.ownerId} is ${t.phase}`).toBe(true)
    expect(h.lifts.longestWait).toBeLessThan(15 * 60)
  }, 120_000)

  it('is deterministic: the same seed gives the same trips and the same cars', () => {
    const run = (seed: number) => {
      const { h } = stress(seed, 24, 8)
      return JSON.stringify({ trips: h.lifts.history.map((t) => [t.ownerId, t.car, +t.grantedAt.toFixed(3), +t.boardedAt.toFixed(3), +t.arrivedAt.toFixed(3)]), cars: h.lifts.state.cars })
    }
    expect(run(21)).toEqual(run(21))
    expect(run(21)).not.toEqual(run(22))
  }, 120_000)

  it('keeps the lobby spots reachable on both levels (the nav graph reaches every wait spot and car spot)', async () => {
    const { tryPlanRoute } = await import('../nav/graph')
    for (const shaft of ['A', 'B'] as const) {
      for (const level of [1, 2] as const) {
        const l = LIFTS[shaft][level]
        const from = level === 1 ? { x: -46, z: shaft === 'A' ? -4.6 : 4.6 } : { x: l2(-42), z: shaft === 'A' ? -6 : 6 }
        const spots = [l.stretcher.at, ...l.walkers, l.cars[0].at, l.cars[1].at]
        for (const s of spots) expect(tryPlanRoute(from, s), `${shaft}${level} ${s.x},${s.z}`).not.toBeNull()
      }
    }
  })
})
