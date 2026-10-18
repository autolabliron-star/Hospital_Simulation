/**
 * The warm-up's public face: slow state for the loading screen and for the frame loop, published at about 4 Hz (never per frame).
 *
 *   useWarmup(s => s.ready)      everything is compiled and uploaded (or the warm-up gave up: see `failed` and `timedOut`)
 *   useWarmup(s => s.progress)   0..1, never goes down
 *   useWarmup(s => s.entered)    the presenter pressed Enter (or `?skipIntro=1` did it): the day has started
 *
 * Non-React readers (the PowerLoop, the sim gate) use `useWarmup.getState()`. `ready` and `entered` only ever go from false to true.
 */
import { create } from 'zustand'
import type { WarmupPhase, WarmupSnapshot } from './run'

export interface WarmupState {
  phase: WarmupPhase
  progress: number
  ready: boolean
  failed: boolean
  timedOut: boolean
  entered: boolean
  /** From the warm-up run (see publisher.ts for the 4 Hz throttle). */
  publish(s: Pick<WarmupSnapshot, 'phase' | 'progress' | 'ready' | 'failed' | 'timedOut'>): void
  /** The watchdog of the loading screen: a warm-up that never started or never ended must not keep the presenter out. */
  giveUp(): void
  /** The presenter is in. Idempotent. Audio and the sim are handled by src/ui/loading/intro.ts, which calls this. */
  enter(): void
}

export const initialWarmup = {
  phase: 'idle' as WarmupPhase,
  progress: 0,
  ready: false,
  failed: false,
  timedOut: false,
  entered: false,
}

export const useWarmup = create<WarmupState>((set) => ({
  ...initialWarmup,
  publish: (s) =>
    set((prev) => ({
      phase: s.phase,
      progress: Math.max(prev.progress, s.progress),
      ready: prev.ready || s.ready,
      failed: prev.failed || s.failed,
      timedOut: prev.timedOut || s.timedOut,
    })),
  giveUp: () => set((prev) => (prev.ready ? prev : { ready: true, timedOut: true, phase: 'done', progress: 1 })),
  enter: () => set((prev) => (prev.entered ? prev : { entered: true })),
}))

/** True once the presenter is in: `<Quality ready={useEntered()} />`. */
export const useEntered = (): boolean => useWarmup((s) => s.entered)

/** True while the loading screen is up (the warm-up is running, or Enter has not been pressed): `<PowerLoop loading={useLoadingUp()} />`. */
export const useLoadingUp = (): boolean => useWarmup((s) => !s.entered)

/** For tests and for a hot reload. */
export function resetWarmup(): void {
  useWarmup.setState({ ...initialWarmup })
}
