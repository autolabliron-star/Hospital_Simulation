/**
 * Walls of the building, derived from the area rects in `places.ts` (pure maths, no three.js).
 *
 * Every area edge is a wall. Where two areas share an edge the wall is drawn once. Door openings, the robot doors and
 * the 0.8 m MedDrawer cabinet gaps are cut out. Each piece is classified by the two areas it separates:
 *   solid      the architect's section cut (`WALL.cutHeight`), the default;
 *   glassFull  a full-height glass partition (command center, atrium and nurse hub fronts, and the MRI / CT observation
 *              windows between a control room and its scan room): the tall landmarks;
 *   glassCut   floor-to-cut glazing in the outer shell (patient rooms, lounges, the atrium);
 *   skip       the pharmacy core's perimeter: builder S2 draws those glass walls.
 */
import { AREAS, BUILDING, DOORS, ROOMS, areaAt, type AreaId, type Rect } from '@/sim/places'
import type { WallClass, WallPiece } from './types'

/** Width of the gap left in the room/corridor wall for S2's MedDrawer cabinet (x +/- 0.4 m around `room.drawer`). */
export const DRAWER_GAP = 0.8

interface Interval {
  a: number
  b: number
}

const EPS = 1e-6
const key = (v: number): number => Math.round(v * 1000) / 1000

function addTo(map: Map<number, Interval[]>, c: number, a: number, b: number): void {
  const k = key(c)
  const list = map.get(k) ?? []
  list.push({ a: Math.min(a, b), b: Math.max(a, b) })
  map.set(k, list)
}

/** The openings: [alongX map keyed by z, alongZ map keyed by x]. */
export function wallGaps(): { alongX: Map<number, Interval[]>; alongZ: Map<number, Interval[]> } {
  const alongX = new Map<number, Interval[]>()
  const alongZ = new Map<number, Interval[]>()
  for (const d of DOORS) {
    const h = d.width / 2
    if (d.wallAxis === 'x') addTo(alongX, d.center.z, d.center.x - h, d.center.x + h)
    else addTo(alongZ, d.center.x, d.center.z - h, d.center.z + h)
  }
  // (W2) no robot doors any more: the pods cross the core's corridor walls through rail portals near the ceiling, drawn
  // by the pharmacy builder; below them the wall is continuous
  // MedDrawer cabinets in the room/corridor wall, beside each bed head
  for (const r of ROOMS) addTo(alongX, r.drawer.z, r.drawer.x - DRAWER_GAP / 2, r.drawer.x + DRAWER_GAP / 2)
  return { alongX, alongZ }
}

const GLAZED_SHELL = (id: AreaId): boolean =>
  id.startsWith('room:') || id === 'loungeA' || id === 'quietB' || id === 'staffA' || id === 'triage' || id === 'er' || id === 'lobby' || id === 'atrium'

/** The observation windows: the wall between a scanner's control room and its scan room is full-height glass. */
const OBSERVATION_PAIRS: readonly (readonly [AreaId, AreaId])[] = [
  ['mriControl', 'mri'],
  ['ctControl', 'ct'],
]
const isObservation = (a: AreaId, b: AreaId): boolean => OBSERVATION_PAIRS.some(([p, q]) => (a === p && b === q) || (a === q && b === p))

const isCorridor = (id: AreaId | null): boolean => id === 'corridorA' || id === 'corridorB' || id === 'spine'
const isHub = (id: AreaId | null): boolean => id === 'hubA' || id === 'hubB'

function classify(a: AreaId | null, b: AreaId | null): WallClass {
  if (a === 'core' || b === 'core') return 'skip'
  if (a === null || b === null) {
    const inner = a ?? b
    return inner !== null && GLAZED_SHELL(inner) ? 'glassCut' : 'solid'
  }
  if (a === 'command' || b === 'command') return 'glassFull'
  if (isObservation(a, b)) return 'glassFull'
  if ((a === 'atrium' && isCorridor(b)) || (b === 'atrium' && isCorridor(a))) return 'glassFull'
  if ((isHub(a) && isCorridor(b)) || (isHub(b) && isCorridor(a))) return 'glassFull'
  return 'solid'
}

/** Probe distance either side of a wall line when asking "which areas does this wall separate?". */
const PROBE = 0.3

/** Wall pieces of the whole building. Pure maths, so it can be checked in node. */
export function buildWallPieces(): WallPiece[] {
  const lineX = new Map<number, Interval[]>() // key = z, intervals in x
  const lineZ = new Map<number, Interval[]>() // key = x, intervals in z
  const edges = (r: Rect) => {
    addTo(lineX, r.z0, r.x0, r.x1)
    addTo(lineX, r.z1, r.x0, r.x1)
    addTo(lineZ, r.x0, r.z0, r.z1)
    addTo(lineZ, r.x1, r.z0, r.z1)
  }
  for (const a of AREAS) edges(a.rect)
  const gaps = wallGaps()

  const out: WallPiece[] = []
  const emit = (lines: Map<number, Interval[]>, gapMap: Map<number, Interval[]>, alongX: boolean) => {
    const keys = [...lines.keys()].sort((p, q) => p - q)
    for (const c of keys) {
      const covers = lines.get(c) ?? []
      const cuts = gapMap.get(c) ?? []
      const outline = alongX ? c === BUILDING.z0 || c === BUILDING.z1 : c === BUILDING.x0 || c === BUILDING.x1
      // breakpoints: every interval end and every gap end
      const pts = new Set<number>()
      for (const iv of covers) {
        pts.add(key(iv.a))
        pts.add(key(iv.b))
      }
      for (const g of cuts) {
        pts.add(key(g.a))
        pts.add(key(g.b))
      }
      const sorted = [...pts].sort((p, q) => p - q)
      let prev: WallPiece | null = null
      for (let i = 0; i + 1 < sorted.length; i++) {
        const p = sorted[i]
        const q = sorted[i + 1]
        const mid = (p + q) / 2
        const covered = covers.some((iv) => iv.a < mid && mid < iv.b)
        const inGap = cuts.some((g) => g.a < mid && mid < g.b)
        if (!covered || inGap) {
          prev = null
          continue
        }
        const sideA = alongX ? areaAt(mid, c - PROBE) : areaAt(c - PROBE, mid)
        const sideB = alongX ? areaAt(mid, c + PROBE) : areaAt(c + PROBE, mid)
        const cls = classify(sideA?.id ?? null, sideB?.id ?? null)
        const cutA = cuts.some((g) => Math.abs(g.b - p) < EPS)
        const cutB = cuts.some((g) => Math.abs(g.a - q) < EPS)
        if (prev && prev.cls === cls && Math.abs(prev.b - p) < EPS && !prev.cutB && !cutA) {
          prev.b = q
          prev.cutB = cutB
        } else {
          prev = { alongX, c, a: p, b: q, outline, cutA, cutB, cls }
          out.push(prev)
        }
      }
    }
  }
  emit(lineX, gaps.alongX, true)
  emit(lineZ, gaps.alongZ, false)
  return out.filter((p) => p.b - p.a > 0.05)
}
