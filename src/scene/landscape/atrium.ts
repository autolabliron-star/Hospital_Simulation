/**
 * The healing atrium: raised grass beds, stone walks linking both corridor openings and the café, an oak café deck with a
 * counter at ATRIUM.cafe and tables along the east glass, benches, low planting, a long reflecting pool along the pharmacy
 * glass and six low-poly trees (instanced by the renderer; the trees are not prims, so while the atrium zone's model is drawn they are
 * hidden by the zone's `area:atrium` key instead: building/model/region.ts `cellOfTree`, compile.ts, cells.ts).
 *
 * The atrium's nav lattice crosses the hall in every direction, so everything solid sits in the pockets between routes:
 * the perimeter bands, a few mid-hall pockets and the café counter (a station: `serves` the café node). Beds, paths and the
 * deck are ground finishes people walk across.
 */
import { ATRIUM, DOORS } from '@/sim/places'
import type { Frame, LayoutBuilder } from '@/scene/building/layout/builder'
import { TILE } from '@/scene/building/layout/screenTiles'

const BED_H = 0.07

function bed(f: Frame, x0: number, x1: number, z0: number, z1: number): void {
  f.rbox((x0 + x1) / 2, -0.01, (z0 + z1) / 2, x1 - x0, BED_H + 0.01, z1 - z0, 'grass', { r: 0.03, cast: false })
}

function walks(f: Frame): void {
  const door = DOORS.find((d) => d.id === 'atriumA')!
  const x = door.center.x
  // main walk from both openings to the café deck, and a garden walk west to the pool
  f.plane(x, 0.004, -7.2, 2.4, 9.6, 'stonePath')
  f.plane(x, 0.004, 10.5, 2.4, 3.0, 'stonePath')
  f.plane(23.5, 0.004, 0, 20, 2.0, 'stonePath')
  // stepping stones across the beds toward the benches
  for (const [sx, sz] of [
    [20, -4.7],
    [25, -4.7],
    [20, 4.7],
    [25, 4.7],
  ] as const)
    f.cyl(sx, 0, sz, 0.8, 0.02, 'stonePath', { cast: false })
}

function beds(f: Frame): void {
  bed(f, 14.4, 32.4, -11.5, -1.3)
  bed(f, 14.4, 32.4, 1.3, 11.5)
  bed(f, 35.4, 39.6, -11.5, -3.2)
  bed(f, 35.4, 39.6, 9.2, 11.5)
}

/** A long shallow reflecting pool with a stone rim, along the pharmacy glass (west wall). */
function pool(f: Frame): void {
  const x = 13.1
  const len = 17.4
  const w = 1.5
  f.rbox(x, 0, 0, w + 0.3, 0.2, len + 0.3, 'stonePath', { r: 0.05 })
  f.rbox(x, 0.2, 0, w, 0.01, len, 'fabricTeal', { r: 0.02, cast: false })
  f.box(x, 0.205, 0, w - 0.1, 0.03, len - 0.1, 'glass', { cast: false })
  for (let i = 0; i < 5; i++) f.cyl(x, 0.2, -6.5 + i * 3.25, 0.1, 0.35, 'whitePlastic', { cast: false }) // small jets
  for (let i = 0; i < 5; i++) f.sphere(x, 0.52, -6.5 + i * 3.25, 0.16, 0.16, 0.16, 'glowTeal', { cast: false })
  f.rect('atrium:pool', x, 0, w + 0.3, len + 0.3)
}

function bench(f: Frame, id: string, x: number, z: number, heading: number, len = 1.7): void {
  const c = f.sub(x, z, heading)
  // two seats on the planks (top 0.46 m), facing the way the bench faces
  for (let k = 0; k < 2; k++) c.seat(`bench:atrium:${id.replace('atrium:bench', '')}:${k}`, 'bench', (k - 0.5) * (len / 2), 0, 0.46)
  for (const s of [-1, 1]) c.rbox(s * (len / 2 - 0.1), 0, 0, 0.06, 0.42, 0.4, 'metalDark', { r: 0.01 })
  for (let i = 0; i < 4; i++) c.rbox(0, 0.42, -0.15 + i * 0.1, len, 0.04, 0.08, 'woodOak', { r: 0.012 })
  c.rbox(0, 0.62, -0.2, len, 0.28, 0.04, 'woodOak', { r: 0.015, rx: 0.12 })
  f.rect(id, x, z, len, 0.5)
}

function bushes(f: Frame): void {
  const spots: [number, number][] = [
    [18.2, -11.3],
    [20.1, -11.3],
    [22.0, -11.3],
    [24.8, -11.3],
    [18.2, 11.3],
    [20.1, 11.3],
    [22.0, 11.3],
    [24.8, 11.3],
    [27.0, -11.2],
    [27.0, 11.2],
  ]
  const colors = ['#f2b3c4', '#f7d56a', '#ffffff', '#f2b3c4', '#f7d56a']
  spots.forEach(([x, z], i) => {
    f.sphere(x, 0.05, z, 0.8, 0.6, 0.8, i % 2 ? 'leafDark' : 'leaf')
    f.sphere(x + 0.15, 0.55, z - 0.05, 0.16, 0.14, 0.16, 'tinted', { color: colors[i % colors.length], cast: false })
    f.sphere(x - 0.18, 0.5, z + 0.1, 0.14, 0.12, 0.14, 'tinted', { color: colors[(i + 2) % colors.length], cast: false })
    f.circle(`atrium:bush${i}`, x, z, 0.4)
  })
}

