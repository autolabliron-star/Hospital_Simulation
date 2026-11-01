/**
 * R4: the CT-guided cryoablation suite's live layer on level 2 (docs/R4-CRYO-SUITE.md): the CT (gantry, spinning rotor, moving table, lasers and
 * status strip), the needle-guidance robot's 5-axis arm and the needles (rig.ts), and the five live screens on one atlas (screens.ts). Seven draw calls (R5 wave 3: and one
 * more while a case's step-by-step view has drapes or marks to show: the patient's prepped skin, sterile sheet and skin marks, surgery/stage/proc, one hidden mesh until then).
 *
 * Mounted once, hidden from the start inside a `<LevelGroup level={2}>` (so the warm-up compiles it before the Enter button: every material is one the
 * hospital already uses), at the level-2 group's offset, so everything inside is in SIM coordinates. The rig steps at FRAME_PRIORITY.cryoRig and the
 * screens at FRAME_PRIORITY.cryoScreens; neither does anything while level 2 is not the level shown. Nothing is allocated in a frame callback.
 *
 * R5 wave 3: the rig also draws the anaesthesia machine (always: its footprint is permanent) and the screens' atlas has its monitor's tile, repainted
 * at 2 Hz (4 Hz while watched) only while its traces move; the monitor's clock is real time that stops while the sim is paused. The planning and live CT
 * pictures are registered as the watch overlay's 'ctPlan' and 'ctLive' insets at mount (and removed at unmount), each on a canvas of its own that is
 * painted only while its inset is on screen (insets.ts).
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useFocus } from '@/scene/camera/focus.store'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import { domEnv } from '@/scene/imaging/images/ctx'
import { LevelGroup } from '@/scene/levels'
import { levelView } from '@/scene/levels/levelView'
import { visualDt } from '@/scene/timeScale'
import { loop, sim, simGeneration } from '@/sim'
import { LEVEL2_DX, LEVEL_Y } from '@/sim/levels'
import { ProcStageLayer } from '@/scene/surgery/stage/proc/ProcStageLayer'
import { watchLive } from '@/scene/watch/watch.store'
import { createCryoInsets } from './insets'
import { createCryoRig, type CryoRigStep } from './rig'
import { createCryoScreens } from './screens'
import { lookingAtSuite } from './presence'

export function CryoSuiteLayer() {
  const rig = useMemo(() => createCryoRig(), [])
  const screens = useMemo(() => createCryoScreens(domEnv), [])
  // the watch overlay's two pictures, on canvases of their own that share the screens' base slice
  const insets = useMemo(() => createCryoInsets(domEnv, screens.base), [screens])
  // the monitor's display clock: real seconds, stopped while the sim is paused
  const monitorClock = useMemo(() => ({ t: 0 }), [])
  const generation = useRef(-1)

  useEffect(() => {
    // the screens are painted and uploaded now, behind the loading screen, not on the frame level 2 is first shown
    screens.paintAll(sim.cryoSuite.state)
    // R5 wave 3: the CT plan and the live CT are the watch overlay's picture-in-picture sources while the layer is mounted
    const off = insets.register()
    return () => {
      off()
      rig.dispose()
      screens.dispose()
    }
  }, [rig, screens, insets])

  // the step input is an object filled in each frame, so the callbacks allocate nothing
  const rigIn = useMemo<CryoRigStep>(() => ({ state: sim.cryoSuite.state, t: 0, dt: 0 }), [])

  useFrame((_, dt) => {
    if (levelView.shown !== 2) return
    if (generation.current !== simGeneration) {
      generation.current = simGeneration
      rig.snap()
    }
    rigIn.state = sim.cryoSuite.state
    rigIn.t = sim.t
    rigIn.dt = visualDt(dt)
    rig.step(rigIn)
  }, FRAME_PRIORITY.cryoRig)

  useFrame((state, dt) => {
    if (levelView.shown !== 2) return
    monitorClock.t += loop.paused ? 0 : dt
    // hot (4 Hz) while somebody is in the suite or looks at it, or the watch camera is on the room (R5)
    const hot = watchLive.room === 'cryo' || lookingAtSuite(useFocus.getState().area, sim.player, levelView.shown)
    screens.update(sim.cryoSuite.state, state.clock.elapsedTime, hot, monitorClock.t)
    insets.update(sim.cryoSuite.state, state.clock.elapsedTime)
  }, FRAME_PRIORITY.cryoScreens)

  return (
    <LevelGroup level={2} name="level-2-cryo-suite">
      <group name="cryo-suite" position={[-LEVEL2_DX, LEVEL_Y[2], 0]}>
        <primitive object={rig.root} />
        {/* R5 wave 3: the patient's prepped skin, sterile sheet and skin marks (surgery/stage/proc): one hidden mesh until the case has some */}
        <ProcStageLayer room="cryo" />
        <primitive object={screens.mesh} />
      </group>
    </LevelGroup>
  )
}
