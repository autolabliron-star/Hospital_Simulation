/**
 * MealBots (L1): at most `MAX_BOTS` instances driven from `sim.life.mealBots`. All of the work is in botsRig.ts (so the node tests run
 * the same code); this component mounts the group and calls `step` once a frame, right after the sim.
 */
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { sim } from '@/sim'
import { visualDt } from '@/scene/timeScale'
import { createMealBotsRig } from './botsRig'
import { lifeOf, LIFE_PRIORITY } from './life'

export function MealBotsLayer() {
  const rig = useMemo(createMealBotsRig, [])
  useEffect(() => () => rig.dispose(), [rig])
  useFrame((state, dt) => rig.step(lifeOf(sim), visualDt(dt), state.clock.elapsedTime), LIFE_PRIORITY)
  return <primitive object={rig.group} />
}
