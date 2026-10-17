/**
 * The pod face screens need a texture, which the shared palette does not carry, so this file owns the one small
 * non-palette material the pods use (the face screen). It is unlit and cheap. (The pods hang from the ceiling rail and touch
 * the floor nowhere, so they no longer have a blob shadow.)
 */
import { Color, MeshBasicMaterial, type Texture } from 'three'
import { CELL_SCALE } from './podParts'

/** Unlit screen reading one atlas cell per instance: `aCell` offsets the quad's UV into its pod's cell. */
export function createFaceMaterial(texture: Texture | null): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ map: texture, color: texture ? new Color('#ffffff') : new Color('#10282a') })
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aCell;')
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
#ifdef USE_MAP
	vMapUv = vMapUv * vec2( ${CELL_SCALE.u.toFixed(6)}, ${CELL_SCALE.v.toFixed(6)} ) + aCell;
#endif`,
      )
  }
  m.customProgramCacheKey = () => 'medpod-face-atlas'
  return m
}
