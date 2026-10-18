import { DataTexture, FloatType, RGBAFormat, ShaderChunk, ShaderLib, type MeshStandardMaterial, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from 'three'
import { describe, expect, it } from 'vitest'
import { createCrowdMaterials } from '@/scene/actors/crowd/shaders'
import { ALL_MATERIALS, MAT } from '@/scene/materials'
import { FLOOR_KEYS, GLASS_KEY, applyPaletteLook, lookKey, lookKindOf, lookPatchCount, patchMaterialLook } from './palettePatch'
import { LIGHT_VOLUME_KEY, VOLUME_ANCHORS, applyLightVolume, hasAnchors } from './volumeChunk'
import { lvUniforms } from './volume/uniforms'

const KEYS = Object.keys(MAT) as (keyof typeof MAT)[]

/** A shader program parameters object with the stock MeshStandardMaterial sources, as three hands them to onBeforeCompile. */
function stock(): WebGLProgramParametersWithUniforms {
  return { vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader, uniforms: {} } as unknown as WebGLProgramParametersWithUniforms
}

/** Run a material's onBeforeCompile on a fresh stock shader. */
function compile(m: MeshStandardMaterial): WebGLProgramParametersWithUniforms {
  const s = stock()
  m.onBeforeCompile(s, {} as WebGLRenderer)
  return s
}

/** Replace every `#include <chunk>` by the chunk's text, recursively, the way three does before it hands the source to the driver. */
function expand(source: string): string {
  return source.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_, name: string) => {
    const chunk = (ShaderChunk as unknown as Record<string, string | undefined>)[name]
    if (chunk === undefined) throw new Error(`unknown chunk ${name}`)
    return expand(chunk)
  })
}

