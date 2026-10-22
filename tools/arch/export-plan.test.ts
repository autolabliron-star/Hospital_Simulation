/** Wave 3: the plan Blender builds the hospital from is the sim's own floor plan, complete and in the drawn frame. */
import { describe, expect, it } from 'vitest'
import { AREAS, DOORS } from '../../src/sim/places'
import { LEVEL2_FOOTPRINT } from '../../src/sim/levels'
import { buildWallPieces } from '../../src/scene/building/layout/walls'
import { buildLayout } from '../../src/scene/building/layout'
import { exportPlan } from './export-plan'

const inside = (x: number, z: number, r: { x0: number; x1: number; z0: number; z1: number }) => x >= r.x0 - 1e-6 && x <= r.x1 + 1e-6 && z >= r.z0 - 1e-6 && z <= r.z1 + 1e-6

describe('the floor plan for the architectural model', () => {
  const plan = exportPlan()

  it('carries every area, door and wall piece of the sim', () => {
    expect(plan.areas.length).toBe(AREAS.length)
    expect(plan.doors.length).toBe(DOORS.length)
    expect(plan.walls.length).toBe(buildWallPieces().length)
  })

  it('draws level 2 back over the west block: every level-2 door and wall is inside its footprint as drawn', () => {
    for (const d of plan.doors.filter((d) => d.level === 2)) expect(inside(d.x, d.z, LEVEL2_FOOTPRINT), d.id).toBe(true)
    for (const w of plan.walls.filter((w) => w.level === 2)) {
      const [x0, z0, x1, z1] = w.alongX ? [w.a, w.c, w.b, w.c] : [w.c, w.a, w.c, w.b]
      expect(inside(x0, z0, LEVEL2_FOOTPRINT) && inside(x1, z1, LEVEL2_FOOTPRINT)).toBe(true)
    }
    expect(plan.levels.map((l) => l.y)).toEqual([0, 4.2])
  })

  it('is deterministic', () => {
    expect(JSON.stringify(exportPlan())).toBe(JSON.stringify(plan))
  })

  it('carries the lobby furniture anchors: every waiting seat, the reception station and the seat rows, exactly as the layout has them', () => {
    const f = plan.furniture
    const layout = buildLayout()
    const lobbySeats = layout.seats.filter((s) => s.area === 'lobby' && s.kind === 'waiting')
    expect(lobbySeats.length).toBe(14)
    for (const s of lobbySeats) {
      const e = f.seats.find((x) => x.id === s.id)
      expect(e, s.id).toBeDefined()
      expect(Math.abs((e?.x ?? 0) - s.x)).toBeLessThan(0.001)
      expect(Math.abs((e?.z ?? 0) - s.z)).toBeLessThan(0.001)
      expect(e?.height).toBe(s.height)
    }
    for (const id of ['lobby:seatsN1', 'lobby:seatsN2', 'lobby:seatsS1', 'lobby:seatsS2', 'lobby:plantNW', 'lobby:plantSW', 'lobby:sideTable', 'lobby:reception'])
      expect(f.footprints.some((p) => p.id === id), id).toBe(true)
    const rec = f.stations.find((s) => s.id === 'lobby:reception')
    expect(rec?.nodes).toEqual(['lobby:reception'])
    expect(rec?.x).toBeCloseTo(-51.52, 3)
    // everything listed is inside the pilot region
    for (const p of [...f.seats, ...f.footprints]) expect(inside(p.x, p.z, f.region), 'id' in p ? p.id : '').toBe(true)
  })
})
