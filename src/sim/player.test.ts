import { describe, expect, it } from 'vitest'
import { CONFIG } from './config'
import { pointAt, type PathPoint } from './meds/circuit'
import { PLAYER_SPAWN, roomById } from './places'
import { Simulation } from './Simulation'

describe('W1: you in the sim', () => {
  it('adds you as a doctor named You, moves you, and takes you out again', () => {
    const sim = new Simulation(5)
    const before = sim.rosterVersion
    const p = sim.addPlayer(PLAYER_SPAWN)
    expect(p.mode).toBe('walk')
    const e = sim.entities.get('player')!
    expect(e.role).toBe('doctor')
    expect(e.name).toBe('You')
    expect(sim.rosterVersion).toBeGreaterThan(before)
    sim.movePlayer(-58, 1, Math.PI / 2, 1.4)
    expect(e.position.x).toBe(-58)
    expect(e.anim).toBe('walk')
    for (let i = 0; i < 120; i++) sim.step(1 / 60)
    // the sim never moves you
    expect(sim.player!.x).toBe(-58)
    expect(e.position.z).toBe(1)
    sim.removePlayer()
    expect(sim.entities.has('player')).toBe(false)
    expect(sim.player).toBeNull()
  })

  it('pods never stop for you, even when you stand right under their rail', () => {
    const DT = CONFIG.sim.step
    const sim = new Simulation(5)
    sim.addPlayer(PLAYER_SPAWN)
    // A5's drawer is on the room side of the corridor; its pod rides the rail line z = podDock.z, and you stand on that line 3 m
    // before the drawer: the pod has to pass right over your head on its way
    const dock = roomById('A5').podDock
    const spot = { x: dock.x - 3, z: dock.z }
    const place = (): void => sim.movePlayer(spot.x, spot.z, Math.PI / 2, 0)
    place()
    const r = sim.prescribe('A5', [{ medId: 'salbutamol', qty: 1 }])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const at: PathPoint = { x: 0, z: 0, heading: 0 }
    let nearest = Infinity
    let stopsForYou = 0
    let podId = ''
    for (let i = 0, n = Math.round((6 * 60) / DT); i < n; i++) {
      place()
      sim.step(DT)
      for (const d of sim.meds.fleet.drivers) {
        if (String(d.pod.waitingFor) === 'person') stopsForYou++ // impossible by type since W2; kept as a runtime guard
        if (d.pod.orderId === r.order.id) {
          podId = d.pod.id
          const q = pointAt(d.circuit, d.pod.s, at)
          nearest = Math.min(nearest, Math.hypot(q.x - spot.x, q.z - spot.z))
        }
      }
    }
    expect(podId, 'a pod took the order').not.toBe('')
    // it went right over you (its centre within a hand's breadth of yours) and never stopped for you
    expect(nearest).toBeLessThan(0.1)
    expect(stopsForYou).toBe(0)
    // ... so the medicines were delivered to the drawer on time
    expect(['inDrawer', 'given']).toContain(r.order.stage)
    expect(r.order.stageAt.inDrawer! - r.order.createdAt).toBeLessThan(4 * 60)
    // (W2) there is no "waited for you" event any more: pods ride the ceiling rail and never yield
  })

  it('you never change when the medicines arrive: the same order reaches the drawer at the very same moment with or without you', () => {
    const DT = CONFIG.sim.step
    const dock = roomById('A5').podDock
    const arrival = (withYou: boolean): number => {
      const sim = new Simulation(5)
      if (withYou) {
        sim.addPlayer(PLAYER_SPAWN)
        sim.movePlayer(dock.x - 3, dock.z, Math.PI / 2, 0) // under the rail, right in the pod's way
      }
      for (let i = 0; i < 30 / DT; i++) sim.step(DT)
      const r = sim.prescribe('A5', [{ medId: 'salbutamol', qty: 1 }])
      if (!r.ok) throw new Error(r.reason)
      for (let i = 0; i < (4 * 60) / DT && r.order.stageAt.inDrawer === undefined; i++) {
        if (withYou) sim.movePlayer(dock.x - 3, dock.z, Math.PI / 2, 0)
        sim.step(DT)
      }
      return r.order.stageAt.inDrawer ?? -1
    }
    const plain = arrival(false)
    expect(plain).toBeGreaterThan(0)
    expect(arrival(true)).toBe(plain)
  })

  it('without you, the day is exactly as before', () => {
    const a = new Simulation(11)
    const b = new Simulation(11)
    for (let i = 0; i < 600; i++) {
      a.step(1 / 60)
      b.step(1 / 60)
    }
    expect(a.log.events.map((e) => e.text)).toEqual(b.log.events.map((e) => e.text))
    expect(a.player).toBeNull()
  })
})
