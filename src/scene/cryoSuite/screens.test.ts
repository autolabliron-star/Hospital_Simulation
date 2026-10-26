/**
 * R4: the suite's screens in node: five quads on one 1024 x 256 atlas, each face at its anchor showing its own tile (the UVs), the repaint gated on
 * what is shown and on 2 Hz (4 Hz while somebody looks), the texture uploaded only on a repaint.
 */
import { describe, expect, it } from 'vitest'
import { mockEnv } from '@/scene/imaging/images/mockCanvas'
import { CRYO_SUITE } from '@/sim/places'
import { ATLAS, COOL_PERIOD, createCryoScreens, HOT_PERIOD, SCREEN_FACES, screensGeometry, TILE, tileU } from './screens'
import { cryoState } from './testkit'
import { lookingAtSuite } from './presence'

describe('the atlas and the quads', () => {
  it('is one 1024 x 256 atlas of four tiles and five quads, each quad\'s u inside its tile, v over the whole height', () => {
    expect([ATLAS.w, ATLAS.h, ATLAS.tile]).toEqual([1024, 256, 256])
    expect(SCREEN_FACES).toHaveLength(5)
    const g = screensGeometry()
    const uv = g.getAttribute('uv')
    const pos = g.getAttribute('position')
    expect(pos.count).toBe(5 * 4)
    SCREEN_FACES.forEach((f, q) => {
      const [u0, u1] = tileU(f.tile)
      let minU = 1
      let maxU = 0
      let minV = 1
      let maxV = 0
      let cx = 0
      let cy = 0
      let cz = 0
      for (let i = q * 4; i < q * 4 + 4; i++) {
        minU = Math.min(minU, uv.getX(i))
        maxU = Math.max(maxU, uv.getX(i))
        minV = Math.min(minV, uv.getY(i))
        maxV = Math.max(maxV, uv.getY(i))
        cx += pos.getX(i) / 4
        cy += pos.getY(i) / 4
        cz += pos.getZ(i) / 4
      }
      expect(minU, f.id).toBeCloseTo(u0, 9)
      expect(maxU, f.id).toBeCloseTo(u1, 9)
      expect([minV, maxV]).toEqual([0, 1])
      expect(cx).toBeCloseTo(f.x, 4)
      expect(cy).toBeCloseTo(f.y, 4)
      expect(cz).toBeCloseTo(f.z, 4)
    })
    // the faces show the right pictures, and every view of the brief is on a screen
    const tileOf = (id: string) => SCREEN_FACES.find((f) => f.id === id)!.tile
    expect(tileOf('roomPlan')).toBe(TILE.planning)
    expect(tileOf('roomLive')).toBe(TILE.live)
    expect(tileOf('console')).toBe(TILE.console)
    expect(tileOf('robotStation')).toBe(TILE.robot)
    expect(new Set(SCREEN_FACES.map((f) => f.tile)).size).toBe(4)
  })

  it('every face looks the way its anchor faces (the quad normal), the console\'s leaning back by its tilt', () => {
    const g = screensGeometry()
    const n = g.getAttribute('normal')
    SCREEN_FACES.forEach((f, q) => {
      const i = q * 4
      expect(n.getX(i)).toBeCloseTo(Math.sin(f.heading) * Math.cos(f.tilt), 6)
      expect(n.getY(i)).toBeCloseTo(Math.sin(f.tilt), 6)
      expect(n.getZ(i)).toBeCloseTo(Math.cos(f.heading) * Math.cos(f.tilt), 6)
    })
    expect(SCREEN_FACES.find((f) => f.id === 'console')!.tilt).toBe(CRYO_SUITE.console.screen.tilt)
  })
})

describe('the repaint gate', () => {
  it('repaints when what is shown changes, at most 2 Hz, 4 Hz while somebody looks; uploads only on a repaint', () => {
    const { env, rec } = mockEnv()
    const screens = createCryoScreens(env)
    const s = cryoState({ step: 'freeze1', ice: 0.4, timer: 10 })
    const v0 = screens.texture.version
    expect(screens.update(s, 0, false)).toBe(true)
    expect(screens.texture.version).toBe(v0 + 1)
    const calls = rec.total()
    // nothing changed: no repaint however long you wait
    for (let t = 0.1; t < 5; t += 0.1) expect(screens.update(s, t, false)).toBe(false)
    expect(rec.total()).toBe(calls)
    expect(screens.texture.version).toBe(v0 + 1)
    // something changes every frame (the state's version): the cool rate is 2 Hz
    let n = 0
    for (let i = 0; i < 600; i++) {
      s.version = 10 + i
      if (screens.update(s, 5 + i / 60, false)) n++
    }
    expect(n).toBeGreaterThanOrEqual(19)
    expect(n).toBeLessThanOrEqual(21) // 10 s at 2 Hz
    let hot = 0
    for (let i = 0; i < 600; i++) {
      s.version = 1000 + i
      if (screens.update(s, 20 + i / 60, true)) hot++
    }
    expect(hot).toBeGreaterThanOrEqual(39)
    expect(hot).toBeLessThanOrEqual(41) // 10 s at 4 Hz
    expect(HOT_PERIOD).toBe(0.25)
    expect(COOL_PERIOD).toBe(0.5)
    expect(screens.gate.repaints).toBe(1 + n + hot)
  })

  it('sub-percent ice and sub-second timer changes do not repaint; the step, the robot and a needle going in do', () => {
    const { env } = mockEnv()
    const screens = createCryoScreens(env)
    const s = cryoState({ step: 'aim', robot: 'aiming', robotNeedle: 0, inserted: [0, 0, 0], ice: 0.5, timer: 10.1 })
    screens.update(s, 0, false)
    s.ice = 0.504
    s.timer = 10.9
    expect(screens.update(s, 1, false)).toBe(false)
    s.robot.phase = 'aligned'
    expect(screens.update(s, 2, false)).toBe(true)
    s.needles[0].inserted = 0.5
    expect(screens.update(s, 3, false)).toBe(true)
    s.step = 'checkCt'
    expect(screens.update(s, 4, false)).toBe(true)
  })

  it('somebody looks when the focus is on the suite or you stand in it on level 2', () => {
    expect(lookingAtSuite('l2Cryo', null, 1)).toBe(true)
    expect(lookingAtSuite('l2CryoControl', null, 1)).toBe(true)
    expect(lookingAtSuite('l2Or', null, 2)).toBe(false)
    expect(lookingAtSuite(null, { x: CRYO_SUITE.viewing.at.x, z: CRYO_SUITE.viewing.at.z }, 2)).toBe(true)
    expect(lookingAtSuite(null, { x: CRYO_SUITE.viewing.at.x, z: CRYO_SUITE.viewing.at.z }, 1)).toBe(false)
  })
})
