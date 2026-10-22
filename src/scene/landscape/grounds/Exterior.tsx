/**
 * The real-place exterior, mounted once: `<Exterior />` (World.tsx, right after `<Building />`). Everything a walker sees outside the glazing:
 * the ground to a hazy horizon, the entrance forecourt in large-format paving, the drop-off lay-by, the ring road, the car park with parked
 * cars, street lights, trees and the neighbouring blocks. See docs/handover/look-exterior.md.
 *
 * Shown ONLY while walking (the overview keeps the architect's model base, drawn by the building layout): the group's `visible` follows
 * `isWalkMode`, one boolean per frame, nothing allocated. Built once at mount, hidden, so the warm-up compiles its two shader programs (plus
 * their instanced variants) behind the loading screen (`registerWarmSource`; the traversal finds them hidden or not).
 *
 * Budget: 4 draw calls, about 35 k triangles, 2 materials, no lights, no shadow casting, no textures.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { BUILDING_VISIBILITY_PRIORITY } from '@/scene/building/render/levelVisibility'
import { isWalkMode } from '@/scene/building/render/walk/modeSwitch'
import { registerWarmSource } from '@/scene/warmup/registry'
import { sim } from '@/sim'
import { buildExteriorScene } from './scene'

export function Exterior() {
  const built = useMemo(() => buildExteriorScene(), [])
  const group = useRef<Group>(null)
  useEffect(() => {
    const unregister = registerWarmSource({ name: 'exterior', materials: () => built.materials })
    return () => {
      unregister()
      built.dispose()
    }
  }, [built])
  useFrame(() => {
    const g = group.current
    if (g) g.visible = isWalkMode(sim.player?.mode)
  }, BUILDING_VISIBILITY_PRIORITY)
  return (
    <group ref={group} name="exterior" visible={false}>
      {built.meshes.map((m) => (
        <primitive key={m.name} object={m} />
      ))}
    </group>
  )
}
