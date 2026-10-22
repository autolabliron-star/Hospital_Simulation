import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CONFIG } from './config'
import { pointAt, type PathPoint } from './meds/circuit'
import { ROBOT, WALL } from './places'
import { Simulation } from './Simulation'

const DT = CONFIG.sim.step
/** The hospital now has its whole population (ER, visitors, ambient crowd): these runs take a few seconds of real time. */
const LONG = 120_000

function run(sim: Simulation, seconds: number) {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) sim.step(DT)
}

describe('Simulation (doctors, pods, nurses together)', () => {
  it('turns doctors\' rounds into medicines given by nurses, with nothing left behind', () => {
    const sim = new Simulation(1234)
    run(sim, 45 * 60)
    const orders = [...sim.meds.orders.values()]
    expect(orders.length).toBeGreaterThanOrEqual(10)
    const given = orders.filter((o) => o.stage === 'given')
    expect(given.length).toBeGreaterThan(0)
    // anything written more than 25 min before the end (15 min dose delay + delivery + walk) is given by now
    const late = orders.filter((o) => o.createdAt < sim.t - 25 * 60 && o.stage !== 'given')
    expect(late.map((o) => `${o.id} ${o.roomId} ${o.stage}`)).toEqual([])
    const texts = sim.log.events.map((e) => e.text)
    expect(texts.some((t) => /^Dr\. (Levi|Okafor) prescribed/.test(t))).toBe(true)
    expect(texts.some((t) => /^Nurse \w+ gave \d+ medicines? to .+, prepared and delivered automatically\.$/.test(t))).toBe(true)
  }, LONG)

  it('presenter orders go through the same pipeline and are given promptly', () => {
    const sim = new Simulation(99)
    run(sim, 30)
    const r = sim.prescribe('B6', [{ medId: 'salbutamol', qty: 1 }])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    run(sim, 5 * 60)
    expect(r.order.stage).toBe('given')
    const minutes = (r.order.stageAt.given! - r.order.createdAt) / 60
    expect(minutes).toBeLessThan(5)
  }, LONG)

  it('pods never wait for people: the rail is above the floor, so no pod ever stops for a person, you or a MealBot', () => {
    let overlaps = 0
    let podSteps = 0
    let podMoving = 0
    let strayAmber = 0
    const at: PathPoint = { x: 0, z: 0, heading: 0 }
    const reasons = new Set<string>()
    // two seeds, 40 sim minutes each from 07:45: enough walkers under the rail that "never" is not vacuous. Wave 1 made the doses real: the
    // dose waves are 06/08/12/14/18/20/22, so between the 07:30 backlog and the 08:00 wave few pods are out and a run from
    // 07:30 (08:00 wave only in its last 10 minutes) measured no pod over any walker in these two seeds. From 07:45 the 08:00 wave (and breakfast,
    // and the morning round going out) is inside the 40 minutes, with the pods out on the rail over the corridors.
    for (const seed of [777, 778]) {
      const sim = new Simulation(seed, { startHour: 7.75 })
      const n = Math.round((40 * 60) / DT)
      for (let i = 0; i < n; i++) {
        sim.step(DT)
        for (const d of sim.meds.fleet.drivers) {
          podSteps++
          if (d.pod.speed > 0.1) podMoving++
          if (d.pod.waitingFor !== null) reasons.add(d.pod.waitingFor)
          // the amber light means "held up behind the pod ahead" and nothing else
          if (d.pod.light === 'amber' && d.pod.waitingFor !== 'pod') strayAmber++
          // somebody (a person, a MealBot) standing right under the pod, body radius included
          // (the pod's pose from its arc length: `position` is only written by `sync`)
          const q = pointAt(d.circuit, d.pod.s, at)
          const px = q.x
          const pz = q.z
          let under = false
          for (const p of sim.people) {
            if (p.mobile && Math.hypot(p.walker.x - px, p.walker.z - pz) < ROBOT.podSize.l / 2 + 0.25) under = true
          }
          for (const u of sim.meals.units) if (u.onDuty && Math.hypot(u.x - px, u.z - pz) < ROBOT.podSize.l / 2 + 0.45) under = true
          if (under) overlaps++
        }
      }
    }
    expect(podSteps).toBeGreaterThan(0)
    // pods were really out on the rail (a run with every pod parked would pass the overlap check for nothing)
    expect(podMoving).toBeGreaterThan(0)
    // 'person' is never a reason for a pod to stop (any other reason is allowed)
    expect([...reasons].filter((r) => r === 'person')).toEqual([])
    expect(strayAmber).toBe(0)
    // the hospital is busy enough that people do walk right under pods (they share the floor spot, not the space)
    expect(overlaps).toBeGreaterThan(0)
  }, LONG)

  it('people never wait for pods: the people code has no hook to the pods and the pods ride above every walker', () => {
    // no walker, crowd or person controller imports the pod fleet, the circuits or the pod system as a value: nothing a pod
    // does can hold a person (a MedPod is a ceiling-rail vehicle, 2.30 m above the floor)
    const dir = fileURLToPath(new URL('.', import.meta.url))
    const files = ['walker.ts', 'nav/follower.ts', 'nav/crowd.ts', 'nav/graph.ts', 'nav/layout.ts', 'person.ts', 'er/actor.ts'].map((f) => dir + f)
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      const bad = src.split('\n').filter((l) => /^import\s+(?!type\b).*['"][./]+\/(meds\/(pods|circuit|system)|crossings)['"]/.test(l))
      expect(bad, f).toEqual([])
    }
    expect(ROBOT.podBottomY).toBeGreaterThanOrEqual(WALL.doorHeight)
  })

  it('is deterministic for a seed', () => {
    const a = new Simulation(5)
    const b = new Simulation(5)
    run(a, 20 * 60)
    run(b, 20 * 60)
    const fmt = (s: Simulation) => s.log.events.map((e) => `${e.t.toFixed(3)} ${e.text}`)
    expect(fmt(a).length).toBeGreaterThan(20)
    expect(fmt(b)).toEqual(fmt(a))
  }, LONG)
})
