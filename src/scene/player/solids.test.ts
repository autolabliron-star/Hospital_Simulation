import { describe, expect, it } from 'vitest'
import { getLayout } from '@/scene/building/layout'
import { DESKS, ISLAND } from '@/scene/pharmacy/layout'
import { CONFIG } from '@/sim/config'
import { PHARMACIST_ZONES, SOLIDS } from '@/sim/nav/layout'
import { LEVEL2_STRIP, levelOf, type LevelId } from '@/sim/levels'
import { DOORS, LIFTS, PLAYER_PLAZA, PLAYER_SPAWN, ROOMS } from '@/sim/places'
import { buildWallBoxes } from './boomProbe'
import { boxDistance, staticClearance } from './bodyTestKit'
import { inRegion } from './collision'
import { GROUP, KIND_BOX, KIND_CIRCLE, QUERY_CAPACITY, SOLID_GRID, SOLID_STRIDE, queryStatic, staticSolids } from './solids'

const R = CONFIG.player.bodyRadius + CONFIG.player.bodySkin

/** The distance from a point to solid `i` of the set (0 inside it). */
function distance(i: number, x: number, z: number): number {
  const s = staticSolids()
  const o = i * SOLID_STRIDE
  if (s.data[o] === KIND_CIRCLE) return Math.max(Math.hypot(x - s.data[o + 1], z - s.data[o + 2]) - s.data[o + 5], 0)
  return boxDistance(x, z, s.data[o + 1], s.data[o + 2], s.data[o + 3], s.data[o + 4], s.data[o + 5], s.data[o + 6])
}

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

