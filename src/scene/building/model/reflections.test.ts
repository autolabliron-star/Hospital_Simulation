/** Presentation's box-projected floor reflections: the shader patch, the cache keys, and the uniforms. */
import { describe, expect, it } from 'vitest'
import { MeshStandardMaterial, ShaderChunk, ShaderLib, UniformsUtils } from 'three'
import { BAKED_LOOK_KEY, applyBakedLook, bakedLookKey, hasBakedLook } from './lightmaps'
import {
  FLOOR_REFLECT,
  IBL_RADIANCE_BOX_CALL,
  IBL_RADIANCE_CALL,
  LOBBY_BOX,
  LOBBY_PROBE_POS,
  floorRoughUniform,
  reflectionUniforms,
  updateModelReflections,
} from './reflections'

type Shader = { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }
const physical = (): Shader => ({
  uniforms: UniformsUtils.clone(ShaderLib.physical.uniforms),
  vertexShader: ShaderLib.physical.vertexShader,
  fragmentShader: ShaderLib.physical.fragmentShader,
})
const compile = (m: MeshStandardMaterial): Shader => {
  const s = physical()
  ;(m.onBeforeCompile as unknown as (this: MeshStandardMaterial, s: Shader) => void).call(m, s)
  return s
}
const count = (s: string, part: string): number => s.split(part).length - 1

describe('the chunks the patch edits (three r186)', () => {
  it('still hold the text it replaces', () => {
    expect(count(ShaderChunk.lights_fragment_maps, IBL_RADIANCE_CALL)).toBe(1)
    expect(ShaderChunk.envmap_physical_pars_fragment).toContain('transformDirectionByInverseViewMatrix( reflectVec, viewMatrix )')
    expect(ShaderChunk.envmap_physical_pars_fragment).toContain('textureCubeUV( envMap, envMapRotation * reflectVec, roughness )')
    expect(ShaderChunk.envmap_physical_pars_fragment).toContain('pow4( roughness )')
    for (const inc of ['#include <envmap_physical_pars_fragment>', '#include <roughnessmap_fragment>', '#include <lights_fragment_maps>'])
      expect(count(ShaderLib.physical.fragmentShader, inc)).toBe(1)
    for (const inc of ['#include <common>', '#include <worldpos_vertex>']) expect(count(ShaderLib.physical.vertexShader, inc)).toBe(1)
  })
})

describe('the baked look with box projection', () => {
  it('keys a floor and a wall apart, and both are still the baked look', () => {
    const floor = new MeshStandardMaterial({ name: 'Terrazzo' })
    const wall = new MeshStandardMaterial({ name: 'WallClinical' })
    applyBakedLook(floor)
    applyBakedLook(wall)
    expect(hasBakedLook(floor) && hasBakedLook(wall)).toBe(true)
    expect(floor.customProgramCacheKey()).toBe(`${BAKED_LOOK_KEY}|box|floor`)
    expect(wall.customProgramCacheKey()).toBe(`${BAKED_LOOK_KEY}|box`)
    expect(bakedLookKey(floor.clone())).toBe(`${BAKED_LOOK_KEY}|box|floor`) // a clone keeps the name, so the floor stays a floor
  })

  it('compiles the box-projected radiance in, driven by shared uniforms', () => {
    const floor = new MeshStandardMaterial({ name: FLOOR_REFLECT.materials[0] })
    const wall = new MeshStandardMaterial({ name: 'Oak' })
    applyBakedLook(floor)
    applyBakedLook(wall)
    const f = compile(floor)
    const w = compile(wall)
    for (const s of [f, w]) {
      expect(s.fragmentShader).not.toContain('#include <lights_fragment_maps>') // inlined, with the call swapped
      expect(count(s.fragmentShader, IBL_RADIANCE_BOX_CALL)).toBe(1)
      expect(s.fragmentShader).toContain('vec3 getIBLRadianceBox(')
      expect(s.fragmentShader).toContain('irradiance = vec3( 0.0 );') // the baked look is still there
      expect(s.fragmentShader).toContain('roughnessFactor * uRoughScale')
      expect(s.vertexShader).toContain('vBoxWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;')
      expect(s.uniforms.uBoxMix).toBe(reflectionUniforms.uBoxMix)
      expect(s.uniforms.uReflGain).toBe(reflectionUniforms.uReflGain)
    }
    expect(f.uniforms.uRoughScale).toBe(floorRoughUniform)
    expect(w.uniforms.uRoughScale).not.toBe(floorRoughUniform)
  })

  it('projects onto the lobby (and the spine opening) around the probe', () => {
    expect(LOBBY_PROBE_POS.x).toBeGreaterThan(LOBBY_BOX.x0)
    expect(LOBBY_PROBE_POS.x).toBeLessThan(LOBBY_BOX.x1)
    expect(LOBBY_PROBE_POS.z).toBeGreaterThan(LOBBY_BOX.z0)
    expect(LOBBY_PROBE_POS.z).toBeLessThan(LOBBY_BOX.z1)
    expect(LOBBY_PROBE_POS.y).toBeLessThan(LOBBY_BOX.y1)
    expect(reflectionUniforms.uBoxMin.value.toArray()).toEqual([LOBBY_BOX.x0, LOBBY_BOX.y0, LOBBY_BOX.z0])
  })
})

describe('the reflection uniforms', () => {
  it('leave the picture alone outside presentation', () => {
    updateModelReflections(0, true, 0.26)
    expect(reflectionUniforms.uBoxMix.value).toBe(0)
    expect(reflectionUniforms.uReflGain.value).toBe(1)
    expect(floorRoughUniform.value).toBe(1)
  })

  it('read the probe at its true brightness while presenting in the lobby', () => {
    updateModelReflections(1, true, 0.25)
    expect(reflectionUniforms.uBoxMix.value).toBe(1)
    expect(reflectionUniforms.uReflGain.value * 0.25).toBeCloseTo(FLOOR_REFLECT.gain, 9) // envMapIntensity x gain = the probe x FLOOR_REFLECT.gain
    expect(floorRoughUniform.value).toBeCloseTo(FLOOR_REFLECT.roughnessScale, 9)
    updateModelReflections(0.5, true, 0.25)
    expect(reflectionUniforms.uBoxMix.value).toBe(0.5)
  })

  it('do nothing while another environment is bound (the probe is not what the floor sees)', () => {
    updateModelReflections(1, false, 0.25)
    expect(reflectionUniforms.uBoxMix.value).toBe(0)
    expect(reflectionUniforms.uReflGain.value).toBe(1)
    expect(floorRoughUniform.value).toBe(1)
  })

  it('keep the tuning in a sane range (polished stone, not a mirror)', () => {
    expect(FLOOR_REFLECT.roughnessScale).toBeGreaterThanOrEqual(0.6)
    expect(FLOOR_REFLECT.roughnessScale).toBeLessThanOrEqual(1.3)
    expect(FLOOR_REFLECT.gain).toBeGreaterThan(0)
  })
})
