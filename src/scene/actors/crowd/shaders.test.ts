/**
 * The crowd's shaders are patched into three's stock materials by string replacement, and a replacement that finds nothing to replace is
 * silent: the person would simply not be posed. There is no GL context in node, so this checks the next best thing: every token the patches
 * look for is in the stock shader, every patch lands, nothing is declared twice, and the braces still balance.
 */
import { DataTexture, FloatType, RGBAFormat, ShaderChunk, type WebGLProgramParametersWithUniforms } from 'three'
import { describe, expect, it } from 'vitest'
import { FEATURE_FIRST, FIXED_COLORS, FX, MAX_PEOPLE, PALETTE_SLOTS, SLOT, TEX, fixedSlot } from './constants'
import { FACE } from './face'
import { createCrowdMaterials } from './shaders'

const tex = new DataTexture(new Float32Array(TEX.width * MAX_PEOPLE * 4), TEX.width, MAX_PEOPLE, RGBAFormat, FloatType)

function patched(m: { onBeforeCompile: (s: never, r: never) => void }, vert: string, frag: string): WebGLProgramParametersWithUniforms {
  const shader = { uniforms: {}, vertexShader: vert, fragmentShader: frag } as unknown as WebGLProgramParametersWithUniforms
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

describe('crowd shaders', () => {
  const mats = createCrowdMaterials(tex)
  const std = { v: ShaderChunk.meshphysical_vert, f: ShaderChunk.meshphysical_frag }

  it('the stock shaders contain every token the patches replace', () => {
    for (const t of ['#include <common>', '#include <beginnormal_vertex>', '#include <begin_vertex>', '#include <project_vertex>']) expect(std.v).toContain(t)
    for (const t of ['#include <common>', '#include <clipping_planes_fragment>', '#include <color_fragment>', '#include <emissivemap_fragment>', '#include <roughnessmap_fragment>']) expect(std.f).toContain(t)
    expect(ShaderChunk.meshbasic_vert).toContain('#include <begin_vertex>')
    expect(ShaderChunk.meshbasic_frag).toContain('#include <map_fragment>')
  })

  it('bodies read the pose texture, place the vertex and dither; the far body uses the rigid figure path', () => {
    for (let i = 0; i < 3; i++) {
      const s = patched(mats.body[i] as never, std.v, std.f)
      expect(s.vertexShader).toContain('texelFetch(uPose')
      expect(s.vertexShader).toContain('vec3 transformed = cWorldPos;')
      expect(s.vertexShader).toContain('vec3 objectNormal = normalize(cWorldNrm')
      expect(s.vertexShader).not.toContain('vec3 objectNormal = vec3( normal );') // the stock chunk is replaced, not duplicated
      expect(s.fragmentShader).toContain('discard;')
      expect(s.fragmentShader).toContain('diffuseColor.rgb *= vCrowdBase;')
      expect(s.uniforms.uPose).toBeDefined()
      expect((s.uniforms.uLod as { value: number }).value).toBe(i)
      expect(balanced(s.vertexShader, '{', '}')).toBe(true)
      expect(balanced(s.fragmentShader, '{', '}')).toBe(true)
      expect(balanced(s.vertexShader, '(', ')')).toBe(true)
    }
    expect(mats.body[2].defines).toHaveProperty('CROWD_FAR')
    expect(mats.body[0].defines?.CROWD_FAR).toBeUndefined()
  })

  it('W1 close-up people: the near bodies move the face features, hide the details a person does not wear and pick a material by what a vertex is', () => {
    for (const i of [0, 1]) {
      const s = patched(mats.body[i] as never, std.v, std.f)
      const v = s.vertexShader
      // the texels of the face and the staff details are read, and the pose texture's layout is the one the model writes
      expect(v).toContain(`texelFetch(uPose, ivec2(${TEX.face}, cRow), 0)`)
      expect(v).toContain(`texelFetch(uPose, ivec2(${TEX.gear}, cRow), 0)`)
      expect(v).toContain(`cSlot >= ${FEATURE_FIRST}`)
      // every feature slot has its branch
      for (const fx of [FX.eye, FX.sclera, FX.brow, FX.mouth, FX.frame, FX.stethTube, FX.dosimeter, FX.bib]) expect(v, `slot of fixed colour ${fx}`).toContain(`cSlot == ${fixedSlot(fx)}`)
      expect(v).toContain(`cSlot >= ${fixedSlot(FX.badgeCard)} && cSlot <= ${fixedSlot(FX.badgeMark)}`)
      // the numbers of the face are the ones the geometry was built with
      expect(v).toContain(`/ ${FACE.gazeYaw}, -1.0, 1.0) * ${FACE.gazeX}`)
      expect(v).toContain(`cE * ${FACE.smileLift} : cE * ${FACE.frownDrop}`)
      expect(v).toContain(`* ${FACE.browLift} + max(-cFace.z, 0.0) * (${FACE.browWorry}`)
      // colours that come from the person's own palette
      expect(v).toContain(`ivec2(${TEX.palette + SLOT.hair}, cRow)`)
      expect(v).toContain(`ivec2(${TEX.palette + SLOT.skin}, cRow)`)
      expect(v).toContain(`ivec2(${TEX.palette + SLOT.badge}, cRow)`)
      expect(v).toContain(`ivec2(${TEX.palette + SLOT.glasses}, cRow)`)
      expect(v).toContain(`ivec2(${TEX.palette + SLOT.coat}, cRow)`)
      expect(v).toContain('if (cHide) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);')
      // the thin lines of the face melt into the skin with distance
      expect(v).toContain(`smoothstep(${FACE.fadeFrom.toFixed(1)}, ${FACE.fadeTo.toFixed(1)}, distance(cRoot.xyz + vec3(0.0, 1.6, 0.0), cameraPosition))`)
      expect(v).toContain('cFade > 0.999')
      expect(v.split('flat varying float vCrowdMat;').length - 1).toBe(1)
      expect(v.split('vec3 cP = position;').length - 1).toBe(1)
      expect(balanced(v, '{', '}')).toBe(true)
      expect(balanced(v, '(', ')')).toBe(true)
      const f = s.fragmentShader
      expect(f.split('flat varying float vCrowdMat;').length - 1).toBe(1)
      expect(f).toContain('roughnessFactor = cR;')
      expect(f).toContain('vCrowdMat > 0.5 && vCrowdMat < 1.5')
      expect(balanced(f, '{', '}')).toBe(true)
    }
    // the far figure has no features: no feature code, and it keeps the stock roughness (material -1)
    const far = patched(mats.body[2] as never, std.v, std.f)
    expect(far.vertexShader).toContain('float cMat = -1.0;')
    expect(far.vertexShader.indexOf('float cMat = -1.0;')).toBeLessThan(far.vertexShader.indexOf('#else')) // inside the CROWD_FAR branch, the features are in the other
    expect(far.vertexShader.indexOf('vec3 cP = position;')).toBeGreaterThan(far.vertexShader.indexOf('#else'))
    // props and vehicles know nothing about it
    for (const m of [mats.props, mats.vehicles]) {
      const s = patched(m as never, std.v, std.f)
      expect(s.vertexShader).not.toContain('vCrowdMat')
      expect(s.fragmentShader).not.toContain('vCrowdMat')
    }
    // the uniform array of fixed colours has one entry per colour, and the fixed colours the shader indexes directly exist
    const s0 = patched(mats.body[0] as never, std.v, std.f)
    expect(s0.vertexShader).toContain(`uniform vec3 uFixed[${FIXED_COLORS.length}];`)
    expect(FX.youInk).toBeLessThan(FIXED_COLORS.length)
    expect(PALETTE_SLOTS + FIXED_COLORS.length).toBeGreaterThan(FEATURE_FIRST)
  })

  it('props and vehicles hide the kinds they are not, and each declares its attributes once', () => {
    for (const [m, label] of [
      [mats.props, 'props'],
      [mats.vehicles, 'vehicles'],
    ] as const) {
      const s = patched(m as never, std.v, std.f)
      expect(s.vertexShader, label).toContain('abs(aPart.x - aKind) > 0.5')
      expect(s.vertexShader, label).toContain('vec3 transformed = gWorldPos;')
      for (const a of ['attribute float aRow;', 'attribute float aKind;', 'attribute float aOff;', 'attribute vec2 aPart;']) expect(s.vertexShader.split(a).length - 1, `${label} ${a}`).toBe(1)
      expect(balanced(s.vertexShader, '{', '}')).toBe(true)
      expect(balanced(s.fragmentShader, '{', '}')).toBe(true)
    }
    expect(mats.props.defines).toHaveProperty('GEAR_PROP')
    expect(mats.vehicles.defines?.GEAR_PROP).toBeUndefined()
  })

  it('the blob shadow fades per instance', () => {
    const s = patched(mats.blob as never, ShaderChunk.meshbasic_vert, ShaderChunk.meshbasic_frag)
    expect(s.vertexShader).toContain('attribute float aFade;')
    expect(s.vertexShader).toContain('vFade = aFade;')
    expect(s.fragmentShader).toContain('diffuseColor.a *= vFade;')
    expect(mats.blob.transparent).toBe(true)
    expect(mats.blob.depthWrite).toBe(false)
  })

  it('compiles six programs: two body variants, props, vehicles, blob', () => {
    const keys = new Set<string>()
    for (const m of [...mats.body, mats.props, mats.vehicles, mats.blob]) keys.add(m.customProgramCacheKey())
    expect(keys.size).toBe(5) // the high and mid bodies share one program; the far body, props, vehicles and blob each have their own
  })
})
