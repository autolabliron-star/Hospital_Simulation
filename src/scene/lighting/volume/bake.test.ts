import { describe, expect, it } from 'vitest'
import { AREAS, BUILDING, ceilingHeight } from '@/sim/places'
import { AO_RADIUS, VolumeBaker, bakeLightVolume, sampleVolume, texel } from './bake'
import { VOLUME_GRID, buildVolumeInput, gridSize, panelsOf, type PanelLight, type VolumeArea, type VolumeGrid, type VolumeInput } from './input'

const REAL: VolumeInput = buildVolumeInput()
const out = new Float32Array(4)

/** Channel of the real volume at a world point (trilinear, as the GPU reads it). */
function at(data: Uint8Array, input: VolumeInput, x: number, y: number, z: number, ch: 0 | 1 | 2 | 3): number {
  sampleVolume(data, input, x, y, z, out)
  return out[ch]
}

/** A tiny hospital: a lit room, a dark room (a ceiling but no panels) behind a wall, and an open yard. */
function tiny(): VolumeInput {
  const grid: VolumeGrid = { x0: 0, y0: 0, z0: 0, cell: 0.5, layer: 0.6, nx: 60, nz: 20, ny: 6 }
  const panels: PanelLight[] = []
  for (const x of [2, 5, 8]) for (const z of [2.5, 7.5]) panels.push({ x, z, area: 1 })
  const areas: VolumeArea[] = [
    { id: 'lit', x0: 0, x1: 10, z0: 0, z1: 10, ceiling: 3, nested: false, panels },
    { id: 'dark', x0: 10, x1: 20, z0: 0, z1: 10, ceiling: 3, nested: false, panels: [] },
    { id: 'yard', x0: 20, x1: 30, z0: 0, z1: 10, ceiling: null, nested: false, panels: [] },
  ]
  return {
    grid,
    areas,
    walls: [
      { x0: 9.9, x1: 10.1, z0: 0, z1: 10, weight: 1 },
      { x0: 19.9, x1: 20.1, z0: 0, z1: 10, weight: 0.3 },
    ],
    windows: [{ alongX: false, c: 10, a: 0, b: 10, side: 1, y1: 3, area: 1, strength: 1 }],
    cutHeight: 1.3,
  }
}

