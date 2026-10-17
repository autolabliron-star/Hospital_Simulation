/**
 * The soft lights of the dock ports and of the overhead charging rank:
 *   - a light strip under the sill of each of the four top dock ports, on the rail side (outside the glass, where the pod
 *     hangs): teal while a pod hangs docked there (brighter and pulsing while the picker loads it), a faint grey otherwise;
 *   - a thin glow strip along each of the charging contacts on the rail above each of the ten rank slots (two per slot):
 *     teal (pulsing softly) over a pod that is charging, green when its battery is full, and nearly dark when the slot is
 *     empty or the pod has an order.
 * A pod "is at" a port or a slot when it stands within 0.3 m of it (plan distance: the pod hangs on the rail above the
 * lane). All colours go through instance colours on the shared `tintedGlow` material, and only these strips are touched,
 * so the cost is a few colour writes.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, Object3D, type InstancedMesh } from 'three'
import { MAT, STATUS } from '@/scene/materials'
import { ensureTintedGlow } from '@/scene/robots/tintGlow'
import { sim } from '@/sim'
import { ROBOT } from '@/sim/places'
import { portGlowGeometry, rankGlowGeometry } from './dockParts'
import { CONTACT, DOCKS, FACE_SIGN, PORT, RANK_SLOTS } from './layout'

ensureTintedGlow()

const NEAR2 = 0.3 * 0.3
const OFF = new Color('#27302f').multiplyScalar(0.7)
const PORT_IDLE = new Color('#6f8a87').multiplyScalar(0.6)
const TEAL = new Color(STATUS.teal)
const GREEN = new Color(STATUS.green)
const tmp = new Color()
const dummy = new Object3D()

export function DockGlow() {
  const ports = useRef<InstancedMesh>(null)
  const strips = useRef<InstancedMesh>(null)
  const geo = useMemo(() => ({ port: portGlowGeometry(), strip: rankGlowGeometry() }), [])

  useEffect(
    () => () => {
      geo.port.dispose()
      geo.strip.dispose()
    },
    [geo],
  )

  useLayoutEffect(() => {
    const p = ports.current
    const q = strips.current
    if (!p || !q) return
    DOCKS.forEach((d, i) => {
      dummy.position.set(d.x, PORT.glow.y, FACE_SIGN[d.ward] * PORT.glow.out)
      dummy.updateMatrix()
      p.setMatrixAt(i, dummy.matrix)
      p.setColorAt(i, PORT_IDLE)
    })
    RANK_SLOTS.forEach((r, i) => {
      for (let k = 0; k < 2; k++) {
        dummy.position.set(ROBOT.rankX + (k === 0 ? -1 : 1) * CONTACT.glow.x, CONTACT.glow.y, r.z)
        dummy.updateMatrix()
        q.setMatrixAt(i * 2 + k, dummy.matrix)
        q.setColorAt(i * 2 + k, OFF)
      }
    })
    p.instanceMatrix.needsUpdate = true
    q.instanceMatrix.needsUpdate = true
  }, [])

  useFrame((state) => {
    const PODS = sim.meds.fleet.drivers
    const p = ports.current
    const q = strips.current
    if (!p || !q) return
    const pulse = 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 3)

    for (let i = 0; i < DOCKS.length; i++) {
      const d = DOCKS[i]
      let level = 0
      for (let k = 0; k < PODS.length; k++) {
        const pod = PODS[k].pod
        if (pod.ward !== d.ward) continue
        const dx = pod.position.x - d.x
        const dz = pod.position.z - d.z
        if (dx * dx + dz * dz > NEAR2 || pod.speed > 0.05) continue
        level = pod.state === 'loading' ? 2 : 1
      }
      if (level === 2) p.setColorAt(i, tmp.copy(TEAL).multiplyScalar(1.5 + 0.7 * pulse))
      else if (level === 1) p.setColorAt(i, tmp.copy(TEAL).multiplyScalar(1.3))
      else p.setColorAt(i, PORT_IDLE)
    }

    for (let i = 0; i < RANK_SLOTS.length; i++) {
      const d = RANK_SLOTS[i]
      let mode = 0 // 0 empty or busy, 1 charging, 2 full
      for (let k = 0; k < PODS.length; k++) {
        const pod = PODS[k].pod
        if (pod.ward !== d.ward || pod.state !== 'charging') continue
        const dx = pod.position.x - d.x
        const dz = pod.position.z - d.z
        if (dx * dx + dz * dz > NEAR2) continue
        mode = pod.battery < 0.995 ? 1 : 2
      }
      if (mode === 1) tmp.copy(TEAL).multiplyScalar(1.0 + 0.5 * pulse)
      else if (mode === 2) tmp.copy(GREEN).multiplyScalar(0.8)
      else tmp.copy(OFF)
      q.setColorAt(i * 2, tmp)
      q.setColorAt(i * 2 + 1, tmp)
    }
    if (p.instanceColor) p.instanceColor.needsUpdate = true
    if (q.instanceColor) q.instanceColor.needsUpdate = true
  })

  return (
    <group name="dock-glow">
      <instancedMesh ref={ports} args={[geo.port, MAT.tintedGlow, DOCKS.length]} frustumCulled={false} />
      <instancedMesh ref={strips} args={[geo.strip, MAT.tintedGlow, RANK_SLOTS.length * 2]} frustumCulled={false} />
    </group>
  )
}
