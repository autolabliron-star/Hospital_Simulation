/**
 * The crowd renderer component: mounts the meshes of crowdRig.ts and drives them every frame from `sim.entities`.
 * Seven draw calls at most: 3 bodies (high, mid, far), props, vehicles, ground blobs, and the selection ring (only while it shows).
 * Nothing is frustum culled and nobody is dropped by distance, so nobody ever pops out; no React state is involved per frame.
 * Reads the simulation, never drives it. Mount once inside the <Canvas>.
 */
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { sim } from '@/sim'
import { createCrowdRig, driveCrowd } from './crowdRig'
import { setActiveCrowd } from './runtime'

const debugEnabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('crowdDebug')

/** The instanced crowd: mount once inside the Canvas (in place of the M1 capsule placeholders). */
export function People() {
  const rig = useMemo(createCrowdRig, [])

  useEffect(() => {
    setActiveCrowd(rig.model)
    const w = window as unknown as Record<string, unknown>
    if (debugEnabled) w.__hospitalCrowd = { model: rig.model, stats: () => ({ ...rig.model.stats }) }
    return () => {
      setActiveCrowd(null)
      if (debugEnabled) delete w.__hospitalCrowd
      rig.dispose()
    }
  }, [rig])

  useFrame((state, delta) => driveCrowd(rig, sim.entities, state.camera.position.x, state.camera.position.y, state.camera.position.z, delta, state.clock.elapsedTime))

  return (
    <>
      {rig.objects.map((o) => (
        <primitive key={o.name} object={o} dispose={null} />
      ))}
    </>
  )
}
