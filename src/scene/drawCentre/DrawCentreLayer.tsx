/**
 * The animated robot blood-draw centre (W4): robot heads gliding along the forearm, needles, tourniquet rings, tube bars filling in cap colours,
 * the prep machine's gripper, the NIR glow, the scan-light chaser, the status bars, the ticket slot and the send inlet, plus the live strip on the
 * three robot screens and the four screens of the shared status atlas. ONE `useFrame` at FRAME_PRIORITY.drawCentre (negative on purpose: positive
 * priorities take over rendering in R3F); the pose maths is in motion.ts, the three meshes are made in rig.ts.
 *
 * Mount `<DrawCentreLayer />` once inside the Canvas (World.tsx does). It reads `sim.blood` through the live binding every frame, so a Jump
 * (which swaps `sim`) needs nothing here. The static room (cabinets, chairs, tunnels, the prep machine's body ...) is drawn by the building.
 */
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { useFocus } from '@/scene/camera/focus.store'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import { loop, sim } from '@/sim'
import { usePower } from '@/app/power'
import { createCallAnnouncer } from '@/audio/devices/speech'
import { createDrawRig, disposeDrawRig, updateDrawRig } from './rig'
import { getStrip, stripMaterial } from './liveTexture'
import { inDrawCentre } from './presence'
import { registerDrawTiles } from './tiles'

/** Negative on purpose. Registered in src/scene/camera/frameOrder.ts. */
export const DRAW_CENTRE_FRAME_PRIORITY = FRAME_PRIORITY.drawCentre

/** The queue call is polled this often (ms): about 4 Hz, never per frame. */
const ANNOUNCE_MS = 250

export function DrawCentreLayer() {
  const rig = useMemo(() => createDrawRig(stripMaterial()), [])

  useEffect(() => {
    const undoTiles = registerDrawTiles()
    return () => {
      undoTiles()
      disposeDrawRig(rig)
    }
  }, [rig])

  // the voice of the queue: a new call on the queue screen is spoken (local voices only) when you are in the room
  useEffect(() => {
    const announcer = createCallAnnouncer({
      read: () => {
        const c = sim.blood.calling
        return c ? { ticket: c.id, station: c.station } : null
      },
      audible: () => inDrawCentre(useFocus.getState().area, sim.player),
      // a hidden tab, or a paused demo (PowerLoop: hidden tab, or a blurred window outside presentation mode), stays silent
      blocked: () => (typeof document !== 'undefined' && document.hidden) || usePower.getState().paused,
    })
    const id = window.setInterval(() => announcer.poll(), ANNOUNCE_MS)
    return () => {
      window.clearInterval(id)
      announcer.stop()
    }
  }, [])

  useFrame((state, dt) => {
    const blood = sim.blood
    updateDrawRig(rig, blood, loop.paused ? 0 : Math.min(dt, 0.1), state.clock.elapsedTime)
    getStrip().update(blood.stations, inDrawCentre(useFocus.getState().area, sim.player), performance.now(), sim.t)
  }, DRAW_CENTRE_FRAME_PRIORITY)

  return <primitive object={rig.root} />
}
