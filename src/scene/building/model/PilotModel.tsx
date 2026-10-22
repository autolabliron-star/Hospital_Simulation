/**
 * `?building=model` only (see ./flags.ts): draws the authored pilot lobby, static and baked. One frame callback with the building's
 * visibility: shown while level 1 is, and cut at the storey's cut height in the overview (./clip.ts), whole while walking.
 * Navigation, collision and picking stay with src/sim/places.ts. The materials are the model's own (baked lightmap, never patchMaterialLook).
 */
import { useEffect, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { sim } from '@/sim'
import { levelView } from '@/scene/levels/levelView'
import { BUILDING_VISIBILITY_PRIORITY } from '../render/levelVisibility'
import { isWalkMode } from '../render/walk/modeSwitch'
import { MODEL_CLIP, modelClipHeight } from './clip'
import { ensurePilotModel, type PilotModel } from './loader'

export function BuildingModel() {
  const gl = useThree((s) => s.gl)
  const [model, setModel] = useState<PilotModel | null>(null)
  useEffect(() => {
    let alive = true
    void ensurePilotModel(gl, import.meta.env.BASE_URL).then((m) => {
      if (alive) setModel(m)
    })
    return () => {
      alive = false
    }
  }, [gl])
  useFrame(() => {
    if (!model) return
    model.scene.visible = levelView.shown === 1
    MODEL_CLIP.constant = modelClipHeight(isWalkMode(sim.player?.mode))
  }, BUILDING_VISIBILITY_PRIORITY)
  return model ? <primitive object={model.scene} /> : null
}
