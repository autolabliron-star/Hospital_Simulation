/**
 * The thin renderer: layout data -> a few merged meshes per material, a handful of instanced meshes, one screen quad
 * mesh (shared atlas), the curved video wall and one label mesh. Everything is built once in `useMemo` and static
 * (no per-frame work but a few `visible` flags), the geometries are disposed on unmount, and the baked sun shadow is refreshed
 * after mount.
 *
 * R2: two storeys. `BuildingMeshes` is level 1 as it always was (plus its walk-only meshes, none today). `Level2Meshes` is level 2's cut shell
 * (floors, walls, glazing, the rooms, the OR): its own merged meshes (compile.ts, `compileLayout(layout, 2)`), mounted inside the level-2 group
 * (`Level2Building`, translated by (-150, +4.2, 0)) and hidden from the start, so the warm-up compiles them behind the loading screen. Level 2
 * never casts into the baked sun shadow and never asks for a re-bake.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { InstancedBufferAttribute, InstancedMesh, Mesh, type BufferGeometry, type Group, type Material, type Texture } from 'three'
import { MAT } from '@/scene/materials'
import { invalidateShadows } from '@/scene/Lighting'
import { levelView } from '@/scene/levels/levelView'
import { sim } from '@/sim'
import type { LevelId } from '@/sim/levels'
import { getLayout } from '../layout'
import { getCommandWallScreen } from './commandWall'
import { compileLayout, disposeCompiled, labelsOfLevel, type InstancedSpec } from './compile'
import { buildLabelMesh } from './labels'
import { BUILDING_VISIBILITY_PRIORITY, level1WalkVisible, level2OverviewVisible, level2WalkVisible } from './levelVisibility'
import { acquireScreenAtlas, releaseScreenAtlas } from './screenAtlasShared'
import { isWalkMode, modeSwitch } from './walk/modeSwitch'

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

/** One level's static meshes, built once. */
function buildLevel(level: LevelId) {
  const layout = getLayout()
  const compiled = compileLayout(layout, level)
  const meshes: Mesh[] = []
  /** Drawn in the overview only (the walk-mode building replaces them). */
  const overview: Mesh[] = []
  /** Drawn while walking only (R2: the OR's ceiling booms and light heads). */
  const walkOnly: Mesh[] = []
  const textures: Texture[] = []
  const materials: Material[] = []
  let atlasAcquired = false

  for (const m of compiled.merged) (m.overviewOnly ? overview : m.walkOnly ? walkOnly : meshes).push(staticMesh(m.geometry, MAT[m.mat], m.key, m.castShadow, m.receiveShadow))
  for (const spec of compiled.instanced) meshes.push(instancedMesh(spec))

  if (compiled.screens) {
    const atlas = acquireScreenAtlas() // one atlas for both levels
    atlasAcquired = true
    meshes.push(staticMesh(compiled.screens, atlas.material, 'screens', false, false))
  }
  if (compiled.commandWall) {
    const wall = getCommandWallScreen() // shared: M4 draws the live map on its canvas
    meshes.push(staticMesh(compiled.commandWall, wall.material, 'command-wall', false, false))
  }
  const labels = buildLabelMesh(labelsOfLevel(layout.labels, level))
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
    if (atlasAcquired) releaseScreenAtlas()
  }
  return { meshes, overview, walkOnly, dispose }
}

const setOverviewGroup = (g: Group | null): void => {
  modeSwitch.overview = g
}

/** Level 1: the cut shell, as it always was. */
export function BuildingMeshes() {
  const built = useMemo(() => buildLevel(1), [])
  const walkGroup = useRef<Group | null>(null)
  useEffect(() => {
    // the meshes are in the scene now: bake the sun shadow once more so the new furniture and walls are in it
    invalidateShadows()
    return built.dispose
  }, [built])
  // level 1's walk-only meshes (none yet) show while walking on level 1; the overview-only group is the walk building's to swap (walk/WalkBuilding.tsx)
  useFrame(() => {
    if (walkGroup.current) walkGroup.current.visible = level1WalkVisible(isWalkMode(sim.player?.mode), levelView.shown)
  }, BUILDING_VISIBILITY_PRIORITY)
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
      <group name="building-walk-only" ref={walkGroup} visible={false}>
        {built.walkOnly.map((m) => (
          <primitive key={m.name} object={m} />
        ))}
      </group>
    </group>
  )
}

/**
 * Level 2's static meshes, in sim coordinates: mount inside the level-2 group (`Level2Building`). Visibility inside it follows `levelView`: the
 * overview-only meshes (the floor labels) in the overview's Level 2, the walk-only ones while walking on level 2; the group itself is hidden by its parent
 * unless level 2 is shown.
 */
export function Level2Meshes() {
  const built = useMemo(() => buildLevel(2), [])
  const overviewGroup = useRef<Group | null>(null)
  const walkGroup = useRef<Group | null>(null)
  useEffect(() => built.dispose, [built])
  useFrame(() => {
    const walking = isWalkMode(sim.player?.mode)
    if (overviewGroup.current) overviewGroup.current.visible = level2OverviewVisible(walking, levelView.shown)
    if (walkGroup.current) walkGroup.current.visible = level2WalkVisible(walking, levelView.shown)
  }, BUILDING_VISIBILITY_PRIORITY)
  return (
    <group name="building-l2-static">
      {built.meshes.map((m) => (
        <primitive key={m.name} object={m} />
      ))}
      <group name="building-l2-overview-only" ref={overviewGroup}>
        {built.overview.map((m) => (
          <primitive key={m.name} object={m} />
        ))}
      </group>
      <group name="building-l2-walk-only" ref={walkGroup} visible={false}>
        {built.walkOnly.map((m) => (
          <primitive key={m.name} object={m} />
        ))}
      </group>
    </group>
  )
}
