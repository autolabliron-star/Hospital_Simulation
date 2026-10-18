/**
 * Patching the shared palette (W3): every material in `MAT` gets the light volume, the floors also reflect the ceiling panels, and the glass
 * climbs toward opaque at grazing angles. materials.ts calls `applyPaletteLook(MAT)` once after the palette is built; this file never imports
 * the palette (no cycle), it is handed the record.
 *
 * Program keys. Three shares one program between materials whose shader source and parameters agree, and tells them apart by
 * `customProgramCacheKey`, so each patched material's key is `<its own key>+<LIGHT_VOLUME_KEY>` plus a suffix for the variant:
 *
 *   plain   `<previous>+lv0`            every palette material but the floors and the glass
 *   floor   `<previous>+lv0+floor`      the six floors (the panel reflection)
 *   glass   `<previous>+lv0+glass`      the glass sheet (the Fresnel opacity)
 *
 * where `<previous>` is the material's own key when it had one (`tintedGlow:emissive-tint`, the instance-colour emissive patch that stays in
 * front of ours in the chain) and `std` otherwise (three's default key is the source of `onBeforeCompile`, which this replaces). The patches
 * never add a program for something that already shared one: the glass program was already its own (transparent), the floors are opaque,
 * single-sided and not instanced, like `wall` and `frame`, so the floor variant is the ONE new program of the palette; every other patched
 * material's program is a replacement of the program it had.
 *
 * Order inside `onBeforeCompile`: the material's previous patch, then the floor or glass chunk, then `applyLightVolume` LAST (the contract). The
 * volume's chunk is spliced right after the same `#include <lights_fragment_maps>` the floor's is, so it ends up in front of it: the floors' panel
 * reflection is added to `radiance` AFTER the volume has darkened it, which is what a reflection of a lamp should be (AO does not dim a lamp).
 *
 * `patchMaterialLook(material, kind)` is exported for materials cloned from the palette (a clone does not carry `onBeforeCompile`).
 */
import type { Material, MeshStandardMaterial } from 'three'
import { LIGHT_VOLUME_KEY, after, applyLightVolume, before, hasAnchors } from './volumeChunk'
import { FLOOR_MAIN, FLOOR_PARS, GLASS_MAIN, GLASS_PARS } from './volume/glsl'

export type LookKind = 'plain' | 'floor' | 'glass'

/** The interior floors: the reflection reads the ceiling map, so only these (not the grass, the paths or the plinth). */
export const FLOOR_KEYS: readonly string[] = ['floorOak', 'floorTerrazzo', 'floorMint', 'floorCore', 'floorSlate', 'floorBlue']
export const GLASS_KEY = 'glass'

export function lookKindOf(key: string): LookKind {
  if (FLOOR_KEYS.includes(key)) return 'floor'
  return key === GLASS_KEY ? 'glass' : 'plain'
}

const KIND_SUFFIX: Record<LookKind, string> = { plain: '', floor: '+floor', glass: '+glass' }

/**
 * Which materials carry the patch, and how many times it was applied (exactly once, or the chain would double the uniforms and varyings).
 * Not a flag in `userData`: three copies `userData` into a clone, and a clone does not carry `onBeforeCompile`, so a flag there would make a
 * clone look patched when it is not.
 */
const patched = new WeakMap<Material, number>()

/** How many times `patchMaterialLook` took effect on a material (0 or 1). */
export function lookPatchCount(material: Material): number {
  return patched.get(material) ?? 0
}

/** The key a patched material answers with. */
export function lookKey(previous: string, kind: LookKind): string {
  return `${previous}+${LIGHT_VOLUME_KEY}${KIND_SUFFIX[kind]}`
}

type Shader = Parameters<MeshStandardMaterial['onBeforeCompile']>[0]

/** The floor's and the glass's chunks, applied to a shader that still has the stock anchors. */
export function applyKindChunk(shader: Shader, kind: LookKind): void {
  if (kind === 'floor') {
    shader.fragmentShader = after(after(shader.fragmentShader, '#include <common>', FLOOR_PARS), '#include <lights_fragment_maps>', FLOOR_MAIN)
  } else if (kind === 'glass') {
    shader.fragmentShader = before(after(shader.fragmentShader, '#include <common>', GLASS_PARS), '#include <opaque_fragment>', GLASS_MAIN)
  }
}

/** Patch one material (once). Returns false when it was already patched. */
export function patchMaterialLook(material: MeshStandardMaterial, kind: LookKind): boolean {
  if (patched.has(material)) return false
  patched.set(material, 1)
  const previous = material.onBeforeCompile
  const own = Object.prototype.hasOwnProperty.call(material, 'customProgramCacheKey')
  const previousKey = own ? material.customProgramCacheKey() : 'std'
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    // a shader without the stock anchors (never the case for a MeshStandardMaterial) is left as the previous patches made it
    if (!hasAnchors(shader)) return
    applyKindChunk(shader, kind)
    applyLightVolume(shader)
  }
  const key = lookKey(previousKey, kind)
  material.customProgramCacheKey = () => key
  return true
}

/** Patch every palette material. Call once, after the palette is complete. */
export function applyPaletteLook(palette: Readonly<Record<string, MeshStandardMaterial>>): void {
  for (const [key, material] of Object.entries(palette)) patchMaterialLook(material, lookKindOf(key))
}
