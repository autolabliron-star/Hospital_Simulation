/**
 * Post-processing for the model look: soft ambient occlusion (half resolution), a gentle bloom that only
 * catches emissive lights (pod rings, drawer lights, screens), and Khronos PBR Neutral tone mapping last (keeps whites white and colours true; AgX greyed the model look).
 * The M5 quality ladder turns AO down or off first if the frame rate drops.
 *
 * Walk mode (W1): at eye level, under ceilings, the overview's wide AO darkens every ceiling joint and corner. While you
 * walk, the AO radius and strength drop. Only those two uniforms change, written straight into the pass's configuration
 * (never through the component props, which re-apply every setting and could rebuild the pass on a Tab).
 */
import { useEffect, useRef } from 'react'
import { Bloom, EffectComposer, N8AO, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { useWalk } from '@/scene/player/state'

const AO_OVERVIEW = { aoRadius: 1.4, intensity: 2.2 }
const AO_WALK = { aoRadius: 0.8, intensity: 1.6 }

interface AoPass {
  configuration: { aoRadius: number; intensity: number }
}

export function Effects() {
  const ao = useRef<AoPass | null>(null)

  useEffect(() => {
    const apply = (mode: string) => {
      const pass = ao.current
      if (!pass) return
      const v = mode === 'overview' ? AO_OVERVIEW : AO_WALK
      pass.configuration.aoRadius = v.aoRadius
      pass.configuration.intensity = v.intensity
    }
    apply(useWalk.getState().mode)
    return useWalk.subscribe((s, prev) => {
      if (s.mode !== prev.mode) apply(s.mode)
    })
  }, [])

  return (
    <EffectComposer multisampling={4} enableNormalPass={false}>
      <N8AO
        ref={ao as never}
        halfRes
        quality="low"
        aoRadius={AO_OVERVIEW.aoRadius}
        distanceFalloff={0.8}
        intensity={AO_OVERVIEW.intensity}
        color="#1d2b2a"
      />
      <Bloom mipmapBlur luminanceThreshold={1.0} luminanceSmoothing={0.2} intensity={0.45} radius={0.6} />
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
    </EffectComposer>
  )
}
