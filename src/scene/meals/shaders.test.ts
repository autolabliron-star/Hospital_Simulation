// The shader hooks of the L1 look are plain string replacements in three's built-in shaders. These tests pin the lines they patch, so a
// three upgrade that moves one fails here and not as a black screen, and check that each patch lands exactly once.
import { MeshBasicMaterial, MeshStandardMaterial, ShaderLib, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from 'three'
import { describe, expect, it } from 'vitest'
import { FADE_ATTRIBUTE, emissiveFollowsInstanceColor, fadeMaterial, patchFadeShader } from './ditherFade'
import { BEDSIDE_ATLAS, createBedsideMaterial, patchPulseShader } from './ward/wardParts'

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1

function shaderOf(kind: 'basic' | 'physical'): WebGLProgramParametersWithUniforms {
  return { vertexShader: ShaderLib[kind].vertexShader, fragmentShader: ShaderLib[kind].fragmentShader, uniforms: {} } as unknown as WebGLProgramParametersWithUniforms
}

describe('lines of three that the L1 shaders patch', () => {
  for (const kind of ['basic', 'physical'] as const) {
    it(`${kind}: each include and the start of main exist exactly once`, () => {
      const s = shaderOf(kind)
      expect(count(s.vertexShader, '#include <common>')).toBe(1)
      expect(count(s.vertexShader, '#include <begin_vertex>')).toBe(1)
      expect(count(s.vertexShader, '#include <uv_vertex>')).toBe(1)
      expect(count(s.fragmentShader, '#include <common>')).toBe(1)
      expect(count(s.fragmentShader, 'void main() {')).toBe(1)
      expect(count(s.fragmentShader, '#include <color_fragment>')).toBe(1)
    })
  }
  it('the emissive line exists once in the physical fragment shader', () => {
    expect(count(ShaderLib.physical.fragmentShader, 'vec3 totalEmissiveRadiance = emissive;')).toBe(1)
  })
})

describe('dither fade', () => {
  it('dither mode: an instance attribute, a varying, and a discard against fixed screen noise (once each)', () => {
    const s = shaderOf('physical')
    patchFadeShader(s, 'dither')
    expect(count(s.vertexShader, `attribute float ${FADE_ATTRIBUTE};`)).toBe(1)
    expect(count(s.vertexShader, 'vFade = aFade;')).toBe(1)
    expect(count(s.fragmentShader, 'varying float vFade;')).toBe(1)
    expect(count(s.fragmentShader, 'discard;')).toBeGreaterThanOrEqual(1)
    expect(s.fragmentShader).toContain('if ( vFade <= fract(')
    expect(s.fragmentShader).not.toContain('diffuseColor.a *= vFade')
  })

  it('alpha mode: the fade multiplies the alpha and nothing is discarded by the patch', () => {
    const s = shaderOf('basic')
    const discards = count(s.fragmentShader, 'discard;')
    patchFadeShader(s, 'alpha')
    expect(count(s.fragmentShader, 'diffuseColor.a *= vFade;')).toBe(1)
    expect(count(s.fragmentShader, 'discard;')).toBe(discards)
  })

  it('fadeMaterial patches only the clone it is given, with its own program key, and keeps an earlier patch', () => {
    const a = fadeMaterial(emissiveFollowsInstanceColor(new MeshStandardMaterial()), 'dither', 'unit-a')
    const b = new MeshStandardMaterial()
    expect(a.customProgramCacheKey()).toBe('unit-a:dither')
    expect(b.customProgramCacheKey()).not.toBe(a.customProgramCacheKey())
    const s = shaderOf('physical')
    a.onBeforeCompile(s, null as unknown as WebGLRenderer)
    expect(s.fragmentShader).toContain('totalEmissiveRadiance *= vColor.rgb;')
    expect(s.fragmentShader).toContain('vFade')
    const untouched = shaderOf('physical')
    b.onBeforeCompile(untouched, null as unknown as WebGLRenderer)
    expect(untouched.fragmentShader).not.toContain('vFade')
  })

  it('fade 1 keeps every pixel and fade 0 drops every pixel (the noise is in [0, 1))', () => {
    // the noise term is fract(...) so it lies in [0, 1): `fade <= noise` is never true at 1 and always true at 0
    const noise = (x: number, y: number): number => {
      const f = (v: number) => v - Math.floor(v)
      return f(52.9829189 * f(x * 0.06711056 + y * 0.00583715))
    }
    let kept = 0
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (!(0.5 <= noise(x, y))) kept++
    expect(kept / 4096).toBeGreaterThan(0.4)
    expect(kept / 4096).toBeLessThan(0.6)
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      expect(1 <= noise(x, y)).toBe(false)
      expect(0 <= noise(x, y)).toBe(true)
    }
  })
})

describe('door tile pulse and bedside atlas shaders', () => {
  it('the pulse is a uniform clock and a per-instance flag, applied to the colour', () => {
    const s = shaderOf('basic')
    const uTime = { value: 0 }
    patchPulseShader(s, uTime)
    expect(s.uniforms.uTime).toBe(uTime)
    expect(count(s.vertexShader, 'attribute float aPulse;')).toBe(1)
    expect(count(s.fragmentShader, 'uniform float uTime;')).toBe(1)
    expect(s.fragmentShader).toContain('diffuseColor.rgb *= mix( 1.0,')
    expect(s.fragmentShader).toContain('sin( uTime')
  })

  it('the bedside material maps each instance into its own tile of the atlas', () => {
    const m: MeshBasicMaterial = createBedsideMaterial(null)
    const s = shaderOf('basic')
    m.onBeforeCompile(s, null as unknown as WebGLRenderer)
    expect(s.vertexShader).toContain('attribute vec2 aCell;')
    expect(s.vertexShader).toContain('vMapUv = vMapUv * vec2(')
    expect(BEDSIDE_ATLAS.cols * BEDSIDE_ATLAS.rows).toBeGreaterThanOrEqual(16)
  })
})
