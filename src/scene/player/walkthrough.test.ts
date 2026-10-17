/**
 * The whole system on a walk through the hospital: the real player system (keys, walking, collision, the chase camera with its
 * smoothing and lag) steered by hand along the people's own routes, from the plaza through the entrance to the bedsides, the imaging
 * rooms and the staff room. On EVERY frame of every walk the camera is outside the walls, under the ceiling and above the floor, and
 * you stand on ground you can stand on.
 *
 * Both control schemes are walked. Classic: the walk is camera-relative, so the test looks where it is going (`setLook`) and holds W.
 * Easy (the default): the test steers with A and D, holding W, as a player does, so the camera swings behind every turn.
 */
import { describe, expect, it } from 'vitest'
import { PerspectiveCamera } from 'three'
import { planRoute } from '@/sim/nav/graph'
import { IMAGING, PLAYER_SPAWN, ROOMS, STAFF_ROOM, areaAt, ceilingHeight } from '@/sim/places'
import { Simulation } from '@/sim/Simulation'
import { insideWallBox, buildWallBoxes } from './boomProbe'
import { walkableAt, settle } from './collision'
import { angleDelta } from './chaseMath'
import type { ControlScheme } from './scheme'
import { PlayerSystem } from './system'
import { CHASE } from './tuning'

const DT = 1 / 60
const boxes = buildWallBoxes()

/** Easy steering, as a player does it: hold A or D to turn towards `want`, and hold W unless you are facing well away from it. */
function steerEasy(sys: PlayerSystem, heading: number, want: number): void {
  const d = angleDelta(heading, want) // positive: turn left
  sys.input.keyUp('KeyA')
  sys.input.keyUp('KeyD')
  if (d > 0.06) sys.input.keyDown('KeyA')
  else if (d < -0.06) sys.input.keyDown('KeyD')
  if (Math.abs(d) > 1.0) sys.input.keyUp('KeyW')
  else sys.input.keyDown('KeyW')
}

function walkRoute(route: readonly { x: number; z: number }[], hurry: boolean, scheme: ControlScheme): { frames: number; stuck: boolean } {
  const sim = new Simulation(5)
  const camera = new PerspectiveCamera(35, 16 / 9, 1, 500)
  const sys = new PlayerSystem({ camera, getSim: () => sim, reducedMotion: () => false, scheme })
  try {
    sys.input.keyDown('KeyW')
    if (hurry) sys.input.keyDown('ShiftLeft')
    sys.update(DT)
    let frames = 0
    for (const wp of route) {
      let spent = 0
      for (;;) {
        const p = sim.player!
        const dx = wp.x - p.x
        const dz = wp.z - p.z
        if (Math.hypot(dx, dz) < 0.35) break
        if (spent++ > 60 * 25) return { frames, stuck: true }
        if (scheme === 'classic') sys.chase.setLook(Math.atan2(dx, dz)) // look where you are going: the walk is camera-relative
        else steerEasy(sys, p.heading, Math.atan2(dx, dz)) // turn towards where you are going
        sys.update(DT)
        frames++
        const q = sim.player!
        expect(walkableAt(q.x, q.z), `frame ${frames}: you at (${q.x.toFixed(2)}, ${q.z.toFixed(2)})`).toBe(true)
        const c = camera.position
        expect(insideWallBox(boxes, c.x, c.y, c.z, 0), `frame ${frames}: camera (${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)}) in a wall`).toBeNull()
        const area = areaAt(c.x, c.z)
        const ceiling = area ? ceilingHeight(area.id) : null
        if (ceiling !== null) expect(c.y, `frame ${frames}: camera above the ceiling`).toBeLessThanOrEqual(ceiling - CHASE.ceilingClearance + 1e-9)
        expect(c.y, `frame ${frames}: camera under the floor`).toBeGreaterThanOrEqual(CHASE.floorClearance - 1e-9)
      }
    }
    return { frames, stuck: false }
  } finally {
    sys.dispose()
  }
}

describe.each(['easy', 'classic'] as const)('walking the hospital (%s controls)', (scheme) => {
  const lobby = { x: -50, z: 0 }

  it('from the plaza, through the entrance, across the lobby and into the main corridor, at a walk', () => {
    const route = [{ x: -63, z: 0 }, { x: -58, z: 0 }, ...planRoute({ x: -58, z: 0 }, { x: -40, z: 0 })]
    const r = walkRoute(route, false, scheme)
    expect(r.stuck).toBe(false)
    expect(r.frames).toBeGreaterThan(60 * 5)
  })

  it('to every patient room\'s bedside, hurrying: the camera never goes through a wall or the ceiling', () => {
    for (const room of ROOMS) {
      const at = { x: 0, z: 0 }
      settle(room.bedside.x, room.bedside.z, at)
      const route = planRoute(lobby, at)
      const r = walkRoute(route, true, scheme)
      expect(r.stuck, room.id).toBe(false)
    }
  })

  it('to the imaging consoles, the staff room and back out to the plaza, at a walk', () => {
    const goals = [IMAGING.mri.operator.at, IMAGING.ct.operator.at, IMAGING.xray.operator.at, STAFF_ROOM.door]
    for (const g of goals) {
      const at = { x: 0, z: 0 }
      settle(g.x, g.z, at)
      const there = walkRoute(planRoute(lobby, at), false, scheme)
      expect(there.stuck, `to ${g.x},${g.z}`).toBe(false)
    }
    const out = walkRoute([...planRoute({ x: -30, z: 0 }, { x: -60, z: 0 }), { x: -65, z: 0 }], true, scheme)
    expect(out.stuck).toBe(false)
    expect(PLAYER_SPAWN.at.x).toBeLessThan(-60) // the plaza is where you started
  })
})
