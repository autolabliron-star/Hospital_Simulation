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
import { markModelFailed } from './modelStatus'
import { ensurePilotModel, notifyModelCommitted, type PilotModel } from './loader'

export function BuildingModel() {
  const gl = useThree((s) => s.gl)
  const [model, setModel] = useState<PilotModel | null>(null)
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    let alive = true
    // ensurePilotModel never rejects (a failure resolves null and re-opens the procedural region); the catch is a last guard
    void ensurePilotModel(gl, import.meta.env.BASE_URL)
      .catch((e: unknown) => {
        console.warn('pilot model: unexpected load error', e)
        markModelFailed()
        return null
      })
      .then((m) => {
        if (!alive) return
        setModel(m)
        setSettled(true)
      })
    return () => {
      alive = false
    }
  }, [gl])
  // F-46: the warm-up gate opens only after React has put the model (or the decision that there is none) in the scene
  useEffect(() => {
    if (settled) notifyModelCommitted()
  }, [settled])
  useFrame(() => {
    if (!model) return
    model.scene.visible = levelView.shown === 1
    MODEL_CLIP.constant = modelClipHeight(isWalkMode(sim.player?.mode))
  }, BUILDING_VISIBILITY_PRIORITY)
  return model ? <primitive object={model.scene} /> : null
}
