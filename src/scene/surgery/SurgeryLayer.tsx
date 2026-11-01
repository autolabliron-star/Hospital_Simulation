/**
 * The robotic OR's live scene layer (R2, level 2): the da Vinci 5 patient cart and its four arms from `sim.surgery.state.robot` (rig.ts: three instanced pools, three
 * draw calls), the surgical lights' glowing faces, the surgeryKit status screens (tiles.ts on the W4 atlas rig: consoles, anaesthesia monitor, the circulator's
 * desk, the PACU and pre-op boards) and the shared endoscope live texture on the vision cart's monitor, the wall monitor and the console viewers (liveEndoscope.ts;
 * R3: its tissue plates and instrument sprites are baked here at mount, behind the loading screen, under a warm gate: endo/plates.ts);
 * plus YOUR session at the teaching console (src/scene/interact/surgery/teaching.ts), ticked here after the interaction system has seated or stood you.
 * The patient cart is solid: its footprint is a moving blocker for your body (cartBlocker.ts), written at FRAME_PRIORITY.doors, before you move.
 * R5 wave 2: the OR table's top, rails, boots and shoulder braces are live instances of the rig's pools (table.ts), tipped every frame by the room's
 * `procedure.patient`: no extra draw call. R5 wave 2 (agent H): the prepped skin, the sterile drapes and the skin marks are one more mesh, one draw call, mounted below (stage/).
 *
 * It is mounted once, hidden from the start inside a `<LevelGroup level={2}>` (so the warm-up compiles its programs before the Enter button; the cylinders'
 * glow material and the instance-colour variant of the palette's tinted material are warmed by the rest of the hospital), at the level-2 group's offset, so
 * everything inside is in SIM coordinates. The rig writes its matrices at FRAME_PRIORITY.surgeryRig and the screens repaint at FRAME_PRIORITY.surgeryScreens,
 * and neither does anything while level 2 is not the level shown. Nothing is allocated in a frame callback.
 */
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { registerBlockers } from '@/scene/blockers'
import { getLayout } from '@/scene/building/layout'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import { layoutShadows, writeStaticShadows } from '@/scene/lighting/contact/layoutShadows'
import { registerContactSource, shownInScene, type ContactBuffer } from '@/scene/lighting/contact/registry'
import type { Object3D } from 'three'
import { useFocus } from '@/scene/camera/focus.store'
import { domEnv } from '@/scene/imaging/images/ctx'
import { interaction } from '@/scene/interact'
import { TeachingSession, teachingRegistry, type TeachingEnv, type TeachingSim } from '@/scene/interact/surgery/teaching'
import { LevelGroup } from '@/scene/levels'
import { levelView } from '@/scene/levels/levelView'
import { createStatusRig, type StatusStep } from '@/scene/w4kit/statusRig'
import { visualDt } from '@/scene/timeScale'
import { sim, simGeneration } from '@/sim'
import { LEVEL2_DX, LEVEL_Y } from '@/sim/levels'
import { useConsoleCard } from '@/ui/walk/consoleCard.store'
import { installEndoDebug } from './endo/debug'
import { ensureEndoPlates } from './endoscope'
import { endoHot, createLiveResources, LIVE_H, LIVE_W } from './liveEndoscope'
import { insetWanted, registerInsetSource } from '@/scene/registries/insetSources'
import { watchLive } from '@/scene/watch/watch.store'
import { createLiveScreens } from './liveScreens'
import { createSurgeryRig, writeDrape, type SurgeryRigStep } from './rig'
import { registerSurgeryTiles, surgeryTiles } from './tiles'
import { StageLayer } from './stage/StageLayer'
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

/** `?probe=1` installs the endoscope's probe handle (endo/debug.ts). */
const probeEnabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('probe') === '1'

/** The patient cart's base (box instance 0: 0.9 x 1.38 m, rig.ts writeCart) as a contact shadow on level 2's floor; nothing while it is hidden. */
export const CART_SHADOW = { halfX: 0.45, halfZ: 0.69, radius: 0.08, pen: 0.25, darkness: 0.5 } as const

function writeCartShadow(anchor: Object3D, m: Float32Array, buf: ContactBuffer): void {
  if (m[15] === 0 || !shownInScene(anchor)) return
  const s = CART_SHADOW
  buf.add(m[12] - LEVEL2_DX, LEVEL_Y[2], m[14], Math.atan2(m[8], m[10]), s.halfX, s.halfZ, s.radius, s.pen, s.darkness)
}

