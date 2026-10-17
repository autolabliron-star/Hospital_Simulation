import { describe, expect, it } from 'vitest'
import { tryPlanRoute } from './nav/graph'
import { isWalkable } from './nav/layout'
import { LOBBY, ROOMS } from './places'
import { SeatRegistry, defaultSeats, seatGroup } from './seats'

const SEATS = defaultSeats()

describe('the building\'s seats', () => {
  it('has every kind the people need, in a stable order with unique ids', () => {
    const by: Record<string, number> = {}
    for (const s of SEATS) by[s.kind] = (by[s.kind] ?? 0) + 1
    expect(by.bed).toBe(16)
    expect(by.visitor).toBe(16)
    expect(by.erBay).toBe(6)
    expect(by.triageBay).toBeGreaterThanOrEqual(4)
    expect(by.waiting).toBeGreaterThanOrEqual(12)
    expect(by.cafe).toBeGreaterThanOrEqual(6)
    expect(by.bench).toBeGreaterThanOrEqual(6)
    expect(by.lounge).toBeGreaterThanOrEqual(6)
    expect(by.command).toBeGreaterThanOrEqual(4)
    const ids = SEATS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(defaultSeats().map((s) => s.id)).toEqual(ids)
  })

  it('puts beds and visitor chairs exactly on the contract positions, lying and sitting', () => {
    for (const r of ROOMS) {
      const bed = SEATS.find((s) => s.id === `bed:${r.id}`)!
      expect(bed.pose).toBe('lie')
      expect(Math.hypot(bed.x - r.bed.x, bed.z - r.bed.z)).toBeLessThan(0.05)
      const chair = SEATS.find((s) => s.kind === 'visitor' && s.area === `room:${r.id}`)!
      expect(chair.pose).toBe('sit')
      expect(Math.hypot(chair.x - r.chair.x, chair.z - r.chair.z)).toBeLessThan(0.6)
    }
  })

  it('gives every seat a sensible height and a walkable approach that is reachable from the entrance', () => {
    for (const s of SEATS) {
      expect(s.height, s.id).toBeGreaterThanOrEqual(0.35) // low lobby seats are 0.37
      expect(s.height, s.id).toBeLessThanOrEqual(1.0)
      expect(isWalkable(s.approach.x, s.approach.z, 0.2), `${s.id} approach`).toBe(true)
      expect(Math.hypot(s.approach.x - s.x, s.approach.z - s.z), `${s.id} approach distance`).toBeLessThan(1.6)
      expect(tryPlanRoute(LOBBY.entrance, s.approach), `${s.id} reachable`).not.toBeNull()
    }
  })
})

describe('SeatRegistry', () => {
  it('hands out the nearest free seat and never the same seat twice', () => {
    const reg = new SeatRegistry(SEATS)
    const near = { x: -58, z: -5 }
    const a = reg.claim('p1', { kind: 'waiting' }, near)!
    const b = reg.claim('p2', { kind: 'waiting' }, near)!
    expect(a.id).not.toBe(b.id)
    const dA = Math.hypot(a.x - near.x, a.z - near.z)
    for (const s of reg.free({ kind: 'waiting' })) expect(Math.hypot(s.x - near.x, s.z - near.z)).toBeGreaterThanOrEqual(dA - 1e-9)
    expect(reg.occupant(a.id)).toBe('p1')
    expect(reg.seatOf('p2')!.id).toBe(b.id)
    // all of them, then none left
    const total = reg.occupancy({ kind: 'waiting' }).total
    const got = new Set([a.id, b.id])
    for (let i = 0; i < total; i++) {
      const s = reg.claim(`q${i}`, { kind: 'waiting' }, near)
      if (s) {
        expect(got.has(s.id)).toBe(false)
        got.add(s.id)
      }
    }
    expect(got.size).toBe(total)
    expect(reg.claim('late', { kind: 'waiting' }, near)).toBeNull()
    expect(reg.occupancy({ kind: 'waiting' })).toEqual({ taken: total, total })
  })

  it('claimId refuses a taken seat; release and releaseBy free them', () => {
    const reg = new SeatRegistry(SEATS)
    expect(reg.claimId('bed:A3', 'pt-A3')).toBe(true)
    expect(reg.claimId('bed:A3', 'someone')).toBe(false)
    const v = reg.claim('visitor-1', { kind: 'visitor', area: 'room:A3' })!
    const c = reg.claim('visitor-1', { kind: 'cafe' })!
    expect(reg.seatOf('visitor-1')!.id).toBe(c.id)
    reg.release(c.id)
    expect(reg.seatOf('visitor-1')!.id).toBe(v.id)
    reg.releaseBy('visitor-1')
    expect(reg.occupant(v.id)).toBeNull()
    expect(reg.seatOf('visitor-1')).toBeNull()
    reg.release(v.id) // no-op on a free seat
    expect(() => reg.byId('nope')).toThrow()
  })

  it('release with an occupant only frees the seat while that occupant still holds it', () => {
    const reg = new SeatRegistry(SEATS)
    const s = reg.claim('comp-1', { kind: 'waiting' })!
    reg.release(s.id) // somebody frees it (a companion that gave up before reaching it) ...
    expect(reg.claimId(s.id, 'amb-2')).toBe(true) // ... and it passes on
    reg.release(s.id, 'comp-1') // a stale handle must not free it under the new holder
    expect(reg.occupant(s.id)).toBe('amb-2')
    reg.release(s.id, 'amb-2')
    expect(reg.occupant(s.id)).toBeNull()
  })

  it('filters by kind list, area and group, and keeps the blood-draw chairs out of general lounge fill', () => {
    const reg = new SeatRegistry(SEATS)
    const lounge = reg.free({ kind: 'lounge' })
    expect(lounge.some((s) => s.area === 'diagnostics')).toBe(false)
    const draw = reg.free({ kind: 'drawChair', area: 'diagnostics' })
    expect(draw.length).toBeGreaterThanOrEqual(2)
    const both = reg.free({ kind: ['cafe', 'bench'] })
    expect(both.every((s) => s.kind === 'cafe' || s.kind === 'bench')).toBe(true)
    const er = reg.free({ kind: 'waiting', group: 'er' })
    expect(er.length).toBeGreaterThan(0)
    expect(er.every((s) => seatGroup(s) === 'er')).toBe(true)
  })

  it('rejects duplicate ids', () => {
    expect(() => new SeatRegistry([SEATS[0], SEATS[0]])).toThrow()
  })
})
