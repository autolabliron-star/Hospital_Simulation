/**
 * Geometry and materials of the live ward parts (L1): the bed backrests, the door tiles and the bedside screens. Pure three.js
 * (no React, no DOM until a canvas is asked for), so the node tests count their draw calls and triangles.
 */
import { type BufferGeometry, InstancedBufferAttribute, MeshBasicMaterial, PlaneGeometry, type WebGLProgramParametersWithUniforms } from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { BACKREST, BEDSIDE_SCREEN, DOOR_TILE } from '@/scene/rooms/bedParts'
import { ROOMS } from '@/sim/places'

/** The head section of the mattress with its pillow, in the hinge's frame (see BACKREST): one geometry, drawn 16 times. */
export function backrestGeometry(): BufferGeometry {
  const { slab, length, pillow } = BACKREST
  const slabGeo = new RoundedBoxGeometry(slab.w, slab.y1 - slab.y0, length, 2, slab.r).translate(0, (slab.y0 + slab.y1) / 2, -length / 2)
  const pillowGeo = new RoundedBoxGeometry(pillow.w, pillow.h, pillow.d, 2, pillow.r).translate(0, pillow.y, pillow.z)
  const parts = [slabGeo, pillowGeo]
  for (const g of parts) for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name)
  const merged = mergeGeometries(parts, false)
  for (const g of parts) g.dispose()
  if (!merged) throw new Error('backrest: could not merge')
  return merged
}

/** A door tile: a thin rounded plate, centred on its own origin. */
export function doorTileGeometry(): BufferGeometry {
  const g = new RoundedBoxGeometry(DOOR_TILE.w, DOOR_TILE.h, DOOR_TILE.d, 1, DOOR_TILE.h / 2 - 0.001)
  // a per-instance pulse flag (0 or 1), filled by the layer
  g.setAttribute('aPulse', new InstancedBufferAttribute(new Float32Array(ROOMS.length), 1))
  return g
}

/** The bedside picture: a quad per room, a UV offset into the 4 x 4 tile atlas per instance (`aCell`). */
export function bedsideQuadGeometry(): BufferGeometry {
  const g = new PlaneGeometry(BEDSIDE_SCREEN.w - 0.03, BEDSIDE_SCREEN.h - 0.03)
  const cells = new Float32Array(ROOMS.length * 2)
  for (let i = 0; i < ROOMS.length; i++) {
    const c = atlasCell(i)
    cells[i * 2] = c.u
    cells[i * 2 + 1] = c.v
  }
  g.setAttribute('aCell', new InstancedBufferAttribute(cells, 2))
  return g
}

/** The bedside atlas: 4 x 4 tiles of 320 x 200 px, one per room, in `ROOMS` order (row 0 on top of the canvas). */
export const BEDSIDE_ATLAS = { cols: 4, rows: 4, tileW: 320, tileH: 200 } as const

/** UV offset (u, v of the tile's lower-left corner in texture space) of the tile of room `i`. */
export function atlasCell(i: number): { col: number; row: number; u: number; v: number } {
  const col = i % BEDSIDE_ATLAS.cols
  const row = Math.floor(i / BEDSIDE_ATLAS.cols)
  return { col, row, u: col / BEDSIDE_ATLAS.cols, v: 1 - (row + 1) / BEDSIDE_ATLAS.rows }
}

/** Texels of padding inside each tile, so mip-mapping never samples a neighbour. */
const PAD = 0.002

/** Unlit screen reading one atlas tile per instance: `aCell` offsets the quad's UV into its room's tile. */
export function createBedsideMaterial(map: import('three').Texture | null): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ map, color: 0xffffff, toneMapped: true })
  if (!map) m.color.set('#10282a')
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    const su = 1 / BEDSIDE_ATLAS.cols - 2 * PAD
    const sv = 1 / BEDSIDE_ATLAS.rows - 2 * PAD
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aCell;')
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
#ifdef USE_MAP
	vMapUv = vMapUv * vec2( ${su.toFixed(6)}, ${sv.toFixed(6)} ) + aCell + vec2( ${PAD}, ${PAD} );
#endif`,
      )
  }
  m.customProgramCacheKey = () => 'bedside-atlas'
  return m
}

/** Pulse flag shader hook for the door tiles: `aPulse` (0 or 1 per instance) makes the glow breathe with `uTime`. */
export function patchPulseShader(
  shader: Pick<WebGLProgramParametersWithUniforms, 'vertexShader' | 'fragmentShader' | 'uniforms'>,
  uTime: { value: number },
): void {
  shader.uniforms.uTime = uTime
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aPulse;\nvarying float vPulse;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvPulse = aPulse;')
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vPulse;')
    .replace('#include <color_fragment>', '#include <color_fragment>\n\tdiffuseColor.rgb *= mix( 1.0, 0.45 + 0.55 * ( 0.5 + 0.5 * sin( uTime * 4.2 ) ), vPulse );')
}

/** The door tile material: unlit, tinted per instance, pulsing by a uniform (never by redrawing anything). */
export function createDoorTileMaterial(): { material: MeshBasicMaterial; uTime: { value: number } } {
  const uTime = { value: 0 }
  const material = new MeshBasicMaterial({ color: 0xffffff, toneMapped: true })
  material.onBeforeCompile = (shader) => patchPulseShader(shader, uTime)
  material.customProgramCacheKey = () => 'door-tile-pulse'
  return { material, uTime }
}
