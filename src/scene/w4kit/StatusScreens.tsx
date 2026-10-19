/**
 * The W4 status screens layer: mounts the atlas rig (statusRig.ts) and steps it once a frame at FRAME_PRIORITY.w4Screens. All the work (the 4 Hz
 * version check, repainting only changed tiles, the 2 Hz upload, the snap on a Jump) is in the rig, so the node tests run the same code.
 */
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import { simGeneration } from '@/sim'
import { createStatusRig, type StatusStep } from './statusRig'

export function StatusScreens() {
  const rig = useMemo(() => createStatusRig(), [])
  useEffect(() => {
    rig.attach()
    return () => rig.dispose()
  }, [rig])
  // the step input is one object filled in each frame, so the callback allocates nothing
  const input = useMemo<StatusStep>(() => ({ generation: 0, now: 0 }), [])
  useFrame((state) => {
    input.generation = simGeneration
    input.now = state.clock.elapsedTime
    rig.step(input)
  }, FRAME_PRIORITY.w4Screens)
  return <primitive object={rig.group} />
}
