import { describe, expect, it } from 'vitest'
import type { Interactable } from '@/scene/interact.store'
import { CONFIG } from '@/sim/config'
import type { Entity, SeatSpec } from '@/sim/types'
import {
  CandidatePool,
  PRIORITY,
  REACH,
  addItems,
  addPeople,
  addSeats,
  angleDelta,
  inReach,
  isTalkable,
  newPickResult,
  pickBest,
  pickTarget,
  priorityOf,
  sittableSeats,
  type Candidate,
  type Facing,
} from './picker'

const DEG = Math.PI / 180

/** You, at the origin, facing +z (heading 0). */
const me: Facing = { x: 0, z: 0, heading: 0 }

function cand(over: Partial<Candidate> & { id: string }): Candidate {
  return { kind: 'item', ref: null, priority: 1, x: 0, z: 1, radius: REACH.radius, enabled: true, ...over }
}

/** A candidate `d` metres away, `deg` degrees to the right of straight ahead. */
const at = (id: string, d: number, deg = 0, over: Partial<Candidate> = {}): Candidate =>
  cand({ id, x: Math.sin(deg * DEG) * d, z: Math.cos(deg * DEG) * d, ...over })

function entity(over: Partial<Entity> & { id: string }): Entity {
  return {
    role: 'nurse',
    name: 'Nurse Priya',
    position: { x: 0, y: 0, z: 1.2 },
    heading: 0,
    speed: 0,
    anim: 'idle',
    emote: 'none',
    mood: 'neutral',
    tier: 'near',
    variant: 0,
    ...over,
  }
}

function seat(over: Partial<SeatSpec> & { id: string }): SeatSpec {
  return { kind: 'waiting', area: 'lobby', x: 0, z: 1, heading: 0, pose: 'sit', height: 0.45, approach: { x: 0, z: 0.5 }, ...over }
}

function item(over: Partial<Interactable> & { id: string }): Interactable {
  return { kind: 'prop', position: { x: 0, y: 0, z: 1 }, label: over.id, onInteract: () => undefined, ...over }
}

describe('the reach comes from the config', () => {
  it('is the player reach and the half angle of the contract', () => {
    expect(REACH.radius).toBe(CONFIG.player.reach)
    expect(REACH.halfAngle).toBeCloseTo(CONFIG.player.reachHalfAngleDeg * DEG, 12)
  })
})

describe('angleDelta', () => {
  it('wraps through pi in both directions', () => {
    expect(angleDelta(0.1, -0.1)).toBeCloseTo(-0.2, 12)
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 12)
    expect(angleDelta(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2, 12)
  })
})

describe('reach: how far', () => {
  it('reaches things within their radius and nothing beyond', () => {
    expect(inReach(me, at('a', 1.9), false)).toBe(true)
    expect(inReach(me, at('a', 2.1), false)).toBe(false)
    expect(inReach(me, at('a', 4, 0, { radius: 5 }), false)).toBe(true)
  })

  it('keeps the current target a little further out, so the prompt does not blink at the edge', () => {
    const edge = at('a', 2.15)
    expect(inReach(me, edge, false)).toBe(false)
    expect(inReach(me, edge, true)).toBe(true)
    expect(inReach(me, at('a', 2.4), true)).toBe(false)
  })
})

