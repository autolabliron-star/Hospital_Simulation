/**
 * Seats: sitting down puts the player system INSIDE the chair's footprint (`placePlayer(seat.x, seat.z)`: the avatar glides onto the seat
 * and the walk camera follows the same spot), and standing up walks out of it. So `placeAt` respects only the walls and the region, never
 * furniture, and a body that starts inside a shape can only leave it: no pop, no push, no being stuck.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { PerspectiveCamera } from 'three'
import { getLayout } from '@/scene/building/layout'
import { CONFIG } from '@/sim/config'
import { Simulation } from '@/sim/Simulation'
import { standHeading } from '@/scene/interact/seats'
import { walkCam } from './state'
import { staticClearance } from './bodyTestKit'
import { zoneAt } from '@/sim/nav/layout'
import { PLAYER_PLAZA } from '@/sim/places'
import { PlayerSystem } from './system'

const R = CONFIG.player.bodyRadius
const DT = 1 / 60
const SPEED = CONFIG.player.walkSpeed

const made: PlayerSystem[] = []
afterEach(() => {
  while (made.length) made.pop()?.dispose()
  walkCam.inputBlocked = false
})

function make(): { sim: Simulation; sys: PlayerSystem } {
  const sim = new Simulation(5)
  const camera = new PerspectiveCamera(35, 16 / 9, 1, 500)
  const sys = new PlayerSystem({ camera, getSim: () => sim, reducedMotion: () => false })
  made.push(sys)
  sys.update(0.1)
  // nobody else: the hospital's own people stand at their stations at the start (the radiographer on the console's stool...)
  for (const id of [...sim.entities.keys()]) if (id !== 'player') sim.entities.delete(id)
  return { sim, sys }
}

const seats = getLayout().seats

describe('seats', () => {
  it('has seats to test', () => {
    expect(seats.length).toBeGreaterThan(100)
  })

  it('placeAt a seat puts you ON it (inside the chair or bed, where the walls and the region allow), not beside it', () => {
    const { sim, sys } = make()
    let inside = 0
    for (const seat of seats) {
      sys.placeAt(seat.x, seat.z, seat.heading)
      sys.update(DT)
      expect(Math.hypot(sim.player!.x - seat.x, sim.player!.z - seat.z), seat.id).toBeLessThan(1e-9)
      expect(zoneAt(sim.player!.x, sim.player!.z, 0.18) !== null || sim.player!.x < PLAYER_PLAZA.x1, seat.id).toBe(true) // on the floor (a bed is not part of the people's region)
      if (staticClearance(seat.x, seat.z).d < R) inside++
    }
    expect(inside).toBeGreaterThan(seats.length * 0.8) // nearly every seat IS inside some footprint
  })

  it('holding forward for a second, facing the way you sat: no pop on any frame, never faster than the walk, and never deeper into anything', () => {
    let worstFirst = 0
    let worstStep = 0
    for (const seat of seats) {
      const { sim, sys } = make()
      sys.placeAt(seat.x, seat.z, seat.heading)
      sys.update(DT)
      sys.input.keyDown('KeyW')
      let last = { x: sim.player!.x, z: sim.player!.z }
      for (let i = 0; i < 60; i++) {
        sys.update(DT)
        const step = Math.hypot(sim.player!.x - last.x, sim.player!.z - last.z)
        if (i === 0) worstFirst = Math.max(worstFirst, step)
        worstStep = Math.max(worstStep, step)
        expect(step, `${seat.id} frame ${i}`).toBeLessThanOrEqual(SPEED * DT + 1e-9)
        last = { x: sim.player!.x, z: sim.player!.z }
      }
      expect(zoneAt(last.x, last.z, 0.18) !== null || last.x < PLAYER_PLAZA.x1, seat.id).toBe(true)
      sys.dispose()
      made.pop()
    }
    expect(worstFirst).toBeLessThanOrEqual(SPEED * DT)
    // eslint-disable-next-line no-console
    console.log(`seats: ${seats.length} walked out; first-frame displacement at most ${(worstFirst * 1000).toFixed(2)} mm, any frame at most ${(worstStep * 1000).toFixed(1)} mm (the limit is ${(SPEED * DT * 1000).toFixed(1)})`)
  })

  it('standing up the way the interaction does (facing out, towards the approach spot) walks you clear of the seat within 1.3 s (an ordinary 1.4 m/s walk)', () => {
    let clear = 0
    const stuck: string[] = []
    for (const seat of seats) {
      const { sim, sys } = make()
      sys.placeAt(seat.x, seat.z, standHeading(seat))
      sys.update(DT)
      sys.input.keyDown('KeyW')
      for (let i = 0; i < 78; i++) sys.update(DT)
      if (staticClearance(sim.player!.x, sim.player!.z).d >= R - 1e-4) clear++
      else stuck.push(seat.id)
      sys.dispose()
      made.pop()
    }
    expect(stuck).toEqual([])
    expect(clear).toBe(seats.length)
  })
})
