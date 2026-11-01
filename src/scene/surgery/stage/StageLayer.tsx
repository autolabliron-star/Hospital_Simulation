/**
 * R5 wave 2 (agent H): mounts the stage (runtime.ts: the patient's prepped skin, sterile drapes and skin marks, one mesh on the shared `MACHINE_BODY`) inside the level-2
 * surgery group, in SIM coordinates like the rig. Mounted once and hidden until it has something to show, so the warm-up reaches it at load; it does nothing while level 2 is
 * not the level shown. The frame callback runs with the rig (FRAME_PRIORITY.surgeryRig) so the drapes and the table top tip in the same frame.
 */
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import { levelView } from '@/scene/levels/levelView'
import { visualDt } from '@/scene/timeScale'
import { sim } from '@/sim'
import { createStageRuntime, disposeStageRuntime, stepStageRuntime } from './runtime'

export function StageLayer() {
  const rt = useMemo(createStageRuntime, [])
  useEffect(() => () => disposeStageRuntime(rt), [rt])
  useFrame((_, dt) => {
    if (levelView.shown !== 2) return
    const s = sim.surgery.state
    stepStageRuntime(rt, s.procedure.procedureId, s.procedure.patient, s.robot.arms, visualDt(dt))
  }, FRAME_PRIORITY.surgeryRig)
  return <primitive object={rt.mesh} />
}
