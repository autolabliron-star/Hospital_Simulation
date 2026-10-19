/**
 * The animated health kiosks (W4): the status LEDs, the ultrasonic ping, the LED digits on the platform, the grip sleeves, the SpO2 LEDs, the cuff ring, the
 * camera's face frame, the QR window and the printed slip, all driven from the sim's `HealthKioskState`s in ONE `useFrame` at FRAME_PRIORITY.kiosks (see
 * rig.ts and motion.ts); the touchscreens, the blood-pressure displays and the triage desk's results list as tiles of the shared W4 atlas (tiles.ts); and
 * YOUR session at a kiosk (src/scene/interact/healthCheck.ts), ticked here after the interaction system has seated or stood you.
 *
 * Mount `<KioskLayer />` once inside the Canvas. One draw call; nothing is allocated per frame.
 */
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { getLayout } from '@/scene/building/layout'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import { interaction } from '@/scene/interact'
import { HealthCheck, healthCheckRegistry, type HealthEnv, type HealthSim } from '@/scene/interact/healthCheck'
import { placePlayer } from '@/scene/player/api'
import { loop, sim, simGeneration } from '@/sim'
import { showToast } from '@/ui/walk/toast.store'
import { useHealthCard } from '@/ui/walk/healthCard.store'
import { resetKioskMemory, trackKiosk, type TriageSim } from '@/ui/kioskView'
import { createRig, disposeRig, updateRig } from './rig'
import { registerKioskTiles, type TileSource } from './tiles'

/** Negative on purpose (positive priorities take over rendering in R3F). Registered in `src/scene/camera/frameOrder.ts`. */
export const KIOSKS_FRAME_PRIORITY = FRAME_PRIORITY.kiosks

/** What the tiles read: the live sim, at use time (a Jump swaps it). */
const tileSource: TileSource = {
  kiosks: () => sim.vitals.kiosks,
  triage: () => sim as unknown as TriageSim,
  generation: () => simGeneration,
}

/** The real environment of your health session: the live sim, the interaction system's seat and the card's store. */
function healthEnv(): HealthEnv {
  return {
    sim: () => sim as unknown as HealthSim,
    sitAt: (seat) => interaction.sitAt(seat),
    seatedOn: () => interaction.seat.active,
    standUp: () => interaction.standUp(),
    place: (x, z, heading) => placePlayer(x, z, heading),
    toast: showToast,
    card: {
      isOpen: () => useHealthCard.getState().open,
      kiosk: () => useHealthCard.getState().kiosk,
      show: (i) => useHealthCard.getState().show(i),
      close: () => useHealthCard.getState().close(),
    },
  }
}

export function KioskLayer() {
  const rig = useMemo(() => createRig(), [])
  const health = useMemo(() => new HealthCheck(healthEnv()), [])

  useEffect(() => {
    const unregister = registerKioskTiles(tileSource, getLayout())
    healthCheckRegistry.current = health
    return () => {
      unregister()
      if (healthCheckRegistry.current === health) healthCheckRegistry.current = null
      disposeRig(rig)
    }
  }, [rig, health])

  // a Jump gives a new hospital: the memory of each kiosk's last result belongs to the old one
  const epoch = useMemo(() => ({ generation: simGeneration }), [])

  useFrame((state, dt) => {
    if (epoch.generation !== simGeneration) {
      epoch.generation = simGeneration
      resetKioskMemory()
    }
    const kiosks = sim.vitals.kiosks
    updateRig(rig, kiosks, loop.paused ? 0 : Math.min(dt, 0.1), state.clock.elapsedTime)
    for (let i = 0; i < kiosks.length; i++) trackKiosk(kiosks[i])
    health.tick(Math.min(dt, 0.1))
  }, KIOSKS_FRAME_PRIORITY)

  return <primitive object={rig.root} />
}
