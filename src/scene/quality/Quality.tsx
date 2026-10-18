/**
 * Adaptive quality, mounted inside the <Canvas>. It renders nothing. The rules are in ladder.ts (a pure state machine); this is the glue:
 *
 *   - It registers as the frame sink (frameTiming.ts): PowerLoop reports every drawn frame's work and interval, the ladder decides.
 *     A decision is applied right after the frame that caused it, between two frames, never in the middle of one.
 *   - `ready` is the loading screen's verdict (warm-up done and Enter pressed). Until it is true the ladder does nothing, and it then
 *     waits a few seconds more. The same wait follows a Jump (`simGeneration` from @/sim) and a resume from a pause.
 *   - It owns the pixel ratio: the rung's value, capped by the display, set with R3F's `setDpr` (no remount). <Canvas> calls `configure`
 *     on every resize, and configure puts the pixel ratio back to its own `dpr` prop, so the wanted value is re-asserted whenever the
 *     R3F store changes (the guard makes that a no-op once they agree).
 *   - (W3) A pixel-ratio change is DEFERRED while you walk and move: it resizes the canvas and the composer (a hitch) and changes the
 *     sharpness in one frame (a pop). It is applied when you stop, when you leave walk mode, or after 6 s (./dprDefer.ts). While one
 *     waits, a 100 ms poll asks again; nothing runs per frame.
 *   - The AO rung is applied by Effects.tsx, which watches the same store; the fx rung ('lite' drops the floor reflection) by the daylight
 *     driver, which reads it every frame. Both are uniforms or flags: they apply at once, never deferred.
 *
 * `?probe=1` also publishes `window.__hospitalQuality = { store, ladder }` for scripted checks in a visible browser.
 */
import { useEffect, useMemo } from 'react'
import { useStore } from '@react-three/fiber'
import { probeEnabled } from '@/app/DevProbe'
import { walkBody } from '@/scene/player/state'
import { sim, simGeneration } from '@/sim'
import { DprDeferral } from './dprDefer'
import { setFrameSink } from './frameTiming'
import { QualityLadder, appliedDpr } from './ladder'
import { useRenderStore } from './render.store'

/** How often a waiting pixel-ratio change asks again whether the player has stopped (ms). */
const POLL_MS = 100

export interface QualityProps {
  /** The loading screen is done and the viewer is in. Defaults to true, so the ladder works even without a loading screen. */
  ready?: boolean
}

export function Quality({ ready = true }: QualityProps) {
  const store = useStore()
  const ladder = useMemo(() => new QualityLadder({}, useRenderStore.getState().level), [])

  // the loading screen's verdict
  useEffect(() => {
    ladder.setReady(ready, performance.now())
  }, [ladder, ready])

  // the frame sink: the ladder decides, the store records
  useEffect(() => {
    let generation = simGeneration
    let windows = 0
    setFrameSink((workMs, intervalMs, capFps, now, refreshMs) => {
      const rs = useRenderStore.getState()
      ladder.auto = rs.auto
      if (rs.level !== ladder.level) ladder.forceLevel(rs.level, now) // a dev switch or `?quality=`
      if (simGeneration !== generation) {
        // a Jump swapped the hospital: this frame carries the rebuild, do not count it
        generation = simGeneration
        ladder.noteJump(now)
        return
      }
      const action = ladder.sample(now, intervalMs, workMs, capFps, window.devicePixelRatio || 1, refreshMs)
      if (ladder.last.windows !== windows) {
        windows = ladder.last.windows
        rs.setWindow(ladder.last.workP95, ladder.last.lateShare)
      }
      if (action !== null) rs.setLevel(ladder.level, ladder.reason)
    })
    return () => setFrameSink(null)
  }, [ladder])

  // the pixel ratio
  useEffect(() => {
    const deferral = new DprDeferral()
    let poll = 0
    const apply = () => {
      const want = appliedDpr(useRenderStore.getState().step, window.devicePixelRatio || 1)
      const state = store.getState()
      const decision = deferral.decide(state.viewport.dpr, want, { mode: sim.player?.mode, live: walkBody.live, stillFor: walkBody.stillFor }, performance.now())
      if (decision === 'apply') state.setDpr(want)
      // a change that waits for the player to stop asks again until it can go; one that is done (or never was) stops asking
      if (decision === 'wait') {
        if (poll === 0) poll = window.setInterval(apply, POLL_MS)
      } else if (poll !== 0) {
        window.clearInterval(poll)
        poll = 0
      }
      // the store shows the ratio the renderer really has (a waiting change has not happened yet)
      const have = store.getState().viewport.dpr
      if (useRenderStore.getState().dpr !== have) useRenderStore.getState().setApplied(have)
    }
    apply()
    const unsubStore = store.subscribe(apply)
    const unsubLevel = useRenderStore.subscribe((s, prev) => {
      if (s.level !== prev.level) apply()
    })
    window.addEventListener('resize', apply)
    return () => {
      if (poll !== 0) window.clearInterval(poll)
      unsubStore()
      unsubLevel()
      window.removeEventListener('resize', apply)
    }
  }, [store])

  // scripted checks
  useEffect(() => {
    if (!probeEnabled) return
    const w = window as unknown as { __hospitalQuality?: unknown }
    w.__hospitalQuality = { store: useRenderStore, ladder }
    return () => {
      delete w.__hospitalQuality
    }
  }, [ladder])

  return null
}
