import { describe, expect, it } from 'vitest'
import { LEVEL2_FOOTPRINT, LEVEL_Y, LEVEL2_DX, toDisplayInto, type LevelId } from '@/sim/levels'
import { AREAS, areaById, type AreaId } from '@/sim/places'
import { CLICK_MAX_MOVE_PX, classifyPress, intersectFloor, intersectLevels, pickArea, tintBox, type LevelHit, type TintBox } from './pick'

/** A ray from a camera 60 m up and 45 m south of `aim` (the overview's look: about 53 degrees down), through the DRAWN point `aim`. */
function rayAt(aim: { x: number; y: number; z: number }, shown: LevelId) {
  const o = { x: aim.x, y: aim.y + 60, z: aim.z + 45 }
  const hit: LevelHit = { x: 0, z: 0, level: 1 }
  const area = pickArea(o.x, o.y, o.z, aim.x - o.x, aim.y - o.y, aim.z - o.z, shown, hit)
  return { area, hit }
}

/** The centre of an area's floor as drawn. */
function drawnCentre(id: AreaId): { x: number; y: number; z: number } {
  const r = areaById(id).rect
  const out = { x: (r.x0 + r.x1) / 2, y: 0, z: (r.z0 + r.z1) / 2 }
  // a level-2 area is in the sim strip; as drawn it is moved west and up
  return toDisplayInto(out, out)
}

const L2_AREAS = AREAS.filter((a) => a.id.startsWith('l2')).map((a) => a.id)

describe('picking a floor at level 1 (as ever)', () => {
  it('meets y = 0, in sim coordinates, on level 1', () => {
    const { area, hit } = rayAt({ x: -35.5, y: 0, z: -8 }, 1)
    expect(area?.id).toBe('mri')
    expect(hit.level).toBe(1)
    expect(hit.x).toBeCloseTo(-35.5, 9)
    expect(hit.z).toBeCloseTo(-8, 9)
  })

  it('never picks level 2 while level 1 is shown, even through the footprint', () => {
    // a ray that would hit the level-2 floor at the drawn lobby spot lands on the ground floor instead, under the slab
    const aim = { x: -50.8, y: LEVEL_Y[2], z: 5.9 }
    const { area, hit } = rayAt(aim, 1)
    expect(area?.id.startsWith('l2')).toBe(false)
    expect(hit.level).toBe(1)
  })

  it('misses when the ray points up or along the floor', () => {
    const hit: LevelHit = { x: 0, z: 0, level: 1 }
    expect(intersectLevels(0, 50, 0, 0, 0.5, -1, 1, hit)).toBe(false)
    expect(intersectLevels(0, 50, 0, 0, 0, -1, 2, hit)).toBe(false)
    expect(pickArea(0, 50, 0, 0, 1, 0, 2, hit)).toBeNull()
  })
})

