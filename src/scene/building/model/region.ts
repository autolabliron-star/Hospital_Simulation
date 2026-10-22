/**
 * The pilot region (level 1) that the authored model replaces: sim x -62.5..-30, z -16.5..16.5. The procedural compilers take the predicates
 * below as an optional filter (undefined = nothing hidden), so the default build is byte-for-byte unchanged.
 *
 * Coverage rule (the same one tools/arch/shell.py builds by): an area, a wall piece or a door is the model's when its CENTRE is in the region,
 * and the model then draws it whole. So the procedural building hides exactly that: the floors of covered areas, every shell prim lying on a
 * covered wall or door line (walls, caps, glazing, mullions, jambs), and in walk mode the upper walls, glazing, lintels and frames on those
 * lines and the ceilings of covered areas.
 *
 * The look pass (docs/handover/look-lobby.md) also designed the lobby's furniture in Blender, so the procedural reception desk, waiting seat
 * rows, planters and side table are hidden too. Everything else stays procedural: the sim's seats and footprints (collision), both kinds of
 * kiosk, the screens, signage, floor lines and every piece of furniture in the other rooms (the triage desk's mint panel, the imaging glass
 * partition: furniture that merely shares an architecture material is never hidden).
 *
 * Prims carry only material and position, so the hidden set is precomputed (lazily, once) as keys `mat|x|z` of the exact prims the shell and the
 * lobby builder emit, and a prim is hidden when its key is in the set.
 */
import { AREAS, DOORS, type Area } from '@/sim/places'
import { levelOf } from '@/sim/levels'
import type { MatKey } from '@/scene/materials'
import { buildLobby } from '@/scene/rooms/lobby'
import { LayoutBuilder } from '../layout/builder'
import { buildFloors, buildWalls } from '../layout/shell'
import type { Prim, WallPiece } from '../layout/types'
import { buildWallPieces } from '../layout/walls'

export const PILOT_REGION = { x0: -62.5, x1: -30, z0: -16.5, z1: 16.5 } as const

export const inPilotRegion = (x: number, z: number): boolean => x >= PILOT_REGION.x0 && x <= PILOT_REGION.x1 && z >= PILOT_REGION.z0 && z <= PILOT_REGION.z1

/** A line the model draws: a covered wall piece, or the head/jamb line of a covered door (its width plus the frame). */
interface Line {
  alongX: boolean
  c: number
  a: number
  b: number
}

/** A wall piece is the model's when it is on level 1 and its centre is in the region. */
export function coversPiece(p: WallPiece): boolean {
  if (p.cls === 'skip') return false
  const [x, z] = p.alongX ? [(p.a + p.b) / 2, p.c] : [p.c, (p.a + p.b) / 2]
  return levelOf(x) === 1 && inPilotRegion(x, z)
}

/** An area is the model's (floor, ceiling) when it is on level 1 and its centre is in the region. */
export function coversArea(a: Area): boolean {
  const x = (a.rect.x0 + a.rect.x1) / 2
  const z = (a.rect.z0 + a.rect.z1) / 2
  return levelOf(a.rect.x0) === 1 && inPilotRegion(x, z)
}

let lines: Line[] | null = null
function coveredLines(): Line[] {
  if (lines) return lines
  const out: Line[] = []
  for (const p of buildWallPieces()) if (coversPiece(p)) out.push({ alongX: p.alongX, c: p.c, a: p.a - 1e-6, b: p.b + 1e-6 })
  for (const d of DOORS) {
    if (levelOf(d.center.x) !== 1 || !inPilotRegion(d.center.x, d.center.z)) continue
    const alongX = d.wallAxis === 'x'
    const mid = alongX ? d.center.x : d.center.z
    out.push({ alongX, c: alongX ? d.center.z : d.center.x, a: mid - d.width / 2 - 0.05, b: mid + d.width / 2 + 0.05 })
  }
  lines = out
  return out
}

