/**
 * The quality ladder's state for everyone else: which rung the demo is on, and what the last measuring window saw. Pure state, no
 * three.js objects, so it is safe to import anywhere (the probe overlay, the effects, tests).
 *
 *   - `level` and `step`: the rung, written by <Quality /> (the ladder moving) or by a dev switch. `step.ao` is read by Effects.tsx,
 *     `step.dpr` by <Quality /> itself, `step.fx` (W3: 'lite' drops the floors' panel reflection) by the daylight driver's glue
 *     (src/scene/daylight/index.tsx), once a frame.
 *   - `dpr`: the pixel ratio actually applied to the renderer (the rung's, capped by the display).
 *   - `workP95` / `lateShare` / `reason`: slow numbers for the probe overlay, published once per window (about every 2 s).
 *   - `?quality=N` forces rung N and turns adaptation off, for screenshots and profiling.
 */
import { create } from 'zustand'
import { QUALITY_STEPS, clampLevel, type LadderReason, type QualityStep } from './ladder'

/** `?quality=2` -> 2 (clamped to the ladder), anything else (missing, empty, not a number) -> null. Pure, for tests. */
export function parseForcedLevel(search: string): number | null {
  try {
    const raw = new URLSearchParams(search).get('quality')
    if (raw === null || raw.trim() === '') return null
    const n = Number(raw)
    return Number.isFinite(n) ? clampLevel(n) : null
  } catch {
    return null
  }
}

export interface RenderState {
  /** Current rung, 0 = best. */
  level: number
  step: QualityStep
  /** False when forced with `?quality=N`: the ladder measures but never moves. */
  auto: boolean
  /** Why the ladder last moved, or null if it has not. */
  reason: LadderReason | null
  /** The pixel ratio applied to the renderer (0 until <Quality /> has applied one). */
  dpr: number
  /** p95 of the frame work (ms) in the last window, and the share of its frames that were late (0..1). */
  workP95: number
  lateShare: number

  /** Move to a rung (clamped). Does nothing when it is already there. */
  setLevel: (level: number, reason?: LadderReason | null) => void
  setAuto: (auto: boolean) => void
  setApplied: (dpr: number) => void
  setWindow: (workP95: number, lateShare: number) => void
}

const forced = typeof window === 'undefined' ? null : parseForcedLevel(window.location.search)
const initialLevel = forced ?? 0

export const useRenderStore = create<RenderState>()((set, get) => ({
  level: initialLevel,
  step: QUALITY_STEPS[initialLevel],
  auto: forced === null,
  reason: forced === null ? null : 'forced',
  dpr: 0,
  workP95: 0,
  lateShare: 0,

  setLevel: (level, reason) => {
    const l = clampLevel(level)
    if (l === get().level) return
    set({ level: l, step: QUALITY_STEPS[l], reason: reason === undefined ? 'forced' : reason })
  },
  setAuto: (auto) => set({ auto }),
  setApplied: (dpr) => set({ dpr }),
  setWindow: (workP95, lateShare) => set({ workP95, lateShare }),
}))
