/**
 * The two shared materials of the animated machines, plus the lazily created textured monitor materials.
 *
 * MOVE TO `src/scene/materials.ts` (the orchestrator owns that file): `MACHINE_BODY` and `MACHINE_GLOW`.
 *
 *   MACHINE_BODY  lit, per-vertex colour. Every static machine part, the moving table tops, the rotor, the X-ray column and head,
 *                 the cart and the probe+hand are merged into vertex-coloured meshes that use it (the palette in materials.ts has
 *                 no per-vertex colour: `MAT.tinted` only tints through instance colours).
 *   MACHINE_GLOW  unlit, per-vertex RGBA colour (itemSize 4, so `transparent` is needed). LED rings, laser lines, collimator light,
 *                 lamps. A brightness or fade is a rewrite of the vertex colours in place (see `geometry.ts` `setRegion`). Colours
 *                 above 1 feed the bloom (luminance threshold 1.0). It is transparent with `depthWrite` off so a fading line never
 *                 leaves a dark shape behind and never hides the glass wall between a control room and a scan room.
 */
import { MeshBasicMaterial, MeshStandardMaterial } from 'three'
import type { ImagingModality } from '@/sim/types'
import { getLiveTexture } from '../live'

export const MACHINE_BODY = new MeshStandardMaterial({ vertexColors: true, color: '#ffffff', roughness: 0.42, metalness: 0.12 })

export const MACHINE_GLOW = new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false })

const monitors = new Map<ImagingModality, MeshBasicMaterial>()

/**
 * The textured material of a modality's monitors (the live canvas shared with the Scan viewer). Created on first use, never at
 * module load: `getLiveTexture` needs `document`, which node tests do not have. Single sided: the back of a monitor stays dark.
 * `vertexColors`: the monitor quads carry white (the picture) and black (the bars either side of the square picture).
 */
export function monitorMaterial(m: ImagingModality): MeshBasicMaterial {
  let mat = monitors.get(m)
  if (!mat) {
    mat = new MeshBasicMaterial({ map: getLiveTexture(m), toneMapped: false, vertexColors: true })
    monitors.set(m, mat)
  }
  return mat
}
