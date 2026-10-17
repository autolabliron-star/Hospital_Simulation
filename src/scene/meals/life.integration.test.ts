// The L1 rigs read the REAL `sim.life` of a running Simulation (not just the fake views of rigs.test.ts): the shape the orchestrator
// built fits, a ward of inpatients draws the default occupied look with their synthetic names, and nothing throws while the sim runs.
import { Texture, type CanvasTexture } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { PATIENTS } from '@/content/catalogue'
import type { BedsideInfo } from '@/scene/building/render/screens'
import { Simulation } from '@/sim/Simulation'
import { ROOMS } from '@/sim/places'
import { createMealBotsRig } from './botsRig'
import { lifeOf } from './life'
import { createTraysRig } from './traysRig'
import type { BedsideAtlas } from './ward/bedsideAtlas'
import { DOOR_COLORS } from './ward/doorStyle'
import { createWardRig } from './ward/wardRig'

describe('the L1 rigs on a real simulation', () => {
  it('reads sim.life defensively: a view without `life` is the default look', () => {
    expect(lifeOf({})).toBeNull()
    expect(lifeOf(null)).toBeNull()
    const sim = new Simulation(7, { population: false })
    expect(lifeOf(sim)).toBe(sim.life)
  })

  it('draws the 16 inpatients\' rooms from the real view, and keeps up while the sim runs', () => {
    const sim = new Simulation(7, { population: false })
    const draw = vi.fn<(i: number, info: BedsideInfo | null) => void>()
    const atlas: BedsideAtlas = { texture: new Texture() as unknown as CanvasTexture, draw }
    const ward = createWardRig(atlas)
    const bots = createMealBotsRig()
    const trays = createTraysRig()
    const life = lifeOf(sim)
    expect(life).not.toBeNull()
    for (let k = 0; k < 10 * 60; k++) {
      sim.step(1 / 60)
      sim.sync(0.5)
      const now = k / 60
      ward.step({ life, generation: 0, simDt: 1 / 60, now })
      bots.step(life, 1 / 60, now)
      trays.step(life, 1 / 60)
    }
    // every room painted with its inpatient's name and day of stay (from the content), the way the content says
    expect(draw.mock.calls.length).toBeGreaterThanOrEqual(ROOMS.length)
    for (const p of PATIENTS) {
      const i = ROOMS.findIndex((r) => r.id === p.roomId)
      const call = draw.mock.calls.find((c) => c[0] === i)!
      expect(call[1]).toMatchObject({ roomId: p.roomId, bed: 'occupied', name: p.name, day: p.dayOfStay })
    }
    // the door tiles are white (occupied), the beds flat
    for (let i = 0; i < ROOMS.length; i++) {
      expect(ward.tiles.instanceColor!.getX(i)).toBeCloseTo(DOOR_COLORS[0].r, 5)
      expect(ward.shown[i]).toBe(0)
    }
    ward.dispose()
    bots.dispose()
    trays.dispose()
  }, 60000)
})