/** True when (x, z) lies on a line the model draws, within `tol` across it (the shell's prims are centred on their lines). */
export function onCoveredLine(x: number, z: number, tol = 0.02): boolean {
  for (const l of coveredLines()) {
    const across = l.alongX ? z : x
    const along = l.alongX ? x : z
    if (Math.abs(across - l.c) <= tol && along >= l.a && along <= l.b) return true
  }
  return false
}

/** The level-1 area whose rect holds (x, z) (the smallest, so a room inside a hall wins), or null. */
function areaAtLevel1(x: number, z: number): Area | null {
  let best: Area | null = null
  let bestA = Infinity
  for (const a of AREAS) {
    const r = a.rect
    if (levelOf(r.x0) !== 1 || x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) continue
    const s = (r.x1 - r.x0) * (r.z1 - r.z0)
    if (s < bestA) {
      best = a
      bestA = s
    }
  }
  return best
}

const keyOf = (mat: string, x: number, z: number): string => `${mat}|${x.toFixed(3)}|${z.toFixed(3)}`

/** Lobby prims that stay: the self check-in kiosks (inside their footprints), the screens and the screens' bezels (above the desk top). */
function lobbyPrimStays(p: Prim, kiosks: { x: number; z: number; hw: number; hd: number }[]): boolean {
  if (p.shape === 'quad' || p.mat === 'screen') return true
  if (p.mat === 'metalDark' && p.position[1] > 1.0) return true
  const [x, , z] = p.position
  return kiosks.some((k) => Math.abs(x - k.x) <= Math.max(k.hw, k.hd) + 0.2 && Math.abs(z - k.z) <= Math.max(k.hw, k.hd) + 0.2)
}

let hidden: Set<string> | null = null
/** The keys of every procedural prim the model replaces (computed once). */
export function hiddenPrimKeys(): Set<string> {
  if (hidden) return hidden
  const out = new Set<string>()
  // the shell: floors of covered areas, everything on a covered wall or door line
  const shell = new LayoutBuilder()
  buildFloors(shell)
  buildWalls(shell)
  for (const p of shell.prims) {
    const [x, , z] = p.position
    if (levelOf(x) !== 1) continue
    const floor = p.shape === 'plane' && p.position[1] <= 0.01
    if (floor) {
      const a = areaAtLevel1(x, z)
      if (a && coversArea(a)) out.add(keyOf(p.mat, x, z))
    } else if (onCoveredLine(x, z)) out.add(keyOf(p.mat, x, z))
  }
  // the lobby furniture the model designs (desk, seat rows, planters, side table)
  const lobby = new LayoutBuilder()
  buildLobby(lobby)
  const kiosks = lobby.footprints.filter((f) => f.id.startsWith('lobby:kiosk'))
  for (const p of lobby.prims) if (!lobbyPrimStays(p, kiosks)) out.add(keyOf(p.mat, p.position[0], p.position[2]))
  hidden = out
  return out
}

/** The model failed to load (./modelStatus.ts `markModelFailed`): nothing is hidden any more, in the overview shell or in walk mode. */
let released = false
export function releaseRegion(): void {
  released = true
  hiddenPrimKeys().clear()
}

/** For tests. */
export function resetRegionRelease(): void {
  released = false
  hidden = null
}

/** True for a layout prim (centre x, z; material) that the model replaces. */
export const hidesPrim = (mat: MatKey, x: number, z: number): boolean => hiddenPrimKeys().has(keyOf(mat, x, z))

/**
 * True for a walk-mode box (its centre) or ceiling piece that the model replaces: upper walls, glazing, lintels and frames on a covered line,
 * ceilings of covered areas. Signage (plates on the wall faces, hanging signs) stays.
 */
export const hidesWalkPart = (mat: 'wall' | 'frame' | 'glass' | 'ceiling', x: number, z: number): boolean => {
  if (released) return false
  if (mat === 'ceiling') {
    const a = areaAtLevel1(x, z)
    return a !== null && coversArea(a)
  }
  return onCoveredLine(x, z)
}
