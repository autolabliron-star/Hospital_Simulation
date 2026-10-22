/**
 * Post-processing: soft ambient occlusion (half resolution), a gentle bloom that only catches emissive lights (pod rings, drawer lights,
 * screens, and in walk mode the ceiling panels), the tone mapper (AgX: our own effect holding three's AgX and Blender's; Neutral is one constant away: look.ts `TONE_MAP`, which
 * also carries the exposure compensation the daylight driver applies; the mode is a define of the one tone-mapping pass, fixed for the page, so
 * nothing recompiles at runtime), and (W3) the colour grade and a vignette, which both merge into the tone mapper's pass (no extra draw).
 *
 * Presentation mode (C, src/ui/present) changes the picture only through uniforms, blended in over `PRESENT_LOOK.seconds`: the grade's opacity
 * goes to 0, the vignette to half its darkness, the bloom to a gentler intensity and a higher threshold (so the bright sky does not glow), and the
 * tone mapper moves from three's AgX to Blender's own (the review stills' "AgX - Base Contrast", a LUT sampled from Blender, at look.ts
 * PRESENT_EXPOSURE: lighting/presentToneMapping.ts). The same callback drives the authored lobby's box-projected floor reflections
 * (building/model/reflections.ts, uniforms) and hides the floor lines (wayfinding/presentLines.ts, on the toggle only). The blend is a plain
 * number advanced in a frame callback and written into the effects only when it moves: no define, no recompile, no allocation.
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
import { BlendFunction, ToneMappingMode, type BloomEffect, type LUT3DEffect, type VignetteEffect } from 'postprocessing'
import { SRGBColorSpace } from 'three'
import { updateModelReflections } from '@/scene/building/model/reflections'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import { createGradeLut } from '@/scene/lighting/grade'
import { liveLook } from '@/scene/lighting/liveLook'
import { BLOOM, PRESENT_LOOK, TONE_MAP, VIGNETTE_OFFSET, presentExposureGain } from '@/scene/lighting/look'
import { PresentToneMappingEffect } from '@/scene/lighting/presentToneMapping'
import { MAT } from '@/scene/materials'
import { useWalk } from '@/scene/player/state'
import { aoSettings } from '@/scene/quality/aoProfile'
import { useRenderStore } from '@/scene/quality/render.store'
import { setLineMaterial, syncPresentLines } from '@/scene/wayfinding/presentLines'
import { registerWarmSource } from '@/scene/warmup/registry'
import { presentActive } from '@/ui/present/presentation.store'
import { BUILDING_MODEL_ON } from '@/scene/building/model/flags'
import { playerPhase } from '@/scene/player/api'

/** AgX (look.ts `TONE_MAP`) is our own effect, three's AgX and Blender's in one shader (presentToneMapping.ts); Neutral is postprocessing's. */
const AGX = TONE_MAP === 'agx'

/** Make the tone mapper (once per mount; null for Neutral). */
const createTone = (): PresentToneMappingEffect | null => (AGX ? new PresentToneMappingEffect(presentExposureGain()) : null)

export interface AoPass {
  enabled: boolean
  configuration: { aoRadius: number; intensity: number; denoiseIterations: number; transparencyAware?: boolean }
  /** n8ao's own flag: while true, every frame traverses the scene and switches `transparencyAware` on at the first transparent material. */
  autoDetectTransparency?: boolean
}

/**
 * F-10: n8ao auto-detects transparency (the glass material is `transparent`, so it always finds some) and then renders the whole scene twice
 * more per frame into two full-resolution half-float targets, and traverses it four times besides. Switch the mode off for good. Setting
 * `transparencyAware = false` alone does NOT do it: n8ao turns auto-detect off only when that value CHANGES, and it starts at false. So the
 * auto-detect flag is cleared directly. The price: no AO is drawn on glass, which is invisible next to the cost.
 */
