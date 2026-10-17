/**
 * The player: you, the doctor, walking the hospital GTA-style (W1). Mounted by App.tsx inside the <Canvas>.
 *
 *   <Player />      builds the PlayerSystem on mount (it adds you to the sim at the entrance, in walk mode: the app STARTS
 *                   walking), steps it every frame at `FRAME_PRIORITY.player` (-10), and removes its listeners on unmount
 *   controls        `?controls=classic` selects the camera-relative WASD scheme; the default ("easy") turns you with A and D
 *   walkCam         the camera state the scene reads per frame (src/scene/player/state.ts)
 *   useWalk         the slow copy for the HUD: mode, view, pointer lock
 *   sim.player      you, as the sim sees you (written every frame)
 *
 * Draws nothing itself: your avatar is a crowd entity (`sim.playerAvatar`), so there is no extra shader to compile on the first
 * Tab or the first V. `?probe=1` exposes `window.__hospitalPlayer` for scripted checks (snapshot, place, look).
 *
 * See system.ts for what happens each frame, and cameraApi.ts for how the room focus hands over to it.
 */
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { PerspectiveCamera } from 'three'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import { sim } from '@/sim'
import { lookPlayerCamera, placePlayer, playerSnapshot, registerPlayer } from './api'
import { schemeFromSearch } from './scheme'
import { PlayerSystem } from './system'

export { walkCam, useWalk } from './state'
export { placePlayer, playerSnapshot, lookPlayerCamera } from './api'

const probeOn = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('probe') === '1'
/** How the keys steer you: the easy scheme (A and D turn you, the camera follows) unless the URL says `?controls=classic`. */
const scheme = schemeFromSearch(typeof window !== 'undefined' ? window.location.search : '')

export function Player(): null {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const connected = useThree((s) => s.events.connected)
  const system = useRef<PlayerSystem | null>(null)

  useEffect(() => {
    const container = connected instanceof HTMLElement ? connected : (gl.domElement.parentElement ?? gl.domElement)
    // `sim` is a live binding: a Jump swaps it, so it is read at every use
    const sys = new PlayerSystem({ camera: camera as PerspectiveCamera, container, getSim: () => sim, scheme })
    system.current = sys
    registerPlayer(sys)
    const w = window as unknown as { __hospitalPlayer?: unknown }
    if (probeOn) w.__hospitalPlayer = { snapshot: playerSnapshot, place: placePlayer, look: lookPlayerCamera }
    return () => {
      if (probeOn) delete w.__hospitalPlayer
      registerPlayer(null)
      sys.dispose()
      system.current = null
    }
  }, [camera, gl, connected])

  // after the simulation (-100), before the camera rig (-1), the label anchors (-0.5) and every <Html> label (0): the full order of a
  // frame is in scene/camera/frameOrder.ts. The chase camera is written here, so the text drawn over the picture sees this frame's.
  useFrame((_, dt) => system.current?.update(dt), FRAME_PRIORITY.player)

  return null
}
