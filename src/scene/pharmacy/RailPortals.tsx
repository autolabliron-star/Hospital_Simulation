/**
 * The flaps of the four rail portals in the core's glass corridor walls (where each ward's ceiling rail leaves and re-enters
 * the core). Each portal has a light flap in two halves, hinged on a line just under the rail's underside and hanging down
 * to the sill, with a gap between the halves for the rail's bogie stem. The flap lifts (swings up to nearly horizontal, above the
 * pod's roof) while any pod is within 2 m of the portal and drops half a second after the last one has gone, so a pod
 * never touches it.
 *
 * Driven in useFrame without allocation by the small state machine in portalMotion.ts (a 0..1 value per portal moved at a fixed rate
 * in sim time, frozen when paused, shown through a smoothstep). The halves are one InstancedMesh on the shared `tinted` material.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, Object3D, type InstancedMesh } from 'three'
import { MAT } from '@/scene/materials'
import { hideInstances } from '@/scene/robots/instancing'
import { loop, sim } from '@/sim'
import { flapGeometry } from './dockParts'
import { FLAP, PORTAL, PORTALS } from './layout'
import { flapAngle, newPortalState, stepPortal } from './portalMotion'

const N = PORTALS.length
const FLAP_COLOR = new Color('#dcebe8')

const dummy = new Object3D()
const STATE = PORTALS.map(newPortalState)
const TRIGGER2 = PORTAL.trigger * PORTAL.trigger

function anyPodNear(x: number, z: number, r2: number): boolean {
  const PODS = sim.meds.fleet.drivers
  for (let i = 0; i < PODS.length; i++) {
    const p = PODS[i].pod.position
    const dx = p.x - x
    const dz = p.z - z
    if (dx * dx + dz * dz < r2) return true
  }
  return false
}

export function RailPortals() {
  const flaps = useRef<InstancedMesh>(null)
  const geo = useMemo(() => flapGeometry(), [])
  useEffect(() => () => geo.dispose(), [geo])

  useLayoutEffect(() => {
    const m = flaps.current
    if (!m) return
    for (let i = 0; i < N * 2; i++) m.setColorAt(i, FLAP_COLOR)
    hideInstances(m)
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [])

  useFrame((_, dt) => {
    const m = flaps.current
    if (!m) return
    const simDt = loop.paused ? 0 : Math.min(dt, 0.1) * loop.speed
    for (let i = 0; i < N; i++) {
      const p = PORTALS[i]
      stepPortal(STATE[i], anyPodNear(p.x, p.z, TRIGGER2), simDt)
      const angle = flapAngle(STATE[i].raw)
      // the flap swings up towards the core side of the wall
      const inward = p.side === 'N' ? 1 : -1
      dummy.rotation.set(-inward * angle, 0, 0)
      dummy.scale.set(FLAP.w, FLAP.len, PORTAL.flapT)
      for (let h = 0; h < 2; h++) {
        dummy.position.set(p.x + (h === 0 ? -FLAP.cx : FLAP.cx), PORTAL.hingeY, p.z + inward * PORTAL.hingeOffset)
        dummy.updateMatrix()
        m.setMatrixAt(i * 2 + h, dummy.matrix)
      }
    }
    m.instanceMatrix.needsUpdate = true
  })

  return (
    <group name="rail-portals">
      <instancedMesh ref={flaps} args={[geo, MAT.tinted, N * 2]} frustumCulled={false} />
    </group>
  )
}
