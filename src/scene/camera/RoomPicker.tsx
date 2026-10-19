import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3, type Mesh } from 'three'
import { useOverviewLevel } from '@/scene/levels/levelView'
import type { Area } from '@/sim/places'
import { cancelFlight, isWalkMode, tickFlight } from './cameraApi'
import { FRAME_PRIORITY } from './frameOrder'
import { useFocus } from './focus.store'
import { classifyPress, pickArea, tintBox, type LevelHit, type TintBox } from './pick'
import { focusRoom } from './roomFocus'
import { useWalk } from '@/scene/player/state'

/** Just above the floor decals (0.012) and under the floor labels (0.03); on level 2 it is lifted by that floor's height (the same offsets, 4.2 m up). */
const TINT_Y = 0.022

// Scratch objects for the pointer maths: made once, never per event.
const _ndc = new Vector3()
const _origin = new Vector3()
const _dir = new Vector3()
const _hit: LevelHit = { x: 0, z: 0, level: 1 }
const _tint: TintBox = { x: 0, y: 0, z: 0, w: 1, d: 1 }

const noRaycast = () => {}

interface Press {
  id: number
  x: number
  y: number
  t: number
  /** The farthest the pointer got from where it went down. */
  moved: number
}

/**
 * Click a room to fly into it; hover to see which room is under the cursor.
 *
 * Plain DOM listeners on the canvas, not R3F's event system: the floor is not a mesh, the pointer ray is intersected with
 * the floor (R2: level 2's floor at y = 4.2 first when it is shown, then y = 0: pick.ts `pickArea`) and handed to `areaAt`. A click means under 6 px of movement and under 350 ms (a drag orbits as before). The HUD
 * cards sit above the canvas, so presses on them never arrive here. Also drives the camera flight each frame.
 *
 * While you are walking (W1) the view is yours: no hover tint, no click-to-fly, and the wheel and drags belong to the player.
 */
export function RoomPicker() {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const tint = useRef<Mesh>(null)

  // The flight runs ahead of CameraControls (priority -1), which then applies the pose it wrote.
  useFrame((_, dt) => tickFlight(dt), FRAME_PRIORITY.tour)

  useEffect(() => {
    const el = gl.domElement
    let press: Press | null = null
    let pointers = 0
    let multiTouch = false
    let hovered: Area | null = null

    const pick = (clientX: number, clientY: number): Area | null => {
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) return null
      camera.updateMatrixWorld()
      _origin.setFromMatrixPosition(camera.matrixWorld)
      _ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1, 0.5).unproject(camera)
      _dir.copy(_ndc).sub(_origin)
      // only the overview picks, so the level on screen is the overview's Level switch
      return pickArea(_origin.x, _origin.y, _origin.z, _dir.x, _dir.y, _dir.z, useOverviewLevel.getState().level, _hit)
    }

    /** Show the tint on the hovered room, unless it is the room we are already in. */
    const showHover = () => {
      const mesh = tint.current
      const focused = useFocus.getState().area
      el.style.cursor = hovered ? 'pointer' : ''
      if (!mesh) return
      if (!hovered || hovered.id === focused) {
        mesh.visible = false
        return
      }
      // a level-2 area is in the sim strip: draw its tint where the room stands (west by 150, up by 4.2)
      const t = tintBox(hovered.rect, TINT_Y, _tint)
      mesh.position.set(t.x, t.y, t.z)
      mesh.scale.set(t.w, t.d, 1)
      mesh.visible = true
    }

    const setHover = (a: Area | null) => {
      if ((a?.id ?? null) === (hovered?.id ?? null)) return
      hovered = a
      showHover()
    }

    const onDown = (e: PointerEvent) => {
      if (isWalkMode()) {
        press = null
        return
      }
      cancelFlight() // grabbing the camera stops a flight where it is
      pointers++
      if (pointers > 1) multiTouch = true
      press = e.button === 0 && !multiTouch ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, moved: 0 } : null
    }

    const onMove = (e: PointerEvent) => {
      if (isWalkMode()) {
        if (hovered) setHover(null)
        return
      }
      if (press && e.pointerId === press.id) press.moved = Math.max(press.moved, Math.hypot(e.clientX - press.x, e.clientY - press.y))
      if (e.buttons === 0) setHover(pick(e.clientX, e.clientY))
    }

    const onUp = (e: PointerEvent) => {
      pointers = Math.max(0, pointers - 1)
      if (pointers === 0) multiTouch = false
      const p = press
      if (!p || e.pointerId !== p.id) return
      press = null
      if (isWalkMode()) return
      if (e.type !== 'pointerup') return
      if (document.elementFromPoint(e.clientX, e.clientY) !== el) return // released over the HUD
      const moved = Math.max(p.moved, Math.hypot(e.clientX - p.x, e.clientY - p.y))
      if (classifyPress(moved, e.timeStamp - p.t) !== 'click') return
      const area = pick(e.clientX, e.clientY)
      if (area) focusRoom(area.id)
    }

    const onLeave = () => setHover(null)
    const onWheel = () => {
      if (!isWalkMode()) cancelFlight()
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)
    el.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    const unsubscribe = useFocus.subscribe(showHover)
    // the Level switch changes what is under the cursor: the old room's tint goes, the next pointer move picks again
    const unsubscribeLevel = useOverviewLevel.subscribe((s, prev) => {
      if (s.level !== prev.level) setHover(null)
    })
    // Tab to walk mode while a room is under the cursor: the hover tint goes with the overview
    const unsubscribeWalk = useWalk.subscribe((s) => {
      if (s.mode !== 'overview') setHover(null)
    })
    return () => {
      unsubscribeWalk()
      unsubscribeLevel()
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      el.removeEventListener('wheel', onWheel)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      unsubscribe()
      el.style.cursor = ''
    }
  }, [gl, camera])

  return (
    <mesh ref={tint} visible={false} rotation-x={-Math.PI / 2} renderOrder={1} frustumCulled={false} raycast={noRaycast}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial color="#1f9e8f" transparent opacity={0.15} depthWrite={false} toneMapped={false} />
    </mesh>
  )
}