describe('reach: which way you face', () => {
  it('wants the thing in front of you, within 55 degrees either side', () => {
    expect(inReach(me, at('a', 1.5, 0), false)).toBe(true)
    expect(inReach(me, at('a', 1.5, 50), false)).toBe(true)
    expect(inReach(me, at('a', 1.5, -50), false)).toBe(true)
    expect(inReach(me, at('a', 1.5, 60), false)).toBe(false)
    expect(inReach(me, at('a', 1.5, -90), false)).toBe(false)
    expect(inReach(me, at('a', 1.5, 180), false)).toBe(false) // right behind you
  })

  it('follows the way the body faces, wrapping through pi', () => {
    const behind = cand({ id: 'a', x: 0, z: -1.5 })
    expect(inReach({ ...me, heading: Math.PI }, behind, false)).toBe(true)
    expect(inReach({ ...me, heading: -Math.PI + 0.1 }, behind, false)).toBe(true)
    expect(inReach({ ...me, heading: Math.PI - 0.1 }, behind, false)).toBe(true)
    expect(inReach({ ...me, heading: 0 }, behind, false)).toBe(false)
  })

  it('does not care which way you face when you are nearly touching it', () => {
    expect(inReach(me, cand({ id: 'a', x: 0, z: -0.5 }), false)).toBe(true)
    expect(inReach(me, cand({ id: 'a', x: 0, z: -0.9 }), false)).toBe(false)
  })

  it('widens the cone for the current target', () => {
    expect(inReach(me, at('a', 1.5, 58), false)).toBe(false)
    expect(inReach(me, at('a', 1.5, 58), true)).toBe(true)
  })
})

describe('pickTarget: priority, then distance', () => {
  it('prefers a lower priority number even when it is further away', () => {
    const bedside = at('bedside', 1.9, 0, { priority: PRIORITY.bedside })
    const seatC = at('seat', 0.9, 0, { kind: 'seat', priority: PRIORITY.seat })
    const person = at('maria', 0.8, 0, { kind: 'person', priority: PRIORITY.person })
    expect(pickTarget(me, [seatC, person, bedside])!.candidate.id).toBe('bedside')
    expect(pickTarget(me, [person, seatC])!.candidate.id).toBe('seat')
    expect(pickTarget(me, [person])!.candidate.id).toBe('maria')
  })

  it('breaks a tie of priority by distance, whatever the list order', () => {
    const near = at('near', 0.9, 0, { priority: 3 })
    const far = at('far', 1.7, 0, { priority: 3 })
    expect(pickTarget(me, [far, near])!.candidate.id).toBe('near')
    expect(pickTarget(me, [near, far])!.candidate.id).toBe('near')
  })

  it('prefers the one you are facing when two are equally far', () => {
    const ahead = at('ahead', 1.5, 0, { priority: 3 })
    const side = at('side', 1.5, 45, { priority: 3 })
    expect(pickTarget(me, [side, ahead])!.candidate.id).toBe('ahead')
    // turn to face the other one
    expect(pickTarget({ ...me, heading: 45 * DEG }, [ahead, side])!.candidate.id).toBe('side')
  })

  it('returns null when nothing is in reach', () => {
    expect(pickTarget(me, [])).toBeNull()
    expect(pickTarget(me, [at('far', 9), at('behind', 1.5, 180)])).toBeNull()
  })

  it('reports how far and how far round the pick is', () => {
    const p = pickTarget(me, [cand({ id: 'a', x: 1, z: 1 })])!
    expect(p.distance).toBeCloseTo(Math.SQRT2, 9)
    expect(p.angle).toBeCloseTo(45 * DEG, 9)
  })
})

describe('pickTarget: people against stations', () => {
  const bedside = at('bedside:A3', 1.9, 0, { priority: PRIORITY.bedside })
  const nurse = at('nurse', 0.6, 0, { kind: 'person', priority: PRIORITY.person })
  const patient = at('patient', 1.2, 10, { kind: 'person', priority: PRIORITY.person })

  it('a station in reach wins over anyone, even a person right in front of you', () => {
    expect(pickTarget(me, [nurse, patient, bedside])!.candidate.id).toBe('bedside:A3')
  })

  it('anyone is talked to when no station is in reach', () => {
    expect(pickTarget(me, [nurse, patient])!.candidate.id).toBe('nurse')
  })

  it('between two people the nearer one wins, and the one you face wins when they are equally far', () => {
    const left = at('left', 1.5, -40, { kind: 'person', priority: PRIORITY.person })
    const right = at('right', 1.5, 40, { kind: 'person', priority: PRIORITY.person })
    expect(pickTarget({ ...me, heading: 40 * DEG }, [left, right])!.candidate.id).toBe('right')
    expect(pickTarget({ ...me, heading: -40 * DEG }, [left, right])!.candidate.id).toBe('left')
  })

  it('a station behind you does not hide the person in front of you', () => {
    const behind = at('drawer:A3', 1.5, 180, { priority: PRIORITY.drawer })
    expect(pickTarget(me, [behind, nurse])!.candidate.id).toBe('nurse')
  })

  it('a free seat beats a person, a station beats a seat', () => {
    const chair = at('seat', 1.2, 0, { kind: 'seat', priority: PRIORITY.seat })
    expect(pickTarget(me, [nurse, chair])!.candidate.id).toBe('seat')
    expect(pickTarget(me, [nurse, chair, bedside])!.candidate.id).toBe('bedside:A3')
  })
})

