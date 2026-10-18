/**
 * The holes that used to be there, closed. Furniture that belongs to a station (the reception desk, the café counter and backbar, the
 * hub desks, the kiosks, the command chairs, the visitor chairs) used to be walk-through within its `reach` (the people's station
 * exemption); the pharmacist desks, the canopy columns and the planters were not modelled at all. Now you are stopped by all of them, from
 * any side. And the things that move: a MealBot, a stretcher with its porter, a person standing in your way.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { PerspectiveCamera } from 'three'
import { CONFIG } from '@/sim/config'
import { Simulation } from '@/sim/Simulation'
import { newEntity } from '@/sim/person'
import type { Entity, MealBot } from '@/sim/types'
import { walkCam } from './state'
import { bearing, classicMover, staticClearance } from './bodyTestKit'
import { inRegion } from './collision'
import { SOLID_STRIDE, staticSolids } from './solids'
import { PlayerSystem } from './system'

const R = CONFIG.player.bodyRadius
const DEG = Math.PI / 180

/** The solid with this id: its centre. */
function centreOf(id: string): { x: number; z: number } {
  const s = staticSolids()
  const i = s.ids.indexOf(id)
  if (i < 0) throw new Error(`no solid ${id}`)
  return { x: s.data[i * SOLID_STRIDE + 1], z: s.data[i * SOLID_STRIDE + 2] }
}

const STATIONS = [
  'lobby:reception',
  'atrium:counter',
  'atrium:backbar',
  'hubA:deskW',
  'hubA:deskE',
  'hubB:deskW',
  'hubB:deskE',
  'lobby:kiosk0',
  'lobby:kiosk1',
  'command:chair0',
  'command:chair1',
  'command:chair2',
  'command:chair3',
  ...['A', 'B'].flatMap((w) => [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `${w}${n}:chair`)),
  'pharmacy:deskA',
  'pharmacy:deskB',
  'forecourt:planter0',
  'forecourt:planter1',
  'entrance:column0',
  'entrance:column1',
  'entrance:column2',
  'entrance:column3',
]

describe('the holes are closed: walk straight at each of them from 3 m, in 8 directions', () => {
  it('has them all as solids', () => {
    const ids = new Set(staticSolids().ids)
    for (const id of [...STATIONS, 'pharmacy:island']) expect(ids.has(id), id).toBe(true) // (the island itself is inside the robots' core, which the fences keep you out of)
  })

  it('never ends inside any of them, at the run speed, whatever the frame rate; and is stopped a body radius from each', () => {
    let walks = 0
    for (const id of STATIONS) {
      const c = centreOf(id)
      let valid = 0
      for (let a = 0; a < 360; a += 45) {
        // 3 m out, or nearer where a wall or other furniture is in the way (a visitor's chair in a 5 m room)
        const far = [3, 2.2, 1.6].find((d) => inRegion(c.x + Math.sin(a * DEG) * d, c.z + Math.cos(a * DEG) * d) && staticClearance(c.x + Math.sin(a * DEG) * d, c.z + Math.cos(a * DEG) * d, 2).d >= R + 0.05)
        if (far === undefined) continue
        const sx = c.x + Math.sin(a * DEG) * far
        const sz = c.z + Math.cos(a * DEG) * far
        valid++
        for (const dt of [1 / 20, 1 / 60]) {
          const m = classicMover(sx, sz)
          let stuck = 0
          for (let i = 0; i < Math.round(3 / dt); i++) {
            m.step(dt, 1, 0, true, bearing(m.x, m.z, c.x, c.z))
            const k = staticClearance(m.x, m.z)
            expect(k.d, `${id} from ${a} deg: inside ${k.id}`).toBeGreaterThanOrEqual(R - 1e-4)
            if (m.move.progress < 0.999) stuck++
          }
          walks++
          expect(stuck, `${id} from ${a} deg at ${dt.toFixed(3)}: it was held up`).toBeGreaterThan(0)
          // and it never got within the body radius of the solid's own surface
          expect(Math.hypot(m.x - c.x, m.z - c.z), id).toBeGreaterThan(R * 0.9)
        }
      }
      expect(valid, `${id}: approachable from at least 2 of the 8 directions (from 3, 2.2 or 1.6 m)`).toBeGreaterThanOrEqual(2)
    }
    expect(walks).toBeGreaterThan(300)
  })
})

// ---------------------------------------------------------------------------------------------
// The moving obstacles, through the real player system
// ---------------------------------------------------------------------------------------------

const made: PlayerSystem[] = []
afterEach(() => {
  while (made.length) made.pop()?.dispose()
  walkCam.inputBlocked = false
})

function plaza(x: number, z: number, heading: number): { sim: Simulation; sys: PlayerSystem } {
  const sim = new Simulation(5)
  const camera = new PerspectiveCamera(35, 16 / 9, 1, 500)
  const sys = new PlayerSystem({ camera, getSim: () => sim, reducedMotion: () => false })
  made.push(sys)
  sys.update(0.1)
  sys.placeAt(x, z, heading)
  sys.update(1 / 60)
  return { sim, sys }
}

function bot(position: { x: number; z: number }, fade = 1): MealBot {
  return { id: 'bot', ward: 'A', position: { x: position.x, y: 0, z: position.z }, heading: 0, speed: 0, state: 'serving', light: 'white', meal: null, trays: 0, fade, door: 0, waitingFor: null }
}

