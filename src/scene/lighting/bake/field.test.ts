/**
 * Realism step 2: the bake field (./field.ts) puts each zone's probe light over its own rects, per storey, with a weight that is 1 inside the
 * authored building and 0 outside; the shader's unpacking (../volume/glsl.ts) is the field's packing; the zone sources (lobbyProbe.ts) borrow a
 * neighbour's probe where a zone ships none.
 */
import { describe, expect, it } from 'vitest'
import { BAKE_MAIN, FRAG_LV, FRAG_PARS, bakeFloatAt } from '@/scene/lighting/volume/glsl'
import { fieldSourcesFor, type ZoneProbeEntry } from '@/scene/lighting/env/lobbyProbe'
import { zoneDef } from '@/scene/building/model/zones'
import type { BuildingManifest } from '@/scene/building/model/manifest'
import { LEVEL_Y } from '@/sim/levels'
import { BAKE_GRID, BAKE_SPLIT_Y, CELL_FLOATS, CELL_TEXELS, SLICES, buildBakeField, sampleBakeField, toHalfFloats, type FieldSource } from './field'
import { SH_FLOATS, shIrradiance } from './sh'

/** A uniform light of radiance L: c0 = L x sqrt(4 PI) x 0.282095 x ... = L x 4 PI x 0.282095, the rest 0. Irradiance PI L everywhere. */
function uniformSH(L: number): Float32Array {
  const sh = new Float32Array(SH_FLOATS)
  sh[0] = sh[1] = sh[2] = L * 4 * Math.PI * 0.282095
  return sh
}

