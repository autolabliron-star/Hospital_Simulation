/**
 * The M5 warm-up: nothing compiles or uploads for the first time while the presenter is demoing.
 *
 *   <Warmup />            mount last inside the <Canvas> (see Warmup.tsx)
 *   useWarmup             { phase, progress, ready, failed, timedOut, entered }: slow state, about 4 Hz (see warmup.store.ts)
 *   useEntered/useLoadingUp  one-line selectors for the frame loop (`loading`) and the quality ladder (`ready`)
 *   registerWarmSource    a feature registers materials or textures that no mesh of the scene holds (see registry.ts)
 *   window.__hospitalWarm programs(), missing(), materials(), state() with `?probe=1` (see probe.ts)
 */
export { Warmup, type WarmupProps } from './Warmup'
export { useWarmup, useEntered, useLoadingUp, resetWarmup, type WarmupState } from './warmup.store'
export { registerWarmSource, type WarmSource } from './registry'
export type { WarmupPhase, WarmupSnapshot, WarmupStats } from './run'
