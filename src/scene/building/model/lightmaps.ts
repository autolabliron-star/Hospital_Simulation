/**
 * Wires the baked light onto a loaded scene. Each mesh node carries glTF extras `{ lightmap: "<file>.ktx2" }` (GLTFLoader puts them on
 * `userData`); the lightmap UVs are the mesh's second set (TEXCOORD_1, `uv1`), so the texture's `channel` is 1. Pure over a resolver, so node can test it
 * without any decoder.
 */
import { Material, Mesh, MeshStandardMaterial, SRGBColorSpace, ShaderChunk, type Object3D, type Texture } from 'three'
import { IBL_RADIANCE_BOX_CALL, IBL_RADIANCE_CALL, isReflectiveFloor, patchBoxProjection } from './reflections'

/** Read the lightmap file a node names, or null. */
export function lightmapNameOf(o: Object3D): string | null {
  const v = (o.userData as { lightmap?: unknown } | undefined)?.lightmap
  return typeof v === 'string' && v.length > 0 ? v : null
}

/**
 * The lightmap's intensity for a node. The bake stores (decoded value x `lightmapScale`) = the outgoing radiance of a white diffuse surface;
 * three lights a lightmapped surface as lightMap x intensity x albedo / PI, so the intensity is scale x PI (1 x PI when the node gives none).
 */
export function lightmapIntensityOf(o: Object3D): number {
  const v = (o.userData as { lightmapScale?: unknown } | undefined)?.lightmapScale
  return (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 1) * Math.PI
}

/**
 * The baked look: a lightmapped surface already holds the sun, the sky, the ceiling panels and the bounce light, so the live lights must not
 * add theirs on top (the old double lighting). Diffuse becomes albedo x lightmap only (direct lights and the hemisphere/ambient/probe
 * irradiance are dropped, and so is the environment's diffuse term); the environment's specular stays, so floors and glass still reflect.
 *
 * (Presentation) the environment's specular is also box-projected onto the lobby and read at the probe's true brightness while presenting
 * (./reflections.ts): uniforms only, compiled in from the start, so the cache key carries `|box` (and `|floor` for the reflective floors, which
 * also read the roughness multiplier).
 */
export const BAKED_LOOK_KEY = 'baked-look'
/** `lights_fragment_maps` with the IBL radiance call swapped for the box-projected one. */
const LIGHTS_MAPS_BOX = ShaderChunk.lights_fragment_maps.replace(IBL_RADIANCE_CALL, IBL_RADIANCE_BOX_CALL)
const BAKED_FRAGMENT = `
reflectedLight.directDiffuse = vec3( 0.0 );
reflectedLight.directSpecular = vec3( 0.0 );
irradiance = vec3( 0.0 );
${LIGHTS_MAPS_BOX}
iblIrradiance = vec3( 0.0 );
`

/** The program cache key of a baked material: one program for the floors, one for the rest (per three's own parameters). */
export function bakedLookKey(m: Material): string {
  return `${BAKED_LOOK_KEY}|box${isReflectiveFloor(m) ? '|floor' : ''}`
}

// `function`, not an arrow: three calls both as methods of the material, which is how they tell a floor from a wall
function bakeShader(this: Material, shader: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }): void {
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_maps>', BAKED_FRAGMENT)
  patchBoxProjection(shader, isReflectiveFloor(this))
}
function bakedKey(this: Material): string {
  return bakedLookKey(this)
}

/** Idempotent per instance (a clone does not carry the hooks over, so it is patched again). */
export function applyBakedLook(m: MeshStandardMaterial): void {
  if (m.onBeforeCompile === bakeShader) return
  m.onBeforeCompile = bakeShader
  m.customProgramCacheKey = bakedKey
  m.needsUpdate = true
}

export const hasBakedLook = (m: Material): boolean => m.onBeforeCompile === bakeShader

export interface LightmapResult {
  /** Distinct materials after wiring (cloned only when two meshes need different lightmaps on one material). */
  materials: Material[]
  textures: Texture[]
  missing: string[]
}

/**
 * Sets `material.lightMap` (channel 1, intensity from `lightmapIntensityOf`) and the baked look on every mesh that names one. `resolve` returns the texture for a file name (the same Texture
 * for the same name). A mesh whose material already holds another lightmap gets its own clone, so the material count stays the number of
 * (material, lightmap) pairs, which the Blender export keeps small.
 */
export function applyLightmaps(root: Object3D, resolve: (file: string) => Texture | null): LightmapResult {
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  const missing: string[] = []
  root.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    const file = lightmapNameOf(o)
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    if (file) {
      const tex = resolve(file)
      if (!tex) missing.push(file)
      else {
        tex.channel = 1
        tex.colorSpace = SRGBColorSpace // generate.py bakes 8-bit sRGB, optimize.mjs encodes R8G8B8_SRGB
        textures.add(tex)
        const intensity = lightmapIntensityOf(o)
        const wired = list.map((m) => {
          const std = m as MeshStandardMaterial
          let target = std
          if (std.lightMap && (std.lightMap !== tex || std.lightMapIntensity !== intensity)) target = std.clone()
          target.lightMap = tex
          target.lightMapIntensity = intensity
          applyBakedLook(target)
          target.needsUpdate = true
          return target
        })
        mesh.material = Array.isArray(mesh.material) ? wired : wired[0]
      }
    }
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m)
  })
  return { materials: [...materials], textures: [...textures], missing }
}
