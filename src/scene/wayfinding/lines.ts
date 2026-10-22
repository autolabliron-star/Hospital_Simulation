/**
 * Wayfinding floor lines ("follow the blue line to Ward A"): flat coloured strips from the entrance, across the lobby,
 * down the main corridor and into each ward corridor, to the atrium, to emergency and to imaging. They are decals
 * (coloured instances of one flat strip, drawn as ONE instanced mesh) at y = 0.008.
 *
 * In a ward corridor a line runs 0.6 m off the centre line (the people's route), which is 0.7 m from the nearest robot lane
 * centre line; and each line stops short of the two U-turn zones, where the lanes sweep across the whole corridor.
 *
 * Level 2 (the surgery floor, in its strip of the flat sim, `l2(drawn x)`): you arrive by lift A at the north end of the theatre corridor or by
 * lift B at its south end, so each line runs the corridor's length from one lift door to the other in its own lane and turns off through its
 * door: pre-op (teal), the family lounge through the theatre hall (pink), recovery (green).
 */
import { l2 } from '@/sim/levels'
import { CORRIDOR_CENTER, ROBOT } from '@/sim/places'
import { WAYFINDING } from '@/scene/materials'
import type { LayoutBuilder } from '@/scene/building/layout/builder'

/** Where the purple imaging line ends: 1.2 m inside the hall, past the booking desk's end (the desk is on the south wall). */
export const IMAGING_LINE_END = -38.8
export const LINE_WIDTH = 0.2
export const LINE_Y = 0.008
/** The corridor offset from the centre line, metres. */
export const LINE_OFFSET = 0.6
/** x-intervals where the U-turn lanes cross the corridor: lines leave a gap here (centre +/- 1.3 m arc + a pod's width). */
export const UTURN_GAPS: [number, number][] = [
  [-ROBOT.uturnX - 2.5, -ROBOT.uturnX + 0.7],
  [ROBOT.uturnX - 0.7, ROBOT.uturnX + 2.5],
]

type P = [number, number]

/** A polyline of axis-aligned runs, cut at the given x gaps (applied to runs along x only). */
function runs(pts: P[], gaps: [number, number][] = []): { x0: number; z0: number; x1: number; z1: number }[] {
  const out: { x0: number; z0: number; x1: number; z1: number }[] = []
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i]
    const [bx, bz] = pts[i + 1]
    if (Math.abs(az - bz) < 1e-9 && gaps.length > 0) {
      // along x: split around the gaps
      const lo = Math.min(ax, bx)
      const hi = Math.max(ax, bx)
      let cur = lo
      for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) {
        if (g1 <= cur || g0 >= hi) continue
        if (g0 > cur) out.push({ x0: cur, z0: az, x1: g0, z1: az })
        cur = Math.max(cur, g1)
      }
      if (cur < hi) out.push({ x0: cur, z0: az, x1: hi, z1: az })
    } else {
      out.push({ x0: ax, z0: az, x1: bx, z1: bz })
    }
  }
  return out
}

/** Level 2 (drawn x, then moved into the level-2 strip): the corridor lanes between the two lift doors, and the branches through the doors. */
const L2_LANE = { preOp: -43.3, lounge: -42.7, recovery: -42.1, north: -15.7, south: 15.7 }
const toL2 = (pts: P[]): P[] => pts.map(([x, z]) => [l2(x), z] as P)
export const L2_LANES: { color: string; pts: P[] }[] = [
  { color: WAYFINDING.preOp, pts: toL2([[L2_LANE.preOp, L2_LANE.north], [L2_LANE.preOp, L2_LANE.south]]) },
  { color: WAYFINDING.lounge, pts: toL2([[L2_LANE.lounge, L2_LANE.north], [L2_LANE.lounge, L2_LANE.south]]) },
  { color: WAYFINDING.recovery, pts: toL2([[L2_LANE.recovery, L2_LANE.north], [L2_LANE.recovery, L2_LANE.south]]) },
]
export const L2_BRANCHES: { color: string; pts: P[] }[] = [
  // pre-op: the door on the corridor's west wall at z -13 (1.8 m wide); the line ends 1.4 m inside, by the admissions desk
  { color: WAYFINDING.preOp, pts: toL2([[L2_LANE.preOp, -13], [-45.4, -13]]) },
  // the family lounge: through the theatre hall (open 4 m at z -2..2), along its north side clear of the scrub sinks, south through the lounge's opening
  { color: WAYFINDING.lounge, pts: toL2([[L2_LANE.lounge, -0.7], [-57.5, -0.7], [-57.5, 3.4]]) },
  // recovery: the door on the west wall at z 12.5
  { color: WAYFINDING.recovery, pts: toL2([[L2_LANE.recovery, 12.5], [-45.4, 12.5]]) },
]