describe('the static solid set', () => {
  const set = staticSolids()

  it('is built once and cached, with the layout of SOLID_STRIDE numbers a solid', () => {
    expect(staticSolids()).toBe(set)
    expect(set.data.length).toBe(set.count * SOLID_STRIDE)
    expect(set.group.length).toBe(set.count)
    expect(set.ids.length).toBe(set.count)
    expect(new Set(set.ids).size).toBe(set.count) // every id is unique
    for (let i = 0; i < set.count; i++) {
      const o = i * SOLID_STRIDE
      for (let k = 0; k < SOLID_STRIDE; k++) expect(Number.isFinite(set.data[o + k]), `${set.ids[i]}[${k}]`).toBe(true)
      expect([KIND_BOX, KIND_CIRCLE]).toContain(set.data[o])
      expect(Math.hypot(set.data[o + 3], set.data[o + 4]), `${set.ids[i]} axis`).toBeCloseTo(1, 9)
      expect(set.data[o + 5], set.ids[i]).toBeGreaterThan(0)
    }
  })

  it('holds the floor-standing walls only: every wall box that starts at the floor, none of the lintels or hanging signs', () => {
    const boxes = buildWallBoxes()
    const floor = boxes.filter((b) => b.y0 === 0)
    const high = boxes.filter((b) => b.y0 > 0)
    expect(high.length).toBeGreaterThan(20) // the lintels and the signs exist, and are left out
    const walls = set.ids.filter((id) => id.startsWith('wall:'))
    expect(walls.length).toBe(floor.length)
    // a lintel is above a doorway: the middle of every door's opening is free
    for (const d of DOORS) {
      const x = d.center.x
      const z = d.center.z
      expect(staticClearance(x, z).d, `the middle of door ${d.id}`).toBeGreaterThan(0.2)
    }
    // and a wall IS there, off to the side of a door
    expect(staticClearance(-44, -7).d).toBeLessThan(0.15)
  })

  it('holds every nav solid (beds and furniture) in the same rotated-rectangle convention, and ignores the station exemption', () => {
    const rnd = lcg(3)
    const byId = new Map(set.ids.map((id, i) => [id, i]))
    let checked = 0
    for (const s of SOLIDS) {
      const i = byId.get(s.id)
      expect(i, s.id).toBeDefined()
      // the nav's own signed distance (solidSigned in nav/layout.ts): rotate into the footprint's frame
      const ref = (px: number, pz: number): number => {
        const dx = px - s.x
        const dz = pz - s.z
        if (s.kind === 0) return Math.hypot(dx, dz) - s.hw
        const lx = dx * s.cos - dz * s.sin
        const lz = dx * s.sin + dz * s.cos
        const qx = Math.abs(lx) - s.hw
        const qz = Math.abs(lz) - s.hd
        if (qx <= 0 && qz <= 0) return Math.max(qx, qz)
        return Math.hypot(qx > 0 ? qx : 0, qz > 0 ? qz : 0)
      }
      for (let n = 0; n < 6; n++) {
        const px = s.x + (rnd() - 0.5) * 3
        const pz = s.z + (rnd() - 0.5) * 3
        const want = ref(px, pz)
        // outside: the same distance; inside: 0 here
        expect(distance(i!, px, pz), `${s.id} at (${px.toFixed(2)}, ${pz.toFixed(2)})`).toBeCloseTo(Math.max(want, 0), 9)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(1000)
    // the reception desk, which people may stand against (reach 2.0), is a plain solid for you
    expect(staticClearance(-51.52, -3).d).toBe(0)
  })

  it('has the outdoor columns and planters (not the overhead canopy), the pharmacist desks and island, and the fences', () => {
    const outdoor = getLayout().footprints.filter((f) => f.area === 'outside')
    expect(outdoor.filter((f) => f.id.startsWith('entrance:column')).length).toBe(4)
    expect(outdoor.filter((f) => f.id.startsWith('forecourt:planter')).length).toBe(2)
    for (const f of outdoor.filter((q) => !q.overhead)) expect(set.ids.includes(f.id), f.id).toBe(true)
    for (const f of outdoor.filter((q) => q.overhead)) expect(set.ids.includes(f.id), f.id).toBe(false)
    // the columns are radius 0.09 at the corners of the entrance canopy (the drawn cylinders have diameter 0.18)
    for (const id of ['entrance:column0', 'entrance:column1', 'entrance:column2', 'entrance:column3']) {
      const i = set.ids.indexOf(id)
      expect(set.data[i * SOLID_STRIDE]).toBe(KIND_CIRCLE)
      expect(set.data[i * SOLID_STRIDE + 5]).toBeCloseTo(0.09, 9)
    }
    const col = new Set(['-68.25,-4.15', '-68.25,4.15', '-62.35,-4.15', '-62.35,4.15'])
    for (let k = 0; k < 4; k++) {
      const i = set.ids.indexOf(`entrance:column${k}`)
      col.delete(`${set.data[i * SOLID_STRIDE + 1].toFixed(2)},${set.data[i * SOLID_STRIDE + 2].toFixed(2)}`)
    }
    expect(col.size).toBe(0)
    for (const d of DESKS) {
      const i = set.ids.indexOf(`pharmacy:desk${d.ward}`)
      expect(i).toBeGreaterThanOrEqual(0)
      expect(set.data[i * SOLID_STRIDE + 1]).toBeCloseTo(d.centre.x, 9)
      expect(set.data[i * SOLID_STRIDE + 2]).toBeCloseTo(d.centre.z, 9)
    }
    const isl = set.ids.indexOf('pharmacy:island')
    expect(set.data[isl * SOLID_STRIDE + 5]).toBeCloseTo((ISLAND.x1 - ISLAND.x0) / 2 + 0.1, 9)
    // fences: the plaza (3 sides), each pharmacist zone (3 sides), the ambulance doorstep
    const fences = set.ids.filter((id) => id.startsWith('fence:'))
    expect(fences.filter((id) => id.startsWith('fence:plaza')).length).toBe(3)
    expect(fences.filter((id) => id.startsWith('fence:pharmacist')).length).toBe(3 * PHARMACIST_ZONES.length)
    expect(fences).toContain('fence:ambulance')
    for (const id of fences) expect(set.group[set.ids.indexOf(id)]).toBe(GROUP.wall)
  })

  it('the grid returns every solid near a box, each once, and never overflows its capacity for a whole room', () => {
    const out = new Int32Array(QUERY_CAPACITY)
    for (let i = 0; i < set.count; i++) {
      const o = i * SOLID_STRIDE
      const x = set.data[o + 1]
      const z = set.data[o + 2]
      const n = queryStatic(x - 0.01, x + 0.01, z - 0.01, z + 0.01, out)
      let found = false
      const seen = new Set<number>()
      for (let k = 0; k < n; k++) {
        expect(seen.has(out[k]), `${set.ids[i]}: duplicate`).toBe(false)
        seen.add(out[k])
        if (out[k] === i) found = true
      }
      expect(found, `${set.ids[i]} is in its own cell`).toBe(true)
    }
    // a query over the whole lobby (18 x 12 m) fits
    const lobby = queryStatic(-62, -44, -6, 6, out)
    expect(lobby).toBeGreaterThan(5)
    expect(lobby).toBeLessThan(QUERY_CAPACITY)
    // outside the grid is clamped, not an error
    expect(() => queryStatic(-500, -490, -500, -490, out)).not.toThrow()
    expect(SOLID_GRID.cols * SOLID_GRID.cell).toBeGreaterThanOrEqual(132)
  })

  it('the cell index finds every solid within the reach of a sweep from any point (what a sweep needs)', () => {
    const rnd = lcg(9)
    const out = new Int32Array(QUERY_CAPACITY)
    for (let n = 0; n < 300; n++) {
      const x = PLAYER_PLAZA.x0 + rnd() * 110
      const z = -22 + rnd() * 44
      const reach = 0.4
      const got = new Set<number>()
      const c = queryStatic(x - reach, x + reach, z - reach, z + reach, out)
      for (let k = 0; k < c; k++) got.add(out[k])
      for (let i = 0; i < set.count; i++) if (distance(i, x, z) < reach - 1e-9) expect(got.has(i), `${set.ids[i]} near (${x.toFixed(2)}, ${z.toFixed(2)})`).toBe(true)
    }
  })
})

describe('the solids and the people\'s region agree about where you may be (no leaks, no false walls)', () => {
  // flood fill over the floor at 10 cm from where you arrive, for a body of radius r + skin: a cell is free when no solid is within the body's reach.
  // R2: per level. The levels are separate strips of the sim: level 1 floods from the spawn (the plaza), level 2 from its lift lobby (as you arrive by lift).
  const step = 0.1
  const z0 = -26
  const z1 = 26
  const LEVELS: { level: LevelId; x0: number; x1: number; start: { x: number; z: number }; cells: number }[] = [
    { level: 1, x0: PLAYER_PLAZA.x0 - 4, x1: 44, start: PLAYER_SPAWN.at, cells: 100000 },
    { level: 2, x0: LEVEL2_STRIP.x0 - 4, x1: LEVEL2_STRIP.x1 + 4, start: LIFTS.A[2].stretcher.at, cells: 40000 },
  ]

  for (const L of LEVELS) {
    const { x0, x1 } = L
    const W = Math.round((x1 - x0) / step) + 1
    const H = Math.round((z1 - z0) / step) + 1
    const free = new Uint8Array(W * H)
    const reach = new Uint8Array(W * H)
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) free[j * W + i] = staticClearance(x0 + i * step, z0 + j * step).d >= R - 1e-9 ? 1 : 0
    const sx = Math.round((L.start.x - x0) / step)
    const sz = Math.round((L.start.z - z0) / step)
    const queue: number[] = [sz * W + sx]
    reach[sz * W + sx] = 1
    while (queue.length) {
      const c = queue.pop()!
      const ci = c % W
      const cj = (c / W) | 0
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue
          const ni = ci + di
          const nj = cj + dj
          if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue
          const n = nj * W + ni
          if (reach[n] || !free[n]) continue
          reach[n] = 1
          queue.push(n)
        }
      }
    }
    const reachable = (x: number, z: number, within = 0.15): boolean => {
      for (let dj = -2; dj <= 2; dj++) {
        for (let di = -2; di <= 2; di++) {
          const i = Math.round((x - x0) / step) + di
          const j = Math.round((z - z0) / step) + dj
          if (i < 0 || j < 0 || i >= W || j >= H) continue
          if (reach[j * W + i] && Math.hypot(x0 + i * step - x, z0 + j * step - z) <= within + step) return true
        }
      }
      return false
    }

    it(`level ${L.level}: everywhere the solids let you reach is inside the region backstop (the fences and walls seal everything the people's floor does not include)`, () => {
      let cells = 0
      const leaks: string[] = []
      for (let j = 0; j < H; j++) {
        for (let i = 0; i < W; i++) {
          if (!reach[j * W + i]) continue
          cells++
          const x = x0 + i * step
          const z = z0 + j * step
          if (!inRegion(x, z)) leaks.push(`(${x.toFixed(2)}, ${z.toFixed(2)})`)
        }
      }
      expect(cells).toBeGreaterThan(L.cells)
      expect(leaks.slice(0, 5)).toEqual([])
    })

    it(`level ${L.level}: every doorway of the building (but the ambulance door's bay) can be reached from ${L.level === 1 ? 'the spawn' : 'the lift lobby'}${L.level === 1 ? ', as can every bedside' : ''}`, () => {
      const unreachable: string[] = []
      let doors = 0
      for (const d of DOORS) {
        if (d.id === 'ambulance' || levelOf(d.center.x) !== L.level) continue
        doors++
        if (!reachable(d.center.x, d.center.z)) unreachable.push(`door ${d.id}`)
      }
      expect(doors).toBe(L.level === 1 ? DOORS.filter((d) => d.id !== 'ambulance' && levelOf(d.center.x) === 1).length : 12)
      if (L.level === 1) {
        for (const r of ROOMS) {
          // the bedside is where a person stands: for you, the nearest place you can
          let best = false
          for (let a = 0; a < 360 && !best; a += 30) for (const rad of [0, 0.15, 0.3, 0.45]) if (reachable(r.bedside.x + Math.sin(a) * rad, r.bedside.z + Math.cos(a) * rad, 0)) best = true
          if (!best) unreachable.push(`bedside ${r.id}`)
        }
      }
      expect(unreachable).toEqual([])
    })
  }
})