describe('the light volume bake', () => {
  const real = bakeLightVolume(REAL)

  it('is 204 x 88 x 6 RGBA8 texels, about 430 KB', () => {
    expect(VOLUME_GRID.nx).toBe(204)
    expect(VOLUME_GRID.nz).toBe(88)
    expect(VOLUME_GRID.ny).toBe(6)
    expect(real.length).toBe(204 * 88 * 6 * 4)
    expect(real.byteLength).toBeGreaterThan(420_000)
    expect(real.byteLength).toBeLessThan(440_000)
    const size = gridSize(VOLUME_GRID)
    expect(size.x).toBeCloseTo(BUILDING.x1 - BUILDING.x0, 9)
    expect(size.z).toBeCloseTo(BUILDING.z1 - BUILDING.z0, 9)
    expect(size.y).toBeGreaterThanOrEqual(3.3)
  })

  it('is deterministic: two bakes are byte for byte the same', () => {
    const again = bakeLightVolume(buildVolumeInput())
    expect(Buffer.compare(Buffer.from(real), Buffer.from(again))).toBe(0)
  })

  it('uses every channel, and every texel is a value in 0..1', () => {
    const max = [0, 0, 0, 0]
    const min = [255, 255, 255, 255]
    for (let i = 0; i < real.length; i++) {
      max[i & 3] = Math.max(max[i & 3], real[i])
      min[i & 3] = Math.min(min[i & 3], real[i])
    }
    for (let c = 0; c < 4; c++) expect(max[c], `channel ${c} is used`).toBeGreaterThan(100)
    expect(min[2], 'walk AO has occlusion somewhere').toBeLessThan(200)
    expect(min[3], 'overview AO has occlusion somewhere').toBeLessThan(250)
    // the channels are bytes, so 0..1 holds by construction; what could break is a NaN becoming 0 everywhere
    const zeros = Array.from({ length: 4 }, (_, c) => {
      let n = 0
      for (let i = c; i < real.length; i += 4) if (real[i] === 0) n++
      return n / (real.length / 4)
    })
    expect(zeros[2]).toBeLessThan(0.001) // AO is never 0
    expect(zeros[3]).toBeLessThan(0.001)
  })

  it('bakes in well under 150 ms', () => {
    const t0 = performance.now()
    bakeLightVolume(buildVolumeInput())
    expect(performance.now() - t0).toBeLessThan(150)
  })

  it('panel light: under a panel more than between panels, and between panels more than in a room with no panels', () => {
    const er = REAL.areas.find((a) => a.id === 'er')!
    expect(er.panels.length).toBeGreaterThanOrEqual(4)
    // a panel that has a neighbour east of it (the same row)
    const row = er.panels.filter((p) => Math.abs(p.z - er.panels[8].z) < 0.01).sort((a, b) => a.x - b.x)
    const p = row[1]
    const q = row[2]
    const midX = (p.x + q.x) / 2
    for (const y of [1.5, 2.1]) {
      const under = at(real, REAL, p.x, y, p.z, 0)
      const between = at(real, REAL, midX, y, p.z, 0)
      expect(under, `under a panel at ${y} m`).toBeGreaterThan(between + 0.05)
    }
    // between panels, mid-room, is lit; a room with a ceiling and no panels is not
    const tinyIn = tiny()
    const tinyData = bakeLightVolume(tinyIn)
    expect(at(real, REAL, midX, 1.5, p.z, 0)).toBeGreaterThan(0.3)
    expect(at(tinyData, tinyIn, 15, 1.5, 5, 0)).toBe(0)
    expect(at(tinyData, tinyIn, 5, 1.5, 5, 0)).toBeGreaterThan(0.3)
  })

  it('a wall stops the light: into a dark neighbouring room the panel term drops by at least 80 %', () => {
    const tinyIn = tiny()
    const tinyData = bakeLightVolume(tinyIn)
    const t = [0, 0, 0, 0]
    // texel centres 0.25 m either side of the wall at x = 10 (no filtering across the wall)
    for (const [iz, iy] of [[10, 1], [8, 2], [12, 1], [6, 3]] as const) {
      texel(tinyData, tinyIn, 19, iz, iy, t)
      const lit = t[0]
      texel(tinyData, tinyIn, 20, iz, iy, t)
      const dark = t[0]
      expect(lit).toBeGreaterThan(0.1)
      expect(dark).toBeLessThanOrEqual(lit * 0.2)
    }
    // and in the real hospital: the pharmacy core is lit, the atrium (no ceiling, no panels) beside it is not
    const core = at(real, REAL, 11.75, 0.9, 0, 0)
    const atrium = at(real, REAL, 12.25, 0.9, 0, 0)
    expect(core).toBeGreaterThan(0.2)
    expect(atrium).toBeLessThanOrEqual(core * 0.2)
    // an area with no ceiling gets no panel light anywhere
    for (let ix = 0; ix < tinyIn.grid.nx; ix++) {
      const x = tinyIn.grid.x0 + (ix + 0.5) * tinyIn.grid.cell
      if (x < 20) continue
      texel(tinyData, tinyIn, ix, 10, 2, t)
      expect(t[0]).toBe(0)
    }
  })

  it('in the open atrium, walking AO equals the overview AO (no ceiling to close it in) and it is open to the sky', () => {
    const atrium = REAL.areas.findIndex((a) => a.id === 'atrium')
    expect(REAL.areas[atrium].ceiling).toBeNull()
    expect(ceilingHeight('atrium')).toBeNull()
    const a = REAL.areas[atrium]
    const t = [0, 0, 0, 0]
    let checked = 0
    for (let iz = 0; iz < VOLUME_GRID.nz; iz++) {
      const z = VOLUME_GRID.z0 + (iz + 0.5) * VOLUME_GRID.cell
      if (z <= a.z0 || z >= a.z1) continue
      for (let ix = 0; ix < VOLUME_GRID.nx; ix++) {
        const x = VOLUME_GRID.x0 + (ix + 0.5) * VOLUME_GRID.cell
        if (x <= a.x0 || x >= a.x1) continue
        for (let iy = 0; iy < VOLUME_GRID.ny; iy++) {
          texel(real, REAL, ix, iz, iy, t)
          expect(t[2]).toBe(t[3])
          expect(t[1]).toBe(1)
          expect(t[0]).toBe(0)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(1000)
    // while in a roofed room the ceiling makes the walking AO darker up by it than the overview's, where the section cut has no ceiling
    expect(at(real, REAL, -61.5, 2.8, 14, 2)).toBeLessThan(at(real, REAL, -61.5, 2.8, 14, 3))
  })

  it('occlusion: darker in a corner than in the middle of a room, never outside 0..1, and a surface is not darkened by its own plane', () => {
    // the pharmacy core's middle against its corner (solid walls elsewhere: the imaging block)
    const mid = at(real, REAL, 0, 1.5, 0, 2)
    expect(mid).toBeGreaterThan(0.95)
    // a patient room's far corner under the ceiling: two solid walls and the ceiling
    const room = REAL.areas.find((a) => a.id === 'room:A1')!
    const corner = at(real, REAL, room.x0 + 0.3, 2.7, room.z0 + 0.3, 2)
    expect(corner).toBeLessThan(0.85)
    const middle = at(real, REAL, (room.x0 + room.x1) / 2, 1.5, (room.z0 + room.z1) / 2, 2)
    expect(middle).toBeGreaterThan(corner)
    // a floor point far from everything is not occluded by the floor
    expect(at(real, REAL, 0, 0.3, 0, 2)).toBeGreaterThan(0.95)
    expect(AO_RADIUS).toBeLessThan(2.5) // a local effect: it never darkens the middle of a corridor
  })

  it('window light: bright beside the glazing, faint across the room, none in a room with no windows', () => {
    const near = at(real, REAL, -61.5, 1.5, 14, 1)
    const far = at(real, REAL, -53, 1.5, 14, 1)
    expect(near).toBeGreaterThan(0.6)
    expect(far).toBeLessThan(near * 0.5)
    expect(at(real, REAL, 0, 1.5, 0, 1)).toBeLessThan(0.01) // the core has its glass box on the atrium side only at its east face
    const tinyIn = tiny()
    const tinyData = bakeLightVolume(tinyIn)
    // the run is on the wall at x = 10 and lights the room on its +x side (the 'dark' one), not the one behind it
    expect(at(tinyData, tinyIn, 10.6, 1.5, 5, 1)).toBeGreaterThan(0.5)
    expect(at(tinyData, tinyIn, 9.4, 1.5, 5, 1)).toBeLessThan(0.01)
    expect(at(tinyData, tinyIn, 25, 1.5, 5, 1)).toBe(1)
  })

  it('every panel of every roofed area sits inside its area, and open areas have none', () => {
    for (const a of AREAS) {
      const v = REAL.areas.find((x) => x.id === a.id)!
      if (ceilingHeight(a.id) === null) {
        expect(v.panels).toEqual([])
        continue
      }
      expect(v.panels.length).toBeGreaterThan(0)
      for (const p of panelsOf(a)) {
        expect(p.x).toBeGreaterThan(a.rect.x0)
        expect(p.x).toBeLessThan(a.rect.x1)
        expect(p.z).toBeGreaterThan(a.rect.z0)
        expect(p.z).toBeLessThan(a.rect.z1)
        expect(p.area).toBeGreaterThan(0.1)
        expect(p.area).toBeLessThan(1.5)
      }
    }
  })

  it('slices: a budget of milliseconds at a time gives the same bytes, and always makes progress', () => {
    const baker = new VolumeBaker(REAL)
    let clock = 0
    // every `now()` costs a tenth of a millisecond: a slice of 2 ms is about 20 clock reads, 16 columns each
    const now = () => (clock += 0.1)
    let steps = 0
    let last = -1
    while (!baker.step(2, now)) {
      steps++
      expect(baker.progress).toBeGreaterThan(last)
      last = baker.progress
      expect(steps).toBeLessThan(5000)
    }
    expect(steps).toBeGreaterThan(5)
    expect(baker.done).toBe(true)
    expect(baker.progress).toBe(1)
    expect(Buffer.compare(Buffer.from(baker.data), Buffer.from(real))).toBe(0)
  })
})