describe('pickTarget: stickiness', () => {
  const a = at('a', 1.2, -20, { priority: 3 })
  const b = at('b', 1.17, 20, { priority: 3 }) // a hair nearer

  it('keeps the current target unless a rival is clearly better', () => {
    expect(pickTarget(me, [a, b])!.candidate.id).toBe('b')
    expect(pickTarget(me, [a, b], 'a')!.candidate.id).toBe('a')
    // a much nearer rival wins even against the current one
    const c = at('c', 0.5, 0, { priority: 3 })
    expect(pickTarget(me, [a, c], 'a')!.candidate.id).toBe('c')
  })

  it('never lets stickiness put a worse priority over a better one', () => {
    const station = at('station', 1.9, 0, { priority: PRIORITY.station })
    expect(pickTarget(me, [a, station], 'a')!.candidate.id).toBe('station')
  })

  it('holds the current target through the edge of reach, then lets it go', () => {
    const edge = at('edge', 2.15, 0, { priority: 3 })
    expect(pickTarget(me, [edge])).toBeNull()
    expect(pickTarget(me, [edge], 'edge')!.candidate.id).toBe('edge')
    expect(pickTarget(me, [at('edge', 2.5, 0, { priority: 3 })], 'edge')).toBeNull()
  })
})

describe('pickBest allocates into the result it is given', () => {
  it('writes the index, distance and angle', () => {
    const list = [at('a', 1.5, 0), at('b', 1.0, 30)]
    const out = newPickResult()
    expect(pickBest(me, list, list.length, null, out)).toBe(true)
    expect(out.index).toBe(1)
    expect(out.distance).toBeCloseTo(1.0, 9)
    expect(out.angle).toBeCloseTo(30 * DEG, 9)
    expect(pickBest(me, list, 0, null, out)).toBe(false)
    expect(out.index).toBe(-1)
  })
})

describe('the pool', () => {
  it('reuses its slots from frame to frame', () => {
    const pool = new CandidatePool()
    pool.begin()
    pool.add('item', 'a', null, 1, 0, 1, 2, true)
    pool.add('item', 'b', null, 1, 0, 1, 2, true)
    const slots = pool.items.slice()
    pool.begin()
    pool.add('person', 'c', null, 5, 3, 3, 2, true)
    expect(pool.count).toBe(1)
    expect(pool.items[0]).toBe(slots[0])
    expect(pool.items[0].id).toBe('c')
    expect(pool.items.length).toBe(2)
  })
})

