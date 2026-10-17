import { ShaderLib, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from 'three'
import { describe, expect, it } from 'vitest'
import { MAT } from '@/scene/materials'
import { EMISSIVE_LINE, ensureTintedGlow } from './tintGlow'

function compileFragment(): string {
  const shader = { fragmentShader: ShaderLib.physical.fragmentShader } as unknown as WebGLProgramParametersWithUniforms
  MAT.tintedGlow.onBeforeCompile(shader, null as unknown as WebGLRenderer)
  return shader.fragmentShader
}

describe('tintedGlow emissive tint', () => {
  it('the line it patches exists exactly once in three\'s physical fragment shader', () => {
    expect(ShaderLib.physical.fragmentShader.split(EMISSIVE_LINE).length - 1).toBe(1)
  })

  it('multiplies the emissive by the instance/vertex colour, only when a colour attribute is present', () => {
    const frag = compileFragment()
    expect(frag).toContain('totalEmissiveRadiance *= vColor.rgb;')
    const at = frag.indexOf('totalEmissiveRadiance *= vColor.rgb;')
    const guard = frag.lastIndexOf('#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )', at)
    expect(guard).toBeGreaterThan(frag.indexOf(EMISSIVE_LINE))
    expect(frag.indexOf('#endif', at)).toBeGreaterThan(at)
  })

  it('is idempotent: asking again does not wrap the hook twice', () => {
    ensureTintedGlow()
    ensureTintedGlow()
    const frag = compileFragment()
    expect(frag.split('totalEmissiveRadiance *= vColor.rgb;').length - 1).toBe(1)
    expect(MAT.tintedGlow.userData.emissiveTint).toBe(true)
  })
})
