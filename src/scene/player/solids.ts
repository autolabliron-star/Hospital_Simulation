/**
 * Everything your body cannot walk through that never moves, as ONE flat set, built once (lazily, cached) and indexed by a uniform
 * grid, so `collision.ts` asks a single question of one structure: "which solids are near this swept circle?".
 *
 * What is in it (all of it floor standing, so a body of radius 0.3 m meets it):
 *   - the walls, the core's walls and the MedDrawer cabinets: `buildWallBoxes()` with `y0 === 0` (the lintels start at 2.3 m and the
 *     hanging signs at 2.18 m: you walk under them);
 *   - every solid of the people's nav (`SOLIDS` in `sim/nav/layout.ts`: the beds and every furniture footprint) with the same rotated
 *     rectangle convention, but WITHOUT the station exemption (people may stand against their own desk; you may not);
 *   - the outdoor, non-overhead footprints (the canopy columns and the forecourt planters, which the nav leaves out);
 *   - the pharmacist desks and the MedVend island (`pharmacy/layout.ts`);
 *   - fences, 0.1 m thick boxes just outside the edge of the floor you may stand on where the nav and the plaza have no wall: the
 *     plaza's west, north and south sides, and the three inner sides of each pharmacist zone. So the exact solids and the region
 *     test (`isWalkable` / `inPlaza`, kept as a backstop) agree about where you may be.
 *
 * Layout of the data: `SOLID_STRIDE` numbers a solid, in `data`: kind (0 box, 1 circle), cx, cz, ux, uz, hu, hv. A box has the unit
 * axis u = (ux, uz) on the floor and half extents hu along u and hv along v = (-uz, ux), the layout of a blocker. A circle has its
 * radius in hu. `group[i]` says what it is (`GROUP`), for the placement rule that only respects walls.
 *
 * The grid is 1 m cells over x -80..52, z -36..36, each cell listing the solids whose bounds touch it (CSR arrays). A query takes the
 * bounds of a swept circle and fills a preallocated index array; nothing is allocated.
 */
import { buildWallBoxes } from './boomProbe'
import { DESKS, ISLAND } from '@/scene/pharmacy/layout'
import { getLayout } from '@/scene/building/layout'
import { PHARMACIST_ZONES, SOLIDS } from '@/sim/nav/layout'
import { DOORS, PLAYER_PLAZA, WALL, wardSign } from '@/sim/places'

export const SOLID_STRIDE = 7
export const KIND_BOX = 0
export const KIND_CIRCLE = 1

/** What a solid is: walls and fences (the building's shell and the edge of the floor), or furniture and the like. */
export const GROUP = { wall: 0, furniture: 1 } as const

export interface SolidSet {
  count: number
  /** SOLID_STRIDE numbers each: kind, cx, cz, ux, uz, hu, hv. */
  data: Float64Array
  /** `GROUP` of each. */
  group: Uint8Array
  /** For tests and failure messages. */
  ids: string[]
  /** Grid: cell c lists `items[start[c] .. start[c + 1])`. */
  start: Int32Array
  items: Int32Array
}

export const SOLID_GRID = { x0: -80, z0: -36, cell: 1, cols: 132, rows: 72 } as const

const FENCE = 0.1

interface Builder {
  data: number[]
  group: number[]
  ids: string[]
}

function addBox(b: Builder, id: string, group: number, cx: number, cz: number, ux: number, uz: number, hu: number, hv: number): void {
  b.data.push(KIND_BOX, cx, cz, ux, uz, hu, hv)
  b.group.push(group)
  b.ids.push(id)
}

function addCircle(b: Builder, id: string, group: number, cx: number, cz: number, r: number): void {
  b.data.push(KIND_CIRCLE, cx, cz, 1, 0, r, r)
  b.group.push(group)
  b.ids.push(id)
}