describe('the palette patch', () => {
  it('patches every palette key exactly once', () => {
    expect(KEYS.length).toBeGreaterThan(25)
    for (const key of KEYS) expect(lookPatchCount(MAT[key]), key).toBe(1)
    // a second call, or a patch of the same material by another caller, is a no-op: the chain never doubles
    const before = KEYS.map((k) => MAT[k].onBeforeCompile)
    applyPaletteLook(MAT)
    expect(patchMaterialLook(MAT.wall, 'plain')).toBe(false)
    expect(KEYS.map((k) => MAT[k].onBeforeCompile)).toEqual(before)
    for (const m of ALL_MATERIALS) expect(lookPatchCount(m)).toBe(1)
  })

  it('keeps the tintedGlow instance-colour emissive patch in front of the volume', () => {
    const shader = compile(MAT.tintedGlow)
    expect(shader.fragmentShader.match(/totalEmissiveRadiance \*= vColor\.rgb;/g)).toHaveLength(1)
    expect(shader.fragmentShader).toContain('vLvPos')
    expect(MAT.tintedGlow.userData.emissiveTint).toBe(true)
    expect(MAT.tintedGlow.customProgramCacheKey()).toBe(`tintedGlow:emissive-tint+${LIGHT_VOLUME_KEY}`)
  })

  it('gives every material a program key that contains the volume key, and one key per shader variant', () => {
    const keys = new Map<string, string[]>()
    for (const key of KEYS) {
      const k = MAT[key].customProgramCacheKey()
      expect(k, key).toContain(LIGHT_VOLUME_KEY)
      keys.set(k, [...(keys.get(k) ?? []), key])
    }
    // plain (everything else), floor, glass, and tintedGlow's own: four variants of the shader source, so four keys
    expect([...keys.keys()].sort()).toEqual([`std+${LIGHT_VOLUME_KEY}`, `std+${LIGHT_VOLUME_KEY}+floor`, `std+${LIGHT_VOLUME_KEY}+glass`, `tintedGlow:emissive-tint+${LIGHT_VOLUME_KEY}`].sort())
    expect(keys.get(`std+${LIGHT_VOLUME_KEY}+floor`)?.sort()).toEqual([...FLOOR_KEYS].sort())
    expect(keys.get(`std+${LIGHT_VOLUME_KEY}+glass`)).toEqual([GLASS_KEY])
    expect(keys.get(`tintedGlow:emissive-tint+${LIGHT_VOLUME_KEY}`)).toEqual(['tintedGlow'])
    // and the key function agrees
    expect(lookKey('std', 'floor')).toBe(`std+${LIGHT_VOLUME_KEY}+floor`)
    expect(lookKey('x', 'plain')).toBe(`x+${LIGHT_VOLUME_KEY}`)
  })

  it('gives only the floors the reflection, only the glass the Fresnel, and everything the volume', () => {
    for (const key of KEYS) {
      const s = compile(MAT[key])
      expect(s.vertexShader, `${key} vertex`).toContain('vLvPos = ( modelMatrix * lvW ).xyz;')
      expect(s.fragmentShader, `${key} fragment`).toContain('uniform highp sampler3D uLvTex;')
      expect(s.fragmentShader.includes('uLvReflect'), `${key} reflection`).toBe(FLOOR_KEYS.includes(key))
      expect(s.fragmentShader.includes('uLvGlass'), `${key} glass`).toBe(key === GLASS_KEY)
      expect(lookKindOf(key)).toBe(FLOOR_KEYS.includes(key) ? 'floor' : key === GLASS_KEY ? 'glass' : 'plain')
    }
    expect(FLOOR_KEYS).toHaveLength(6)
    for (const key of FLOOR_KEYS) expect(key.startsWith('floor')).toBe(true)
  })

  it('reads the volume in the texture\'s own axis order: x across, z down the rows, y up the layers', () => {
    // the bake stores x fastest, then z (rows), then y (layers); the sampler must be given (x, z, y), not the world's (x, y, z)
    const frag = compile(MAT.wall).fragmentShader
    expect(frag).toContain('texture( uLvTex, lvUvw.xzy )')
    expect(frag).not.toMatch(/texture\( uLvTex, lvUvw \)/)
  })

  it('hands every material the SAME uniform objects, so one write updates the whole hospital', () => {
    for (const key of KEYS) {
      const s = compile(MAT[key])
      for (const name of Object.keys(lvUniforms) as (keyof typeof lvUniforms)[]) expect(s.uniforms[name], `${key}.${name}`).toBe(lvUniforms[name])
    }
  })

  it('splices only after stock anchors that exist in three 0.186', () => {
    for (const a of VOLUME_ANCHORS.vertex) expect(ShaderLib.standard.vertexShader, a).toContain(a)
    for (const a of VOLUME_ANCHORS.fragment) expect(ShaderLib.standard.fragmentShader, a).toContain(a)
    expect(ShaderLib.standard.fragmentShader).toContain('#include <opaque_fragment>')
    // each anchor appears once, so "the first occurrence" is the only one
    for (const a of ['#include <project_vertex>']) expect(ShaderLib.standard.vertexShader.split(a).length - 1).toBe(1)
    for (const a of ['#include <lights_fragment_maps>', '#include <opaque_fragment>']) expect(ShaderLib.standard.fragmentShader.split(a).length - 1).toBe(1)
    expect(hasAnchors(stock())).toBe(true)
  })

  it('uses only names the stock shader defines, in an order that compiles', () => {
    const frag = expand(compile(MAT.floorTerrazzo).fragmentShader)
    const at = (needle: string, from = 0): number => {
      const i = frag.indexOf(needle, from)
      expect(i, `"${needle}" is in the expanded fragment shader`).toBeGreaterThanOrEqual(0)
      return i
    }
    // the symbols the volume block reads are declared before it, and it runs before the indirect light is used
    const block = at('vec3 lvN = transformNormalByInverseViewMatrix( geometryNormal, viewMatrix );')
    expect(at('vec3 geometryNormal = normal;')).toBeLessThan(block)
    expect(at('vec3 iblIrradiance = vec3( 0.0 );')).toBeLessThan(block)
    expect(at('vec3 irradiance = getAmbientLightIrradiance')).toBeLessThan(block)
    expect(at('vec3 radiance = vec3( 0.0 );')).toBeLessThan(block)
    expect(at('RE_IndirectDiffuse( irradiance')).toBeGreaterThan(block)
    expect(at('transformNormalByInverseViewMatrix( in vec3 normal, in mat4 viewMatrix )')).toBeLessThan(block)
    // the floor's reflection comes after the volume's block and before the indirect specular is evaluated, and reads declared names
    const floor = at('vec3 lvFV = normalize( vLvPos - cameraPosition );')
    expect(floor).toBeGreaterThan(block)
    expect(at('RE_IndirectSpecular( radiance', floor)).toBeGreaterThan(floor)
    expect(at('PhysicalMaterial material;')).toBeLessThan(floor)
    // the declarations come before main()
    expect(at('varying vec3 vLvPos;')).toBeLessThan(at('void main()'))
    expect(at('uniform highp sampler2D uLvCeil;')).toBeLessThan(at('void main()'))
    // what the patches add is balanced in braces and parentheses (the stock text has #if branches that are not, so compare with the stock)
    const balance = (text: string, open: RegExp, close: RegExp): number => (text.match(open) ?? []).length - (text.match(close) ?? []).length
    const stockVert = expand(stock().vertexShader)
    const stockFrag = expand(stock().fragmentShader)
    for (const key of ['wall', 'floorOak', 'glass', 'tintedGlow'] as const) {
      const s = compile(MAT[key])
      const vert = expand(s.vertexShader)
      const fragment = expand(s.fragmentShader)
      // tintedGlow's own patch is balanced too, so the same comparison holds
      expect(balance(vert, /\{/g, /\}/g) - balance(stockVert, /\{/g, /\}/g), `${key} vertex braces`).toBe(0)
      expect(balance(fragment, /\{/g, /\}/g) - balance(stockFrag, /\{/g, /\}/g), `${key} fragment braces`).toBe(0)
      expect(balance(vert, /\(/g, /\)/g) - balance(stockVert, /\(/g, /\)/g), `${key} vertex parens`).toBe(0)
      expect(balance(fragment, /\(/g, /\)/g) - balance(stockFrag, /\(/g, /\)/g), `${key} fragment parens`).toBe(0)
    }
  })

  it('puts the glass Fresnel after the lighting and before the output alpha is written', () => {
    const frag = expand(compile(MAT.glass).fragmentShader)
    const fresnel = frag.indexOf('float lvGF = pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 4.0 );')
    expect(fresnel).toBeGreaterThan(frag.indexOf('vec3 outgoingLight ='))
    expect(fresnel).toBeLessThan(frag.indexOf('gl_FragColor = vec4( outgoingLight, diffuseColor.a );'))
    expect(frag.indexOf('uniform float uLvGlass;')).toBeLessThan(frag.indexOf('void main()'))
  })

  it('leaves a shader without the stock anchors exactly as it found it', () => {
    const odd = { vertexShader: 'void main() {}', fragmentShader: 'void main() {}', uniforms: {} } as unknown as WebGLProgramParametersWithUniforms
    applyLightVolume(odd)
    expect(odd.vertexShader).toBe('void main() {}')
    expect(odd.fragmentShader).toBe('void main() {}')
    expect(Object.keys(odd.uniforms)).toEqual([])
    // a patched material on such a shader keeps its previous patches and adds nothing
    const m = MAT.floorOak
    const shader = { ...odd, fragmentShader: '#include <common>\nvoid main() {}' } as unknown as WebGLProgramParametersWithUniforms
    m.onBeforeCompile(shader, {} as WebGLRenderer)
    expect(shader.fragmentShader).toBe('#include <common>\nvoid main() {}')
    // and a shader handed over with one stage only (the tintGlow test does) is left to the previous patches
    const fragmentOnly = { fragmentShader: ShaderLib.physical.fragmentShader } as unknown as WebGLProgramParametersWithUniforms
    MAT.tintedGlow.onBeforeCompile(fragmentOnly, null as unknown as WebGLRenderer)
    expect(fragmentOnly.fragmentShader).toContain('totalEmissiveRadiance *= vColor.rgb;')
    expect(fragmentOnly.fragmentShader).not.toContain('vLvPos')
  })

  it('a clone can be patched through the exported hook (clones do not carry onBeforeCompile, and a copied userData must not fool it)', () => {
    const clone = MAT.tintedGlow.clone()
    expect(clone.onBeforeCompile).not.toBe(MAT.tintedGlow.onBeforeCompile)
    expect(lookPatchCount(clone)).toBe(0)
    expect(patchMaterialLook(clone, 'plain')).toBe(true)
    expect(lookPatchCount(clone)).toBe(1)
    const s = compile(clone)
    expect(s.fragmentShader).toContain('uLvTex')
    expect(clone.customProgramCacheKey()).toBe(`std+${LIGHT_VOLUME_KEY}`)
  })
})