describe('gathering candidates', () => {
  it('uses the contract priorities and the default radius for registered items', () => {
    expect(priorityOf('bedside')).toBe(1)
    expect(priorityOf('console')).toBe(1)
    expect(priorityOf('drawer')).toBe(1)
    expect(priorityOf('station')).toBe(1)
    expect(priorityOf('door')).toBe(1)
    expect(priorityOf('gate')).toBe(2)
    expect(priorityOf('seat')).toBe(3)
    expect(priorityOf('prop')).toBe(4)
    expect(priorityOf('prop', 9)).toBe(9)
    const pool = new CandidatePool()
    pool.begin()
    addItems(pool, me, [item({ id: 'b', kind: 'bedside' }), item({ id: 'far', position: { x: 0, y: 0, z: 9 } }), item({ id: 'wide', radius: 3, position: { x: 0, y: 0, z: 2.8 } })])
    expect(pool.items.slice(0, pool.count).map((c) => [c.id, c.priority, c.radius])).toEqual([
      ['b', 1, REACH.radius],
      ['wide', 4, 3],
    ])
  })

  it('skips a disabled item without a locked label and shows one with it, disabled', () => {
    const pool = new CandidatePool()
    pool.begin()
    addItems(pool, me, [
      item({ id: 'silent', enabled: () => false }),
      item({ id: 'locked', enabled: () => false, lockedLabel: 'A3 has no patient right now' }),
      item({
        id: 'throws',
        enabled: () => {
          throw new Error('boom')
        },
      }),
    ])
    expect(pool.items.slice(0, pool.count).map((c) => [c.id, c.enabled])).toEqual([['locked', false]])
  })

  it('offers only free, ordinary seats in range', () => {
    const seats = [
      seat({ id: 'waiting:lobby:1', x: 0, z: 1 }),
      seat({ id: 'waiting:lobby:2', x: 0.5, z: 1 }),
      seat({ id: 'cafe:T1:a', kind: 'cafe', x: 0, z: 1.2 }),
      seat({ id: 'bed:A3', kind: 'bed', x: 0, z: 1 }),
      seat({ id: 'erBay:bay:4', kind: 'erBay', x: 0, z: 1 }),
      seat({ id: 'bench:far', kind: 'bench', x: 0, z: 8 }),
    ]
    expect(sittableSeats(seats).map((s) => s.id)).toEqual(['waiting:lobby:1', 'waiting:lobby:2', 'cafe:T1:a', 'bench:far'])
    const pool = new CandidatePool()
    pool.begin()
    addSeats(pool, me, sittableSeats(seats), (id) => id !== 'waiting:lobby:2')
    expect(pool.items.slice(0, pool.count).map((c) => c.id)).toEqual(['waiting:lobby:1', 'cafe:T1:a'])
    expect(pool.items[0].priority).toBe(PRIORITY.seat)
  })

  it('offers anyone in range except you, the fading and the people being carried', () => {
    const people = [
      entity({ id: 'nurse-1' }),
      entity({ id: 'player', position: { x: 0, y: 0, z: 0.5 } }),
      entity({ id: 'fading', fade: 0.2 }),
      entity({ id: 'rider', riding: true }),
      entity({ id: 'faraway', position: { x: 0, y: 0, z: 7 } }),
      entity({ id: 'visitor-2', position: { x: 0.4, y: 0, z: 1.5 }, fade: 1 }),
    ]
    expect(people.map((p) => isTalkable(p))).toEqual([true, false, false, false, true, true])
    const pool = new CandidatePool()
    pool.begin()
    addPeople(pool, me, people)
    expect(pool.items.slice(0, pool.count).map((c) => [c.id, c.kind, c.priority])).toEqual([
      ['nurse-1', 'person', 5],
      ['visitor-2', 'person', 5],
    ])
  })

  it('gathers a mixed scene and lets the right thing win', () => {
    const pool = new CandidatePool()
    pool.begin()
    addItems(pool, me, [item({ id: 'bedside:A3', kind: 'bedside', position: { x: 0, y: 0, z: 1.8 } })])
    addSeats(pool, me, [seat({ id: 'waiting:lobby:1', x: 1.2, z: 0.3 })], () => true)
    addPeople(pool, me, [entity({ id: 'nurse-1' })])
    expect(pool.count).toBe(3)
    const out = newPickResult()
    // facing the bed: the bed (the seat to your right is outside the cone, the nurse is lower priority)
    expect(pickBest(me, pool.items, pool.count, null, out)).toBe(true)
    expect(pool.items[out.index].id).toBe('bedside:A3')
    // turn to the right: the bed and the nurse leave the cone, the seat is what is left
    expect(pickBest({ ...me, heading: Math.PI / 2 }, pool.items, pool.count, null, out)).toBe(true)
    expect(pool.items[out.index].kind).toBe('seat')
  })
})
