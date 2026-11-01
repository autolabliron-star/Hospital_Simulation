/**
 * R5 wave 3 (agent J): mounts a procedure room's stage (runtime.ts: the patient's prepped skin, the sterile sheet and the skin marks, one mesh on the shared matte cloth) inside the
 * room's group, in SIM coordinates like the rooms' rigs: the CT cryo suite's (CryoSuiteLayer) and the ultrasound room's (the imaging machines). Mounted once and hidden until it has
 * something to show, so the warm-up reaches it at load. The frame callback runs with the room's rig so the drapes and the table top move in the same frame.
 *
 * Two rules (R5 wave 3, P2 and P8):
 *   - it runs on the frame's REAL time (`stageDt`), not `visualDt`: the patient's table followers (the turn, the arms) roll on real time, so what follows them must: at 10x and 30x the
 *     drape used to refit every frame, and while the sim was paused (visualDt 0) it froze mid-roll as the body kept rolling;
 *   - it steps exactly while the screen draws the patient (`roomDrawn`: levelView `shownAt` the room's table: your level while walking, in the overview the storey on show and the ground floor
 *     round it where it is not under the slab: the rule the crowd draws people by), and is hidden otherwise: the ultrasound room's stage no longer freezes, still visible, in the
 *     level-2 overview. A room that is not drawn is suspended (runtime.ts `suspendProcRuntime`): its fit is stale by the time it is drawn again, and it shows nothing until it is
 *     fitted again, not the sheet shaped for the old pose.
 */
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import { sim } from '@/sim'
import type { RoomId } from './config'
import { createProcRuntime, disposeProcRuntime, roomDrawn, stageDt, stepProcRuntime, suspendProcRuntime } from './runtime'
import { gownBackOver } from './stage'

export function ProcStageLayer({ room }: { room: RoomId }) {
  const rt = useMemo(() => createProcRuntime(room), [room])
  useEffect(() => () => disposeProcRuntime(rt), [rt])
  useFrame(
    (_, dt) => {
      if (!roomDrawn(room)) {
        suspendProcRuntime(rt)
        return
      }
      if (room === 'cryo') {
        const s = sim.cryoSuite.state
        stepProcRuntime(rt, s.procedure.patient, s.needles, stageDt(dt), s.target, gownBackOver(s.procedure.procedureId, s.procedure.stepId))
      } else {
        const pv = sim.imaging.scanners.us.procedure
        stepProcRuntime(rt, pv.patient, null, stageDt(dt), 'kidney', gownBackOver(pv.procedureId, pv.stepId))
      }
    },
    room === 'cryo' ? FRAME_PRIORITY.cryoRig : FRAME_PRIORITY.imagingMachines,
  )
  return <primitive object={rt.mesh} />
}
