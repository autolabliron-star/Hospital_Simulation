/**
 * The pharmacist desks' monitors. The desks themselves are static (CoreStatic); here only the display glows:
 * bright teal, pulsing, while that ward's pharmacist is checking an order (`sim.meds.isVerifying(w)`), a calm dim teal otherwise.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BoxGeometry, Color, Object3D, type InstancedMesh } from 'three'
import { MAT, STATUS } from '@/scene/materials'
import { ensureTintedGlow } from '@/scene/robots/tintGlow'
import { sim } from '@/sim'
import { DESK, DESKS } from './layout'

ensureTintedGlow()

const DIM = new Color(STATUS.teal).multiplyScalar(0.4)
const BRIGHT = new Color(STATUS.teal).multiplyScalar(1.7)
const tmp = new Color()
const dummy = new Object3D()

export function Desks() {
  const screens = useRef<InstancedMesh>(null)
  const geo = useMemo(() => new BoxGeometry(1, 1, 1), [])
  useEffect(() => () => geo.dispose(), [geo])

  // the display sits just in front of the monitor panel, on the pharmacist's side
  useLayoutEffect(() => {
    const m = screens.current
    if (!m) return
    DESKS.forEach((d, i) => {
      dummy.position.set(d.centre.x + d.forward.x * 0.1015, DESK.top + 0.36, d.centre.z + d.forward.z * 0.1015)
      dummy.rotation.set(0, Math.atan2(d.forward.x, d.forward.z), 0)
      dummy.scale.set(0.5, 0.26, 0.004)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
      m.setColorAt(i, DIM)
    })
    m.instanceMatrix.needsUpdate = true
  }, [])

  useFrame((state) => {
    const m = screens.current
    if (!m) return
    const pulse = 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 6)
    for (let i = 0; i < DESKS.length; i++) {
      if (sim.meds.isVerifying(DESKS[i].ward)) m.setColorAt(i, tmp.copy(DIM).lerp(BRIGHT, 0.65 + 0.35 * pulse))
      else m.setColorAt(i, DIM)
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  })

  return <instancedMesh ref={screens} args={[geo, MAT.tintedGlow, DESKS.length]} frustumCulled={false} />
}
