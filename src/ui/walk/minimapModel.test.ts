import { describe, expect, it } from 'vitest'
import { AREAS, BUILDING, DEPARTURES, LOBBY, PLAYER_PLAZA, PLAYER_SPAWN, ROOMS, areaById } from '@/sim/places'
import { CIRCUITS } from '@/sim/meds/circuit'
import {
  ARROW_COLOR,
  MAP_BOUNDS,
  MAP_LABELS,
  POD_COLOR,
  arrowAngle,
  fallbackAreas,
  labelBox,
  labelLayout,
  mapFrame,
  pulse,
  toMapX,
  toMapY,
} from './minimapModel'

describe('the frame', () => {
  const f = mapFrame(354)

  it('fits the whole bounds into the width, at the shape of the plan', () => {
    expect(f.scale).toBeCloseTo(354 / (MAP_BOUNDS.x1 - MAP_BOUNDS.x0), 9)
    expect(f.width).toBe(354)
    expect(f.height).toBeCloseTo((MAP_BOUNDS.z1 - MAP_BOUNDS.z0) * f.scale, 9)
  })

  it('puts the corners of the bounds on the corners of the map', () => {
    expect(toMapX(f, MAP_BOUNDS.x0)).toBe(0)
    expect(toMapY(f, MAP_BOUNDS.z0)).toBe(0)
    expect(toMapX(f, MAP_BOUNDS.x1)).toBeCloseTo(f.width, 9)
    expect(toMapY(f, MAP_BOUNDS.z1)).toBeCloseTo(f.height, 9)
  })

  it('is north-up: a point further north (smaller z) is higher on the map, further east is further right', () => {
    expect(toMapY(f, -10)).toBeLessThan(toMapY(f, 10))
    expect(toMapX(f, 10)).toBeGreaterThan(toMapX(f, -10))
  })

  it('scales linearly: a metre is `scale` pixels in both directions', () => {
    expect(toMapX(f, 5) - toMapX(f, 4)).toBeCloseTo(f.scale, 9)
    expect(toMapY(f, 5) - toMapY(f, 4)).toBeCloseTo(f.scale, 9)
  })
})

describe('everything you may want to point at is on the map', () => {
  const f = mapFrame(300)
  const inside = (x: number, z: number): boolean => {
    const px = toMapX(f, x)
    const py = toMapY(f, z)
    return px >= 0 && px <= f.width && py >= 0 && py <= f.height
  }

  it('holds the building, the apron where you start and the spawn', () => {
    expect(inside(BUILDING.x0, BUILDING.z0)).toBe(true)
    expect(inside(BUILDING.x1, BUILDING.z1)).toBe(true)
    expect(inside(PLAYER_PLAZA.x0, PLAYER_PLAZA.z0)).toBe(true)
    expect(inside(PLAYER_PLAZA.x1, PLAYER_PLAZA.z1)).toBe(true)
    expect(inside(PLAYER_SPAWN.at.x, PLAYER_SPAWN.at.z)).toBe(true)
  })

  it('holds every room door and MedDrawer, both ward circuits and the lifts and kiosks', () => {
    for (const r of ROOMS) {
      expect(inside(r.door.x, r.door.z), r.id).toBe(true)
      expect(inside(r.drawer.x, r.drawer.z), r.id).toBe(true)
    }
    for (const w of ['A', 'B'] as const) expect(CIRCUITS[w].length).toBeGreaterThan(0)
    for (const l of DEPARTURES.lifts) expect(inside(l.x, l.z)).toBe(true)
    for (const k of LOBBY.kiosks) expect(inside(k.x, k.z)).toBe(true)
  })
})

