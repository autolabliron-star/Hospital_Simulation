/**
 * R5 "Watch step by step": the watch camera, mounted once inside the <Canvas> (App.tsx). Builds the director (director.ts) with the real camera, the
 * live sim, the player's lease hooks (src/scene/player/api.ts) and the building's wall probe; steps it every frame at `FRAME_PRIORITY.watchCamera`
 * (-9.4); feeds it your free look (drag on the canvas to orbit, the wheel to come closer); and registers it as the watch session the UI starts and
 * stops a watch through (watch.store.ts). Draws nothing.
 */
import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { PerspectiveCamera } from 'three'
import { getLayout } from '@/scene/building/layout'
import { flyTo, getRig, leaseCamera, overview, releaseCamera } from '@/scene/camera/cameraApi'
import { useFocus } from '@/scene/camera/focus.store'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import { interaction } from '@/scene/interact'
import { closeOverlays } from '@/scene/interact/overlays'
import { useOverviewLevel } from '@/scene/levels/levelView'
import { afterLease, placePlayer, playerPhase, playerSnapshot, playerViewPitch, requestWalk } from '@/scene/player/api'
import { WallBoxProbe } from '@/scene/player/boomProbe'
import { walkCam } from '@/scene/player/state'
import { loop, sim, simGeneration } from '@/sim'
import { useGoTo } from '@/ui/goTo.store'
import { useJump } from '@/ui/jump.store'
import { usePresentation } from '@/ui/present/presentation.store'
import { useConsoleCard } from '@/ui/walk/consoleCard.store'
import { WatchDirector, type DirectorDeps } from './director'
import { roomObstacles, type RoomObstacles, type WatchRoomId, type WatchSim } from './rooms'
import { registerWatchSession, useWatch, watchLive } from './watch.store'

/** Reduced motion, read once a frame from a query made once (a `matchMedia` call per frame would allocate). */
function reducedMotionReader(): () => boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => false
  const q = window.matchMedia('(prefers-reduced-motion: reduce)')
  return () => q.matches
}

/** Close everything that would hold your input or cover the picture, end the walkthrough, and stand you up. */
function prepare(): void {
  if (usePresentation.getState().on) usePresentation.getState().setOn(false)
  useGoTo.getState().setOpen(false)
  useJump.getState().setOpen(false)
  closeOverlays()
  if (useConsoleCard.getState().open) useConsoleCard.getState().close()
  if (interaction.seat.active !== null) interaction.standUp()
}

export function WatchCamera(): null {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const gl = useThree((s) => s.gl)

  const director = useMemo(() => {
    // each room's furniture, cart and lights, built the first time the room is watched
    const obstacles = new Map<WatchRoomId, RoomObstacles>()
    const deps: DirectorDeps = {
      camera,
      // `sim` is a live binding (a Jump swaps it): read at every use
      sim: () => sim as unknown as WatchSim,
      generation: () => simGeneration,
      player: { phase: playerPhase, snapshot: playerSnapshot, viewPitch: playerViewPitch, place: placePlayer, requestWalk, afterLease },
      rig: getRig,
      flyTo: (pose) => (pose ? flyTo(pose) : overview()),
      overviewLevel: { get: () => useOverviewLevel.getState().level, set: (level) => useOverviewLevel.getState().set(level) },
      focusArea: { get: () => useFocus.getState().area, set: (area) => useFocus.getState().setArea(area) },
      lease: { take: () => leaseCamera('watch'), release: () => releaseCamera('watch') },
      reducedMotion: reducedMotionReader(),
      probe: new WallBoxProbe(),
      simCamera: walkCam.camera,
      publish: (patch) => useWatch.getState().set(patch),
      prepare,
      live: watchLive,
      obstacles: (room) => {
        let o = obstacles.get(room)
        if (o === undefined) {
          o = roomObstacles(room, getLayout().footprints)
          obstacles.set(room, o)
        }
        return o
      },
      clock: {
        speed: () => loop.speed,
        setSpeed: (n) => {
          loop.speed = n
          loop.publishNow()
        },
      },
    }
    return new WatchDirector(deps)
  }, [camera])

  useEffect(() => {
    registerWatchSession(director)
    return () => {
      registerWatchSession(null)
      // unmounted mid-watch (a hot reload): give the camera back
      director.end()
      releaseCamera('watch')
      watchLive.room = null
    }
  }, [director])

  // free look: drag on the picture to orbit what the camera looks at, the wheel to come closer or go back
  useEffect(() => {
    const el = gl.domElement
    let drag: number | null = null
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0 || director.phase !== 'live') return
      drag = e.pointerId
    }
    const onMove = (e: PointerEvent): void => {
      if (drag === null || e.pointerId !== drag) return
      director.look(e.movementX, e.movementY)
    }
    const onUp = (e: PointerEvent): void => {
      if (e.pointerId === drag) drag = null
    }
    const onWheel = (e: WheelEvent): void => {
      if (director.phase === 'live') director.zoom(e.deltaY)
    }
    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    el.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      el.removeEventListener('wheel', onWheel)
    }
  }, [gl, director])

  // after you (-10) and the shown level (-9.5), before the tour (-9), the interaction (-8), the rig (-1) and every label: scene/camera/frameOrder.ts
  useFrame((_, dt) => director.update(dt), FRAME_PRIORITY.watchCamera)

  return null
}
