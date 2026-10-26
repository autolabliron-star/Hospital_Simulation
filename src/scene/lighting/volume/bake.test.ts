import { describe, expect, it } from 'vitest'
import { AREAS, BUILDING, ceilingHeight } from '@/sim/places'
import { LEVEL2_DX, LEVEL_Y, levelOf } from '@/sim/levels'
import { AO_RADIUS, SKY_TEXEL, VolumeBaker, bakeLightVolume, sampleVolume, texel } from './bake'
import { FLOOR_MAIN, FRAG_LV } from './glsl'
import { LOWER_LAYERS, UPPER_FIRST_LAYER, UPPER_LAYERS, VOLUME_GRID, buildVolumeInput, gridSize, panelsOf, type PanelLight, type VolumeArea, type VolumeGrid, type VolumeInput } from './input'

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

  it('is 204 x 88 x 13 RGBA8 texels, about 930 KB (R2: level 1, a buffer, level 2, a buffer: 0..7.8 m)', () => {
    expect(VOLUME_GRID.nx).toBe(204)
    expect(VOLUME_GRID.nz).toBe(88)
    expect(VOLUME_GRID.ny).toBe(13)
    expect(LOWER_LAYERS).toBe(6)
    expect(UPPER_FIRST_LAYER).toBe(7)
    expect(UPPER_LAYERS).toBe(5)
    expect(real.length).toBe(204 * 88 * 13 * 4)
    expect(real.byteLength).toBeGreaterThan(920_000)
    expect(real.byteLength).toBeLessThan(940_000)
    const size = gridSize(VOLUME_GRID)
    expect(size.x).toBeCloseTo(BUILDING.x1 - BUILDING.x0, 9)
    expect(size.z).toBeCloseTo(BUILDING.z1 - BUILDING.z0, 9)
    expect(size.y).toBeCloseTo(7.8, 9)
    // level 2's floor is a layer boundary: its first layer is 0.3 m above the floor, as level 1's first is
    expect((UPPER_FIRST_LAYER + 0.5) * VOLUME_GRID.layer - LEVEL_Y[2]).toBeCloseTo((0 + 0.5) * VOLUME_GRID.layer, 9)
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

  it('every panel of every roofed area sits inside its area, and open areas have none (level 2\'s in drawn coordinates)', () => {
    for (const a of AREAS) {
      const upper = levelOf((a.rect.x0 + a.rect.x1) / 2) === 2
      const v = (upper ? REAL.upper!.areas : REAL.areas).find((x) => x.id === a.id)!
      expect(v, a.id).toBeDefined()
      const dx = upper ? -LEVEL2_DX : 0
      if (ceilingHeight(a.id) === null) {
        expect(v.panels).toEqual([])
        continue
      }
      expect(v.panels.length).toBeGreaterThan(0)
      for (const p of panelsOf(a, dx)) {
        expect(p.x).toBeGreaterThan(a.rect.x0 + dx)
        expect(p.x).toBeLessThan(a.rect.x1 + dx)
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

describe('R2: the light volume of level 2 (layers 7..11), and the buffers (6 and 12)', () => {
  const real = bakeLightVolume(REAL)
  const g = VOLUME_GRID
  const upper = REAL.upper!
  const t = [0, 0, 0, 0]
  /** The layer containing height y (the layers are 0.6 m). */
  const layerOf = (y: number): number => Math.floor((y - g.y0) / g.layer)

  it('level 1 is exactly as it was: layers 0..5 are byte for byte a bake of level 1 on its own', () => {
    const only: VolumeInput = { grid: { ...REAL.grid, ny: 6 }, areas: REAL.areas, walls: REAL.walls, windows: REAL.windows, cutHeight: REAL.cutHeight }
    const alone = bakeLightVolume(only)
    const prefix = real.subarray(0, 6 * g.nz * g.nx * 4)
    expect(Buffer.compare(Buffer.from(prefix), Buffer.from(alone))).toBe(0)
    // and level 1's lists hold no level-2 area, wall or window
    for (const a of REAL.areas) expect(a.x1, a.id).toBeLessThanOrEqual(BUILDING.x1)
    expect(REAL.areas.some((a) => a.id.startsWith('l2'))).toBe(false)
    expect(upper.areas.every((a) => a.id.startsWith('l2'))).toBe(true)
  })

  it('level 2 is baked from its own areas in drawn coordinates, over the level-2 footprint (drawn x -62..-40), 4.2 m up', () => {
    expect(upper.floorY).toBe(4.2)
    expect(upper.firstLayer).toBe(7)
    expect(upper.layers).toBe(5)
    expect(upper.areas.length).toBe(12) // R4 added the cryoablation suite and its control room
    for (const a of upper.areas) {
      expect(a.x0, a.id).toBeGreaterThanOrEqual(-62)
      expect(a.x1, a.id).toBeLessThanOrEqual(-40)
      expect(a.ceiling, a.id).toBe(3)
    }
    for (const w of upper.walls) {
      expect(w.x0).toBeGreaterThanOrEqual(-62 - 0.2)
      expect(w.x1).toBeLessThanOrEqual(-40 + 0.2)
    }
    for (const w of upper.windows) {
      const across = w.alongX ? w.a : w.c
      expect(across).toBeGreaterThanOrEqual(-62 - 0.2)
      expect(across).toBeLessThanOrEqual(-40 + 0.2)
    }
  })

  it('panel light on level 2: under a panel of the pre-op more than between panels, at every layer of the storey', () => {
    const pre = upper.areas.find((a) => a.id === 'l2PreOp')!
    expect(pre.panels.length).toBeGreaterThanOrEqual(4)
    const row = pre.panels.filter((p) => Math.abs(p.z - pre.panels[1].z) < 0.01).sort((a, b) => a.x - b.x)
    const p = row[1]
    const q = row[2]
    const midX = (p.x + q.x) / 2
    for (const rel of [1.5, 2.1]) {
      const y = LEVEL_Y[2] + rel
      expect(layerOf(y)).toBeGreaterThanOrEqual(7)
      expect(layerOf(y)).toBeLessThanOrEqual(11)
      const under = at(real, REAL, p.x, y, p.z, 0)
      const between = at(real, REAL, midX, y, p.z, 0)
      expect(under, `under a panel at ${rel} m`).toBeGreaterThan(between + 0.05)
      expect(between, `between panels at ${rel} m`).toBeGreaterThan(0.3)
    }
  })

  it('level 2\'s light is its own: the pre-op over triage reads its own panels, not the lit ceiling below it', () => {
    // the pre-op (12 m deep) lies over the triage hall (16 m deep): the same x range, different panel rows, so the two storeys' panel light differs along z
    const pre = upper.areas.find((a) => a.id === 'l2PreOp')!
    const tri = REAL.areas.find((a) => a.id === 'triage')!
    expect(pre.panels.length).toBeGreaterThan(0)
    expect(tri.panels.length).toBeGreaterThan(0)
    const x = -53
    const sampleAt = (y: number): number[] => Array.from({ length: 36 }, (_, i) => at(real, REAL, x, y, -20.5 + i * 0.25, 0))
    const lowRow = sampleAt(1.5)
    const upRow = sampleAt(LEVEL_Y[2] + 1.5)
    expect(Math.max(...lowRow)).toBeGreaterThan(0.2)
    expect(Math.max(...upRow)).toBeGreaterThan(0.2)
    expect(upRow.some((v, i) => Math.abs(v - lowRow[i]) > 0.02)).toBe(true)
  })

  it('window light on level 2: bright beside the pre-op\'s north glazing, faint across the room', () => {
    const near = at(real, REAL, -57, LEVEL_Y[2] + 1.5, -21.4, 1)
    const far = at(real, REAL, -53, LEVEL_Y[2] + 1.5, -12.5, 1)
    expect(near).toBeGreaterThan(0.5)
    expect(far).toBeLessThan(near * 0.6)
    // the sterile store has no outer wall: no window light (it is not glazed)
    expect(at(real, REAL, -48.5, LEVEL_Y[2] + 1.5, -6, 1)).toBeLessThan(0.05)
  })

  it('the OR\'s viewing window lets the corridor\'s light in (glass occludes little) while its wall stops the panels of the other side', () => {
    const win = { x: -44, z: 4.3 }
    const solid = { x: -44, z: 8.5 }
    const aoAt = (p: { x: number; z: number }) => at(real, REAL, p.x + 0.6, LEVEL_Y[2] + 1.5, p.z, 2)
    // the walk AO beside the glass is higher (less occluded) than beside the solid part of the same wall
    expect(aoAt(win)).toBeGreaterThan(aoAt(solid))
  })

  it('occlusion on level 2: darker in a corner under the ceiling than in the middle of a room', () => {
    const or = upper.areas.find((a) => a.id === 'l2Or')!
    const corner = at(real, REAL, or.x0 + 0.3, LEVEL_Y[2] + 2.7, or.z0 + 0.3, 2)
    const middle = at(real, REAL, (or.x0 + or.x1) / 2, LEVEL_Y[2] + 1.5, (or.z0 + or.z1) / 2, 2)
    expect(corner).toBeLessThan(0.85)
    expect(middle).toBeGreaterThan(corner)
  })

  it('the buffers: open sky outside the level-2 footprint, and a repeat of the level-2 layer next to them inside it', () => {
    const sky = [SKY_TEXEL[0] / 255, SKY_TEXEL[1] / 255, SKY_TEXEL[2] / 255, SKY_TEXEL[3] / 255]
    // over the pharmacy core (x 0): open sky in both buffers and over level 1
    const ix = Math.floor((0 - g.x0) / g.cell)
    const iz = Math.floor((0 - g.z0) / g.cell)
    for (const iy of [6, 12]) {
      texel(real, REAL, ix, iz, iy, t)
      expect([...t]).toEqual(sky)
    }
    // inside the pre-op's footprint the buffers repeat the neighbouring layer of level 2
    const jx = Math.floor((-55 - g.x0) / g.cell)
    const jz = Math.floor((-15 - g.z0) / g.cell)
    const first = [0, 0, 0, 0]
    texel(real, REAL, jx, jz, 7, first)
    texel(real, REAL, jx, jz, 6, t)
    expect([...t]).toEqual([...first])
    const last = [0, 0, 0, 0]
    texel(real, REAL, jx, jz, 11, last)
    texel(real, REAL, jx, jz, 12, t)
    expect([...t]).toEqual([...last])
    // a floor of level 2 (sampled 0.2 m above it, at 4.4 m) reads its own room: no sky leaks into it from the buffer below
    sampleVolume(real, REAL, -55, LEVEL_Y[2] + 0.2, -15, t)
    expect(t[1]).toBeLessThan(0.3)
  })

  it('level 2 outside its areas (the rest of the plan, 7..11) is open air, and the lower storey outside its areas keeps its old "no light" texel', () => {
    // x = 20: the atrium (open, no ceiling) on level 1; on level 2 nothing stands there
    const ix = Math.floor((20 - g.x0) / g.cell)
    const iz = Math.floor((0 - g.z0) / g.cell)
    for (let iy = 7; iy <= 11; iy++) {
      texel(real, REAL, ix, iz, iy, t)
      expect([...t]).toEqual([0, 1, 1, 1])
    }
  })

  it('the shader reads the band between the storeys as open sky, and the floors read their own page of the ceiling map', () => {
    expect(FRAG_LV).toContain('lvIn *= 1.0 - smoothstep( 3.05, 3.25, lvY )')
    expect(FLOOR_MAIN).toContain('bool lvUp = vLvPos.y > 3.9;')
    expect(FLOOR_MAIN).toContain('uLvCeil2')
    expect(FLOOR_MAIN).toContain('uLvCeilY2')
  })

  it('bakes in well under 250 ms with both storeys, and the slices give the same bytes', () => {
    const t0 = performance.now()
    bakeLightVolume(buildVolumeInput())
    expect(performance.now() - t0).toBeLessThan(250)
    const baker = new VolumeBaker(REAL)
    let clock = 0
    const now = () => (clock += 0.1)
    while (!baker.step(2, now)) {
      /* slices */
    }
    expect(Buffer.compare(Buffer.from(baker.data), Buffer.from(real))).toBe(0)
  })
})