export function disableAoTransparency(pass: AoPass): void {
  pass.autoDetectTransparency = false
  pass.configuration.transparencyAware = false
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
  const bloom = useRef<BloomEffect | null>(null)
  // the tone mapper (AgX): presentation blends it from three's AgX to Blender's through `mix`
  const [tone] = useState(createTone)
  // presentation mode's blend, 0 (the game's look) .. 1 (the walkthrough's), and the one last written into the effects (-1: nothing yet)
  const present = useRef(0)
  const presentWritten = useRef(-1)
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
      effect.darkness = liveLook.vignette * (1 - (1 - PRESENT_LOOK.vignette) * present.current)
      written.current = -1
    }
  }, [])
  const bloomRef = useCallback((effect: BloomEffect | null) => {
    bloom.current = effect
    presentWritten.current = -1
  }, [])

  // the LUT uploads behind the loading screen; the line material is told once (the floor lines hide in presentation: wayfinding/presentLines.ts)
  useEffect(() => {
    setLineMaterial(MAT.tinted)
    if (!tone) return
    // (the effect itself lives as long as the page's composer: no dispose here, so a StrictMode re-run never leaves it without its LUT)
    return registerWarmSource({ name: 'tone-lut', textures: () => [tone.lut] })
  }, [tone])

  // the daylight driver publishes the look, and presentation mode (C) blends its own on top; this writes both into the effects, only when either moved.
  // Presentation also drives, from here: Blender's AgX (the tone mapper's mix), the lobby floor's box-projected reflections (uniforms), and hiding
  // the floor lines (on the toggle only)
  useFrame((state, dt) => {
    const on = presentActive()
    // the authored building's photographic look (Blender AgX, exposure, floor reflections) also in the normal walk, with every game function;
    // presentation mode adds only its camera, the hidden HUD and the hidden floor lines
    const look = on || (BUILDING_MODEL_ON && playerPhase() === 'walk')
    const want = look ? 1 : 0
    if (present.current !== want) {
      const step = Math.min(dt, 0.1) / PRESENT_LOOK.seconds
      present.current = want > present.current ? Math.min(want, present.current + step) : Math.max(want, present.current - step)
    }
    const p = present.current
    if (tone) tone.mix.value = p * PRESENT_LOOK.agx
    updateModelReflections(p, liveLook.lobbyEnv, state.scene.environmentIntensity)
    syncPresentLines(state.scene, on)
    const l = lut.current
    const v = vignette.current
    const b = bloom.current
    if (!l || !v) return
    if (written.current !== liveLook.version || presentWritten.current !== p) {
      l.blendMode.opacity.value = liveLook.grade * (1 - (1 - PRESENT_LOOK.grade) * p)
      v.darkness = liveLook.vignette * (1 - (1 - PRESENT_LOOK.vignette) * p)
      written.current = liveLook.version
    }
    if (b && presentWritten.current !== p) {
      b.intensity = BLOOM.intensity + (PRESENT_LOOK.bloomIntensity - BLOOM.intensity) * p
      b.luminanceMaterial.threshold = BLOOM.threshold + (PRESENT_LOOK.bloomThreshold - BLOOM.threshold) * p
    }
    presentWritten.current = p
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
      if (pass) {
        disableAoTransparency(pass) // before the first render: the auto-detect runs inside it
        queueMicrotask(apply)
      }
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
      <Bloom ref={bloomRef as never} mipmapBlur luminanceThreshold={BLOOM.threshold} luminanceSmoothing={0.2} intensity={BLOOM.intensity} radius={0.6} />
      {tone ? <primitive object={tone} dispose={null} /> : <ToneMapping mode={ToneMappingMode.NEUTRAL} />}
      <LUT ref={lutRef} lut={gradeLut} blendFunction={BlendFunction.NORMAL} />
      <Vignette ref={vignetteRef} offset={VIGNETTE_OFFSET} darkness={0} />
    </EffectComposer>
  )
}
