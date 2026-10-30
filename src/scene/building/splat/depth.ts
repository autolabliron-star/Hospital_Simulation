/**
 * The splat pilot's depth stand-in (./flags.ts): a depth-only copy of a zone's baked model, drawn while the zone's splat replaces it. Splats write
 * no depth, so without it the ambient occlusion pass (N8AO) sees people standing over empty space and draws its tinted shadow as smudges round
 * their feet; with it the floor, walls and furniture are in the depth buffer again and the contact shadows come back. It writes no colour and
 * draws last (a transparent material at the highest render order, after Spark's splats at 0), so it never hides a splat. It shares the model's
 * geometry; glass (see-through materials) and the kit nodes that move (doors, beds: live matrices) are left out.
 */
import { Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, type Material, type Object3D, type Plane } from 'three'

/** After Spark's splats and everything else that is transparent. */
export const SPLAT_DEPTH_RENDER_ORDER = 1000

export interface SplatDepth {
  group: Group
  material: MeshBasicMaterial
  dispose(): void
}

function seeThrough(m: Material | Material[]): boolean {
  const list = Array.isArray(m) ? m : [m]
  return list.some((x) => x.transparent || ((x as { transmission?: number }).transmission ?? 0) > 0)
}

/** The stand-in of `model` (hidden; add it next to the model, under the same parent), clipped like the model's level. */
export function splatDepthStandIn(model: Object3D, clip: Plane): SplatDepth {
  const material = new MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true })
  material.name = 'splat-depth'
  material.clippingPlanes = [clip]
  const group = new Group()
  group.name = `${model.name}-splat-depth`
  group.visible = false
  model.updateMatrixWorld(true)
  const toParent = model.parent ? new Matrix4().copy(model.parent.matrixWorld).invert() : null
  model.traverse((o) => {
    const src = o as Mesh
    if (!src.isMesh || src.matrixAutoUpdate || seeThrough(src.material)) return
    const inst = o as InstancedMesh
    let copy: Mesh
    if (inst.isInstancedMesh) {
      const im = new InstancedMesh(inst.geometry, material, inst.count)
      im.instanceMatrix = inst.instanceMatrix
      copy = im
    } else {
      copy = new Mesh(src.geometry, material)
    }
    copy.name = `${src.name}-depth`
    copy.matrixAutoUpdate = false
    copy.matrix.copy(src.matrixWorld)
    if (toParent) copy.matrix.premultiply(toParent)
    copy.renderOrder = SPLAT_DEPTH_RENDER_ORDER
    group.add(copy)
  })
  return {
    group,
    material,
    dispose() {
      group.removeFromParent()
      group.clear()
      material.dispose()
    },
  }
}
