/**
 * The animated imaging machines (R1): MRI magnet and table with coils, CT gantry with a spinning rotor and red lasers, the X-ray
 * ceiling tube on its rails with the collimator light and the exposure lamp, the ultrasound cart with the probe and the sonographer's
 * hand, and the live monitors on the control-room desks. Everything is procedural, merged into 20 draw calls, and driven by the
 * sim's `ScannerState` in ONE `useFrame` (see `rig.ts`; the pose maths is in `motion.ts`).
 *
 * Mount `<Machines />` once inside the Canvas. The building shadow is baked once: the static parts cast into it, the moving
 * parts do not.
 */
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { getLayout } from '@/scene/building/layout'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import { invalidateShadows } from '@/scene/Lighting'
import { loop, sim } from '@/sim'
import { monitorMaterial } from './machineMaterials'
import { createRig, disposeRig, updateRig } from './rig'

/** Negative on purpose (positive priorities take over rendering in R3F). Register it in `src/scene/camera/frameOrder.ts`. */
export const MACHINES_FRAME_PRIORITY = FRAME_PRIORITY.imagingMachines

export function Machines() {
  const rig = useMemo(() => createRig(getLayout().consoleScreens, monitorMaterial), [])

  useEffect(() => {
    invalidateShadows()
    return () => disposeRig(rig)
  }, [rig])

  useFrame((state, dt) => updateRig(rig, sim.imaging.scanners, loop.paused ? 0 : Math.min(dt, 0.1), state.clock.elapsedTime), MACHINES_FRAME_PRIORITY)

  return <primitive object={rig.root} />
}
