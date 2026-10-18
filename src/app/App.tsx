import { useEffect, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { CameraControls } from '@react-three/drei'
import type CameraControlsImpl from 'camera-controls'
import { Box3, MathUtils, Vector3 } from 'three'
import { BUILDING, VIEW } from '@/sim/places'
import { Ambience } from '@/audio/AmbienceSounds'
import { ScannerSounds } from '@/audio/ScannerSounds'
import { registerControls } from '@/scene/camera/cameraApi'
import { RoomPicker } from '@/scene/camera/RoomPicker'
import { CommandWallLive } from '@/scene/building/render/CommandWallLive'
import { Interaction } from '@/scene/interact'
import { Player } from '@/scene/player'
import { RigControls } from '@/scene/player/rigControls'
import { Quality } from '@/scene/quality/Quality'
import { SimDriver } from '@/scene/SimDriver'
import { Warmup, useEntered, useLoadingUp } from '@/scene/warmup'
import { World } from '@/scene/World'
import { GoToMenu } from '@/ui/GoToMenu'
import { Hud } from '@/ui/Hud'
import { JumpFade, JumpMenu } from '@/ui/JumpMenu'
import { LoadingScreen } from '@/ui/loading'
import { RoomKeys } from '@/ui/RoomKeys'
import { RoomPanel } from '@/ui/RoomPanel'
import { DevProbe, ProbeOverlay, probeEnabled } from './DevProbe'
import { PowerLoop } from './PowerLoop'

const FOV = 35
/** Camera elevation above the horizon (the plan's Sims-style 50° look-in). */
const PITCH = MathUtils.degToRad(50)
/** Extra metres of building to keep in frame left and right. */
const SIDE_MARGIN = 3

/** Orbit target limits, so the view cannot be dragged off into the void. */
const TARGET_BOUNDS = new Box3(new Vector3(BUILDING.x0 - 10, -1, BUILDING.z0 - 10), new Vector3(BUILDING.x1 + 10, 12, BUILDING.z1 + 10))

/** Camera controls plus the first framing of the whole building for the current window shape. */
function CameraRig() {
  const controls = useRef<CameraControlsImpl>(null)
  const get = useThree((s) => s.get)

  useEffect(() => {
    const c = controls.current
    if (!c) return
    const { size } = get()
    const aspect = size.width / Math.max(1, size.height)
    const tanV = Math.tan(MathUtils.degToRad(FOV) / 2)
    const tanH = tanV * aspect
    // Width is the tight dimension: the near edge of the building is closer to the lens, so add its depth offset.
    const fitWidth = (VIEW.halfExtent.x + SIDE_MARGIN) / tanH + VIEW.halfExtent.z * Math.cos(PITCH)
    const fitHeight = (VIEW.halfExtent.z * Math.sin(PITCH) + 4) / tanV + VIEW.halfExtent.z * Math.cos(PITCH)
    const dist = Math.max(fitWidth, fitHeight)
    const { x: tx, z: tz } = VIEW.center
    c.setBoundary(TARGET_BOUNDS)
    void c.setLookAt(tx, dist * Math.sin(PITCH), tz + dist * Math.cos(PITCH), tx, 0, tz, false)
    // the room focus flies this camera (click a room, or the "Go to…" menu)
    registerControls(c)
    if (!probeEnabled) return () => registerControls(null)
    // Scripted shots for checks (?probe=1 only): look at (x, y, z) from `distance` m, `pitchDeg` above the
    // horizon, `yawDeg` round from the south (0 = camera south of the target, looking north).
    const w = window as unknown as { __hospitalCam?: unknown }
    w.__hospitalCam = {
      view(x: number, y: number, z: number, distance: number, pitchDeg = 50, yawDeg = 0) {
        const p = MathUtils.degToRad(pitchDeg)
        const yaw = MathUtils.degToRad(yawDeg)
        const h = distance * Math.cos(p)
        return c.setLookAt(x + h * Math.sin(yaw), y + distance * Math.sin(p), z + h * Math.cos(yaw), x, y, z, false)
      },
      overview: () => c.setLookAt(tx, dist * Math.sin(PITCH), tz + dist * Math.cos(PITCH), tx, 0, tz, false),
    }
    return () => {
      delete w.__hospitalCam
      registerControls(null)
    }
  }, [get])

  return (
    <CameraControls
      ref={controls}
      // the overview rig, with a suspend switch: the player system suspends it while you walk (W1) and hands the camera back on Tab
      impl={RigControls}
      makeDefault
      minDistance={8}
      maxDistance={190}
      minPolarAngle={0.08}
      maxPolarAngle={Math.PI / 2 - 0.1}
      smoothTime={0.14}
      draggingSmoothTime={0.07}
      dollyToCursor
    />
  )
}

/** M1: the simulation made visible: a flat floor plan, boxes for robots, capsules for people, a top camera and the HUD. */
/**
 * M5: the frame loop and the quality ladder, in their own tiny component so the loading flag never re-renders App (and with
 * it the Canvas). 30 fps and no quality steps until the presenter presses Enter; then 60 fps and the ladder watches.
 */
function Pacing() {
  const loading = useLoadingUp()
  const entered = useEntered()
  return (
    <>
      <PowerLoop loading={loading} />
      <Quality ready={entered} />
    </>
  )
}

export function App() {
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      {/* M5: frameloop "never": PowerLoop drives every frame (the cap, pauses, no fast-forward); Quality owns the real pixel ratio */}
      <Canvas flat shadows="percentage" frameloop="never" dpr={[1, 1.5]} gl={{ antialias: false, powerPreference: "high-performance" }} camera={{ fov: FOV, near: 1, far: 500, position: [VIEW.center.x, 80, 66] }}>
        <Pacing />
        <DevProbe />
        <SimDriver />
        <World />
        <CommandWallLive />
        <RoomPicker />
        {/* you, the doctor: starts walking at the entrance (W1). Steps at FRAME_PRIORITY.player (-10), before the rig (-1). */}
        <Player />
        <Interaction />
        <CameraRig />
        {/* M5: LAST in the Canvas, so every layer's effects (the environment map) have run. Compiles both modes, uploads every texture. */}
        <Warmup />
      </Canvas>
      <Hud />
      <GoToMenu />
      <RoomPanel />
      <ScannerSounds />
      <Ambience />
      <RoomKeys />
      <JumpMenu />
      <JumpFade />
      <ProbeOverlay />
      {/* M5: above everything; holds the sim paused until the presenter presses Enter */}
      <LoadingScreen />
    </div>
  )
}
