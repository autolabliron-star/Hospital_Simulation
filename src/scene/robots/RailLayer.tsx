/**
 * The ceiling rail of both ward circuits (W2): a slim white beam under the ceiling with a teal light line, and a clamp block
 * every couple of metres where it hangs. Static, built once from the same circuit maths the pods ride (rail.ts), three draw
 * calls, no shadows (a rail's shadow on the floor would read as a lane again). Drawn in every mode: in the overview the walls
 * are cut at 1.3 m and there are no ceilings, so the teal line reads as the pods' route; walking, the line is off (the owner's choice,
 * 2026-10-24) and the rail is a quiet white beam under the ceiling, like a real tube-transport track.
 */
import { useEffect, useMemo } from 'react'
import { MAT } from '@/scene/materials'
import { useWalk } from '@/scene/player/state'
import { buildRail } from './rail'

export function RailLayer() {
  const geo = useMemo(() => buildRail(), [])
  // the teal line only in the overview (slow state: it changes on Tab, never per frame)
  const walking = useWalk((s) => s.mode === 'walk' || s.mode === 'toWalk')
  useEffect(
    () => () => {
      geo.body.dispose()
      geo.collars.dispose()
      geo.light.dispose()
    },
    [geo],
  )
  return (
    <group name="rail">
      <mesh geometry={geo.body} material={MAT.whitePlastic} />
      <mesh geometry={geo.collars} material={MAT.frame} />
      <mesh geometry={geo.light} material={MAT.laneLine} visible={!walking} />
    </group>
  )
}
