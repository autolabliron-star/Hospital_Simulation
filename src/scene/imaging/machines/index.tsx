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
import type { Mesh, Object3D } from 'three'
import { useFrame } from '@react-three/fiber'
import { getLayout } from '@/scene/building/layout'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import { invalidateShadows } from '@/scene/Lighting'
import { floorFootprints, type Footprint } from '@/scene/lighting/contact/footprints'
import { registerContactSource, shownInScene, type ContactBuffer } from '@/scene/lighting/contact/registry'
import { visualDt } from '@/scene/timeScale'
import { loop, sim } from '@/sim'
import { monitorMaterial } from './machineMaterials'
import { createRig, disposeRig, updateRig, type Rig } from './rig'

/** Negative on purpose (positive priorities take over rendering in R3F). Register it in `src/scene/camera/frameOrder.ts`. */
export const MACHINES_FRAME_PRIORITY = FRAME_PRIORITY.imagingMachines

/**
 * Realism step 2: the machines' soft contact shadows (src/scene/lighting/contact): what of the static, floor-standing meshes lies within 0.35 m of
 * the floor (the magnet's and the gantry's plinths, the table pedestals, the console desks' legs, the ultrasound cart), as footprints, once.
 * The live sun's shadow map does not reach the authored building's baked floors, so without these the scanners float.
 */
const FLOOR_MESHES = ['mri-static', 'ct-static', 'xray-rails', 'us-cart']
export const MACHINE_SHADOW = { darkness: 0.5, pen: 0.25, radius: 0.1 } as const

export function machineFootprints(rig: Pick<Rig, 'root'>): Footprint[] {
  const out: Footprint[] = []
  rig.root.updateMatrixWorld(true)
  for (const name of FLOOR_MESHES) {
    const mesh = rig.root.getObjectByName(name) as Mesh | undefined
    const pos = mesh?.geometry.attributes.position
    if (!mesh || !pos) continue
    const index = mesh.geometry.index
    for (const f of floorFootprints(pos.array, index ? index.array : null, mesh.matrixWorld.elements, { floorY: 0, band: 0.35, max: 24 })) out.push(f)
  }
  return out
}

function writeMachineShadows(root: Object3D, list: readonly Footprint[], buf: ContactBuffer): void {
  if (!shownInScene(root)) return
  for (let i = 0; i < list.length; i++) {
    const f = list[i]
    buf.add(f.cx, f.y, f.cz, 0, f.halfX, f.halfZ, Math.min(MACHINE_SHADOW.radius, f.halfX, f.halfZ), MACHINE_SHADOW.pen, MACHINE_SHADOW.darkness)
  }
}

export function Machines() {
  const rig = useMemo(() => createRig(getLayout().consoleScreens, monitorMaterial), [])

  useEffect(() => {
    invalidateShadows()
    return () => disposeRig(rig)
  }, [rig])

  useEffect(() => {
    const list = machineFootprints(rig)
    return registerContactSource({ name: 'imaging-machines', write: (buf) => writeMachineShadows(rig.root, list, buf) })
  }, [rig])

  // the table and probe smoothing stand for the sim's process (visualDt); the CT gantry spin stays on real time
  useFrame((state, dt) => updateRig(rig, sim.imaging.scanners, visualDt(dt), state.clock.elapsedTime, loop.paused ? 0 : Math.min(dt, 0.1)), MACHINES_FRAME_PRIORITY)

  return <primitive object={rig.root} />
}