/** An axis-aligned box from its bounds. */
function addRect(b: Builder, id: string, group: number, x0: number, x1: number, z0: number, z1: number): void {
  addBox(b, id, group, (x0 + x1) / 2, (z0 + z1) / 2, 1, 0, (x1 - x0) / 2, (z1 - z0) / 2)
}

function build(): SolidSet {
  const b: Builder = { data: [], group: [], ids: [] }

  // walls, the core's walls, the drawer cabinets
  buildWallBoxes().forEach((w, i) => {
    if (w.y0 !== 0 || w.sign) return // (the lintels start at 2.3 m, the hanging signs at 2.18 m: you walk under them)
    addRect(b, `wall:${i}`, GROUP.wall, w.x0, w.x1, w.z0, w.z1)
  })

  // the people's solids, the same rotated rectangle convention as `solidSigned` (nav/layout.ts), station exemptions ignored
  for (const s of SOLIDS) {
    if (s.kind === 0) addCircle(b, s.id, GROUP.furniture, s.x, s.z, s.hw)
    else addBox(b, s.id, GROUP.furniture, s.x, s.z, s.cos, -s.sin, s.hw, s.hd)
  }

  // outdoors: columns and planters
  for (const f of getLayout().footprints) {
    if (f.area !== 'outside' || f.overhead) continue
    if (f.kind === 'circle') addCircle(b, f.id, GROUP.furniture, f.x, f.z, f.hw)
    else addBox(b, f.id, GROUP.furniture, f.x, f.z, Math.cos(f.rotationY), -Math.sin(f.rotationY), f.hw, f.hd)
  }

  // the pharmacist desks and the MedVend island
  for (const d of DESKS) addRect(b, `pharmacy:desk${d.ward}`, GROUP.furniture, d.rect.x0, d.rect.x1, d.rect.z0, d.rect.z1)
  addRect(b, 'pharmacy:island', GROUP.furniture, ISLAND.x0 - 0.1, ISLAND.x1 + 0.1, ISLAND.z0 - 0.1, ISLAND.z1 + 0.1)

  // fences: the plaza's west, north and south edges (the east edge is the façade)
  const p = PLAYER_PLAZA
  const half = WALL.thickness / 2
  const east = p.x1 - half + 0.05
  addRect(b, 'fence:plaza:west', GROUP.wall, p.x0 - FENCE, p.x0, p.z0 - FENCE, p.z1 + FENCE)
  addRect(b, 'fence:plaza:north', GROUP.wall, p.x0 - FENCE, east, p.z0 - FENCE, p.z0)
  addRect(b, 'fence:plaza:south', GROUP.wall, p.x0 - FENCE, east, p.z1, p.z1 + FENCE)

  // fences: the ambulance door opens onto the bay outside, which is no floor of yours: stop at the doorstep, a body radius short of
  // the outer edge of the door's bridge (BRIDGE_HALF_DEPTH, nav/layout.ts)
  const amb = DOORS.find((d) => d.id === 'ambulance')
  if (amb) {
    const step = amb.center.x - (half + 0.3) - 0.3
    addRect(b, 'fence:ambulance', GROUP.wall, step - FENCE, step, amb.center.z - amb.width / 2 - 0.2, amb.center.z + amb.width / 2 + 0.2)
  }

  // fences: the three inner sides of each pharmacist zone (the fourth is the corridor wall with its door)
  for (const zone of PHARMACIST_ZONES) {
    const r = zone.rect
    const north = wardSign(zone.ward) < 0 // ward A's zone is north: its island side is its +z edge
    const inner = north ? r.z1 : r.z0
    const id = `fence:pharmacist${zone.ward}`
    addRect(b, `${id}:west`, GROUP.wall, r.x0 - FENCE, r.x0, r.z0, r.z1)
    addRect(b, `${id}:east`, GROUP.wall, r.x1, r.x1 + FENCE, r.z0, r.z1)
    if (north) addRect(b, `${id}:island`, GROUP.wall, r.x0 - FENCE, r.x1 + FENCE, inner, inner + FENCE)
    else addRect(b, `${id}:island`, GROUP.wall, r.x0 - FENCE, r.x1 + FENCE, inner - FENCE, inner)
  }

  const count = b.ids.length
  const data = Float64Array.from(b.data)
  const group = Uint8Array.from(b.group)

  // the grid
  const G = SOLID_GRID
  const cells = G.cols * G.rows
  const cellX = (x: number): number => Math.min(G.cols - 1, Math.max(0, Math.floor((x - G.x0) / G.cell)))
  const cellZ = (z: number): number => Math.min(G.rows - 1, Math.max(0, Math.floor((z - G.z0) / G.cell)))
  const span = (i: number, out: number[]): void => {
    const o = i * SOLID_STRIDE
    const ux = data[o + 3]
    const uz = data[o + 4]
    const hu = data[o + 5]
    const hv = data[o + 6]
    const circle = data[o] === KIND_CIRCLE
    const ex = circle ? hu : Math.abs(ux) * hu + Math.abs(uz) * hv
    const ez = circle ? hu : Math.abs(uz) * hu + Math.abs(ux) * hv
    out[0] = cellX(data[o + 1] - ex)
    out[1] = cellX(data[o + 1] + ex)
    out[2] = cellZ(data[o + 2] - ez)
    out[3] = cellZ(data[o + 2] + ez)
  }
  const sp = [0, 0, 0, 0]
  const start = new Int32Array(cells + 1)
  for (let i = 0; i < count; i++) {
    span(i, sp)
    for (let cz = sp[2]; cz <= sp[3]; cz++) for (let cx = sp[0]; cx <= sp[1]; cx++) start[cz * G.cols + cx + 1]++
  }
  for (let c = 0; c < cells; c++) start[c + 1] += start[c]
  const items = new Int32Array(start[cells])
  const fill = start.slice(0, cells)
  for (let i = 0; i < count; i++) {
    span(i, sp)
    for (let cz = sp[2]; cz <= sp[3]; cz++) for (let cx = sp[0]; cx <= sp[1]; cx++) items[fill[cz * G.cols + cx]++] = i
  }
  return { count, data, group, ids: b.ids, start, items }
}

