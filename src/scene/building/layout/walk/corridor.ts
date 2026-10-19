/**
 * Corridor furniture of the walk-mode building (W1): handrails along the solid walls that face a corridor, and corner guards at
 * the door jambs. All simple boxes in the `frame` material (steel), merged with the rest of the chunk.
 *
 *   rail      a 0.9 m handrail on small brackets, standing 0.04 to 0.09 m off the wall face; it stops short of every door edge and
 *             every perpendicular wall, so nothing crosses an opening;
 *   guard     a 1.2 m steel strip on the wall face beside each door jamb that opens off a corridor.
 *
 * Clearance: the robot lanes run 0.7 m from the wall's centre line (ROBOT.laneOffset), pods are 0.6 m wide, so a rail 0.19 m from the
 * centre line leaves 0.21 m beside a pod and 0.51 m to the lane's centre line (the keep-clear rule of the M2 brief is 0.45 m).
 */
import { DOORS, WALL, areaAt, type AreaId } from '@/sim/places'
import { buildWallPieces } from '../walls'
import type { WallPiece } from '../types'
import { isWalkDoor } from './upperWalls'
import type { WalkBox } from './types'

const T = WALL.thickness
const FACE = T / 2
/** Corridors: the two ward corridors and the main corridor (R2: and the theatre corridor on level 2). */
const CORRIDORS: readonly AreaId[] = ['corridorA', 'corridorB', 'spine', 'l2Corridor']

export const RAIL = { y0: 0.88, y1: 0.935, standoff: 0.04, depth: 0.05, minLength: 0.4, bracketPitch: 1.4, bracketAlong: 0.03 } as const
export const GUARD = { y0: 0.05, y1: 1.25, along: 0.06, depth: 0.035 } as const
/** A rail or guard stays this far from a door edge, and from a perpendicular wall's face. */
const END_AT_DOOR = 0.12
const END_AT_WALL = FACE + 0.03
const PROBE = 0.3
const STEP = 0.25

const key = (v: number): number => Math.round(v * 1000) / 1000

/** Door edges per wall line: `${alongX}|${c}` -> coordinates along the line. */
function doorEdges(): Map<string, Set<number>> {
  const m = new Map<string, Set<number>>()
  for (const d of DOORS) {
    if (!isWalkDoor(d) || d.kind === 'counter') continue
    const alongX = d.wallAxis === 'x'
    const k = `${alongX}|${key(alongX ? d.center.z : d.center.x)}`
    const set = m.get(k) ?? new Set<number>()
    const mid = alongX ? d.center.x : d.center.z
    set.add(key(mid - d.width / 2))
    set.add(key(mid + d.width / 2))
    m.set(k, set)
  }
  return m
}

function isCorridorSide(p: WallPiece, t: number, s: 1 | -1): boolean {
  const area = p.alongX ? areaAt(t, p.c + s * PROBE) : areaAt(p.c + s * PROBE, t)
  return area !== null && CORRIDORS.includes(area.id)
}

/** A box on the wall face of side `s` (`s * (FACE + near)` to `s * (FACE + far)` off the centre line), along [a, b]. */
function faceBox(p: WallPiece, s: 1 | -1, a: number, b: number, y0: number, y1: number, near: number, far: number, part: 'rail' | 'railBracket' | 'guard'): WalkBox {
  const c0 = p.c + s * (FACE + near)
  const c1 = p.c + s * (FACE + far)
  const lo = Math.min(c0, c1)
  const hi = Math.max(c0, c1)
  return p.alongX
    ? { mat: 'frame', part, x0: a, x1: b, y0, y1, z0: lo, z1: hi }
    : { mat: 'frame', part, x0: lo, x1: hi, y0, y1, z0: a, z1: b }
}

export function buildCorridorFurniture(pieces: WallPiece[] = buildWallPieces()): WalkBox[] {
  const out: WalkBox[] = []
  const edges = doorEdges()
  for (const p of pieces) {
    if (p.cls !== 'solid') continue
    const doors = edges.get(`${p.alongX}|${key(p.c)}`) ?? new Set<number>()
    const cells = Math.max(1, Math.round((p.b - p.a) / STEP))
    const stride = (p.b - p.a) / cells
    for (const s of [-1, 1] as const) {
      // runs of cells that face a corridor
      let start = -1
      const flush = (end: number): void => {
        if (start < 0) return
        const r0 = p.a + start * stride
        const r1 = p.a + end * stride
        const startsAtA = start === 0
        const endsAtB = end === cells
        const i0 = startsAtA && p.cutA ? END_AT_DOOR : END_AT_WALL
        const i1 = endsAtB && p.cutB ? END_AT_DOOR : END_AT_WALL
        const a = r0 + i0
        const b = r1 - i1
        if (b - a >= RAIL.minLength) {
          out.push(faceBox(p, s, a, b, RAIL.y0, RAIL.y1, RAIL.standoff, RAIL.standoff + RAIL.depth, 'rail'))
          const n = Math.max(2, Math.ceil((b - a) / RAIL.bracketPitch) + 1)
          for (let i = 0; i < n; i++) {
            const t = a + 0.08 + ((b - a - 0.16) * i) / (n - 1)
            out.push(faceBox(p, s, t - RAIL.bracketAlong / 2, t + RAIL.bracketAlong / 2, RAIL.y0 - 0.02, RAIL.y1 + 0.01, 0, RAIL.standoff, 'railBracket'))
          }
        }
        // corner guards at the door jambs this run starts or ends at
        if (startsAtA && p.cutA && doors.has(key(p.a))) {
          const inset = jambInset(p.a, p)
          out.push(faceBox(p, s, p.a + inset, p.a + inset + GUARD.along, GUARD.y0, GUARD.y1, 0, GUARD.depth, 'guard'))
        }
        if (endsAtB && p.cutB && doors.has(key(p.b))) {
          const inset = jambInset(p.b, p)
          out.push(faceBox(p, s, p.b - inset - GUARD.along, p.b - inset, GUARD.y0, GUARD.y1, 0, GUARD.depth, 'guard'))
        }
        start = -1
      }
      for (let k = 0; k < cells; k++) {
        const mid = p.a + (k + 0.5) * stride
        if (isCorridorSide(p, mid, s)) {
          if (start < 0) start = k
        } else flush(k)
      }
      flush(cells)
    }
  }
  return out
}

/** Doors with a leaf have a 0.07 m jamb centred on the opening's edge: the guard stands just beside it. Open passages have none. */
function jambInset(edge: number, p: WallPiece): number {
  const leaf = DOORS.some((d) => {
    if (!isWalkDoor(d) || d.kind === 'opening' || d.kind === 'counter') return false
    const alongX = d.wallAxis === 'x'
    if (alongX !== p.alongX || Math.abs((alongX ? d.center.z : d.center.x) - p.c) > 1e-6) return false
    const mid = alongX ? d.center.x : d.center.z
    return Math.abs(mid - d.width / 2 - edge) < 1e-6 || Math.abs(mid + d.width / 2 - edge) < 1e-6
  })
  return leaf ? 0.035 : 0
}
