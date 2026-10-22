/**
 * Node tests of the walk-mode building (W1): upper walls close every solid wall above the cut and leave every door open below the door
 * height, every area has a ceiling except the atrium, hanging signs never hang in a crossing zone or a doorway, door plates sit on real
 * wall beside their doors, handrails keep clear of the robot lanes and the doors, swing leaves clear the furniture, the arrows on the
 * signs point the right way, the layout is deterministic, and the whole walk-mode addition fits its budget (<= 25 draw calls, <= 150 k
 * triangles). Pure data and plain three.js geometry: no browser.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CIRCUITS, pointAt, type PathPoint } from '@/sim/meds/circuit'
import { AREAS, BUILDING, DOORS, ROOMS, SIGNS, WALL, ceilingHeight, areaById } from '@/sim/places'
import { LEVEL2_STRIP, levelOf } from '@/sim/levels'
import { destinationCopy, doorPlateCopy, signTitle } from '@/content/signs'
import { allSigns, L2_SIGNS } from '@/scene/wayfinding/signsL2'
import { buildLayout } from '../index'
import { DRAWER_GAP, buildWallPieces } from '../walls'
import { compileWalk, estimateWalkBudget } from '../../render/walk/walkGeometry'
import { packAtlas } from '../../render/walk/signAtlas'
import { CHUNK_COUNT, CHUNK_EDGES } from './chunks'
import { buildWalkLayout, walkLayoutOfLevel } from './index'
import { sweepIsClear } from './doors'
import { NAME_PLATE, PLATE_Y, ROOM_PLATE, SIGN, arrowFor, orientedAabb } from './signage'
import { isWalkDoor } from './upperWalls'
import type { WalkBox } from './types'

const layout = buildLayout()
const walk = buildWalkLayout(layout)
const pieces = buildWallPieces()

const CUT = WALL.cutHeight
const H = WALL.height
const T = WALL.thickness

const inside = (b: WalkBox, x: number, y: number, z: number): boolean => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && z >= b.z0 && z <= b.z1
const anyBox = (boxes: readonly WalkBox[], x: number, y: number, z: number): WalkBox | undefined => boxes.find((b) => inside(b, x, y, z))
const at = (alongX: boolean, c: number, t: number): { x: number; z: number } => (alongX ? { x: t, z: c } : { x: c, z: t })

// ---------------------------------------------------------------------------------------------
// Upper walls
// ---------------------------------------------------------------------------------------------

describe('upper walls', () => {
  const walls = walk.boxes.filter((b) => b.mat === 'wall')

  it('cover every solid wall piece from the cut to the full height', () => {
    const offenders: string[] = []
    for (const p of pieces) {
      if (p.cls !== 'solid') continue
      for (let t = p.a + 0.05; t <= p.b - 0.05; t += 0.25) {
        for (const y of [CUT + 0.02, 2.0, H - 0.02]) {
          const { x, z } = at(p.alongX, p.c, t)
          if (!anyBox(walls, x, y, z)) offenders.push(`solid piece ${p.alongX ? 'z' : 'x'}=${p.c} at ${t.toFixed(2)}, y=${y}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('continue the outer glazing to the ceiling (glass and frame at every height above the cut)', () => {
    const glazing = walk.boxes.filter((b) => b.part === 'glazing' || b.part === 'glazingFrame')
    let checked = 0
    for (const p of pieces) {
      if (p.cls !== 'glassCut') continue
      for (const t of [p.a + 0.6, (p.a + p.b) / 2, p.b - 0.6]) {
        const { x, z } = at(p.alongX, p.c, t)
        // a mullion or a panel (the spans between partitions are excluded by sampling the middle of the run only where one exists)
        const hit = [CUT + 0.1, 2.0, H - 0.03].every((y) => anyBox(glazing, x, y, z))
        if (hit) checked++
      }
    }
    expect(checked).toBeGreaterThan(20)
    // the glazing never reaches below the cut and never above the ceiling
    for (const b of glazing) {
      expect(b.y0).toBeGreaterThanOrEqual(CUT - 1e-9)
      expect(b.y1).toBeLessThanOrEqual(H + 1e-9)
    }
  })

  it('never reach below the section cut (an upper wall only hides the cap strip), nor above the storey height', () => {
    for (const b of walk.boxes.filter((b) => ['upperWall', 'lintel', 'drawerFill'].includes(b.part))) {
      expect(b.y0).toBeGreaterThanOrEqual(CUT - 0.04 - 1e-9)
      expect(b.y1).toBeLessThanOrEqual(H + 1e-9)
    }
  })

  it('leave every door opening clear below the door height', () => {
    const offenders: string[] = []
    for (const d of DOORS) {
      const alongX = d.wallAxis === 'x'
      const h = d.width / 2 - 0.25 // clear of the jambs and of the perpendicular walls an opening runs into
      for (const t of [-h, -h / 2, 0, h / 2, h]) {
        for (const y of [0.1, 0.6, 1.0, 1.5, 2.0, WALL.doorHeight - 0.1]) {
          for (const across of [-0.09, 0, 0.09]) {
            const x = alongX ? d.center.x + t : d.center.x + across
            const z = alongX ? d.center.z + across : d.center.z + t
            const hit = anyBox(walk.boxes, x, y, z)
            if (hit) offenders.push(`${d.id}: ${hit.part} at t=${t.toFixed(2)}, y=${y}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('close the opening above the door height with a lintel (every door but the core\'s own)', () => {
    for (const d of DOORS) {
      const hit = anyBox(walk.boxes.filter((b) => b.part === 'lintel'), d.center.x, (WALL.doorHeight + H) / 2, d.center.z)
      if (isWalkDoor(d)) expect(hit, d.id).toBeDefined()
      else expect(hit, d.id).toBeUndefined() // S2's glass box has its own transom
    }
  })

  it('give every door that has a leaf a full-height frame (two jambs and a head)', () => {
    for (const d of DOORS) {
      if (!isWalkDoor(d) || d.kind === 'opening' || d.kind === 'counter') continue
      const alongX = d.wallAxis === 'x'
      const frames = walk.boxes.filter((b) => b.part === 'doorFrame')
      for (const s of [-1, 1]) {
        const x = alongX ? d.center.x + (s * d.width) / 2 : d.center.x
        const z = alongX ? d.center.z : d.center.z + (s * d.width) / 2
        expect(anyBox(frames, x, (CUT + WALL.doorHeight) / 2, z), `${d.id} jamb ${s}`).toBeDefined()
      }
      const head = anyBox(frames, d.center.x, WALL.doorHeight - 0.03, d.center.z)
      expect(head, `${d.id} head`).toBeDefined()
    }
  })

  it('continue the wall over every MedDrawer cabinet (it is flush with the cut) and leave the cabinet itself open', () => {
    for (const r of ROOMS) {
      for (const t of [-DRAWER_GAP / 2 + 0.03, 0, DRAWER_GAP / 2 - 0.03]) {
        expect(anyBox(walls, r.drawer.x + t, 2.0, r.drawer.z), `${r.id} above the cabinet`).toBeDefined()
        expect(anyBox(walk.boxes, r.drawer.x + t, 0.9, r.drawer.z), `${r.id} cabinet space`).toBeUndefined()
      }
    }
  })

  it('stay inside the outline of their level (a wall thickness of slack): the building for level 1, the level-2 strip for level 2', () => {
    for (const b of walk.boxes) {
      const r = levelOf((b.x0 + b.x1) / 2) === 2 ? LEVEL2_STRIP : BUILDING
      expect(b.x0).toBeGreaterThanOrEqual(r.x0 - T)
      expect(b.x1).toBeLessThanOrEqual(r.x1 + T)
      expect(b.z0).toBeGreaterThanOrEqual(r.z0 - T)
      expect(b.z1).toBeLessThanOrEqual(r.z1 + T)
    }
  })

  it('level 2 has its own upper walls, a lintel over each of its doors, and glazing on its window walls', () => {
    const upper = walkLayoutOfLevel(walk, 2).boxes
    expect(upper.filter((b) => b.part === 'upperWall').length).toBeGreaterThan(15)
    expect(upper.filter((b) => b.part === 'glazing').length).toBeGreaterThan(20)
    for (const d of DOORS.filter((q) => q.id.startsWith('l2'))) expect(anyBox(upper.filter((b) => b.part === 'lintel'), d.center.x, (WALL.doorHeight + H) / 2, d.center.z), d.id).toBeDefined()
    // the OR's viewing window is full-height glass: no upper wall above it, and none in it
    expect(anyBox(upper, 106, 2.0, 4.3)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------------------------
// Ceilings
// ---------------------------------------------------------------------------------------------

describe('ceilings', () => {
  it('exist for every area except the ones with no ceiling, at ceilingHeight, covering the whole rectangle', () => {
    for (const a of AREAS) {
      const pieces = walk.ceilings.filter((c) => c.area === a.id)
      const h = ceilingHeight(a.id)
      if (h === null) {
        expect(pieces, a.id).toHaveLength(0)
        continue
      }
      expect(pieces.length, a.id).toBeGreaterThan(0)
      let covered = 0
      for (const c of pieces) {
        expect(c.y).toBe(h)
        expect(c.z0).toBe(a.rect.z0)
        expect(c.z1).toBe(a.rect.z1)
        expect(c.x0).toBeGreaterThanOrEqual(a.rect.x0)
        expect(c.x1).toBeLessThanOrEqual(a.rect.x1)
        covered += (c.x1 - c.x0) * (c.z1 - c.z0)
      }
      expect(covered, a.id).toBeCloseTo((a.rect.x1 - a.rect.x0) * (a.rect.z1 - a.rect.z0), 6)
    }
  })

  it('the atrium keeps its sky and the pharmacy core gets a ceiling above its glass box', () => {
    expect(walk.ceilings.some((c) => c.area === 'atrium')).toBe(false)
    const core = walk.ceilings.filter((c) => c.area === 'core')
    expect(core.length).toBeGreaterThan(0)
    expect(core[0].y).toBe(H)
  })

  it('the light-panel pattern runs through a cut: pieces of one area are contiguous in uv', () => {
    for (const a of AREAS) {
      const ps = walk.ceilings.filter((c) => c.area === a.id).sort((p, q) => p.x0 - q.x0)
      for (let i = 0; i + 1 < ps.length; i++) {
        expect(ps[i].x1).toBe(ps[i + 1].x0)
        expect(ps[i].u1).toBeCloseTo(ps[i + 1].u0, 9)
      }
    }
  })

  it('repeat the light cell about every 3 m: a corridor gets one row of panels, a patient room four', () => {
    const corridor = walk.ceilings.filter((c) => c.area === 'corridorA')
    const nx = Math.max(...corridor.map((c) => c.u1))
    expect(nx).toBeGreaterThan(20)
    expect(Math.max(...corridor.map((c) => c.v1))).toBe(1)
    const room = walk.ceilings.find((c) => c.area === 'room:A1')!
    expect(room.u1).toBe(2)
    expect(room.v1).toBe(2)
  })
})

// ---------------------------------------------------------------------------------------------
// Signs and plates
// ---------------------------------------------------------------------------------------------

describe('hanging signs', () => {
  // (W2) no crossing zones any more: the doorway rects below are the only floor openings a sign must avoid
  const zones: { x0: number; x1: number; z0: number; z1: number }[] = []

  it('there is one per SIGNS anchor (level 1) and per L2_SIGNS anchor (level 2), two-sided, with the panel at head-clear height under the ceiling', () => {
    expect(walk.signs.map((s) => s.id)).toEqual(allSigns(SIGNS).map((s) => s.id))
    expect(walk.signs.filter((s) => levelOf(s.x) === 2).map((s) => s.id)).toEqual(L2_SIGNS.map((s) => s.id))
    for (const s of walk.signs) {
      expect(s.y0, s.id).toBeGreaterThanOrEqual(2.1)
      expect(s.y1, s.id).toBeLessThan(ceilingHeight(s.area) ?? H)
      expect(s.front).not.toBe(s.back)
      expect(walk.quads.filter((q) => q.tile === s.front || q.tile === s.back)).toHaveLength(2)
    }
  })

  it('sit outside every crossing zone and every doorway, so a sign never hangs in a door', () => {
    const offenders: string[] = []
    for (const s of walk.signs) {
      const fp = orientedAabb(s.x, s.z, s.heading, s.halfAlong, s.halfAcross)
      const overlap = (r: { x0: number; x1: number; z0: number; z1: number }, m: number): boolean =>
        fp.x1 > Math.min(r.x0, r.x1) - m && fp.x0 < Math.max(r.x0, r.x1) + m && fp.z1 > Math.min(r.z0, r.z1) - m && fp.z0 < Math.max(r.z0, r.z1) + m
      for (const r of zones) if (overlap(r, 0.05)) offenders.push(`${s.id} is in a crossing zone`)
      for (const d of DOORS) {
        const h = d.width / 2
        // the doorway: the opening along the wall, half a metre deep either side of it
        const r = d.wallAxis === 'x' ? { x0: d.center.x - h, x1: d.center.x + h, z0: d.center.z - 0.5, z1: d.center.z + 0.5 } : { x0: d.center.x - 0.5, x1: d.center.x + 0.5, z0: d.center.z - h, z1: d.center.z + h }
        if (overlap(r, 0)) offenders.push(`${s.id} is in the doorway ${d.id}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('hang inside their area, clear of its walls', () => {
    for (const s of walk.signs) {
      const fp = orientedAabb(s.x, s.z, s.heading, s.halfAlong, s.halfAcross)
      const r = areaById(s.area).rect
      expect(fp.x0, s.id).toBeGreaterThan(r.x0 + T / 2)
      expect(fp.x1, s.id).toBeLessThan(r.x1 - T / 2)
      expect(fp.z0, s.id).toBeGreaterThan(r.z0 + T / 2)
      expect(fp.z1, s.id).toBeLessThan(r.z1 - T / 2)
    }
  })

  it('every word comes from the content: each place a sign points to has copy, and each sign has a title', () => {
    for (const s of allSigns(SIGNS)) {
      expect(signTitle(s.id), s.id).toBeDefined()
      expect(s.points.length, s.id).toBeLessThanOrEqual(SIGN.maxRows)
      for (const p of s.points) expect(destinationCopy(p), `${s.id} -> ${p}`).toBeDefined()
    }
    for (const t of walk.tiles) if (t.kind === 'sign') for (const r of t.rows) expect(r.label.length).toBeGreaterThan(0)
  })

  it('the arrows are seen from each face: what is ahead for one reader is behind the other, left and right swap', () => {
    const flip: Record<string, string> = { ahead: 'back', back: 'ahead', left: 'right', right: 'left' }
    for (const s of walk.signs) {
      const front = walk.tiles.find((t) => t.key === s.front)
      const back = walk.tiles.find((t) => t.key === s.back)
      if (front?.kind !== 'sign' || back?.kind !== 'sign') throw new Error('sign tiles')
      front.rows.forEach((row, i) => expect(back.rows[i].arrow, `${s.id} row ${i}`).toBe(flip[row.arrow]))
    }
  })

  it('arrowFor reads a plan the way a walker does (x east, z south)', () => {
    const from = { x: 0, z: 0 }
    const east = { x: 1, z: 0 }
    // facing east: north (-z) is on the left, south (+z) on the right
    expect(arrowFor(from, east, { x: 10, z: 0 })).toBe('ahead')
    expect(arrowFor(from, east, { x: 0, z: -10 })).toBe('left')
    expect(arrowFor(from, east, { x: 0, z: 10 })).toBe('right')
    expect(arrowFor(from, east, { x: -10, z: 0 })).toBe('back')
    // facing north: east is on the right
    expect(arrowFor(from, { x: 0, z: -1 }, { x: 10, z: -2 })).toBe('right')
  })
})

describe('door plates', () => {
  it('a room-number plate beside every patient room door, at eye level, on the corridor side', () => {
    for (const r of ROOMS) {
      const p = walk.plates.find((q) => q.kind === 'room' && q.id === r.id)
      expect(p, r.id).toBeDefined()
      expect(p!.y).toBe(PLATE_Y)
      expect(p!.w).toBe(ROOM_PLATE.w)
      // east of the door, and on the corridor face of the wall
      expect(p!.x).toBeGreaterThan(r.door.x + r.doorWidth / 2)
      expect(p!.x).toBeLessThan(r.drawer.x - DRAWER_GAP / 2)
      expect(Math.sign(p!.z - r.door.z)).toBe(r.ward === 'A' ? 1 : -1)
      expect(Math.abs(p!.z - r.door.z)).toBeGreaterThan(T / 2)
      // it looks into the corridor
      expect(p!.heading).toBeCloseTo(r.ward === 'A' ? 0 : Math.PI, 9)
    }
  })

  it('every main room named in the content has a plate beside its door, and every name is a real door', () => {
    for (const d of DOORS) {
      const copy = doorPlateCopy(d.id)
      const plate = walk.plates.find((p) => p.kind === 'name' && p.id === d.id)
      if (copy && d.a !== d.b) {
        expect(plate, d.id).toBeDefined()
        expect(plate!.w).toBe(NAME_PLATE.w)
      } else expect(plate, d.id).toBeUndefined()
    }
    const names = walk.tiles.filter((t) => t.kind === 'name')
    expect(names.length).toBeGreaterThan(10)
  })

  it('no plate hangs over a door opening, a drawer gap or a perpendicular wall', () => {
    for (const p of walk.plates) {
      const half = p.w / 2 + 0.015
      const along = p.alongX ? p.x : p.z
      const lo = along - half
      const hi = along + half
      for (const d of DOORS) {
        if ((d.wallAxis === 'x') !== p.alongX) continue
        const c = p.alongX ? d.center.z : d.center.x
        if (Math.abs(c - p.line) > 1e-6) continue
        const mid = p.alongX ? d.center.x : d.center.z
        expect(hi <= mid - d.width / 2 + 1e-9 || lo >= mid + d.width / 2 - 1e-9, `${p.id} over door ${d.id}`).toBe(true)
      }
      for (const r of ROOMS) {
        if (!p.alongX || Math.abs(r.drawer.z - p.line) > 1e-6) continue
        expect(hi <= r.drawer.x - DRAWER_GAP / 2 + 1e-9 || lo >= r.drawer.x + DRAWER_GAP / 2 - 1e-9, `${p.id} over the ${r.id} drawer`).toBe(true)
      }
    }
  })
})

// ---------------------------------------------------------------------------------------------
// Corridor furniture
// ---------------------------------------------------------------------------------------------

describe('handrails and corner guards', () => {
  const furniture = walk.boxes.filter((b) => b.part === 'rail' || b.part === 'railBracket' || b.part === 'guard')

  it('there are rails along the corridor walls and guards at the door jambs', () => {
    expect(furniture.filter((b) => b.part === 'rail').length).toBeGreaterThan(20)
    expect(furniture.filter((b) => b.part === 'guard').length).toBeGreaterThan(20)
    for (const b of furniture.filter((b) => b.part === 'rail')) {
      expect(b.y0).toBeGreaterThan(0.8)
      expect(b.y1).toBeLessThan(1.0)
    }
  })

  it('never cross a door opening or a MedDrawer gap', () => {
    const offenders: string[] = []
    for (const b of furniture) {
      for (const d of DOORS) {
        const alongX = d.wallAxis === 'x'
        const c = alongX ? d.center.z : d.center.x
        const mid = alongX ? d.center.x : d.center.z
        const across0 = alongX ? b.z0 : b.x0
        const across1 = alongX ? b.z1 : b.x1
        // a thin box standing off THIS wall's face, in front of its opening (a rail on the perpendicular wall may run past the
        // plane of an opening: the corridor's wall carries on across the junction, and the rail with it)
        const a0 = alongX ? b.x0 : b.z0
        const a1 = alongX ? b.x1 : b.z1
        const onFace = across1 - across0 <= 0.1 && a1 - a0 > 0.2 && across0 >= c - 0.3 && across1 <= c + 0.3
        if (!onFace) continue
        if (a1 > mid - d.width / 2 + 1e-9 && a0 < mid + d.width / 2 - 1e-9) offenders.push(`${b.part} over door ${d.id}`)
      }
      for (const r of ROOMS) {
        if (b.z1 < r.drawer.z - T / 2 - 0.2 || b.z0 > r.drawer.z + T / 2 + 0.2) continue
        if (b.x1 > r.drawer.x - DRAWER_GAP / 2 + 1e-9 && b.x0 < r.drawer.x + DRAWER_GAP / 2 - 1e-9) offenders.push(`${b.part} over the ${r.id} drawer`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('stay >= 0.45 m from every robot lane centre line (the keep-clear rule of the M2 brief)', () => {
    const samples: { x: number; z: number }[] = []
    const p: PathPoint = { x: 0, z: 0, heading: 0 }
    for (const w of ['A', 'B'] as const) for (let s = 0; s < CIRCUITS[w].length; s += 0.05) samples.push({ x: pointAt(CIRCUITS[w], s, p).x, z: p.z })
    let worst = Infinity
    for (const b of furniture) {
      for (const s of samples) {
        if (s.x < b.x0 - 0.6 || s.x > b.x1 + 0.6 || s.z < b.z0 - 0.6 || s.z > b.z1 + 0.6) continue
        const dx = Math.max(b.x0 - s.x, s.x - b.x1, 0)
        const dz = Math.max(b.z0 - s.z, s.z - b.z1, 0)
        worst = Math.min(worst, Math.hypot(dx, dz))
      }
    }
    expect(worst).toBeGreaterThanOrEqual(0.45)
  })
})

// ---------------------------------------------------------------------------------------------
// Door leaves
// ---------------------------------------------------------------------------------------------

describe('door leaves', () => {
  it('every auto and swing door of the building has a leaf, except the pharmacy core\'s (its builder moves those)', () => {
    const want = DOORS.filter((d) => isWalkDoor(d) && (d.kind === 'auto' || d.kind === 'swing')).map((d) => d.id)
    expect(walk.doors.map((d) => d.id)).toEqual(want)
    expect(walk.doors.some((d) => d.id.startsWith('pharmacist'))).toBe(false)
    // swing doors: 16 patient rooms, the staff room, clean supply, the lab (W4), ... on level 1: 21 in all; level 2 adds the theatre staff room
    expect(walk.doors.filter((d) => d.kind === 'swing' && levelOf(d.x) === 1).length).toBe(21)
    expect(walk.doors.filter((d) => d.kind === 'swing' && levelOf(d.x) === 2).map((d) => d.id)).toEqual(['l2Staff'])
    expect(walk.doors.filter((d) => d.kind === 'swing').length).toBe(22)
    // level 2's sliding doors: both lifts, pre-op, sterile supply, the OR and recovery (the hall and the lounge are open passages)
    expect(walk.doors.filter((d) => d.kind === 'auto' && levelOf(d.x) === 2).map((d) => d.id).sort()).toEqual(['l2LiftA', 'l2LiftB', 'l2Or', 'l2Pacu', 'l2PreOp', 'l2Sterile'])
  })

  it('a swing leaf swings into the room beyond and its whole sweep clears every footprint of the layout', () => {
    for (const d of walk.doors.filter((q) => q.kind === 'swing')) {
      const spec = DOORS.find((q) => q.id === d.id)!
      expect(d.maxAngle, d.id).toBeGreaterThanOrEqual((55 * Math.PI) / 180)
      // into the room: toward the middle of area b
      const rb = areaById(spec.b).rect
      const toward = d.wallAxis === 'x' ? (rb.z0 + rb.z1) / 2 - d.z : (rb.x0 + rb.x1) / 2 - d.x
      expect(Math.sign(toward), d.id).toBe(d.wallAxis === 'x' ? d.into.z : d.into.x)
      const hx = d.x + d.hinge * d.along.x * (d.width / 2)
      const hz = d.z + d.hinge * d.along.z * (d.width / 2)
      expect(sweepIsClear(hx, hz, d.along, d.hinge, d.into, d.width - 0.04, d.maxAngle, layout.footprints), d.id).toBe(true)
    }
  })

  it('the swing doors are double-acting: the same sweep (same hinge, same widest angle) also clears every footprint on the side the leaf comes from', () => {
    for (const d of walk.doors.filter((q) => q.kind === 'swing')) {
      const hx = d.x + d.hinge * d.along.x * (d.width / 2)
      const hz = d.z + d.hinge * d.along.z * (d.width / 2)
      const back = { x: -d.into.x, z: -d.into.z }
      expect(sweepIsClear(hx, hz, d.along, d.hinge, back, d.width - 0.04, d.maxAngle, layout.footprints), d.id).toBe(true)
    }
  })

  it('the patient rooms\' doors all open wide, hinged on the side away from the bed', () => {
    for (const r of ROOMS) {
      const d = walk.doors.find((q) => q.id === `room:${r.id}`)!
      expect(d.maxAngle).toBeCloseTo((85 * Math.PI) / 180, 9)
      expect(d.hinge).toBe(1)
    }
  })

  it('every sliding leaf rides off the wall line so it clears thin glass, toward the area people come from', () => {
    for (const d of walk.doors.filter((q) => q.kind === 'auto')) expect(Math.abs(d.offset), d.id).toBeCloseTo(0.06, 9)
  })
})

// ---------------------------------------------------------------------------------------------
// Determinism, switching rules and the budget
// ---------------------------------------------------------------------------------------------

describe('walk layout', () => {
  it('is deterministic: building twice gives identical output', () => {
    expect(JSON.stringify(buildWalkLayout(buildLayout()))).toBe(JSON.stringify(walk))
  })

  it('leaves the overview layout untouched: no walk part is in layout.prims, and the cut walls stay at the cut', () => {
    for (const p of layout.prims.filter((q) => q.mat === 'wall')) expect(p.position[1] + p.size[1] / 2).toBeLessThanOrEqual(CUT + 1e-9)
    // (the architect's model base outside the walls, the plinth, lawns and paving, is overview-only too: src/scene/landscape/exterior.ts hands the
    // ground to the real exterior while walking)
    const modelBase = new Set(['plinth', 'grass', 'stonePath', 'concrete'])
    const overview = layout.prims.filter((p) => p.overviewOnly && !modelBase.has(p.mat))
    // the parked sliding leaves of the patient rooms (a mint panel and its track each) are the only overview-only parts inside
    expect(overview).toHaveLength(ROOMS.length * 2)
    expect(overview.filter((p) => p.mat === 'wallMint')).toHaveLength(ROOMS.length)
  })
})

describe('walk-mode budget (W1: <= 25 draw calls and <= 150 k triangles on top of the building; R2: level 2 has its own, the same size)', () => {
  const atlas = packAtlas(walk.tiles)
  const level1 = walkLayoutOfLevel(walk, 1)
  const level2 = walkLayoutOfLevel(walk, 2)
  const compiled = compileWalk(level1, atlas)
  const compiled2 = compileWalk(level2, atlas)
  const budget = estimateWalkBudget(compiled)
  const budget2 = estimateWalkBudget(compiled2)

  it('reports the estimate', () => {
    // eslint-disable-next-line no-console
    console.log(
      `walk-mode additions: level 1 ${budget.drawCalls} draw calls (${budget.chunkMeshes} chunk meshes of ${CHUNK_COUNT} chunks, glass, signs, 3 door meshes), ${budget.triangles} triangles; level 2 ${budget2.drawCalls} draw calls, ${budget2.triangles} triangles; ${walk.boxes.length} boxes, ${walk.ceilings.length} ceiling pieces, ${walk.quads.length} sign and plate pictures; atlas ${atlas.width} x ${atlas.height}`,
    )
    expect(budget.drawCalls).toBeGreaterThan(5)
  })

  it('is within 25 draw calls (each level)', () => {
    expect(budget.drawCalls).toBeLessThanOrEqual(25)
    expect(budget2.drawCalls).toBeLessThanOrEqual(25)
  })

  it('is within 150 k triangles (each level)', () => {
    expect(budget.triangles).toBeLessThanOrEqual(150_000)
    expect(budget2.triangles).toBeLessThanOrEqual(150_000)
  })

  it('level 2 is its own chunk (never the atrium chunk next to it in x): one wall, one frame and one ceiling mesh, all east of the split', () => {
    expect(CHUNK_EDGES[CHUNK_EDGES.length - 1]).toBe(70)
    const chunk = compiled2.chunks.filter((c) => c.wall || c.frame || c.ceiling)
    expect(chunk.map((c) => c.index)).toEqual([CHUNK_COUNT - 1])
    for (const c of compiled.chunks) for (const g of [c.wall, c.frame, c.ceiling]) if (g?.boundingBox) expect(g.boundingBox.max.x).toBeLessThan(70)
    // level 1 holds no level-2 piece
    expect(level1.boxes.every((b) => levelOf((b.x0 + b.x1) / 2) === 1)).toBe(true)
    expect(level2.boxes.every((b) => levelOf((b.x0 + b.x1) / 2) === 2)).toBe(true)
  })

  it('compiles deterministically', () => {
    const again = buildWalkLayout(buildLayout())
    const a2 = packAtlas(again.tiles)
    expect(estimateWalkBudget(compileWalk(walkLayoutOfLevel(again, 1), a2))).toEqual(budget)
    expect(estimateWalkBudget(compileWalk(walkLayoutOfLevel(again, 2), a2))).toEqual(budget2)
  })

  it('merges per chunk: no mesh of a chunk reaches into another (long walls are cut at the chunk edges)', () => {
    const edges = CHUNK_EDGES
    compiled.chunks.forEach((ch) => {
      const lo = ch.index === 0 ? -Infinity : edges[ch.index - 1]
      const hi = ch.index === edges.length ? Infinity : edges[ch.index]
      for (const g of [ch.wall, ch.frame, ch.ceiling]) {
        if (!g?.boundingBox) continue
        // boxes are assigned by their centre after cutting at the edges, so each stays inside its band
        expect(g.boundingBox.min.x).toBeGreaterThanOrEqual(lo - 1e-6)
        expect(g.boundingBox.max.x).toBeLessThanOrEqual(hi + 1e-6)
      }
    })
  })

  it('the atlas is small: every cell inside it, none overlapping', () => {
    const cells = [...atlas.cells.values()]
    expect(cells.length).toBe(walk.tiles.length)
    for (const c of cells) {
      expect(c.x).toBeGreaterThanOrEqual(0)
      expect(c.y).toBeGreaterThanOrEqual(0)
      expect(c.x + c.w).toBeLessThanOrEqual(atlas.width)
      expect(c.y + c.h).toBeLessThanOrEqual(atlas.height)
    }
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const a = cells[i]
        const b = cells[j]
        expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true)
      }
    }
    // (R2: level 2's three signs and eight plates took it from 1536 rows to 1792)
    expect(atlas.width * atlas.height).toBeLessThanOrEqual(2048 * 1792)
  })
})

// ---------------------------------------------------------------------------------------------
// The shadow rule: nothing walk-only casts into the baked sun shadow
// ---------------------------------------------------------------------------------------------

describe('the baked sun shadow stays valid', () => {
  const dir = join(process.cwd(), 'src/scene/building/render/walk')
  const files = (d: string, out: string[] = []): string[] => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) files(p, out)
      else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(p)
    }
    return out
  }
  const code = (f: string): string => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('no walk-mode mesh sets castShadow or receiveShadow to anything but false, and nothing touches the shadow map or asks for a re-bake', () => {
    const offenders: string[] = []
    for (const f of files(dir)) {
      const src = code(f)
      const name = relative(process.cwd(), f)
      if (/castShadow/.test(src.replace(/castShadow\s*=\s*false/g, ''))) offenders.push(`${name}: castShadow other than false`)
      if (/receiveShadow/.test(src.replace(/receiveShadow\s*=\s*false/g, ''))) offenders.push(`${name}: receiveShadow other than false`)
      if (/shadowMap|invalidateShadows|lightRig/.test(src)) offenders.push(`${name}: shadow map or light rig`)
    }
    expect(offenders).toEqual([])
  })

  it('the walk-mode building is only ever shown or hidden: no per-frame rebuild, no material recompile', () => {
    const src = code(join(dir, 'WalkBuilding.tsx'))
    expect(src).not.toMatch(/(?:material|mat|MAT\.\w+|mats\.\w+)\.needsUpdate/)
    expect(src).not.toMatch(/\.defines\b/)
    expect(src).toMatch(/\.visible\s*=/)
  })
})
