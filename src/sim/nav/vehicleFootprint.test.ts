/**
 * Wave 1: a stretcher, wheelchair or cart takes up its real floor (places.ts VEHICLE_HALF), so nobody walks through it. Runs busy stretches of
 * the whole hospital (ER, porters, cleaners, lifts, visitors) at several seeds and checks, every quarter second of sim time, that no standing
 * or walking person's body is inside a pushed vehicle's box beyond a small tolerance. Also checks the crowd's discs for one vehicle directly.
 */
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { VEHICLE_AHEAD, VEHICLE_HALF } from '../places'
import { Simulation } from '../Simulation'
import type { Entity } from '../types'
import { Crowd } from './crowd'
import { makeWalker } from '../walker'

/** A body of this radius may reach into the vehicle's box by at most this much (m). The discs cover the box with 8 cm to spare; the rest is the crowd's own slack. */
const TOLERANCE = 0.12
const BODY = 0.25

/** How far a body at (px, pz) of radius BODY reaches into the box of `pusher`'s vehicle (<= 0: clear). */
function penetration(pusher: Entity, px: number, pz: number): number {
  const kind = pusher.vehicle!
  const h = pusher.heading
  const sinH = Math.sin(h)
  const cosH = Math.cos(h)
  const cx = pusher.position.x + sinH * VEHICLE_AHEAD[kind]
  const cz = pusher.position.z + cosH * VEHICLE_AHEAD[kind]
  const dx = px - cx
  const dz = pz - cz
  // along the heading (l) and across it (w)
  const l = dx * sinH + dz * cosH
  const w = dx * cosH - dz * sinH
  const hw = VEHICLE_HALF[kind][0]
  const hl = VEHICLE_HALF[kind][1]
  const ex = Math.max(Math.abs(w) - hw, 0)
  const ez = Math.max(Math.abs(l) - hl, 0)
  const outside = Math.hypot(ex, ez)
  // (centre inside the box counts as fully overlapping)
  const d = ex === 0 && ez === 0 ? -Math.min(hw - Math.abs(w), hl - Math.abs(l)) : outside
  return BODY - d
}

function worst(sim: Simulation): { pen: number; who: string } {
  let pen = -Infinity
  let who = ''
  const pushers: Entity[] = []
  for (const e of sim.entities.values()) if (e.vehicle !== undefined && e.vehicle !== 'none' && !e.riding && (e.fade ?? 1) >= 0.99) pushers.push(e)
  for (const pu of pushers) {
    for (const e of sim.entities.values()) {
      if (e === pu || e.riding || (e.fade ?? 1) < 0.99 || e.seated || e.anim === 'lie' || e.anim === 'sit') continue
      if (e.vehicle !== undefined && e.vehicle !== 'none') continue
      const p = penetration(pu, e.position.x, e.position.z)
      if (p > pen) {
        pen = p
        who = `${e.name} (${e.role}, ${e.anim}) in ${pu.name}'s ${pu.vehicle}`
      }
    }
  }
  return { pen, who }
}

