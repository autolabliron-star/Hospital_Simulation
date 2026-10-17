/**
 * The live parts of the 16 ward rooms (L1): bed backrests that tilt with the recline, door tiles lit by bed state, and bedside
 * screens repainted when the room's version changes. All of the work is in wardRig.ts (so the node tests run the same code); this
 * component mounts the group and calls `step` once a frame, right after the sim.
 */
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { loop, sim, simGeneration } from '@/sim'
import { lifeOf, LIFE_PRIORITY } from '../life'
import { createWardRig } from './wardRig'

export function WardLayer() {
  const rig = useMemo(() => createWardRig(), [])
  useEffect(() => {
    rig.attach()
    return () => rig.dispose()
  }, [rig])
  useFrame((state, dt) => {
    // the bed head moves in SIM time: frozen while paused, quicker at 2x and 4x
    const simDt = loop.paused ? 0 : Math.min(dt, 0.1) * loop.speed
    rig.step({ life: lifeOf(sim), generation: simGeneration, simDt, now: state.clock.elapsedTime })
  }, LIFE_PRIORITY)
  return <primitive object={rig.group} />
}