export interface LineSegment {
  color: string
  x0: number
  z0: number
  x1: number
  z1: number
}

/** All wayfinding segments (pure data, also used by the tests). */
export function wayfindingSegments(): LineSegment[] {
  const mid = CORRIDOR_CENTER // 14
  const nearRooms = mid + LINE_OFFSET // 14.6: toward the room wall
  const nearCore = mid - LINE_OFFSET // 13.4: toward the core side
  const defs: { color: string; pts: P[]; gaps?: [number, number][] }[] = [
    // ward A (blue): along the room side of corridor A, through the west U-turn gap, out to the last room
    { color: WAYFINDING.wardA, pts: [[-60.5, -1.35], [-43.4, -1.35], [-43.4, -nearRooms], [24.4, -nearRooms]], gaps: UTURN_GAPS },
    // atrium (amber): up the spine, along the core side of corridor A, then south through the atrium opening
    { color: WAYFINDING.atrium, pts: [[-60.5, -0.45], [-42.6, -0.45], [-42.6, -nearCore], [34, -nearCore], [34, -8.4]], gaps: UTURN_GAPS },
    // imaging (purple): straight across the lobby and the spine, through the spine door (x -40, z -1..1) into the imaging hall
    { color: WAYFINDING.diagnostics, pts: [[-60.5, 0.45], [IMAGING_LINE_END, 0.45]] },
    // ward B (green): mirror of ward A
    { color: WAYFINDING.wardB, pts: [[-60.5, 1.35], [-43.4, 1.35], [-43.4, nearRooms], [24.4, nearRooms]], gaps: UTURN_GAPS },
    // emergency (red): across the lobby, south through the ER door
    { color: WAYFINDING.emergency, pts: [[-60.5, 2.3], [-50, 2.3], [-50, 13.2]] },
    // level 2: lift A to lift B in three lanes (the lift doors are x -42.8..-41.2 at z -16 and 16), each branching off through its door
    ...L2_LANES,
    ...L2_BRANCHES,
  ]
  const out: LineSegment[] = []
  for (const d of defs) for (const r of runs(d.pts, d.gaps)) out.push({ color: d.color, ...r })
  return out
}

/** One drawn piece of the lines: a flat strip ('plane', w x d) or a round end cap ('cyl', diameter w, height d), at its centre. */
export interface WayfindingPiece {
  shape: 'plane' | 'cyl'
  x: number
  y: number
  z: number
  w: number
  d: number
  color: string
}

/** Every drawn piece (pure data): what `buildWayfinding` puts in the layout, and what ./presentLines.ts finds again to hide in presentation mode. */
export function wayfindingPieces(): WayfindingPiece[] {
  const out: WayfindingPiece[] = []
  for (const s of wayfindingSegments()) {
    const horizontal = Math.abs(s.z0 - s.z1) < 1e-9
    const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0)
    if (len < 0.05) continue
    // extend by half a width so corners meet
    const cx = (s.x0 + s.x1) / 2
    const cz = (s.z0 + s.z1) / 2
    if (horizontal) out.push({ shape: 'plane', x: cx, y: LINE_Y, z: cz, w: len + LINE_WIDTH, d: LINE_WIDTH, color: s.color })
    else out.push({ shape: 'plane', x: cx, y: LINE_Y, z: cz, w: LINE_WIDTH, d: len + LINE_WIDTH, color: s.color })
  }
  // a round end cap where each line finishes
  const ends: [number, number, string][] = [
    [24.4, -(CORRIDOR_CENTER + LINE_OFFSET), WAYFINDING.wardA],
    [24.4, CORRIDOR_CENTER + LINE_OFFSET, WAYFINDING.wardB],
    [34, -8.4, WAYFINDING.atrium],
    [IMAGING_LINE_END, 0.45, WAYFINDING.diagnostics],
    [-50, 13.2, WAYFINDING.emergency],
  ]
  // level 2: a cap at both lift doors on each lane and where each branch ends inside its room
  for (const d of L2_LANES) for (const [x, z] of d.pts) ends.push([x, z, d.color])
  for (const d of L2_BRANCHES) ends.push([...d.pts[d.pts.length - 1], d.color])
  for (const [x, z, color] of ends) out.push({ shape: 'cyl', x, y: LINE_Y - 0.002, z, w: 0.34, d: 0.006, color })
  return out
}

export function buildWayfinding(b: LayoutBuilder): void {
  b.area = 'lobby'
  const f = b.world
  for (const p of wayfindingPieces()) {
    if (p.shape === 'plane') f.plane(p.x, p.y, p.z, p.w, p.d, 'tinted', { color: p.color })
    else f.cyl(p.x, p.y, p.z, p.w, p.d, 'tinted', { color: p.color, cast: false })
  }
}