let cached: SolidSet | null = null
let seen = new Int32Array(0)
let stamp = 0

/** The static solids, built on first use. */
export function staticSolids(): SolidSet {
  if (!cached) {
    cached = build()
    seen = new Int32Array(cached.count)
  }
  return cached
}

/** Capacity of the index array `queryStatic` fills. */
export const QUERY_CAPACITY = 512

/**
 * The indices of the static solids whose grid cells touch the box [x0, x1] x [z0, z1], each once, written into `out` (at most
 * QUERY_CAPACITY of them). Returns how many. The caller grows the box by whatever radius it sweeps.
 */
export function queryStatic(x0: number, x1: number, z0: number, z1: number, out: Int32Array): number {
  const s = staticSolids()
  const G = SOLID_GRID
  const cx0 = Math.min(G.cols - 1, Math.max(0, Math.floor((x0 - G.x0) / G.cell)))
  const cx1 = Math.min(G.cols - 1, Math.max(0, Math.floor((x1 - G.x0) / G.cell)))
  const cz0 = Math.min(G.rows - 1, Math.max(0, Math.floor((z0 - G.z0) / G.cell)))
  const cz1 = Math.min(G.rows - 1, Math.max(0, Math.floor((z1 - G.z0) / G.cell)))
  stamp++
  let n = 0
  for (let cz = cz0; cz <= cz1; cz++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const c = cz * G.cols + cx
      for (let k = s.start[c]; k < s.start[c + 1]; k++) {
        const i = s.items[k]
        if (seen[i] === stamp) continue
        seen[i] = stamp
        if (n < QUERY_CAPACITY) out[n++] = i
      }
    }
  }
  return n
}