describe('the arrow', () => {
  it('points the way you face: south is down, north is up, east is right, west is left', () => {
    // an arrow drawn pointing up (north, -y), rotated by the angle, lands on the heading's direction (sin h, cos h) in map pixels
    const point = (heading: number): [number, number] => {
      const a = arrowAngle(heading)
      return [Math.sin(a), -Math.cos(a)]
    }
    const near = (got: [number, number], want: [number, number]) => {
      expect(got[0]).toBeCloseTo(want[0], 9)
      expect(got[1]).toBeCloseTo(want[1], 9)
    }
    near(point(0), [0, 1]) // heading 0 faces +z: south, down the map
    near(point(Math.PI), [0, -1]) // north
    near(point(Math.PI / 2), [1, 0]) // east
    near(point(-Math.PI / 2), [-1, 0]) // west
  })

  it('has your arrow face into the entrance at the start (east)', () => {
    const a = arrowAngle(PLAYER_SPAWN.heading)
    expect(Math.sin(a)).toBeCloseTo(1, 9)
  })
})

describe('colours', () => {
  it('gives every pod light its own, and a vivid arrow', () => {
    expect(new Set(Object.values(POD_COLOR)).size).toBe(4)
    expect(Object.keys(POD_COLOR).sort()).toEqual(['amber', 'green', 'teal', 'white'])
    expect(ARROW_COLOR).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('the area labels', () => {
  const f = mapFrame(278)

  it('name real areas, once each, in a few short letters', () => {
    expect(new Set(MAP_LABELS.map((l) => l.area)).size).toBe(MAP_LABELS.length)
    for (const l of MAP_LABELS) {
      expect(() => areaById(l.area), l.area).not.toThrow()
      expect(l.text.length, l.area).toBeLessThanOrEqual(9)
    }
  })

  it('are centred in their room, and the room size says whether the word fits', () => {
    const lobby = labelBox(f, 'lobby')
    expect(lobby.x).toBeCloseTo(toMapX(f, -53), 9)
    expect(lobby.y).toBeCloseTo(toMapY(f, 0), 9)
    expect(labelLayout(lobby, 26, 9)).toBe('h')
    // a 6 m wide room is too narrow for "X-ray" at this size, either way up
    expect(labelLayout(labelBox(f, 'xray'), 26, 9)).toBeNull()
    expect(labelLayout({ x: 0, y: 0, w: 100, h: 8 }, 20, 9)).toBeNull()
  })

  it('names the lab ("Lab"): its room is 6 m wide, so the word fits on a larger map but not on this small one', () => {
    expect(MAP_LABELS).toContainEqual({ area: 'lab', text: 'Lab' })
    expect(labelLayout(labelBox(f, 'lab'), 16, 9)).toBeNull()
    expect(labelLayout(labelBox(mapFrame(420), 'lab'), 16, 9)).toBe('h')
  })

  it('turns a label a quarter to fit a tall, narrow room (the command center)', () => {
    const command = labelBox(f, 'command')
    expect(command.h).toBeGreaterThan(command.w)
    expect(labelLayout(command, 38, 9)).toBe('v')
  })

  it('leaves the big areas room enough to be named', () => {
    for (const [a, width] of [['lobby', 26], ['atrium', 31], ['core', 44], ['er', 14], ['triage', 30]] as const) expect(labelLayout(labelBox(f, a), width, 9), a).toBe('h')
  })
})

describe('the fallback plan', () => {
  it('draws every area, the largest first, so the small ones are not hidden under a band', () => {
    const list = fallbackAreas()
    expect(list.length).toBe(AREAS.length)
    const size = (a: (typeof list)[number]): number => (a.rect.x1 - a.rect.x0) * (a.rect.z1 - a.rect.z0)
    for (let i = 1; i < list.length; i++) expect(size(list[i])).toBeLessThanOrEqual(size(list[i - 1]))
  })
})

describe('the pulse', () => {
  it('swells and fades between 0 and 1 every 1.2 seconds', () => {
    expect(pulse(0)).toBeCloseTo(0, 9)
    expect(pulse(600)).toBeCloseTo(1, 9)
    expect(pulse(1200)).toBeCloseTo(0, 9)
    for (let t = 0; t < 3000; t += 50) {
      expect(pulse(t)).toBeGreaterThanOrEqual(0)
      expect(pulse(t)).toBeLessThanOrEqual(1)
    }
  })
})