describe('vehicles have their real footprint in the crowd', () => {
  it('makes a pusher\'s vehicle a row of discs that cover its box, and gives them up when it is put down', () => {
    const crowd = new Crowd()
    const w = makeWalker(crowd, { id: 'porter' })
    w.place(-30, 0, 0)
    const before = crowd.size
    w.setFootprint!({ ahead: VEHICLE_AHEAD.stretcher, halfWidth: VEHICLE_HALF.stretcher[0], halfLength: VEHICLE_HALF.stretcher[1] })
    const discs = crowd.size - before
    expect(discs).toBeGreaterThanOrEqual(4)
    // every point of the stretcher's box is inside a disc
    let uncovered = 0
    for (let l = VEHICLE_AHEAD.stretcher - 1.05; l <= VEHICLE_AHEAD.stretcher + 1.05; l += 0.05) {
      for (let a = -0.4; a <= 0.4; a += 0.05) {
        let inside = false
        for (let s = 0; s < crowd.count; s++) {
          if (crowd.owner[s] < 0 || !crowd.act[s]) continue
          if (Math.hypot(crowd.px[s] - (-30 + a), crowd.pz[s] - l) <= crowd.rad[s]) inside = true
        }
        if (!inside) uncovered++
      }
    }
    expect(uncovered).toBe(0)
    w.setFootprint!(null)
    expect(crowd.size).toBe(before)
  })

  /** A stretcher and a wheelchair pushed along the spine while walkers cross and meet them; returns how far a body reached into a box. */
  function stress(withFootprint: boolean): { worst: number; arrived: boolean } {
    const crowd = new Crowd()
    const kinds = ['stretcher', 'wheelchair'] as const
    const pushers = kinds.map((k, i) => {
      const w = makeWalker(crowd, { id: `push${i}` })
      w.place(-40 + i * 6, i === 0 ? -0.6 : 0.6, Math.PI)
      ;(w as unknown as { setRadius(r: number): void }).setRadius(0.45)
      if (withFootprint) w.setFootprint!({ ahead: VEHICLE_AHEAD[k], halfWidth: VEHICLE_HALF[k][0], halfLength: VEHICLE_HALF[k][1] })
      w.goTo({ x: -62, z: i === 0 ? -0.6 : 0.6 })
      return w
    })
    const walkers = Array.from({ length: 8 }, (_, i) => {
      const w = makeWalker(crowd, { id: `walk${i}` })
      w.place(-64 + (i % 2) * 1.5, -1.2 + i * 0.35, 0)
      w.goTo({ x: -30, z: -1.2 + i * 0.35 })
      return w
    })
    // two people standing in the way of the vehicles, in line with them (a nurse at a bay, a visitor reading a sign)
    const standers = [-0.6, 0.6].map((z, i) => {
      const w = makeWalker(crowd, { id: `stand${i}` })
      w.place(-52 - i * 7, z, 0)
      w.setStatic(true)
      return w
    })
    walkers.push(...standers)
    let worst = -Infinity
    for (let n = 0; n < 60 * 90; n++) {
      crowd.beginStep()
      for (const p of pushers) p.step(1 / 60, 1.0)
      for (const w of walkers) if (!standers.includes(w)) w.step(1 / 60, 1.3)
      pushers.forEach((p, i) => {
        const k = kinds[i]
        const h = p.heading
        const cx = p.x + Math.sin(h) * VEHICLE_AHEAD[k]
        const cz = p.z + Math.cos(h) * VEHICLE_AHEAD[k]
        for (const w of walkers) {
          const dx = w.x - cx
          const dz = w.z - cz
          const l = dx * Math.sin(h) + dz * Math.cos(h)
          const wd = dx * Math.cos(h) - dz * Math.sin(h)
          const ex = Math.max(Math.abs(wd) - VEHICLE_HALF[k][0], 0)
          const ez = Math.max(Math.abs(l) - VEHICLE_HALF[k][1], 0)
          worst = Math.max(worst, BODY - Math.hypot(ex, ez))
        }
      })
    }
    const arrived = pushers.every((p, i) => Math.hypot(p.x + 62, p.z - (i === 0 ? -0.6 : 0.6)) < 1) && walkers.every((w) => standers.includes(w) || w.x > -32)
    return { worst, arrived }
  }

  it('lets walkers meet and pass a pushed stretcher and wheelchair without going through them, and everybody still gets there', () => {
    const without = stress(false)
    const withFp = stress(true)
    // the test is sensitive: with only the pusher's disc, walkers do go through the box
    expect(without.worst).toBeGreaterThan(TOLERANCE)
    expect(withFp.worst).toBeLessThanOrEqual(TOLERANCE)
    expect(withFp.arrived).toBe(true)
  })

  const SEEDS = [3, 17, 29]
  it.each(SEEDS)('keeps every walker out of every moving vehicle, seed %i (busy morning, whole hospital)', { timeout: 900_000 }, (seed) => {
    const sim = new Simulation(seed, { startHour: 9.5, inFlight: true })
    const step = CONFIG.sim.step
    const every = Math.round(0.25 / step)
    const n = Math.round((35 * 60) / step)
    let worstPen = -Infinity
    let who = ''
    let seen = 0
    for (let i = 0; i < n; i++) {
      sim.step(step)
      if (i % every !== 0) continue
      const r = worst(sim)
      if (r.pen > -Infinity) seen++
      if (r.pen > worstPen) {
        worstPen = r.pen
        who = `${(sim.t / 3600 + CONFIG.sim.startHour).toFixed(2)}h ${r.who}`
      }
    }
    // there were vehicles about
    expect(seen).toBeGreaterThan(100)
    expect(worstPen, who).toBeLessThanOrEqual(TOLERANCE)
  })
})