describe('picking with Level 2 shown', () => {
  it('meets level 2 first: the point is drawn at y = 4.2, in the footprint, and is mapped back to the sim strip', () => {
    // the OR's table, as drawn
    const { area, hit } = rayAt({ x: -49.2, y: LEVEL_Y[2], z: 5.9 }, 2)
    expect(area?.id).toBe('l2Or')
    expect(hit.level).toBe(2)
    expect(hit.x).toBeCloseTo(-49.2 + LEVEL2_DX, 9)
    expect(hit.z).toBeCloseTo(5.9, 9)
  })

  it('finds every level-2 room from above its centre, and each one is a level-2 area (never a ground-floor room under it)', () => {
    expect(L2_AREAS.length).toBe(10)
    for (const id of L2_AREAS) {
      const { area, hit } = rayAt(drawnCentre(id), 2)
      expect(area?.id, id).toBe(id)
      expect(hit.level, id).toBe(2)
    }
  })

  it('covers the whole footprint: every point of it is some level-2 area, so the ground floor under the slab is not picked from above', () => {
    const r = LEVEL2_FOOTPRINT
    for (let x = r.x0 + 0.5; x < r.x1; x += 3) {
      for (let z = r.z0 + 0.5; z < r.z1; z += 3) {
        const { area } = rayAt({ x, y: LEVEL_Y[2], z }, 2)
        expect(area?.id.startsWith('l2'), `${x},${z}`).toBe(true)
      }
    }
  })

  it('falls back to y = 0 outside the footprint: ground-floor rooms next to the slab stay pickable', () => {
    for (const [id, aim] of [
      ['mri', { x: -35.5, y: 0, z: -8 }],
      ['atrium', { x: 26, y: 0, z: 0 }],
      ['core', areaCentre('core')],
      ['lab', areaCentre('lab')],
    ] as const) {
      const { area, hit } = rayAt(aim, 2)
      expect(area?.id, id).toBe(id)
      expect(hit.level, id).toBe(1)
    }
  })

  it('a ray that passes the level-2 plane outside the footprint and reaches the ground under its edge picks the ground-floor room there', () => {
    // from the south, shallow: crosses y = 4.2 at z = 24 (outside the footprint, z1 = 22) and lands at y = 0 about 3 m on, under the slab
    const o = { x: -50, y: 20, z: 60 }
    const aim = { x: -50, y: 0, z: 21 }
    const hit: LevelHit = { x: 0, z: 0, level: 1 }
    const area = pickArea(o.x, o.y, o.z, aim.x - o.x, aim.y - o.y, aim.z - o.z, 2, hit)
    const crossing = intersectFloor(o.x, o.y, o.z, aim.x - o.x, aim.y - o.y, aim.z - o.z, { x: 0, z: 0 }, LEVEL_Y[2])
    expect(crossing).toBe(true)
    expect(hit.level).toBe(1)
    expect(area?.id).toBe('er')
  })

  it('misses nothing it should not: outside the building at level 2 is null', () => {
    const { area } = rayAt({ x: -70, y: 0, z: 0 }, 2)
    expect(area).toBeNull()
  })
})

describe('the hover tint', () => {
  const out: TintBox = { x: 0, y: 0, z: 0, w: 0, d: 0 }

  it('stays on the floor of a level-1 room', () => {
    const r = areaById('lobby').rect
    tintBox(r, 0.022, out)
    expect(out).toEqual({ x: -53, y: 0.022, z: 0, w: 18, d: 12 })
  })

  it('is lifted by the level-2 floor and drawn where the room stands, over the footprint', () => {
    for (const id of L2_AREAS) {
      const r = areaById(id).rect
      tintBox(r, 0.022, out)
      expect(out.y, id).toBeCloseTo(LEVEL_Y[2] + 0.022, 9)
      // the centre is inside the drawn footprint (not 150 m east in the strip), and the size is the room's
      expect(out.x - out.w / 2, id).toBeGreaterThanOrEqual(LEVEL2_FOOTPRINT.x0 - 1e-9)
      expect(out.x + out.w / 2, id).toBeLessThanOrEqual(LEVEL2_FOOTPRINT.x1 + 1e-9)
      expect(out.z - out.d / 2, id).toBeGreaterThanOrEqual(LEVEL2_FOOTPRINT.z0 - 1e-9)
      expect(out.z + out.d / 2, id).toBeLessThanOrEqual(LEVEL2_FOOTPRINT.z1 + 1e-9)
      expect(out.w).toBeCloseTo(r.x1 - r.x0, 9)
      expect(out.d).toBeCloseTo(r.z1 - r.z0, 9)
    }
  })
})

describe('click or drag (unchanged)', () => {
  it('is a click when short and still, a drag when it moved, a hold when it lasted', () => {
    expect(classifyPress(2, 120)).toBe('click')
    expect(classifyPress(CLICK_MAX_MOVE_PX, 120)).toBe('drag')
    expect(classifyPress(1, 600)).toBe('hold')
  })
})

function areaCentre(id: AreaId): { x: number; y: number; z: number } {
  const r = areaById(id).rect
  return { x: (r.x0 + r.x1) / 2, y: 0, z: (r.z0 + r.z1) / 2 }
}