function walkEast(sys: PlayerSystem, sim: Simulation, seconds: number, hurry = true): number {
  sys.input.keyDown('KeyW')
  if (hurry) sys.input.keyDown('ShiftLeft')
  let nearest = Infinity
  for (let i = 0; i < seconds * 60; i++) {
    sys.update(1 / 60)
    nearest = Math.min(nearest, sim.player!.x)
  }
  return sim.player!.x
}

describe('moving things are solid too', () => {
  it('a person standing in your way holds you off at the sum of the radii, and you can walk away', () => {
    const { sim, sys } = plaza(-72, 0, Math.PI / 2)
    const e = newEntity('stranger', 'visitor', 'Stranger', { x: -68, z: 0 }, 0)
    sim.entities.set(e.id, e)
    const x = walkEast(sys, sim, 3)
    expect(x).toBeLessThanOrEqual(-68 - R - 0.28 - CONFIG.player.bodySkin + 1e-6)
    expect(x).toBeGreaterThan(-68 - R - 0.28 - 0.1) // it did get up close
    // away from them: backing up is free
    sys.input.keyUp('KeyW')
    sys.input.keyUp('ShiftLeft')
    sys.input.keyDown('KeyS')
    const before = sim.player!.x
    for (let i = 0; i < 60; i++) sys.update(1 / 60)
    expect(sim.player!.x).toBeLessThan(before - 0.5)
  })

  it('a MealBot (radius 0.45) holds you off at 0.76 m, but not while it is still fading in at the lift', () => {
    const { sim, sys } = plaza(-72, 0, Math.PI / 2)
    sim.life.mealBots.set('bot', bot({ x: -68, z: 0 }))
    const x = walkEast(sys, sim, 3)
    expect(x).toBeLessThanOrEqual(-68 - R - 0.45 - CONFIG.player.bodySkin + 1e-6)
    expect(x).toBeGreaterThan(-68 - R - 0.45 - 0.1)
    // a bot that is mostly faded out does not count
    const faded = plaza(-72, 0, Math.PI / 2)
    faded.sim.life.mealBots.set('bot', bot({ x: -68, z: 0 }, 0.2))
    expect(walkEast(faded.sys, faded.sim, 3)).toBeGreaterThan(-67)
  })

  it('a porter pushing a stretcher: the stretcher is a box 2.1 m long in front of them, and holds you off a body radius from its end', () => {
    const { sim, sys } = plaza(-72, 0, Math.PI / 2)
    const porter: Entity = { ...newEntity('porter', 'porter', 'Porter', { x: -64, z: 0 }, -Math.PI / 2), vehicle: 'stretcher', riding: false } // facing west, towards you
    sim.entities.set(porter.id, porter)
    const x = walkEast(sys, sim, 4)
    // the stretcher is centred 1.45 m in front of the porter (x = -65.45), 1.05 m half length: its end is at x = -66.5
    expect(x).toBeLessThanOrEqual(-66.5 - R - CONFIG.player.bodySkin + 1e-6)
    expect(x).toBeGreaterThan(-66.5 - R - 0.1)
  })

  it('a rider on a wheelchair is a circle you cannot enter either', () => {
    const { sim, sys } = plaza(-72, 0, Math.PI / 2)
    const rider: Entity = { ...newEntity('patient', 'patient', 'Patient', { x: -68, z: 0 }, 0), vehicle: 'wheelchair', riding: true, anim: 'sit' }
    sim.entities.set(rider.id, rider)
    const x = walkEast(sys, sim, 3)
    expect(x).toBeLessThanOrEqual(-68 - R - 0.4 - CONFIG.player.bodySkin + 1e-6)
  })

  it('seated and lying people are not circles in the way (their chair or bed is the solid)', () => {
    const { sim, sys } = plaza(-72, 0, Math.PI / 2)
    const sitter: Entity = { ...newEntity('sitter', 'visitor', 'Sitter', { x: -68, z: 0 }, 0), seated: { seatId: 'x', pose: 'sit' }, anim: 'sit' }
    sim.entities.set(sitter.id, sitter)
    expect(walkEast(sys, sim, 3)).toBeGreaterThan(-67)
  })

  it('a crowd of people never traps you and never throws you about: standing among them you can always walk off, and you never end inside one', () => {
    const { sim, sys } = plaza(-70, 0, Math.PI / 2)
    // ten people on top of you and around you
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2
      const e = newEntity(`p${i}`, 'visitor', `P${i}`, { x: -70 + Math.sin(a) * 0.5, z: Math.cos(a) * 0.5 }, 0)
      sim.entities.set(e.id, e)
    }
    let last = { x: sim.player!.x, z: sim.player!.z }
    for (let i = 0; i < 120; i++) {
      sys.update(1 / 60)
      // the push is at most the push speed (4.5 m/s) a frame: it never teleports you
      expect(Math.hypot(sim.player!.x - last.x, sim.player!.z - last.z)).toBeLessThanOrEqual(4.5 / 60 + 1e-9)
      last = { x: sim.player!.x, z: sim.player!.z }
      expect(staticClearance(sim.player!.x, sim.player!.z).d).toBeGreaterThanOrEqual(R - 1e-4)
    }
  })
})
