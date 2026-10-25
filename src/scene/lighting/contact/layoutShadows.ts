/**
 * Contact shadows from the building layout's furniture footprints (realism step 2, follow-up): the floor-standing DEVICES that stay live or
 * procedural (the health kiosks, the blood-draw robots, the lab's benches and analysers, the theatre's consoles, vision cart and anaesthesia
 * machine, the MedVend island) are already described as footprints (src/scene/building/layout: id, centre, half extents, turn), so their shadows
 * come from there instead of from their meshes. A layer picks its own ids and registers them with `registerStaticShadows`, anchored on its root
 * (no shadow while the layer's storey is hidden). Footprints are SIM coordinates: level 2's are moved over the building as drawn.
 *
 * Only for things NOT in the Blender bake: a baked piece already has its contact shadow in the floor's lightmap.
 */
import type { Object3D } from 'three'
import { LEVEL2_DX, LEVEL_Y, levelOf } from '@/sim/levels'
import { registerContactSource, shownInScene, type ContactBuffer } from './registry'

/** One shadow in drawn coordinates (the arguments of `ContactBuffer.add`). */
export interface StaticShadow {
  x: number
  y: number
  z: number
  heading: number
  halfX: number
  halfZ: number
  radius: number
  pen: number
  darkness: number
}

/** The slice of a layout footprint this needs (building/layout/types.ts Footprint). */
export interface FootprintLike {
  id: string
  kind: 'rect' | 'circle'
  x: number
  z: number
  hw: number
  hd: number
  rotationY: number
  overhead?: boolean
}

export interface ShadowStyle {
  /** Darkness right under it (0..1). */
  darkness: number
  /** Penumbra width outside the footprint (m). */
  pen: number
  /** Corner radius of a rect (m; clamped to the footprint). Default 0.06. */
  radius?: number
}

/** The shadows of the footprints whose id `match`es (overhead ones never: people walk under them). Pure. */
export function layoutShadows(footprints: readonly FootprintLike[], match: (id: string) => boolean, style: ShadowStyle): StaticShadow[] {
  const out: StaticShadow[] = []
  for (const f of footprints) {
    if (f.overhead || !match(f.id) || !(f.hw > 0)) continue
    const level = levelOf(f.x)
    const circle = f.kind === 'circle'
    const halfX = f.hw
    const halfZ = circle ? f.hw : f.hd
    if (!(halfZ > 0)) continue
    out.push({
      x: level === 2 ? f.x - LEVEL2_DX : f.x,
      y: LEVEL_Y[level],
      z: f.z,
      heading: f.rotationY,
      halfX,
      halfZ,
      radius: circle ? halfX : Math.min(style.radius ?? 0.06, halfX, halfZ),
      pen: style.pen,
      darkness: style.darkness,
    })
  }
  return out
}

/** Write a list of static shadows while `anchor` is drawn (allocation-free). */
export function writeStaticShadows(anchor: Object3D, list: readonly StaticShadow[], buf: ContactBuffer): void {
  if (!shownInScene(anchor)) return
  for (let i = 0; i < list.length; i++) {
    const s = list[i]
    buf.add(s.x, s.y, s.z, s.heading, s.halfX, s.halfZ, s.radius, s.pen, s.darkness)
  }
}

/** Register a layer's static shadows (nothing when the list is empty). Returns the function that removes them. */
export function registerStaticShadows(name: string, anchor: Object3D, list: readonly StaticShadow[]): () => void {
  if (list.length === 0) return () => undefined
  return registerContactSource({ name, write: (buf) => writeStaticShadows(anchor, list, buf) })
}
