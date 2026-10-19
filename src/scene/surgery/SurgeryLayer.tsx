/**
 * The robotic OR's live scene layer (R2, level 2): the da Vinci 5 patient cart and its four arms from `sim.surgery.state.robot` (rig.ts: three instanced pools, three
 * draw calls), the surgical lights' glowing faces, the surgeryKit status screens (tiles.ts on the W4 atlas rig: consoles, anaesthesia monitor, the circulator's
 * desk, the PACU and pre-op boards) and the shared endoscope live texture on the vision cart's monitor, the wall monitor and the console viewers (liveEndoscope.ts);
 * plus YOUR session at the teaching console (src/scene/interact/surgery/teaching.ts), ticked here after the interaction system has seated or stood you.
 * The patient cart is solid: its footprint is a moving blocker for your body (cartBlocker.ts), written at FRAME_PRIORITY.doors, before you move.
 *
 * It is mounted once, hidden from the start inside a `<LevelGroup level={2}>` (so the warm-up compiles its programs before the Enter button; the cylinders'
 * glow material and the instance-colour variant of the palette's tinted material are warmed by the rest of the hospital), at the level-2 group's offset, so
 * everything inside is in SIM coordinates. The rig writes its matrices at FRAME_PRIORITY.surgeryRig and the screens repaint at FRAME_PRIORITY.surgeryScreens,
 * and neither does anything while level 2 is not the level shown. Nothing is allocated in a frame callback.
 */
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { registerBlockers } from '@/scene/blockers'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import { useFocus } from '@/scene/camera/focus.store'
import { domEnv } from '@/scene/imaging/images/ctx'
import { interaction } from '@/scene/interact'
import { TeachingSession, teachingRegistry, type TeachingEnv, type TeachingSim } from '@/scene/interact/surgery/teaching'
import { LevelGroup } from '@/scene/levels'
import { levelView } from '@/scene/levels/levelView'
import { createStatusRig, type StatusStep } from '@/scene/w4kit/statusRig'
import { loop, sim, simGeneration } from '@/sim'
import { LEVEL2_DX, LEVEL_Y } from '@/sim/levels'
import { useConsoleCard } from '@/ui/walk/consoleCard.store'
import { inOr, createLiveResources } from './liveEndoscope'
import { createLiveScreens } from './liveScreens'
import { createSurgeryRig, type SurgeryRigStep } from './rig'
import { registerSurgeryTiles, surgeryTiles } from './tiles'
import { createCartBlockers, writeCartBlocker } from './cartBlocker'

/** The real environment of your teaching session: the live sim, the interaction system's seat and the card's store. */
function teachingEnv(): TeachingEnv {
  return {
    sim: () => sim as unknown as TeachingSim,
    sitAt: (seat) => interaction.sitAt(seat),
    seatedOn: () => interaction.seat.active,
    standUp: () => interaction.standUp(),
    card: {
      isOpen: () => useConsoleCard.getState().open,
      source: () => useConsoleCard.getState().source,
      show: (s) => useConsoleCard.getState().show(s),
      close: () => useConsoleCard.getState().close(),
    },
  }
}

export function SurgeryLayer() {
  const rig = useMemo(() => createSurgeryRig(), [])
  const live = useMemo(() => createLiveResources(domEnv), [])
  const screens = useMemo(() => createLiveScreens(live.material), [live])
  const kit = useMemo(() => createStatusRig({ tiles: surgeryTiles }), [])
  const teaching = useMemo(() => new TeachingSession(teachingEnv()), [])
  const cartBlockers = useMemo(createCartBlockers, [])

  // the cart is solid for as long as this layer is mounted (its box is in sim coordinates, on level 2's strip, so it never reaches you on level 1)
  useEffect(() => {
    const off = registerBlockers(cartBlockers)
    return () => {
      off()
      cartBlockers.count = 0
    }
  }, [cartBlockers])

  useFrame(() => {
    cartBlockers.count = writeCartBlocker(sim.surgery.state.robot.cart, cartBlockers.data)
  }, FRAME_PRIORITY.doors)

  useEffect(() => {
    const off = registerSurgeryTiles({ state: () => sim.surgery.state, now: () => sim.t })
    kit.attach()
    // the six tiles are painted and uploaded now, behind the loading screen, not on the frame level 2 is first shown
    kit.step({ generation: simGeneration, now: 0 })
    teachingRegistry.current = teaching
    return () => {
      off()
      if (teachingRegistry.current === teaching) teachingRegistry.current = null
      kit.dispose()
      live.dispose()
      rig.dispose()
    }
  }, [rig, live, kit, teaching])

  // the step inputs are objects filled in each frame, so the callbacks allocate nothing
  const rigIn = useMemo<SurgeryRigStep>(() => ({ robot: sim.surgery.state.robot, theatre: sim.surgery.state.theatre, t: 0, dt: 0, overview: true }), [])
  const kitIn = useMemo<StatusStep>(() => ({ generation: 0, now: 0 }), [])

  useFrame((_, dt) => {
    teaching.tick()
    if (levelView.shown !== 2) return
    const s = sim.surgery.state
    rigIn.robot = s.robot
    rigIn.theatre = s.theatre
    rigIn.t = sim.t
    rigIn.dt = loop.paused ? 0 : Math.min(dt, 0.1)
    rigIn.overview = levelView.overview
    rig.step(rigIn)
  }, FRAME_PRIORITY.surgeryRig)

  useFrame((state) => {
    if (levelView.shown !== 2) return
    kitIn.generation = simGeneration
    kitIn.now = state.clock.elapsedTime
    kit.step(kitIn)
    live.live.update(sim.surgery.state.robot, sim.t, performance.now(), inOr(useFocus.getState().area, sim.player, levelView.shown))
  }, FRAME_PRIORITY.surgeryScreens)

  return (
    <LevelGroup level={2} name="level-2-surgery">
      <group name="surgery" position={[-LEVEL2_DX, LEVEL_Y[2], 0]}>
        <primitive object={rig.root} />
        <primitive object={kit.group} />
        <primitive object={screens} />
      </group>
    </LevelGroup>
  )
}
