/**
 * R4: the suite's screens in node: six quads on one 1280 x 256 atlas (R5 wave 3: the anaesthesia monitor is the sixth quad and the fifth tile), each face at
 * its anchor showing its own tile (the UVs), the repaint gated on what is shown and on 2 Hz (4 Hz while somebody looks), the texture uploaded only on a
 * repaint; the monitor's tile with a gate of its own (it scrolls while the machine is in use and is still when it is not).
 */
import { describe, expect, it } from 'vitest'
import { mockEnv } from '@/scene/imaging/images/mockCanvas'
import { CRYO_SUITE } from '@/sim/places'
import { ANAES_SCREEN } from './anaesMachine'
import { ATLAS, COOL_PERIOD, createCryoScreens, HOT_PERIOD, SCREEN_FACES, screensGeometry, TILE, TILE_COUNT, TILE_LOGICAL_W, tileU } from './screens'
import { anaesState, cryoState } from './testkit'
import { lookingAtSuite } from './presence'

describe('the atlas and the quads', () => {
  it('is one 1280 x 256 atlas of five tiles and six quads, each quad\'s u inside its tile, v over the whole height', () => {
    expect([ATLAS.w, ATLAS.h, ATLAS.tile]).toEqual([1280, 256, 256])
    expect(TILE_COUNT).toBe(5)
    expect(ATLAS.w).toBe(TILE_COUNT * ATLAS.tile)
    expect(SCREEN_FACES).toHaveLength(6)
    const g = screensGeometry()
    const uv = g.getAttribute('uv')
    const pos = g.getAttribute('position')
    expect(pos.count).toBe(6 * 4)
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
      // (float32 uvs: a fifth of the atlas is not exactly representable)
      expect(minU, f.id).toBeCloseTo(u0, 6)
      expect(maxU, f.id).toBeCloseTo(u1, 6)
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
    expect(tileOf('anaesMonitor')).toBe(TILE.anaes)
    expect(TILE.anaes).toBe(4)
    expect(new Set(SCREEN_FACES.map((f) => f.tile)).size).toBe(5)
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

describe('R5 wave 3: the anaesthesia monitor\'s tile and its repaint gate', () => {
  it('the sixth quad is the machine\'s monitor at its anchor, its tile is the last of the atlas, painted in the screen\'s own aspect', () => {
    const face = SCREEN_FACES.find((f) => f.id === 'anaesMonitor')!
    expect(face).toMatchObject({ x: ANAES_SCREEN.x, y: ANAES_SCREEN.y, z: ANAES_SCREEN.z, w: ANAES_SCREEN.w, h: ANAES_SCREEN.h, heading: ANAES_SCREEN.heading, tilt: ANAES_SCREEN.tilt, tile: TILE.anaes })
    const [u0, u1] = tileU(TILE.anaes)
    expect([u0, u1]).toEqual([0.8, 1])
    expect(TILE_LOGICAL_W).toHaveLength(TILE_COUNT)
    expect(TILE_LOGICAL_W[TILE.anaes]).toBe(Math.round(256 * (ANAES_SCREEN.w / ANAES_SCREEN.h)))
    // the quad's normal looks the way the machine does (north: -z), tilted up a little
    const n = screensGeometry().getAttribute('normal')
    const i = SCREEN_FACES.indexOf(face) * 4
    expect(n.getZ(i)).toBeLessThan(-0.9)
    expect(n.getY(i)).toBeCloseTo(Math.sin(ANAES_SCREEN.tilt), 6)
  })

  it('while the machine is in use the traces scroll: repainted at 2 Hz, 4 Hz while somebody looks, one tile and one upload each time', () => {
    const { env, rec } = mockEnv()
    const screens = createCryoScreens(env)
    const s = anaesState()
    screens.paintAll(s, 0)
    screens.update(s, 0, false, 0)
    const clips0 = rec.count('clip')
    const v0 = screens.texture.version
    let n = 0
    for (let i = 0; i < 600; i++) {
      const t = 1 + i / 60
      if (screens.update(s, t, false, t)) n++
    }
    // 10 s at 2 Hz (the gate's period 0.5 s)
    expect(n).toBeGreaterThanOrEqual(19)
    expect(n).toBeLessThanOrEqual(21)
    // only the monitor's tile was painted each time (one clip a tile), and the main gate never fired
    expect(rec.count('clip') - clips0).toBe(n)
    expect(screens.texture.version - v0).toBe(n)
    expect(screens.monitorGate.repaints).toBe(n)
    let hot = 0
    for (let i = 0; i < 600; i++) {
      const t = 20 + i / 60
      if (screens.update(s, t, true, t)) hot++
    }
    expect(hot).toBeGreaterThanOrEqual(39)
    expect(hot).toBeLessThanOrEqual(41)
  })

  it('in standby (the kidney, a lung case not yet connected) it is never repainted, however long you wait; neither is anything else', () => {
    for (const s of [cryoState({ step: 'freeze1', ice: 0.4, timer: 10 }), anaesState({ airway: 'none' })]) {
      const { env, rec } = mockEnv()
      const screens = createCryoScreens(env)
      screens.update(s, 0, false, 0)
      const calls = rec.total()
      for (let t = 0.1; t < 60; t += 0.1) expect(screens.update(s, t, false, t)).toBe(false)
      expect(rec.total()).toBe(calls)
      expect(screens.monitorGate.repaints).toBe(0)
    }
  })

  it('a stopped clock (the sim paused) repaints nothing: the traces would not move', () => {
    const { env, rec } = mockEnv()
    const screens = createCryoScreens(env)
    const s = anaesState()
    screens.update(s, 0, false, 5)
    const calls = rec.total()
    for (let t = 0.1; t < 20; t += 0.1) expect(screens.update(s, t, false, 5)).toBe(false)
    expect(rec.total()).toBe(calls)
    // and it goes on when the clock does
    expect(screens.update(s, 21, false, 5.6)).toBe(true)
  })

  it('a held breath repaints the monitor within one period of its start and of its end', () => {
    const { env } = mockEnv()
    const screens = createCryoScreens(env)
    const run = anaesState()
    // (a clock that does not move, so only the flag can make a repaint)
    screens.update(run, 0, true, 5)
    expect(screens.update(run, 1, true, 5)).toBe(false)
    const held = anaesState({ apnoea: true })
    expect(screens.update(held, 1.1, true, 5)).toBe(true)
    expect(screens.monitor.held).toBe(true)
    expect(screens.update(held, 1.2, true, 5)).toBe(false)
    expect(screens.update(run, 1.4, true, 5)).toBe(true)
    expect(screens.monitor.held).toBe(false)
  })

  it('when the main gate repaints, the monitor\'s tile goes with it (every tile is clipped once, the live view clips its square too: six clips), and the monitor\'s own gate learns what it shows', () => {
    const { env, rec } = mockEnv()
    const screens = createCryoScreens(env)
    const s = anaesState({ step: 'checkCt' })
    screens.update(s, 0, false, 0)
    expect(rec.count('clip')).toBe(6)
    // the very next monitor tick (a quarter second of display time later) is the monitor's own: one tile, one clip
    expect(screens.update(s, 0.6, false, 0.6)).toBe(true)
    expect(rec.count('clip')).toBe(7)
    s.version++
    expect(screens.update(s, 1.2, false, 0.6)).toBe(true)
    expect(rec.count('clip')).toBe(13)
    // the same display time: the monitor has nothing new
    expect(screens.update(s, 1.8, false, 0.6)).toBe(false)
  })
})
