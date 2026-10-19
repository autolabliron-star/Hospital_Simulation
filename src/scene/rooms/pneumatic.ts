/**
 * W4: the overhead pneumatic tube. A clear trunk (OD 0.063) under the ceiling at y 2.85 along the draw room's south wall, through that wall
 * at x -27.8, a short jog into corridor B, west along the corridor's north wall and across the corridor at x -29.9 (0.72 m and more from the
 * ward-B pod rail's U-turn), through the lab's north wall into the receive station's hood. Each robot (and the manual send station) joins it
 * with a riser. Collars where it passes the two walls, elbows at the corners, clamps and hangers about every 1.2 m, thin rings every half metre
 * so the clear pipe reads. Pure prims on the building's existing materials: 0 extra draw calls. The path itself is the contract's
 * (`PNEUMATIC.trunk`, `PNEUMATIC.sources`, src/sim/pneumaticPath.ts): the flying tube (src/scene/lab) is drawn on the very same points.
 *
 * `cyl()` takes the BOTTOM of a vertical cylinder as its y; a horizontal pipe is a cylinder turned a quarter about x or z, whose centre is the
 * pipe's axis, so its bottom is `axis - length / 2`.
 */
import { PNEUMATIC, WALL } from '@/sim/places'
import type { Vec3 } from '@/sim/types'
import type { Frame, LayoutBuilder } from '../building/layout/builder'

export interface PipeRun {
  a: Vec3
  b: Vec3
  kind: 'trunk' | 'riser' | 'drop'
}

/** The straight runs of the whole line: the trunk's legs (the last one is the drop into the receive hood) and the four risers. */
export function pneumaticRuns(): PipeRun[] {
  const t = PNEUMATIC.trunk
  const out: PipeRun[] = []
  for (let i = 0; i + 1 < t.length; i++) out.push({ a: t[i], b: t[i + 1], kind: i + 2 === t.length ? 'drop' : 'trunk' })
  for (const s of PNEUMATIC.sources) out.push({ a: s, b: { x: s.x, y: PNEUMATIC.y, z: t[0].z }, kind: 'riser' })
  return out
}

/** The corners of the trunk, where an elbow sits (every interior point of the polyline, plus its two ends). */
export function pneumaticElbows(): Vec3[] {
  const t = PNEUMATIC.trunk
  return [t[0], ...t.slice(1, -1)]
}

/** The two wall crossings: the wall's two faces and the pipe's x there. */
export const WALL_CROSSINGS: readonly { id: string; x: number; wallZ: number }[] = [
  { id: 'drawSouth', x: -27.8, wallZ: 12 },
  { id: 'labNorth', x: -29.9, wallZ: 16 },
]

export const PIPE = { od: PNEUMATIC.outerDiameter, clampDia: 0.086, clampLen: 0.04, ringDia: 0.072, ringLen: 0.014, ringEvery: 0.5, clampEvery: 1.2, elbowDia: 0.078, collarDia: 0.13, collarLen: 0.04 } as const

const len3 = (r: PipeRun): number => Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y, r.b.z - r.a.z)

/** Positions along a horizontal trunk leg for clamps (every 1.2 m from 0.6 m in) and rings (every 0.5 m from 0.25 m in). */
export function marksAlong(length: number, every: number, first: number, keepOff: number): number[] {
  const out: number[] = []
  for (let d = first; d < length - keepOff + 1e-9; d += every) if (d > keepOff - 1e-9) out.push(d)
  return out
}

function axisOf(r: PipeRun): 'x' | 'y' | 'z' {
  if (Math.abs(r.b.x - r.a.x) > 1e-9) return 'x'
  if (Math.abs(r.b.y - r.a.y) > 1e-9) return 'y'
  return 'z'
}

/** A short cylinder of length `len` centred at (x, y, z) with its axis along `axis`. */
function barrel(f: Frame, x: number, y: number, z: number, axis: 'x' | 'y' | 'z', dia: number, len: number, mat: 'glass' | 'frame' | 'metalDark'): void {
  const o = { cast: false, ...(axis === 'x' ? { rz: Math.PI / 2 } : axis === 'z' ? { rx: Math.PI / 2 } : {}) }
  f.cyl(x, y - len / 2, z, dia, len, mat, o)
}

export function buildPneumatic(b: LayoutBuilder): void {
  b.area = 'corridorB'
  const f = b.world
  const runs = pneumaticRuns()

  for (const r of runs) {
    const axis = axisOf(r)
    const length = len3(r)
    const mx = (r.a.x + r.b.x) / 2
    const my = (r.a.y + r.b.y) / 2
    const mz = (r.a.z + r.b.z) / 2
    barrel(f, mx, my, mz, axis, PIPE.od, length, 'glass')
    const dir = { x: Math.sign(r.b.x - r.a.x), y: Math.sign(r.b.y - r.a.y), z: Math.sign(r.b.z - r.a.z) }
    const at = (d: number) => ({ x: r.a.x + dir.x * d, y: r.a.y + dir.y * d, z: r.a.z + dir.z * d })
    // thin rings so the clear pipe reads from afar
    for (const d of marksAlong(length, PIPE.ringEvery, 0.25, 0.1)) {
      const p = at(d)
      barrel(f, p.x, p.y, p.z, axis, PIPE.ringDia, PIPE.ringLen, 'frame')
    }
    // clamps and their hangers on the horizontal runs (the trunk is 2.85 m up: the rod runs to the ceiling at WALL.height)
    if (r.kind === 'trunk' && axis !== 'y') {
      for (const d of marksAlong(length, PIPE.clampEvery, 0.6, 0.3)) {
        const p = at(d)
        if (WALL_CROSSINGS.some((w) => axis === 'z' && Math.abs(p.x - w.x) < 0.01 && Math.abs(p.z - w.wallZ) < 0.3)) continue
        barrel(f, p.x, p.y, p.z, axis, PIPE.clampDia, PIPE.clampLen, 'frame')
        const rodBottom = p.y + PIPE.clampDia / 2
        f.cyl(p.x, rodBottom, p.z, 0.012, WALL.height - rodBottom, 'metalDark', { cast: false })
      }
    }
  }

  // elbows at the trunk's corners and a T where each riser joins
  for (const p of pneumaticElbows()) f.sphere(p.x, p.y - PIPE.elbowDia / 2, p.z, PIPE.elbowDia, PIPE.elbowDia, PIPE.elbowDia, 'frame', { cast: false })
  for (const s of PNEUMATIC.sources) f.sphere(s.x, PNEUMATIC.y - PIPE.elbowDia / 2, PNEUMATIC.trunk[0].z, PIPE.elbowDia, PIPE.elbowDia, PIPE.elbowDia, 'frame', { cast: false })
  // each riser starts in a launch port (a dark collar where the tube leaves its robot or the send station)
  for (const s of PNEUMATIC.sources) f.cyl(s.x, s.y - 0.02, s.z, PIPE.collarDia - 0.03, 0.04, 'metalDark', { cast: false })

  // collars either side of the two walls the trunk passes through
  for (const w of WALL_CROSSINGS) {
    for (const side of [-1, 1]) {
      const z = w.wallZ + side * (WALL.thickness / 2 + PIPE.collarLen / 2 + 0.002)
      barrel(f, w.x, PNEUMATIC.y, z, 'z', PIPE.collarDia, PIPE.collarLen, 'frame')
    }
  }
}
