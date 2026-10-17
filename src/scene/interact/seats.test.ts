import { describe, expect, it } from 'vitest'
import { PLAYER_SPAWN } from '@/sim/places'
import { Simulation } from '@/sim/Simulation'
import { PLAYER_ID, SIT_SLIDE_SECONDS, SeatSession, ease, slidePose, standHeading, type Pose } from './seats'
import { SITTABLE_KINDS, sittableSeats } from './picker'

describe('the slide onto a seat', () => {
  const from: Pose = { x: 0, z: 0, heading: 0 }
  const to: Pose = { x: 1, z: 2, heading: Math.PI / 2 }

  it('eases from where you stand to the seat and arrives exactly', () => {
    const out: Pose = { x: 9, z: 9, heading: 9 }
    expect(slidePose(from, to, 0, out)).toEqual({ x: 0, z: 0, heading: 0 })
    expect(slidePose(from, to, 1, out)).toEqual({ x: 1, z: 2, heading: Math.PI / 2 })
    slidePose(from, to, 0.5, out)
    expect(out.x).toBeCloseTo(0.5, 9)
    expect(out.z).toBeCloseTo(1, 9)
    // past the end it stays on the seat
    expect(slidePose(from, to, 3, out).x).toBe(1)
    expect(ease(-1)).toBe(0)
    expect(ease(2)).toBe(1)
  })

  it('turns the short way round', () => {
    const out: Pose = { x: 0, z: 0, heading: 0 }
    slidePose({ x: 0, z: 0, heading: Math.PI - 0.1 }, { x: 0, z: 0, heading: -Math.PI + 0.1 }, 1, out)
    expect(Math.cos(out.heading)).toBeCloseTo(Math.cos(-Math.PI + 0.1), 9)
    slidePose({ x: 0, z: 0, heading: Math.PI - 0.1 }, { x: 0, z: 0, heading: -Math.PI + 0.1 }, 0.5, out)
    expect(Math.abs(Math.abs(out.heading) - Math.PI)).toBeLessThan(0.01)
  })

  it('stands you up facing away from the seat, towards the spot in front of it', () => {
    const h = standHeading({ id: 's', kind: 'waiting', area: 'lobby', x: 0, z: 0, heading: 0, pose: 'sit', height: 0.45, approach: { x: 0, z: 0.6 } })
    expect(h).toBeCloseTo(0, 9)
  })
})

describe('the seats you can offer', () => {
  it('are the waiting, café, lounge and bench seats of the real building, and there are many', () => {
    const sim = new Simulation(3)
    const seats = sittableSeats(sim.seats.all)
    expect(seats.length).toBeGreaterThanOrEqual(40)
    expect(new Set(seats.map((s) => s.kind))).toEqual(SITTABLE_KINDS)
  })
})

