/**
 * W3 wave B: the realistic people's material, patched into three's standard material by string replacement (see shaders.test.ts for why this is
 * checked token by token): one program for every avatar and LOD, the alpha test only in the hair region, the garment tint, no depth or shadow
 * material, and the light volume patched in last.
 */
import { DataTexture, FloatType, RGBAFormat, ShaderChunk, Texture, type WebGLProgramParametersWithUniforms } from 'three'
import { describe, expect, it } from 'vitest'
import { LIGHT_VOLUME_KEY } from '@/scene/lighting/volumeChunk'
import { FRAG_LV, VERT_MAIN } from '@/scene/lighting/volume/glsl'
import { lvUniforms } from '@/scene/lighting/volume/uniforms'
import { BADGE_FRAME, BADGE_KIND, CAP_FRAME, CAP_KIND, MAX_PEOPLE, P, SLOT, TEX } from './constants'
import { readIndex } from './avatars.testkit'
import { AVATAR_PROGRAM_KEY, avatarUniformValues, createAvatarMaterials, createCrowdMaterials } from './shaders'

const tex = new DataTexture(new Float32Array(TEX.width * MAX_PEOPLE * 4), TEX.width, MAX_PEOPLE, RGBAFormat, FloatType)
const INDEX = readIndex()
const std = { v: ShaderChunk.meshphysical_vert, f: ShaderChunk.meshphysical_frag }

function patched(m: { onBeforeCompile: (s: never, r: never) => void }): WebGLProgramParametersWithUniforms {
  const shader = { uniforms: {}, vertexShader: std.v, fragmentShader: std.f } as unknown as WebGLProgramParametersWithUniforms
  m.onBeforeCompile(shader as never, undefined as never)
  return shader
}

function balanced(src: string, open: string, close: string): boolean {
  let depth = 0
  for (const c of src) {
    if (c === open) depth++
    else if (c === close && --depth < 0) return false
  }
  return depth === 0
}

