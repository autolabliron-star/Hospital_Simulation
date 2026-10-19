/**
 * Level 2's walk-mode building (R2), the pure parts: its doors are sensed in SIM coordinates (where the people and you are), each level has its own bank,
 * the leaves it writes and the solid boxes it publishes stay in the level-2 strip (the group moves them, nothing here maps), and the level-2 sign pictures
 * live in the one shared atlas.
 */
import { describe, expect, it } from 'vitest'
import { BLOCKER_STRIDE } from '@/scene/blockers'
import { LEVEL2_STRIP, l2, levelOf } from '@/sim/levels'
import { DOORS } from '@/sim/places'
import { buildLayout } from '../../layout'
import { buildWalkLayout, walkLayoutOfLevel } from '../../layout/walk'
import { DoorBank, type PersonLike } from './doorBank'
import { leafBlockerCount, writeAutoDoor, writeLeafBlockers, writeSwingDoor } from './doorMatrices'
import { packAtlas } from './signAtlas'
import { compileWalk } from './walkGeometry'

const walk = buildWalkLayout(buildLayout())
const level1 = walkLayoutOfLevel(walk, 1)
const level2 = walkLayoutOfLevel(walk, 2)
const person = (x: number, z: number): PersonLike => ({ entity: { position: { x, z } } })
const run = (bank: DoorBank, seconds: number, people: PersonLike[], player: { x: number; z: number } | null = null): void => {
  for (let i = 0; i < Math.round(seconds * 60); i++) bank.update(1 / 60, people, player)
}

