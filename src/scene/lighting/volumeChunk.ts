/**
 * W3: the shared hook that lets a material pick up the baked light volume (src/scene/lighting/volume, the lighting builder). Contract glue,
 * owned by the orchestrator; the signature is fixed, the body is the lighting builder's.
 *
 * A material that wants the realistic indoor light calls `applyLightVolume(shader)` LAST inside its `onBeforeCompile` (after its own patches),
 * and appends `LIGHT_VOLUME_KEY` to its `customProgramCacheKey` (compose: `${previous}+${LIGHT_VOLUME_KEY}`), so the program is shared by every
 * material patched the same way and never collides with an unpatched one.
 *
 * Requirements on the caller: the vertex shader still contains `#include <project_vertex>` and the fragment shader
 * `#include <lights_fragment_maps>`, and `transformed` times `modelMatrix` (times `instanceMatrix` when instanced) is the world position.
 * The crowd's model matrix is the identity, so its `transformed` already is.
 *
 * What it does (the GLSL is in ./volume/glsl.ts, the numbers in ./volume/bake.ts, the uniforms in ./volume/uniforms.ts):
 *   vertex    the vertex's world position into a varying;
 *   fragment  after the stock environment lookups, one fetch of the baked volume 0.2 m in front of the surface: scales the ambient light
 *             (hemisphere, environment diffuse and specular) by the ambient occlusion, then adds the ceiling panels' and the windows' light.
 * The uniforms are the shared objects of `lvUniforms`: the daylight driver writes them, nothing here ever recompiles. If a stock anchor is
 * missing (a material built on another shader) the shader is left exactly as it was.
 */
import type { WebGLProgramParametersWithUniforms } from 'three'
import { FRAG_LV, FRAG_PARS, VERT_MAIN, VERT_PARS } from './volume/glsl'
import { lvUniforms } from './volume/uniforms'

export const LIGHT_VOLUME_KEY = 'lv0'

/** The anchors the patch needs, per stage. */
export const VOLUME_ANCHORS = {
  vertex: ['#include <common>', '#include <project_vertex>'],
  fragment: ['#include <common>', '#include <lights_fragment_maps>'],
} as const

/** `text` with `anchor` replaced by itself followed by `add` (the first occurrence only). */
export function after(text: string, anchor: string, add: string): string {
  return text.replace(anchor, () => `${anchor}\n${add}`)
}

/** `text` with `add` inserted in front of `anchor`. */
export function before(text: string, anchor: string, add: string): string {
  return text.replace(anchor, () => `${add}\n${anchor}`)
}

/** Does every anchor exist in the shader? (A shader without a stage, as a test may hand a patch, has none.) */
export function hasAnchors(shader: Pick<WebGLProgramParametersWithUniforms, 'vertexShader' | 'fragmentShader'>): boolean {
  const vertex = shader.vertexShader as string | undefined
  const fragment = shader.fragmentShader as string | undefined
  if (typeof vertex !== 'string' || typeof fragment !== 'string') return false
  return VOLUME_ANCHORS.vertex.every((a) => vertex.includes(a)) && VOLUME_ANCHORS.fragment.every((a) => fragment.includes(a))
}

export function applyLightVolume(shader: WebGLProgramParametersWithUniforms): void {
  if (!hasAnchors(shader)) return
  for (const name of Object.keys(lvUniforms) as (keyof typeof lvUniforms)[]) shader.uniforms[name] = lvUniforms[name]
  shader.vertexShader = after(after(shader.vertexShader, '#include <common>', VERT_PARS), '#include <project_vertex>', VERT_MAIN)
  shader.fragmentShader = after(after(shader.fragmentShader, '#include <common>', FRAG_PARS), '#include <lights_fragment_maps>', FRAG_LV)
}