describe('the avatar material', () => {
  const all = INDEX.avatars.map((a) => createAvatarMaterials(tex, new Texture(), a))

  it('is one program for every avatar and every LOD, keyed with the light volume', () => {
    const keys = new Set<string>()
    for (const mats of all) for (const m of mats) keys.add(m.customProgramCacheKey())
    expect([...keys]).toEqual([AVATAR_PROGRAM_KEY])
    expect(AVATAR_PROGRAM_KEY).toBe(`hospital-crowd-avatar-v1+${LIGHT_VOLUME_KEY}`)
    // nothing that would split the program: the same map / side / alpha state everywhere, no alpha test as a material, no defines
    for (const mats of all) {
      for (const m of mats) {
        expect(m.alphaTest).toBe(0)
        expect(m.transparent).toBe(false)
        expect(m.defines ?? {}).toEqual(all[0][0].defines ?? {})
        expect(m.map).toBeTruthy()
        expect(m.side).toBe(all[0][0].side)
      }
    }
    // and different from every procedural crowd program
    const crowd = createCrowdMaterials(tex)
    for (const m of [...crowd.body, crowd.props, crowd.vehicles]) expect(m.customProgramCacheKey()).not.toBe(AVATAR_PROGRAM_KEY)
    // the shader text is the same for every avatar (only the uniform values differ)
    const a = patched(all[0][0] as never)
    for (const mats of all) {
      for (const m of mats) {
        const s = patched(m as never)
        expect(s.vertexShader).toBe(a.vertexShader)
        expect(s.fragmentShader).toBe(a.fragmentShader)
      }
    }
  })

  it('skins from the pose texture with four influences and reads the tint bits and colours of the person', () => {
    const s = patched(all[0][1] as never)
    const v = s.vertexShader
    for (const c of ['x', 'y', 'z', 'w']) expect(v).toContain(`if (aWeights.${c} > 0.0)`)
    expect(v).toContain('vec3 transformed = cWorldPos;')
    expect(v).toContain('vec3 objectNormal = normalize(cWorldNrm')
    expect(v).not.toContain('vec3 objectNormal = vec3( normal );')
    expect(v).toContain(`texelFetch(uPose, ivec2(${TEX.size}, cRow), 0).z`)
    expect(v).toContain(`ivec2(${TEX.palette + SLOT.top}, cRow)`)
    expect(v).toContain(`ivec2(${TEX.palette + SLOT.pants}, cRow)`)
    for (const a of ['attribute float aRow;', 'attribute vec4 aJoints;', 'attribute vec4 aWeights;']) expect(v.split(a).length - 1, a).toBe(1)
    expect((s.uniforms.uLod as { value: number }).value).toBe(1)
    expect(s.uniforms.uPose).toBeDefined()
    expect(balanced(v, '{', '}')).toBe(true)
    expect(balanced(v, '(', ')')).toBe(true)
  })

  it('alpha tests only in the hair region; the mask tints the garments elsewhere; the dither and the rim stay', () => {
    const s = patched(all[0][0] as never)
    const f = s.fragmentShader
    // the cut at 0.5 is inside the hair rectangle's branch, and it is the only discard besides the LOD dither
    const hair = f.indexOf('vMapUv.x >= uHair.x && vMapUv.x <= uHair.z && vMapUv.y >= uHair.y && vMapUv.y <= uHair.w')
    expect(hair).toBeGreaterThan(-1)
    const cut = f.indexOf('if (cMask < 0.5) discard;')
    expect(cut).toBeGreaterThan(hair)
    expect(f.indexOf('} else {', hair)).toBeGreaterThan(cut)
    expect(f.split('discard;').length - 1).toBe(2) // the LOD dither and the hair cut
    expect(f.indexOf('#include <map_fragment>')).toBeLessThan(hair)
    expect(f).toContain('abs(cMask - 0.6667)')
    expect(f).toContain('abs(cMask - 0.3333)')
    expect(f).toContain('diffuseColor.a = 1.0;')
    expect(f).toContain('if (cNoise < vCrowdLod.x || cNoise >= vCrowdLod.y) discard;')
    expect(f).toContain('totalEmissiveRadiance += vCrowdRim')
    expect(balanced(f, '{', '}')).toBe(true)
    expect(balanced(f, '(', ')')).toBe(true)
    // the hair rectangle and the tint references are the avatar's own
    for (const [i, a] of INDEX.avatars.entries()) {
      const u = all[i][0].userData.avatarUniforms
      const want = avatarUniformValues(a)
      expect(u.uHair.value.toArray()).toEqual(want.hair)
      expect(u.uTintRef.value.x).toBeCloseTo(Math.max(a.tintRef.top, 1e-3), 9)
      if (!a.atlas.hair) expect(want.hair[0]).toBeGreaterThan(want.hair[2]) // an empty rectangle: no alpha test anywhere
    }
  })

  it('patches the light volume in (after its own patches) and has no depth or shadow material', () => {
    const s = patched(all[0][2] as never)
    const v = s.vertexShader
    const f = s.fragmentShader
    expect(v).toContain(VERT_MAIN.trim())
    expect(f).toContain(FRAG_LV.trim())
    expect(v.indexOf(VERT_MAIN.trim())).toBeGreaterThan(v.indexOf('#include <project_vertex>'))
    expect(f.indexOf(FRAG_LV.trim())).toBeGreaterThan(f.indexOf('#include <lights_fragment_maps>'))
    for (const k of Object.keys(lvUniforms)) expect(s.uniforms[k], k).toBe(lvUniforms[k as keyof typeof lvUniforms])
    for (const mats of all) for (const m of mats) expect((m as unknown as { customDepthMaterial?: unknown }).customDepthMaterial).toBeUndefined()
  })

  it("the props shader draws the player's badge and the theatre caps from their own frames", () => {
    const crowd = createCrowdMaterials(tex)
    const s = patched(crowd.props as never)
    expect(s.vertexShader).toContain(`(aKind > ${CAP_KIND - 0.5} ? ${CAP_FRAME} : aKind > ${BADGE_KIND - 0.5} ? ${BADGE_FRAME} : ${P.prop}) * 3`)
    expect(CAP_FRAME).not.toBe(BADGE_FRAME)
  })
})
