/**
 * The exterior's three.js objects, built once from the pure site data (./site.ts): one merged static mesh and three InstancedMeshes (trees,
 * cars, street lights) = 4 draw calls. All static (`matrixAutoUpdate` off), none casts or receives shadow (the baked sun map holds the
 * cut-height building only), none is ever touched per frame.
 */
import { BufferAttribute, BufferGeometry, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, Vector3, type Material } from 'three'
import type { MeshData } from './meshBuilder'
import { createExteriorMaterials, type ExteriorMaterials } from './material'
import { buildSite, type Site } from './site'
import { carTemplate, lampTemplate, treeTemplate, type Inst } from './templates'

export interface ExteriorScene {
  meshes: (Mesh | InstancedMesh)[]
  materials: Material[]
  site: Site
  dispose: () => void
}

function geometryOf(d: MeshData): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(d.positions, 3))
  g.setAttribute('normal', new BufferAttribute(d.normals, 3))
  g.setAttribute('color', new BufferAttribute(d.colors, 3))
  g.computeBoundingSphere()
  g.computeBoundingBox()
  return g
}

function settle(m: Mesh): void {
  m.castShadow = false
  m.receiveShadow = false
  m.matrixAutoUpdate = false
  m.updateMatrix()
}

function instanced(name: string, geometry: BufferGeometry, material: Material, list: readonly Inst[]): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, list.length)
  mesh.name = name
  const m4 = new Matrix4()
  const s = new Vector3()
  const colors = new Float32Array(list.length * 3)
  list.forEach((t, i) => {
    m4.makeRotationY(t.ry)
    m4.scale(s.set(t.s, t.s, t.s))
    m4.setPosition(t.x, 0, t.z)
    mesh.setMatrixAt(i, m4)
    colors[i * 3] = t.c[0]
    colors[i * 3 + 1] = t.c[1]
    colors[i * 3 + 2] = t.c[2]
  })
  mesh.instanceMatrix.needsUpdate = true
  mesh.instanceColor = new InstancedBufferAttribute(colors, 3)
  settle(mesh)
  mesh.computeBoundingSphere()
  return mesh
}

export function buildExteriorScene(site: Site = buildSite(), mats: ExteriorMaterials = createExteriorMaterials()): ExteriorScene {
  const groundGeo = geometryOf(site.ground)
  const treeGeo = geometryOf(treeTemplate())
  const carGeo = geometryOf(carTemplate())
  const lampGeo = geometryOf(lampTemplate())
  const ground = new Mesh(groundGeo, mats.matte)
  ground.name = 'exterior-ground'
  settle(ground)
  const meshes: (Mesh | InstancedMesh)[] = [
    ground,
    instanced('exterior-trees', treeGeo, mats.matte, site.trees),
    instanced('exterior-cars', carGeo, mats.gloss, site.cars),
    instanced('exterior-lamps', lampGeo, mats.matte, site.lamps),
  ]
  return {
    meshes,
    materials: [mats.matte, mats.gloss],
    site,
    dispose: () => {
      for (const g of [groundGeo, treeGeo, carGeo, lampGeo]) g.dispose()
      for (const m of meshes) if (m instanceof InstancedMesh) m.dispose()
      mats.matte.dispose()
      mats.gloss.dispose()
    },
  }
}