const rect = (x0: number, x1: number, z0: number, z1: number, level: 1 | 2, name: string, sh: Float32Array): FieldSource => ({
  name,
  level,
  contains: (x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1,
  sh,
})

/** E / PI of the field at a point, premultiplied (so: weight x the zone's), and the weight. */
function at(field: ReturnType<typeof buildBakeField>, x: number, y: number, z: number): { e: number; w: number } {
  const s = sampleBakeField(field, x, y, z)
  const out = [0, 0, 0]
  shIrradiance(s, 0, 1, 0, out)
  return { e: out[0] / Math.PI, w: s[SH_FLOATS] }
}

describe('buildBakeField', () => {
  const A = rect(-40, -20, -10, 10, 1, 'A', uniformSH(0.6))
  const B = rect(-20, 0, -10, 10, 1, 'B', uniformSH(0.2))
  const T = rect(-62, -40, -22, 22, 2, 'T', uniformSH(0.9))
  const field = buildBakeField([A, B, T])

  it('fills the texture the GPU gets: nx x nz x 14 RGBA, and counts the owned cells per storey', () => {
    expect(field.data.length).toBe(BAKE_GRID.nx * BAKE_GRID.nz * SLICES * 4)
    expect(SLICES).toBe(14)
    expect(CELL_FLOATS).toBe(28)
    expect(field.owned[0]).toBe(20 * 20 * 2)
    // level 2's page: T over the level-2 footprint, and level 1's zones repeated outside it (A and B lie east of x -40)
    expect(field.owned[1]).toBe(22 * 44 + 20 * 20 * 2)
    expect(toHalfFloats(field.data).length).toBe(field.data.length)
  })

  it('gives each zone its own light with full weight, and the live light (weight 0) outside the building', () => {
    expect(at(field, -30, 1, 0)).toEqual({ e: expect.closeTo(0.6, 3), w: expect.closeTo(1, 4) })
    expect(at(field, -10, 1.5, 0)).toEqual({ e: expect.closeTo(0.2, 3), w: expect.closeTo(1, 4) })
    expect(at(field, -30, 1, 18).w).toBe(0) // no zone there
    expect(at(field, -70, 1, 0).w).toBe(0) // the forecourt
    expect(at(field, 200, 1, 0).w).toBe(0) // clamped to the empty border
  })

  it('keeps full weight right up to a facade and blends two zones over a couple of metres at their border', () => {
    expect(at(field, -30, 1, 9.6).w).toBeGreaterThan(0.95)
    expect(at(field, -30, 1, 12.5).w).toBeLessThan(0.05)
    const mid = at(field, -20, 1, 0)
    expect(mid.w).toBeCloseTo(1, 4)
    expect(mid.e).toBeGreaterThan(0.25)
    expect(mid.e).toBeLessThan(0.55)
    expect(at(field, -22.5, 1, 0).e).toBeCloseTo(0.6, 2)
    expect(at(field, -17.5, 1, 0).e).toBeCloseTo(0.2, 2)
  })

  it('reads level 2 above the split height over the level-2 footprint, and level 1 elsewhere', () => {
    expect(at(field, -50, LEVEL_Y[2] + 1, 0).e).toBeCloseTo(0.9, 3)
    expect(at(field, -50, 1, 0).w).toBe(0) // no level-1 zone in this test under the theatres
    expect(at(field, -30, BAKE_SPLIT_Y + 2, 0).e).toBeCloseTo(0.6, 3) // a tall thing in a level-1 zone
  })
})

describe('the shader reads what the field packs', () => {
  it('unpacks coefficient i channel c from float 3 i + c, and the weight from float 27', () => {
    // a field whose cell holds 0, 1, 2, ... 27: the GLSL's `bkC[i] = vec3(bkT.x, ...)` must name the texel and component holding 3 i + c
    for (let i = 0; i < 9; i++) {
      const names = [0, 1, 2].map((c) => {
        const at = bakeFloatAt(i * 3 + c)
        expect(at.texel).toBeLessThan(CELL_TEXELS)
        return `bk${at.texel}.${'rgba'[at.component]}`
      })
      expect(BAKE_MAIN).toContain(`bkC[ ${i} ] = vec3( ${names.join(', ')} );`)
    }
    expect(bakeFloatAt(27)).toEqual({ texel: 6, component: 3 })
    expect(BAKE_MAIN).toContain('clamp( bk6.a, 0.0, 1.0 )')
    // and the packing in field.ts: float k of the cell is texel floor(k / 4), component k % 4 (slices 0..6)
    const sh = new Float32Array(SH_FLOATS).map((_, k) => k + 1)
    const f = buildBakeField([{ name: 'all', level: 1, contains: () => true, sh }])
    const s = sampleBakeField(f, 0, 1, 0)
    for (let k = 0; k < SH_FLOATS; k++) expect(s[k]).toBeCloseTo(k + 1, 4)
    expect(s[SH_FLOATS]).toBeCloseTo(1, 6)
  })

  it('is part of the light-volume chunk every live material carries, after the volume block, with its uniforms declared', () => {
    expect(FRAG_LV).toContain(BAKE_MAIN.trim())
    expect(FRAG_LV.indexOf('lvKeep = lvOcc;')).toBeLessThan(FRAG_LV.indexOf('if ( uBkOn > 0.0 )'))
    for (const u of ['uBkField', 'uBkGeom', 'uBkSplitY', 'uBkOn', 'uBkGain', 'uBkSpec', 'uBkKey', 'uBkAo']) expect(FRAG_PARS).toContain(u)
    expect(FRAG_PARS).toContain('uniform highp sampler3D uBkField;')
    // three's own SH irradiance (lights_pars_begin), the same formula as ./sh.ts shIrradiance
    expect(BAKE_MAIN).toContain('shGetIrradianceAt( bkN, bkC )')
  })
})

describe('fieldSourcesFor (the zones that light live objects)', () => {
  const probe = (zone: string, eye: { x: number; z: number }, level: 1 | 2 = 1, sh: Float32Array | null = uniformSH(0.5)): ZoneProbeEntry => ({
    zone,
    level,
    def: zoneDef(zone) ?? null,
    file: `assets/building/zones/${zone}/env_${zone}.hdr`,
    eye: { x: eye.x, y: level === 2 ? 5.8 : 1.6, z: eye.z },
    box: { x0: 0, x1: 1, y0: 0, y1: 1, z0: 0, z1: 1 },
    texture: null,
    sh,
  })
  const manifest = (ids: string[]): BuildingManifest => ({ zones: ids.map((id) => ({ id })) }) as unknown as BuildingManifest

  it('every loaded probe over its zone; a listed zone without a probe borrows the nearest one on its storey; unlisted zones stay live', () => {
    const lobby = probe('lobby', { x: -53, z: 0 })
    const core = probe('core', { x: 0, z: 0 })
    const theatres = probe('theatres', { x: -57.5, z: 12 }, 2)
    const sources = fieldSourcesFor([lobby, core, theatres], manifest(['lobby', 'core', 'imaging', 'theatres']))
    expect(sources.map((s) => s.name)).toEqual(['lobby', 'core', 'theatres', 'imaging<-lobby'])
    const imaging = sources[3]
    expect(imaging.sh).toBe(lobby.sh)
    expect(imaging.level).toBe(1)
    expect(imaging.contains(-30, 0)).toBe(true) // the imaging corridor
    expect(sources.some((s) => s.name.startsWith('wardA'))).toBe(false)
  })

  it('a probe that did not load lights nothing, and the pilot (no manifest) lights the pilot region', () => {
    const failed = probe('lobby', { x: -53, z: 0 }, 1, null)
    expect(fieldSourcesFor([failed], manifest(['lobby']))).toEqual([])
    const pilot: ZoneProbeEntry = { ...probe('lobby', { x: -53, z: 0 }), zone: 'pilot', def: null }
    const [s] = fieldSourcesFor([pilot], null)
    expect(s.contains(-50, 0)).toBe(true)
    expect(s.contains(10, 0)).toBe(false)
  })
})
