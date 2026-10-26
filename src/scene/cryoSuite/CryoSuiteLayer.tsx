/**
 * R4: the CT-guided cryoablation suite's live layer on level 2 (docs/R4-CRYO-SUITE.md): the CT (gantry, spinning rotor, moving table, lasers and
 * status strip), the needle-guidance robot's 5-axis arm and the needles (rig.ts), and the five live screens on one atlas (screens.ts). Seven draw calls.
 *
 * Mounted once, hidden from the start inside a `<LevelGroup level={2}>` (so the warm-up compiles it before the Enter button: every material is one the
 * hospital already uses), at the level-2 group's offset, so everything inside is in SIM coordinates. The rig steps at FRAME_PRIORITY.cryoRig and the
 * screens at FRAME_PRIORITY.cryoScreens; neither does anything while level 2 is not the level shown. Nothing is allocated in a frame callback.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useFocus } from '@/scene/camera/focus.store'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import { domEnv } from '@/scene/imaging/images/ctx'
import { LevelGroup } from '@/scene/levels'
import { levelView } from '@/scene/levels/levelView'
import { visualDt } from '@/scene/timeScale'
import { sim, simGeneration } from '@/sim'
import { LEVEL2_DX, LEVEL_Y } from '@/sim/levels'
import { createCryoRig, type CryoRigStep } from './rig'
import { createCryoScreens } from './screens'
import { lookingAtSuite } from './presence'

export function CryoSuiteLayer() {
  const rig = useMemo(() => createCryoRig(), [])
  const screens = useMemo(() => createCryoScreens(domEnv), [])
  const generation = useRef(-1)

  useEffect(() => {
    // the screens are painted and uploaded now, behind the loading screen, not on the frame level 2 is first shown
    screens.paintAll(sim.cryoSuite.state)
    return () => {
      rig.dispose()
      screens.dispose()
    }
  }, [rig, screens])

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

  useFrame((state) => {
    if (levelView.shown !== 2) return
    screens.update(sim.cryoSuite.state, state.clock.elapsedTime, lookingAtSuite(useFocus.getState().area, sim.player, levelView.shown))
  }, FRAME_PRIORITY.cryoScreens)

  return (
    <LevelGroup level={2} name="level-2-cryo-suite">
      <group name="cryo-suite" position={[-LEVEL2_DX, LEVEL_Y[2], 0]}>
        <primitive object={rig.root} />
        <primitive object={screens.mesh} />
      </group>
    </LevelGroup>
  )
}
