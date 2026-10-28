/**
 * How the people walk, measured on the seeded hospital (the showcase opening, the default seed): the sim runs at 60 Hz and the crowd model
 * draws every step, as the browser does. Three numbers guard the fixes of "the people walk not good":
 *   - crab: a walking body drawn facing more than 20 degrees away from where it goes (it slid sideways). 14 % of the walking frames
 *     before (the drawn yaw was the path's, the body went round people and changed lanes at 0.9 m/s sideways), about 1.5 % after
 *     (facing.ts, crowd.ts LAT_ACC);
 *   - side steps: a foot that lifts while walking although it is not behind the body (the planter stepping sideways to catch a body that
 *     slid). 9 % of the steps before, about 3 % after;
 *   - forced steps: a foot that had to lift while the other was still in the air (a hop, a limp). 10 % of the steps before, about 6 % after
 *     (eased lanes, rounded corners); most of what is left is the first steps of a start.
 * And a standing person is never turned on screen by more than FACING.maxTurn in a frame (the sim turns them in one step on arrival).
 */
import { describe, expect, it } from 'vitest'
import { CONFIG } from '@/sim/config'
import { buildSimulation } from '@/sim/index'
import { FACING } from './facing'
import { wrapPi } from './math'
import { CrowdModel, type FrameInput } from './model'

const DT = CONFIG.sim.step
const SECONDS = 180

describe('the walk on a seeded morning', () => {
  it('faces where it goes, steps forward and seldom hops', { timeout: 300_000 }, () => {
    const sim = buildSimulation(CONFIG.sim.worldSeed, undefined, 0, 'showcase')
    const model = new CrowdModel()
    const f: FrameInput = { dt: DT, time: 0, camX: 0, camY: 40, camZ: 0, entities: sim.entities, followId: null, selectedId: null, hoverId: null, timeScale: 1 }
    const feet = new Map<string, { x: number; z: number; stepping: boolean }[]>()
    const lastYaw = new Map<string, number>()
    let walking = 0
    let crab = 0
    let sideSteps = 0
    let standTurnMax = 0
    const sideLog: string[] = []
    // the cadence at a normal pace (1.1 to 1.3 m/s, measured): footfalls over time spent at that pace
    let paceTime = 0
    let paceSteps = 0
    let paceDist = 0
    const lastSteps = new Map<string, number>()
    for (let t = 0; t < Math.round(SECONDS / DT); t++) {
      sim.step(DT)
      sim.sync(1)
      f.time += DT
      model.update(f)
      for (const e of sim.entities.values()) {
        const s = model.get(e.id)
        if (!s || s.posture !== 'stand' || s.rideKind !== 0 || e.id === 'player' || s.presence <= 0) {
          feet.delete(e.id)
          lastYaw.delete(e.id)
          continue
        }
        if (s.speed > 0.4) {
          walking++
          if (Math.abs(wrapPi(Math.atan2(s.vx, s.vz) - s.heading)) > (20 * Math.PI) / 180) crab++
        }
        // a standing person (the sim may turn them in one step): the drawn yaw turns at a human rate
        const ly = lastYaw.get(e.id)
        if (ly !== undefined && s.speed < 0.05 && s.faceOk) standTurnMax = Math.max(standTurnMax, Math.abs(wrapPi(s.heading - ly)))
        lastYaw.set(e.id, s.heading)
        const pl = s.rig.planter
        const ls = lastSteps.get(e.id) ?? pl.steps
        lastSteps.set(e.id, pl.steps)
        if (s.speed > 1.1 && s.speed < 1.3 && pl.moving) {
          paceTime += DT
          paceSteps += pl.steps - ls
          paceDist += s.speed * DT
        }
        const prev = feet.get(e.id)
        if (prev && pl.initialised && s.speed > 0.4) {
          for (let i = 0; i < 2; i++) {
            // a swing that began this frame: where was the foot relative to the body?
            if (pl.feet[i].stepping && !prev[i].stepping) {
              const along = (prev[i].x - s.x) * Math.sin(s.heading) + (prev[i].z - s.z) * Math.cos(s.heading)
              if (along > -0.05) {
                sideSteps++
                if (process.env.WALK_OUT) sideLog.push(`spd=${s.speed.toFixed(2)} along=${along.toFixed(2)} sinceMove=${pl.lifts - pl.liftsAtMove} moving=${pl.moving}`)
              }
            }
          }
        }
        feet.set(e.id, [
          { x: pl.feet[0].x, z: pl.feet[0].z, stepping: pl.feet[0].stepping },
          { x: pl.feet[1].x, z: pl.feet[1].z, stepping: pl.feet[1].stepping },
        ])
      }
    }
    let steps = 0
    let forced = 0
    for (const id of sim.entities.keys()) {
      const s = model.get(id)
      if (!s || id === 'player') continue
      steps += s.rig.planter.steps
      forced += s.rig.planter.forced
    }
    if (process.env.WALK_OUT) require('node:fs').writeFileSync(process.env.WALK_OUT, `crab ${(crab / walking).toFixed(4)} side ${(sideSteps / steps).toFixed(4)} forced ${(forced / steps).toFixed(4)} ${sideLog.slice(0, 40).join('\n')} cadence ${((paceSteps / paceTime) * 60).toFixed(1)}/min step ${(paceDist / paceSteps).toFixed(3)} m`)
    expect(walking).toBeGreaterThan(20_000)
    expect(steps).toBeGreaterThan(1000)
    expect(crab / walking, 'walking frames drawn crabbing (> 20 degrees off the motion)').toBeLessThan(0.04)
    expect(sideSteps / steps, 'steps that lift a foot that is not behind the body').toBeLessThan(0.05)
    expect(forced / steps, 'steps forced while the other foot is in the air').toBeLessThan(0.08)
    expect(standTurnMax).toBeLessThanOrEqual(FACING.maxTurn * DT + 1e-6)
    // a real gait (gait.ts WALK): 100 to 115 steps a minute and 0.65 to 0.75 m a step at 1.1 to 1.3 m/s (the Waltz walk: about 120 and 0.6 m)
    expect(paceTime).toBeGreaterThan(60)
    expect((paceSteps / paceTime) * 60, 'steps per minute at 1.1-1.3 m/s').toBeGreaterThan(100)
    expect((paceSteps / paceTime) * 60, 'steps per minute at 1.1-1.3 m/s').toBeLessThan(115)
    expect(paceDist / paceSteps, 'metres a step at 1.1-1.3 m/s').toBeGreaterThan(0.65)
    expect(paceDist / paceSteps, 'metres a step at 1.1-1.3 m/s').toBeLessThan(0.75)
  })
})