describe('sitting down in the real hospital', () => {
  function setup() {
    const sim = new Simulation(5)
    sim.addPlayer(PLAYER_SPAWN)
    const free = sim.seats.free({ kind: 'waiting' })
    expect(free.length).toBeGreaterThan(0)
    const seat = free[0]
    // stand at the seat's approach spot, facing it
    sim.movePlayer(seat.approach.x, seat.approach.z, Math.atan2(seat.x - seat.approach.x, seat.z - seat.approach.z), 0)
    return { sim, seat, session: new SeatSession() }
  }

  it('claims the seat, glides onto it and is drawn seated', () => {
    const { sim, seat, session } = setup()
    expect(session.sit(sim, seat)).toBe(true)
    expect(sim.seats.occupant(seat.id)).toBe(PLAYER_ID)
    expect(session.active).toBe(seat)
    for (let i = 0; i < Math.ceil(SIT_SLIDE_SECONDS * 60) + 2; i++) session.step(sim, 1 / 60)
    const av = sim.playerAvatar!
    expect(av.anim).toBe('sit')
    expect(av.seated).toEqual({ seatId: seat.id, pose: seat.pose })
    expect(av.position.x).toBeCloseTo(seat.x, 6)
    expect(av.position.z).toBeCloseTo(seat.z, 6)
    expect(sim.player!.x).toBeCloseTo(seat.x, 6)
    expect(av.speed).toBe(0)
  })

  it('keeps the pose when the player system writes a walking pose over it', () => {
    const { sim, seat, session } = setup()
    session.sit(sim, seat)
    for (let i = 0; i < 40; i++) session.step(sim, 1 / 60)
    // the player system calls movePlayer every frame, which sets 'walk' or 'idle' ...
    sim.movePlayer(seat.approach.x, seat.approach.z, 0, 1.4)
    expect(sim.playerAvatar!.anim).toBe('walk')
    // ... and the seat puts it back before the frame is drawn
    session.step(sim, 1 / 60)
    expect(sim.playerAvatar!.anim).toBe('sit')
    expect(sim.player!.x).toBeCloseTo(seat.x, 6)
  })

  it('stays seated while the hospital runs on, and nobody else is sent to your seat', () => {
    const { sim, seat, session } = setup()
    session.sit(sim, seat)
    for (let i = 0; i < 20 * 60; i++) {
      sim.step(1 / 60)
      session.step(sim, 1 / 60)
    }
    expect(sim.seats.occupant(seat.id)).toBe(PLAYER_ID)
    expect(sim.playerAvatar!.anim).toBe('sit')
    expect(sim.seats.free({ kind: 'waiting' }).some((s) => s.id === seat.id)).toBe(false)
  })

  it('stands you up in front of the seat and frees it', () => {
    const { sim, seat, session } = setup()
    session.sit(sim, seat)
    for (let i = 0; i < 40; i++) session.step(sim, 1 / 60)
    expect(session.stand(sim)).toBe(seat)
    expect(session.active).toBeNull()
    expect(sim.seats.occupant(seat.id)).toBeNull()
    const av = sim.playerAvatar!
    expect(av.seated).toBeUndefined()
    expect(av.anim).toBe('idle')
    expect(av.position.x).toBeCloseTo(seat.approach.x, 6)
    expect(av.position.z).toBeCloseTo(seat.approach.z, 6)
    // standing twice is harmless
    expect(session.stand(sim)).toBeNull()
  })

  it('does not sit you on a seat somebody holds, and does not free a seat that is not yours', () => {
    const { sim, seat, session } = setup()
    sim.seats.claimId(seat.id, 'somebody-else')
    expect(session.sit(sim, seat)).toBe(false)
    expect(session.active).toBeNull()
    session.stand(sim)
    expect(sim.seats.occupant(seat.id)).toBe('somebody-else')
  })

  it('moving to another seat frees the first', () => {
    const { sim, seat, session } = setup()
    const other = sim.seats.free({ kind: 'waiting' }).find((s) => s.id !== seat.id)!
    session.sit(sim, seat)
    expect(session.sit(sim, other)).toBe(true)
    expect(sim.seats.occupant(seat.id)).toBeNull()
    expect(sim.seats.occupant(other.id)).toBe(PLAYER_ID)
  })

  it('moves the player system with you: onto the seat when you sit, in front of it when you stand', () => {
    const { sim, seat } = setup()
    const placed: [number, number, number][] = []
    const session = new SeatSession((x, z, h) => placed.push([x, z, h]))
    session.sit(sim, seat)
    expect(placed).toEqual([[seat.x, seat.z, seat.heading]])
    session.stand(sim)
    expect(placed.length).toBe(2)
    expect(placed[1][0]).toBe(seat.approach.x)
    expect(placed[1][1]).toBe(seat.approach.z)
    expect(placed[1][2]).toBeCloseTo(standHeading(seat), 9)
    // a seat somebody else holds moves nobody
    const other = sim.seats.free({ kind: 'waiting' }).find((s) => s.id !== seat.id)!
    sim.seats.claimId(other.id, 'visitor')
    session.sit(sim, other)
    expect(placed.length).toBe(2)
  })

  it('forgets without touching a new hospital (a Jump)', () => {
    const { sim, seat, session } = setup()
    session.sit(sim, seat)
    session.forget()
    expect(session.active).toBeNull()
    // the old hospital still holds the claim, but the session no longer acts on it
    session.step(sim, 1 / 60)
    sim.movePlayer(0, 0, 0, 0)
    expect(sim.playerAvatar!.anim).toBe('idle')
  })
})