function cafe(f: Frame): void {
  const at = ATRIUM.cafe.at
  // oak deck under the café (x 32.4..39.9, z -2.4..9.0)
  f.rbox(36.15, 0, 3.3, 7.5, 0.1, 11.4, 'floorOak', { r: 0.03 })
  // counter in front of the barista (east of the node). Café frame: local +z = east, local +x = north-to-south reversed
  const c = f.sub(at.x, at.z, ATRIUM.cafe.heading)
  c.rbox(0, 0.1, 0.9, 3.6, 1.0, 0.65, 'whitePlastic', { r: 0.05 })
  c.rbox(0, 1.1, 0.9, 3.8, 0.05, 0.8, 'woodOak', { r: 0.02 })
  c.box(0, 0.4, 1.235, 3.0, 0.5, 0.012, 'wallMint', { cast: false })
  c.rbox(0.6, 1.15, 0.8, 0.5, 0.4, 0.5, 'metalDark', { r: 0.04 }) // espresso machine
  c.sphere(0.6, 1.55, 0.8, 0.12, 0.1, 0.12, 'glowWarm', { cast: false })
  c.rbox(-0.5, 1.15, 0.85, 0.3, 0.28, 0.3, 'whitePlastic', { r: 0.04 }) // cake dome base
  c.cyl(-0.5, 1.43, 0.85, 0.28, 0.14, 'glass', { cast: false })
  // back bar behind the barista and a menu board on two posts
  c.rbox(0, 0.1, -1.1, 3.6, 1.0, 0.5, 'whitePlastic', { r: 0.04 })
  c.rbox(0, 1.1, -1.1, 3.66, 0.04, 0.56, 'woodOak', { r: 0.02 })
  for (const s of [-1, 1]) c.cyl(s * 0.85, 1.14, -1.3, 0.05, 0.7, 'metalDark', { cast: false })
  c.display(0, 1.85, -1.3, 1.5, 0.62, TILE.menu, { ry: 0, lean: 0, t: 0.04 })
  c.rect('atrium:counter', 0, 0.9, 3.8, 0.8, { serves: { nodes: ['atrium:cafe'], reach: 2.4 } })
  c.rect('atrium:backbar', 0, -1.1, 3.66, 0.56, { serves: { nodes: ['atrium:cafe'], reach: 2.4 } })
  // warm pendants above the counter
  for (let i = 0; i < 4; i++) c.sphere(-1.5 + i * 1.0, 2.3, 0.9, 0.2, 0.2, 0.2, 'glowWarm', { cast: false })
  // bistro tables along the east glass (free band), two chairs each
  ;[-1.6, 1.4, 4.4, 7.4].forEach((z, i) => {
    const x = 38.95
    f.cyl(x, 0.1, z, 0.06, 0.7, 'metalDark')
    f.cyl(x, 0.8, z, 0.7, 0.04, 'whitePlastic')
    f.circle(`atrium:table${i}`, x, z, 0.36)
    for (const s of [-1, 1]) {
      const cz = z + s * 0.62
      const ch = f.sub(x, cz, z - cz > 0 ? 0 : Math.PI)
      ch.cyl(0, 0.1, 0, 0.36, 0.03, 'metalDark')
      ch.cyl(0, 0.13, 0, 0.04, 0.4, 'metalDark', { cast: false })
      ch.rbox(0, 0.52, 0, 0.4, 0.05, 0.4, 'fabricTeal', { r: 0.025 })
      ch.rbox(0, 0.56, -0.18, 0.38, 0.28, 0.04, 'fabricTeal', { r: 0.02 })
      f.circle(`atrium:chair${i}${s < 0 ? 'a' : 'b'}`, x, cz, 0.24)
      f.seat(`cafe:T${i}:${s < 0 ? 'a' : 'b'}`, 'cafe', x, cz, 0.57, { ry: z - cz > 0 ? 0 : Math.PI })
    }
  })
}

export function buildAtrium(b: LayoutBuilder): void {
  b.area = 'atrium'
  const f = b.world
  walks(f)
  beds(f)
  pool(f)
  cafe(f)
  bushes(f)
  bench(f, 'atrium:benchN0', 18.4, -10.4, 0)
  bench(f, 'atrium:benchN1', 22.4, -10.4, 0)
  bench(f, 'atrium:benchS0', 18.4, 10.4, Math.PI)
  bench(f, 'atrium:benchS1', 22.4, 10.4, Math.PI)
  // six trees in the pockets of the lattice
  const trees: [number, number, number, string, number][] = [
    [23.2, -7.7, 4.8, '#9fcf94', 0.1],
    [28.8, -7.7, 4.4, '#b3dc9a', 0.4],
    [15.9, -10.4, 4.2, '#a9d59b', 0.7],
    [38.2, -10.3, 4.6, '#9fcf94', 0.2],
    [23.2, 7.7, 4.0, '#b3dc9a', 0.55],
    [38.2, 10.3, 4.0, '#a9d59b', 0.85],
  ]
  trees.forEach(([x, z, height, tint, seed], i) => {
    b.trees.push({ x, z, height, tint, seed })
    f.circle(`atrium:tree${i}`, x, z, 0.22)
  })
}