describe('the crowd bodies', () => {
  const pose = new DataTexture(new Float32Array(4), 1, 1, RGBAFormat, FloatType)
  const { body } = createCrowdMaterials(pose)

  it('carry the volume last and its key, near and far', () => {
    expect(body.map((m) => m.customProgramCacheKey())).toEqual([
      `hospital-crowd-body-near-v2+${LIGHT_VOLUME_KEY}`,
      `hospital-crowd-body-near-v2+${LIGHT_VOLUME_KEY}`,
      `hospital-crowd-body-far-v2+${LIGHT_VOLUME_KEY}`,
    ])
    for (const m of body) {
      const s = compile(m)
      // the crowd's own patch is in (its pose texture) and so is the volume's, and the volume's hook follows the crowd's `project_vertex` line
      expect(s.vertexShader).toContain('uniform sampler2D uPose;')
      expect(s.vertexShader).toContain('vLvPos = ( modelMatrix * lvW ).xyz;')
      expect(s.vertexShader.indexOf('if (cHide) gl_Position')).toBeGreaterThan(-1)
      expect(s.fragmentShader).toContain('uniform highp sampler3D uLvTex;')
      expect(s.uniforms.uLvTex).toBe(lvUniforms.uLvTex)
      expect(s.uniforms.uPose).toBeDefined()
    }
  })
})
