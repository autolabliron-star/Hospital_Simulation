/**
 * Meal trays (L1): 16 on the over-bed tables and up to eight per MealBot on its shelves. The work is in traysRig.ts (so the node
 * tests run the same code); this component mounts the group and calls `step` once a frame, right after the sim.
 */
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { sim } from '@/sim'
import { visualDt } from '@/scene/timeScale'
import { lifeOf, LIFE_PRIORITY } from './life'
import { createTraysRig } from './traysRig'

export function TraysLayer() {
  const rig = useMemo(createTraysRig, [])
  useEffect(() => () => rig.dispose(), [rig])
  useFrame((_, dt) => rig.step(lifeOf(sim), visualDt(dt)), LIFE_PRIORITY)
  return <primitive object={rig.group} />
}
