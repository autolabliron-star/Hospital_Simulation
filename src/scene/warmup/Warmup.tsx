/**
 * Mount once inside the <Canvas>, AFTER every layer (after <CameraRig />: effects of earlier siblings, such as the environment map that
 * <Lighting /> builds, have run by the time this one starts). Behind the loading screen it makes everything the demo can show ready: every
 * shader program of both modes (walk and overview), the crowd bodies, pods, MealBots, machines, emotes and screens, and every texture. See run.ts.
 *
 * It publishes `useWarmup` (phase, progress, ready) at about 4 Hz; the loading screen (src/ui/loading) shows it and offers Enter once it is ready.
 * With `?probe=1` it also puts `window.__hospitalWarm` (programs(), missing(), materials(), state()) on the page.
 *
 * Safe under React StrictMode: the first effect's run is cancelled by its cleanup and a fresh run starts; a cancelled run publishes nothing.
 */
import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { createWarmProbe, installWarmProbe } from './probe'
import { WarmupPublisher } from './publisher'
import { warmExtras } from './registry'
import { asWarmupGl, WarmupRun, type WarmupPass } from './run'
import { registerDefaultWarmSources } from './sources'
import { useWarmup } from './warmup.store'

const probeEnabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('probe') === '1'

export interface WarmupProps {
  /**
   * Also compile every program against the canvas itself (default true). The composer draws into its own targets, so the canvas variants are
   * only needed if something is ever drawn straight to the screen; turn them off to roughly halve the compile if nothing is.
   */
  canvasPass?: boolean
}

export function Warmup({ canvasPass = true }: WarmupProps) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  useEffect(() => {
    // already warm (a hot reload, or a second mount): nothing to do
    if (useWarmup.getState().ready) return
    const warmGl = asWarmupGl(gl)
    const offSources = registerDefaultWarmSources()
    const publisher = new WarmupPublisher((s) => useWarmup.getState().publish(s))
    let cancelled = false
    const passes: WarmupPass[] = canvasPass ? ['composer', 'canvas'] : ['composer']
    const run = new WarmupRun(warmGl, scene, camera, {
      passes,
      extras: warmExtras,
      onUpdate: (s) => {
        if (!cancelled) publisher.push(s)
      },
    })
    const offProbe = probeEnabled && typeof window !== 'undefined' ? installWarmProbe(window, createWarmProbe(warmGl, scene, run, warmExtras)) : () => undefined
    void run.start().then((s) => {
      if (cancelled) return
      publisher.push(s)
      if (probeEnabled) console.info('[warmup]', s.stats, { failed: s.failed, timedOut: s.timedOut })
    })
    return () => {
      cancelled = true
      run.cancel()
      offProbe()
      offSources()
    }
  }, [gl, scene, camera, canvasPass])

  return null
}
