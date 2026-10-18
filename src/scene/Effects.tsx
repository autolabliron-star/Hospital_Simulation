/**
 * Post-processing: soft ambient occlusion (half resolution), a gentle bloom that only catches emissive lights (pod rings, drawer lights,
 * screens, and in walk mode the ceiling panels), Khronos PBR Neutral tone mapping (keeps whites white and colours true; AgX greyed the model
 * look and would recompile), and (W3) the colour grade and a vignette, which both merge into the tone mapper's pass (no extra draw).
 *
 * The grade (src/scene/lighting/grade.ts) is an always-mounted 32 cubed LUT in blend mode NORMAL: its blend opacity IS its strength, so the
 * overview (opacity 0) is exactly the picture it always was and walk mode fades it in with the rest of the look. The vignette is the stock
 * one, darkness 0 (the identity) in the overview. Both strengths are written through refs when the daylight driver publishes a new look
 * (`liveLook`, read once a frame, written only when it changed): never through props, never a recompile.
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
import { useFrame } from '@react-three/fiber'
import { Bloom, EffectComposer, LUT, N8AO, ToneMapping, Vignette } from '@react-three/postprocessing'
import { BlendFunction, ToneMappingMode, type LUT3DEffect, type VignetteEffect } from 'postprocessing'
import { SRGBColorSpace } from 'three'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import { createGradeLut } from '@/scene/lighting/grade'
import { liveLook } from '@/scene/lighting/liveLook'
import { VIGNETTE_OFFSET } from '@/scene/lighting/look'
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
  const [gradeLut] = useState(createGradeLut)
  const lut = useRef<LUT3DEffect | null>(null)
  const vignette = useRef<VignetteEffect | null>(null)
  // the version of `liveLook` last written into the effects (-1: nothing yet)
  const written = useRef(-1)

  // the effects arrive late (the composer builds its passes after the first commit) and are written the moment they do, before any frame
  // uses them: the grade at the strength of the look right now, the vignette likewise
  const lutRef = useCallback((effect: LUT3DEffect | null) => {
    lut.current = effect
    if (effect) {
      effect.blendMode.opacity.value = liveLook.grade
      written.current = -1
    }
  }, [])
  const vignetteRef = useCallback((effect: VignetteEffect | null) => {
    vignette.current = effect
    if (effect) {
      // display-referred, like the grade: the darkness is a share of the picture's brightness as seen, not of its linear light
      ;(effect as unknown as { inputColorSpace: string }).inputColorSpace = SRGBColorSpace // marked protected in the typings, a public setter in the build
      effect.darkness = liveLook.vignette
      written.current = -1
    }
  }, [])

  // the daylight driver publishes the look; this writes it into the two effects, only when it changed
  useFrame(() => {
    if (written.current === liveLook.version) return
    const l = lut.current
    const v = vignette.current
    if (!l || !v) return
    l.blendMode.opacity.value = liveLook.grade
    v.darkness = liveLook.vignette
    written.current = liveLook.version
  }, FRAME_PRIORITY.sim + 4)

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
      <LUT ref={lutRef} lut={gradeLut} blendFunction={BlendFunction.NORMAL} />
      <Vignette ref={vignetteRef} offset={VIGNETTE_OFFSET} darkness={0} />
    </EffectComposer>
  )
}
