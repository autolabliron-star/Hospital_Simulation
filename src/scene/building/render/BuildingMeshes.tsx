/**
 * The thin renderer: layout data -> a few merged meshes per material, a handful of instanced meshes, one screen quad
 * mesh (shared atlas), the curved video wall and one label mesh. Everything is built once in `useMemo` and static
 * (no `useFrame`), the geometries are disposed on unmount, and the baked sun shadow is refreshed after mount.
 */
import { useEffect, useMemo } from 'react'
import { InstancedBufferAttribute, InstancedMesh, Mesh, type BufferGeometry, type Group, type Material, type Texture } from 'three'
import { MAT } from '@/scene/materials'
import { invalidateShadows } from '@/scene/Lighting'
import { getLayout } from '../layout'
import { getCommandWallScreen } from './commandWall'
import { compileLayout, disposeCompiled, type InstancedSpec } from './compile'
import { buildLabelMesh } from './labels'
import { createScreenAtlas } from './screens'
import { modeSwitch } from './walk/modeSwitch'

function instancedMesh(spec: InstancedSpec): InstancedMesh {
  const mesh = new InstancedMesh(spec.geometry, MAT[spec.mat], spec.count)
  mesh.name = spec.key
  mesh.instanceMatrix.array.set(spec.matrices)
  mesh.instanceMatrix.needsUpdate = true
  if (spec.colors) mesh.instanceColor = new InstancedBufferAttribute(spec.colors, 3)
  mesh.castShadow = spec.castShadow
  mesh.receiveShadow = spec.receiveShadow
  mesh.matrixAutoUpdate = false
  mesh.updateMatrix()
  mesh.computeBoundingSphere()
  mesh.computeBoundingBox()
  return mesh
}

function staticMesh(geometry: BufferGeometry, material: Material, name: string, cast: boolean, receive: boolean): Mesh {
  const mesh = new Mesh(geometry, material)
  mesh.name = name
  mesh.castShadow = cast
  mesh.receiveShadow = receive
  mesh.matrixAutoUpdate = false
  mesh.updateMatrix()
  return mesh
}

function buildScene() {
  const layout = getLayout()
  const compiled = compileLayout(layout)
  const meshes: Mesh[] = []
  /** Drawn in the overview only (the walk-mode building replaces them). */
  const overview: Mesh[] = []
  const textures: Texture[] = []
  const materials: Material[] = []

  for (const m of compiled.merged) (m.overviewOnly ? overview : meshes).push(staticMesh(m.geometry, MAT[m.mat], m.key, m.castShadow, m.receiveShadow))
  for (const spec of compiled.instanced) meshes.push(instancedMesh(spec))

  if (compiled.screens) {
    const atlas = createScreenAtlas()
    textures.push(atlas.texture)
    materials.push(atlas.material)
    meshes.push(staticMesh(compiled.screens, atlas.material, 'screens', false, false))
  }
  if (compiled.commandWall) {
    const wall = getCommandWallScreen() // shared: M4 draws the live map on its canvas
    meshes.push(staticMesh(compiled.commandWall, wall.material, 'command-wall', false, false))
  }
  const labels = buildLabelMesh(layout.labels)
  if (labels) {
    textures.push(labels.texture)
    materials.push(labels.material)
    const mesh = staticMesh(labels.geometry, labels.material, 'floor-labels', false, false)
    mesh.renderOrder = 2
    // the giant room names on the floor read the plan from above; at eye level (W1 walk) the door plates and signs do it
    mesh.frustumCulled = false
    overview.push(mesh)
  }

  const dispose = () => {
    disposeCompiled(compiled)
    labels?.geometry.dispose()
    for (const t of textures) t.dispose()
    for (const mat of materials) mat.dispose()
  }
  return { meshes, overview, dispose }
}

const setOverviewGroup = (g: Group | null): void => {
  modeSwitch.overview = g
}

export function BuildingMeshes() {
  const built = useMemo(buildScene, [])
  useEffect(() => {
    // the meshes are in the scene now: bake the sun shadow once more so the new furniture and walls are in it
    invalidateShadows()
    return built.dispose
  }, [built])
  return (
    <group name="building">
      {built.meshes.map((m) => (
        <primitive key={m.name} object={m} />
      ))}
      <group name="building-overview-only" ref={setOverviewGroup}>
        {built.overview.map((m) => (
          <primitive key={m.name} object={m} />
        ))}
      </group>
    </group>
  )
}