describe('level 2 has its own doors, in sim coordinates', () => {
  it('splits the doors by level: 22 on level 1 minus the pharmacy core\'s, and the seven level-2 leaves', () => {
    expect(level2.doors.map((d) => d.id).sort()).toEqual(['l2LiftA', 'l2LiftB', 'l2Or', 'l2Pacu', 'l2PreOp', 'l2Staff', 'l2Sterile'])
    expect(level1.doors.length + level2.doors.length).toBe(walk.doors.length)
    for (const d of level2.doors) {
      expect(levelOf(d.x), d.id).toBe(2)
      expect(d.x).toBeGreaterThan(LEVEL2_STRIP.x0)
      expect(d.x).toBeLessThanOrEqual(LEVEL2_STRIP.x1)
    }
    for (const d of level1.doors) expect(levelOf(d.x), d.id).toBe(1)
  })

  it('every level-2 door opens for a person standing at it (a bank of its own), either side', () => {
    for (const door of DOORS.filter((d) => d.id.startsWith('l2'))) {
      const i = level2.doors.findIndex((d) => d.id === door.id)
      if (i < 0) continue // an open passage has no leaf
      const d = level2.doors[i]
      for (const s of [-1, 1]) {
        const bank = new DoorBank(level2.doors)
        run(bank, 1.2, [person(d.x + d.into.x * s * 1.0, d.z + d.into.z * s * 1.0)])
        expect(bank.shown[i], `${d.id} from side ${s}`).toBe(1)
      }
    }
  })

  it('the banks do not hear each other: a person on level 2 opens nothing on level 1, and the other way round', () => {
    const upper = new DoorBank(level2.doors)
    const lower = new DoorBank(level1.doors)
    const or = level2.doors.find((d) => d.id === 'l2Or')!
    const entrance = level1.doors.find((d) => d.id === 'entrance')!
    run(upper, 1.5, [person(or.x, or.z + 1)])
    run(lower, 1.5, [person(or.x, or.z + 1)])
    expect(upper.shown[level2.doors.indexOf(or)]).toBe(1)
    expect(Array.from(lower.shown).every((v) => v === 0)).toBe(true)
    const upper2 = new DoorBank(level2.doors)
    const lower2 = new DoorBank(level1.doors)
    run(upper2, 1.5, [person(entrance.x + 1, entrance.z)])
    run(lower2, 1.5, [person(entrance.x + 1, entrance.z)])
    expect(Array.from(upper2.shown).every((v) => v === 0)).toBe(true)
    expect(lower2.shown[level1.doors.indexOf(entrance)]).toBe(1)
  })

  it('you open the level-2 doors too (the player is sensed where the sim has you), and the lift lobby doors stir as you come out of the car', () => {
    const lift = level2.doors.find((d) => d.id === 'l2LiftA')!
    const bank = new DoorBank(level2.doors)
    run(bank, 1.2, [], { x: l2(-42), z: -17.5 })
    expect(bank.shown[level2.doors.indexOf(lift)]).toBe(1)
  })

  it('the leaves and the blockers it writes lie in the level-2 strip: the sim\'s own coordinates (the group translates the drawing, the player collides in sim space)', () => {
    const bank = new DoorBank(level2.doors)
    bank.snapOpenNear({ x: l2(-47), z: 2.2 })
    for (const shown of [0, 0.5, 1]) {
      const out = new Float64Array(leafBlockerCount(level2.doors) * BLOCKER_STRIDE)
      const shownAll = new Float32Array(level2.doors.length).fill(shown)
      const n = writeLeafBlockers(level2.doors, shownAll, out, bank.swing)
      expect(n).toBe(leafBlockerCount(level2.doors))
      for (let k = 0; k < n; k++) {
        const cx = out[k * BLOCKER_STRIDE]
        const cz = out[k * BLOCKER_STRIDE + 1]
        expect(cx).toBeGreaterThan(LEVEL2_STRIP.x0 - 0.5)
        expect(cx).toBeLessThan(LEVEL2_STRIP.x1 + 0.5)
        expect(cz).toBeGreaterThan(-22.5)
        expect(cz).toBeLessThan(22.5)
      }
    }
    const glass = new Float32Array(16 * level2.doors.length * 2)
    const bars = new Float32Array(16 * level2.doors.length * 2 * 4)
    const leaves = new Float32Array(16 * 2)
    const autos = level2.doors.filter((d) => d.kind === 'auto')
    autos.forEach((d, slot) => writeAutoDoor(glass, bars, slot, d, 0.5))
    const swing = level2.doors.filter((d) => d.kind === 'swing')
    swing.forEach((d, slot) => writeSwingDoor(leaves, slot, d, 0.5, 1))
    for (let i = 0; i < autos.length * 2; i++) expect(glass[i * 16 + 12], 'leaf x').toBeGreaterThan(LEVEL2_STRIP.x0 - 1)
    expect(leaves[12]).toBeGreaterThan(LEVEL2_STRIP.x0)
  })
})

describe('level 2 compiles apart, on the shared sign atlas', () => {
  const atlas = packAtlas(walk.tiles)

  it('its signs, plates and pictures are in the one atlas the two levels share, and its quads are all on level 2', () => {
    const c = compileWalk(level2, atlas)
    expect(c.signs).not.toBeNull()
    expect(level2.quads.length).toBe(3 * 2 + 9) // 3 signs x 2 faces + the name plates of its nine doors
    for (const q of level2.quads) expect(atlas.cells.has(q.tile), q.tile).toBe(true)
    for (const q of level1.quads) expect(levelOf(q.cx)).toBe(1)
    // level 2's walk meshes: chunk 4 only, and glass over its window walls
    expect(c.glass).not.toBeNull()
    expect(c.chunks.filter((ch) => ch.wall || ch.frame || ch.ceiling).map((ch) => ch.index)).toEqual([4])
    // level 1 has no geometry over level 2's strip
    const c1 = compileWalk(level1, atlas)
    for (const ch of c1.chunks) for (const g of [ch.wall, ch.frame, ch.ceiling]) if (g?.boundingBox) expect(g.boundingBox.max.x).toBeLessThan(70)
    c1.glass?.computeBoundingBox()
    expect(c1.glass!.boundingBox!.max.x).toBeLessThan(70)
  })
})