export function SurgeryLayer() {
  const rig = useMemo(() => createSurgeryRig(), [])
  const live = useMemo(() => createLiveResources(domEnv), [])
  const screens = useMemo(() => createLiveScreens(live.material), [live])
  const kit = useMemo(() => createStatusRig({ tiles: surgeryTiles }), [])
  const teaching = useMemo(() => new TeachingSession(teachingEnv()), [])
  const cartBlockers = useMemo(createCartBlockers, [])

  // realism step 2: soft contact shadows under the OR table, the consoles, the vision cart and the anaesthesia machine (layout footprints; the
  // chairs, stool, back table, Mayo stand and desk are baked) and under the robot's patient cart, which follows its pose
  useEffect(() => {
    const list = layoutShadows(getLayout().footprints, (id) => /^l2:or:(table|console:surgeon|console:teach|vision|anaesthesia)$/.test(id), { darkness: 0.5, pen: 0.22 })
    return registerContactSource({
      name: 'surgery',
      write: (buf) => {
        writeStaticShadows(rig.root, list, buf)
        writeCartShadow(rig.root, rig.boxes.instanceMatrix.array as Float32Array, buf)
      },
    })
  }, [rig])

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
    // the endoscope's sprites now, its three tissue plates in 8 ms slices; the warm-up holds the Enter button until they are in
    void ensureEndoPlates(domEnv)
    const offDebug = probeEnabled ? installEndoDebug(domEnv, { get canvas() { return live.live.canvas }, get paints() { return live.live.paints } }) : null
    teachingRegistry.current = teaching
    return () => {
      off()
      offDebug?.()
      if (teachingRegistry.current === teaching) teachingRegistry.current = null
      kit.dispose()
      live.dispose()
      rig.dispose()
    }
  }, [rig, live, kit, teaching])

  // R5: the endoscope picture is the watch overlay's picture-in-picture (the inset copies the canvas each time it repaints)
  useEffect(
    () => registerInsetSource({ id: 'endo', canvas: live.live.canvas, width: LIVE_W, height: LIVE_H, paints: () => live.live.paints }),
    [live],
  )

  // the step inputs are objects filled in each frame, so the callbacks allocate nothing
  const rigIn = useMemo<SurgeryRigStep>(
    () => ({ robot: sim.surgery.state.robot, theatre: sim.surgery.state.theatre, t: 0, dt: 0, overview: true, patient: sim.surgery.state.procedure.patient }),
    [],
  )
  const kitIn = useMemo<StatusStep>(() => ({ generation: 0, now: 0 }), [])

  useFrame((_, dt) => {
    teaching.tick()
    if (levelView.shown !== 2) return
    const s = sim.surgery.state
    rigIn.robot = s.robot
    rigIn.theatre = s.theatre
    // R5: the table top follows the patient's pose (tilt, roll, position): the room's step-by-step view
    rigIn.patient = s.procedure.patient
    rigIn.t = sim.t
    rigIn.dt = visualDt(dt)
    rigIn.overview = levelView.overview
    rig.step(rigIn)
    // R5 wave 2: while the room runs a case's script, the new sterile drapes (stage/) replace the old level blue box over the patient's lower body
    if (s.procedure.procedureId !== null) writeDrape(rig.boxes.instanceMatrix.array as Float32Array, 0)
  }, FRAME_PRIORITY.surgeryRig)

  useFrame((state) => {
    if (levelView.shown !== 2) return
    kitIn.generation = simGeneration
    kitIn.now = state.clock.elapsedTime
    kit.step(kitIn)
    // hot (4 Hz) while somebody is in the OR, or the watch camera is on it or shows its picture (R5)
    live.live.update(sim.surgery.state, sim.t, performance.now(), endoHot(useFocus.getState().area, sim.player, levelView.shown, watchLive.room === 'or' || insetWanted.endo))
  }, FRAME_PRIORITY.surgeryScreens)

  return (
    <LevelGroup level={2} name="level-2-surgery">
      <group name="surgery" position={[-LEVEL2_DX, LEVEL_Y[2], 0]}>
        <primitive object={rig.root} />
        {/* R5: the patient's prepped skin, sterile drapes and skin marks (stage/): one hidden mesh until the case has some */}
        <StageLayer />
        <primitive object={kit.group} />
        <primitive object={screens} />
      </group>
    </LevelGroup>
  )
}
