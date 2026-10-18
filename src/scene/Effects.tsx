/**
 * Post-processing for the model look: soft ambient occlusion (half resolution), a gentle bloom that only
 * catches emissive lights (pod rings, drawer lights, screens), and Khronos PBR Neutral tone mapping last (keeps whites white and colours true; AgX greyed the model look).
 *
 * The AO pass has two switches, both written straight into the pass through a ref, never through the component props (which re-apply
 * every setting, and n8ao rebuilds a shader when some of them change):
 *   - the player mode (W1): at eye level, under ceilings, the overview's wide AO darkens every ceiling joint and corner, so while you
 *     walk the radius and strength drop;
 *   - the quality rung (M5, scene/quality): the ladder turns AO lighter (a smaller radius, one denoise pass fewer), then off (the pass is
 *     skipped, nothing is remounted) if the frame rate drops.
 * The numbers for each combination are one fixed table, scene/quality/aoProfile.ts.
 *
 * The N8AO pass is not mounted when this component first runs: EffectComposer renders its children only after its own effect has built
 * the composer. So the pass arrives through a callback ref, and every arrival (and every later change of mode or rung) applies the table.
 * The props below carry the first values only, read once, so they never change and never re-apply anything.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Bloom, EffectComposer, N8AO, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { useWalk } from '@/scene/player/state'
import { aoSettings } from '@/scene/quality/aoProfile'
import { useRenderStore } from '@/scene/quality/render.store'

interface AoPass {
  enabled: boolean
  configuration: { aoRadius: number; intensity: number; denoiseIterations: number }
}

/** The AO row for the player mode and the quality rung right now. */
function currentAo() {
  return aoSettings(useWalk.getState().mode, useRenderStore.getState().step.ao)
}

export function Effects() {
  // the first values, read once: constant props never re-apply anything
  const [first] = useState(currentAo)
  const ao = useRef<AoPass | null>(null)

  const apply = useCallback(() => {
    const pass = ao.current
    if (!pass) return
    const v = currentAo()
    pass.configuration.aoRadius = v.aoRadius
    pass.configuration.intensity = v.intensity
    pass.configuration.denoiseIterations = v.denoiseIterations
    pass.enabled = v.enabled
  }, [])

  // the pass arrives late and may be replaced: apply the table to each new one, after the commit (the wrapper's own layout effect sets its props first)
  const aoRef = useCallback(
    (pass: AoPass | null) => {
      ao.current = pass
      if (pass) queueMicrotask(apply)
    },
    [apply],
  )

  useEffect(() => {
    apply()
    const unsubWalk = useWalk.subscribe((s, prev) => {
      if (s.mode !== prev.mode) apply()
    })
    const unsubRender = useRenderStore.subscribe((s, prev) => {
      if (s.step.ao !== prev.step.ao) apply()
    })
    return () => {
      unsubWalk()
      unsubRender()
    }
  }, [apply])

  return (
    <EffectComposer multisampling={4} enableNormalPass={false}>
      <N8AO
        ref={aoRef as never}
        halfRes
        quality="low"
        aoRadius={first.aoRadius}
        distanceFalloff={0.8}
        intensity={first.intensity}
        enabled={first.enabled}
        color="#1d2b2a"
      />
      <Bloom mipmapBlur luminanceThreshold={1.0} luminanceSmoothing={0.2} intensity={0.45} radius={0.6} />
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
    </EffectComposer>
  )
}
