/**
 * MedPods (W2: they hang from the ceiling rail): one InstancedMesh per part (bogie, body, light ring, face screen, compartment
 * lids, hatches), all driven from the sim's interpolated pod poses by `PodRig` (podRig.ts: pose, sway, hatches, ring, face, lids).
 * Nothing touches the floor any more, so there is no floor shadow; moving things never cast into the baked shadow map.
 *
 * Six draw calls. The hatches are one mesh of 4 x pod count instances (one plate shape: the bottom hatches, the side hatches, then
 * the dark seats under each), so the two hatches still animate independently without a seventh call.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { InstancedMesh } from 'three'
import { MAT } from '@/scene/materials'
import { loop, sim } from '@/sim'
import { ROBOT } from '@/sim/places'
import { WARDS } from '@/sim/types'
import { createFaceAtlas } from './faceAtlas'
import { createFaceMaterial } from './faceMaterial'
import { PodRig, type PodMeshes } from './podRig'
import { podBodyGeometry, podBogieGeometry, podFaceGeometry, podHatchGeometry, podLidGeometry, podRingGeometry } from './podParts'
import './tintGlow'

/** Every hospital has the same fleet (the contract's pods per ward, both wards), so a Jump never changes it. */
const N = ROBOT.podsPerWard * WARDS.length
const LIDS = ROBOT.compartments

export function PodsLayer() {
  const bogie = useRef<InstancedMesh>(null)
  const body = useRef<InstancedMesh>(null)
  const ring = useRef<InstancedMesh>(null)
  const face = useRef<InstancedMesh>(null)
  const lids = useRef<InstancedMesh>(null)
  const hatches = useRef<InstancedMesh>(null)

  const assets = useMemo(() => {
    const atlas = createFaceAtlas()
    return {
      atlas,
      bogieGeo: podBogieGeometry(),
      bodyGeo: podBodyGeometry(),
      ringGeo: podRingGeometry(),
      faceGeo: podFaceGeometry(N),
      lidGeo: podLidGeometry(),
      hatchGeo: podHatchGeometry(),
      faceMat: createFaceMaterial(atlas?.texture ?? null),
      rig: new PodRig(N, atlas, sim.t),
      owner: sim,
    }
  }, [])

  useEffect(
    () => () => {
      for (const g of [assets.bogieGeo, assets.bodyGeo, assets.ringGeo, assets.faceGeo, assets.lidGeo, assets.hatchGeo]) g.dispose()
      assets.faceMat.map?.dispose()
      assets.faceMat.dispose()
    },
    [assets],
  )

  // give the tinted meshes their instance colours before the first draw, so no shader recompiles later
  useLayoutEffect(() => {
    const meshes = { bogie: bogie.current, body: body.current, ring: ring.current, face: face.current, lids: lids.current, hatches: hatches.current }
    if (meshes.bogie && meshes.body && meshes.ring && meshes.face && meshes.lids && meshes.hatches) assets.rig.init(meshes as PodMeshes)
  }, [assets])

  useFrame((state, dt) => {
    const bo = bogie.current
    const bd = body.current
    const ri = ring.current
    const fa = face.current
    const li = lids.current
    const ha = hatches.current
    if (!bo || !bd || !ri || !fa || !li || !ha) return

    if (assets.owner !== sim) {
      assets.owner = sim
      assets.rig.reset(sim.t)
    }
    // sim-time step for the filters: frozen while paused, faster at 2x and 4x
    const simDt = loop.paused ? 0 : Math.min(dt, 0.1) * loop.speed
    assets.rig.update(sim.meds.fleet.drivers, rigMeshes(bo, bd, ri, fa, li, ha), sim.t, simDt, state.clock.elapsedTime, sim.meds.orders)
  })

  return (
    <group name="pods">
      <instancedMesh ref={bogie} args={[assets.bogieGeo, MAT.metalDark, N]} frustumCulled={false} />
      <instancedMesh ref={body} args={[assets.bodyGeo, MAT.whitePlastic, N]} frustumCulled={false} />
      <instancedMesh ref={ring} args={[assets.ringGeo, MAT.tintedGlow, N]} frustumCulled={false} />
      <instancedMesh ref={face} args={[assets.faceGeo, assets.faceMat, N]} frustumCulled={false} />
      <instancedMesh ref={lids} args={[assets.lidGeo, MAT.tinted, N * LIDS]} frustumCulled={false} />
      <instancedMesh ref={hatches} args={[assets.hatchGeo, MAT.frame, N * 4]} frustumCulled={false} />
    </group>
  )
}

/** The one reusable bundle of mesh handles (filled in place each frame, so the frame allocates nothing). */
const bundle = {} as PodMeshes
function rigMeshes(bo: InstancedMesh, bd: InstancedMesh, ri: InstancedMesh, fa: InstancedMesh, li: InstancedMesh, ha: InstancedMesh): PodMeshes {
  bundle.bogie = bo
  bundle.body = bd
  bundle.ring = ri
  bundle.face = fa
  bundle.lids = li
  bundle.hatches = ha
  return bundle
}
