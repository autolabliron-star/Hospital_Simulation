/**
 * Night and day light (L1). Mount `<Daylight />` once inside the <Canvas>, after <Lighting />. It follows the world clock with
 * `lightAt(hour)` at 1 Hz, easing the sun's colour and intensity, the fill and environment, the sky, the window glass, the warm room
 * panels, the bedside screens and the corridor night lights. Uniforms and existing properties only: the sun's direction never changes
 * and the baked shadow map is never rendered again. The one thing it draws is the corridor night-light strips (one draw call; by day
 * they write no pixels). In walk mode (W1) it also blends the indoor preset in (./indoor.ts): the sun down, the fill and environment up.
 */
import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { MeshBasicMaterial } from 'three'
import { MAT } from '@/scene/materials'
import { lightRig } from '@/scene/Lighting'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import { sim, simGeneration } from '@/sim'
import { hourOf } from '@/sim/events'
import { useWorld } from '@/sim/world.store'
import { DaylightDriver, type DayTargets } from './driver'
import { indoorTarget } from './indoor'
import { nightLightsGeometry } from './nightLights'

/** Right after the sim and the L1 ward layers (which run at sim + 1): it only reads the clock, nothing here depends on the camera. */
const DAYLIGHT_PRIORITY = FRAME_PRIORITY.sim + 2

const readHour = (): number => hourOf(useWorld.getState().t)

export function Daylight() {
  const scene = useThree((s) => s.scene)
  const assets = useMemo(() => {
    const material = new MeshBasicMaterial({ color: 0x000000, toneMapped: true, colorWrite: false, depthWrite: false })
    const targets: DayTargets = {
      sun: null,
      hemi: null,
      scene: null,
      glass: MAT.glass,
      panels: MAT.glowTeal,
      lamps: MAT.glowWarm,
      nightLights: { material, setLit: () => undefined },
    }
    return { driver: new DaylightDriver(), geometry: nightLightsGeometry(), material, targets }
  }, [])

  useEffect(() => {
    assets.targets.nightLights = {
      material: assets.material,
      // lit by night; by day the strips are still drawn (so their shader is compiled and the first dusk never hitches) but write
      // no pixels: `colorWrite` is a GL state, not a program define, so toggling it recompiles nothing
      setLit: (lit) => {
        assets.material.colorWrite = lit
      },
    }
    return () => {
      assets.geometry.dispose()
      assets.material.dispose()
    }
  }, [assets])

  useFrame((_, dt) => {
    const t = assets.targets
    t.sun = lightRig.sun
    t.hemi = lightRig.hemi
    t.scene = scene
    // walk mode (W1): the rooms have ceilings, so the sun eases down and the indoor fill up (read the live sim: a Jump swaps it)
    assets.driver.frame(dt, readHour, simGeneration, t, indoorTarget(sim.player?.mode))
  }, DAYLIGHT_PRIORITY)

  return <mesh name="night-lights" geometry={assets.geometry} material={assets.material} frustumCulled={false} renderOrder={1} />
}
