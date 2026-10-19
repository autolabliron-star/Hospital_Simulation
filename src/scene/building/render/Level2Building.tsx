/**
 * Level 2 of the building (R2, docs/R2-SURGERY.md): the robotic surgery suite's cut shell and its walk-mode building, in ONE group at (-150, +4.2, 0), so
 * everything inside is authored in sim coordinates (sim x = drawn x + 150) and appears stacked 4.2 m over the west block of the hospital. The sim, the nav,
 * the collision and the boom probe all keep sim coordinates; only drawing moves, here, by one rigid translation (`toDisplayInto` says the same).
 *
 *   <Level2Meshes />          the static meshes (floors, walls, glazing, the rooms, the OR): one merged mesh per material (compile.ts, level 2)
 *   <WalkBuilding level={2} /> upper walls, lintels, ceilings, signs and door leaves for walking on level 2, with the doors sensed in sim space
 *
 * The group is mounted hidden from the start, so the warm-up compiles level 2 behind the loading screen (no shader program is new: the same palette
 * materials in the same flags as level 1), and shown while `levelView.shown === 2` (the overview's Level 2, or walking on level 2), from a frame callback
 * that runs after the levels frame (FRAME_PRIORITY.levels). Level 2 never casts into the baked sun shadow. Its second ceiling page for the floor
 * reflections is registered with the warm-up here, so it uploads before the Enter button too.
 */
import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { levelView } from '@/scene/levels/levelView'
import { createCeilingTexture2 } from '@/scene/lighting/ceilingMap'
import { registerWarmSource } from '@/scene/warmup/registry'
import { LEVEL2_DX, LEVEL_Y } from '@/sim/levels'
import { Level2Meshes } from './BuildingMeshes'
import { BUILDING_VISIBILITY_PRIORITY, level2Visible } from './levelVisibility'
import { WalkBuilding } from './walk/WalkBuilding'

export function Level2Building() {
  const root = useRef<Group | null>(null)
  useEffect(() => registerWarmSource({ name: 'level2-ceiling-map', textures: () => [createCeilingTexture2()] }), [])
  useFrame(() => {
    if (root.current) root.current.visible = level2Visible(levelView.shown)
  }, BUILDING_VISIBILITY_PRIORITY)
  return (
    <group ref={root} name="building-l2" position={[-LEVEL2_DX, LEVEL_Y[2], 0]} visible={false}>
      <Level2Meshes />
      <WalkBuilding level={2} />
    </group>
  )
}
