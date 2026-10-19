/**
 * The lab layer: mounts the lab rig (rig.ts: pucks, tubes and caps on the belt and in the pneumatic tube, centrifuge lids and rotors, probes,
 * grippers, status lights and glow trails; five draw calls) and registers the lab's status screens in the W4 atlas. ONE `useFrame` at
 * FRAME_PRIORITY.lab, right after the sim has interpolated this frame's samples; all the work is in the rig, so the node tests run the same code.
 */
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import { loop, sim, simGeneration } from '@/sim'
import { createLabRig, type LabStep } from './rig'
import { registerLabTiles } from './tiles'

export function LabLayer() {
  const rig = useMemo(() => createLabRig(), [])
  useEffect(() => {
    const off = registerLabTiles(() => sim.lab.state)
    return () => {
      off()
      rig.dispose()
    }
  }, [rig])
  // the step input is one object filled in each frame, so the callback allocates nothing
  const input = useMemo<LabStep>(() => ({ lab: null, generation: 0, simT: 0, dt: 0 }), [])
  useFrame((_, dt) => {
    input.lab = sim.lab
    input.generation = simGeneration
    input.simT = sim.t
    input.dt = loop.paused ? 0 : Math.min(dt, 0.1)
    rig.step(input)
  }, FRAME_PRIORITY.lab)
  return <primitive object={rig.root} />
}
