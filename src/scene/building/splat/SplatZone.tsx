/**
 * The splat pilot's renderer (./flags.ts): one zone's static building as a Gaussian splat (Spark, World Labs), shown while you walk on level 1
 * in place of the zone's baked model. The splat holds the zone's Cycles light as linear radiance (sRGB-encoded); Spark decodes it when it draws
 * into the composer's linear target, so the game's one AgX pass tone-maps it with everything else. People, robots and devices stay meshes:
 * they draw first and write depth, the splats blend behind and around them. The splat was trained in Blender's frame (z up), hence the turn here (the
 * packer cannot bake it: tools/arch/splat-pack.mjs says why). Its centres are relative to the origin in `<zone>.json`, next to the `.spz`: Spark
 * keeps centres as 16-bit floats, too coarse this far from the world origin, so the packer moves them near zero and the mesh sits at the origin.
 */
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark'
import { sim } from '@/sim'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import { levelView } from '@/scene/levels/levelView'
import { registerWarmGate } from '@/scene/warmup/registry'
import { isWalkMode } from '../render/walk/modeSwitch'
import { splatSwap } from './flags'

export function SplatZone({ zone }: { zone: string }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const mesh = useRef<SplatMesh | null>(null)
  const loaded = useRef(false)

  useEffect(() => {
    const spark = new SparkRenderer({ renderer: gl })
    scene.add(spark)
    const base = `${import.meta.env.BASE_URL}assets/building/splats/${zone}`
    const m = new SplatMesh({ url: `${base}.spz` })
    m.name = `splat-${zone}`
    m.rotation.x = -Math.PI / 2
    m.visible = false
    scene.add(m)
    mesh.current = m
    loaded.current = false
    const placed = fetch(`${base}.json`)
      .then((r) => r.json() as Promise<{ origin: [number, number, number] }>)
      .then((meta) => {
        m.position.fromArray(meta.origin)
      })
    const ready = Promise.all([m.initialized, placed]).then(() => {
      loaded.current = true
    })
    const offGate = registerWarmGate(`splat-${zone}`, ready)
    splatSwap.zone = zone
    return () => {
      offGate()
      splatSwap.zone = null
      splatSwap.shown = false
      scene.remove(m)
      scene.remove(spark)
      m.dispose()
      mesh.current = null
    }
  }, [gl, scene, zone])

  useFrame(() => {
    const m = mesh.current
    if (m === null) return
    const shown = loaded.current && isWalkMode(sim.player?.mode) && levelView.shown === 1
    m.visible = shown
    splatSwap.shown = shown
  }, FRAME_PRIORITY.splatSwap)

  return null
}
