/**
 * `?building=model` safety net (F-45): the authored lobby replaces the procedural architecture of the pilot region, which was already
 * compiled WITHOUT those prims. If the model then fails to load (missing or corrupt .glb or lightmap, KTX2 transcode error, timeout) the
 * lobby would have no walls. This tiny store says so, and `markModelFailed` re-opens the procedural region: it empties the set of hidden
 * prims (./region.ts, the filter of the overview shell) so the next build of the building keeps them; `src/scene/building/index.tsx` then
 * remounts the procedural meshes. Plain module state (no React), read through subscribe/getSnapshot.
 */
import { releaseRegion } from './region'

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'failed'

let status: ModelStatus = 'idle'
const listeners = new Set<() => void>()

export const getModelStatus = (): ModelStatus => status

export function subscribeModelStatus(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function setModelStatus(next: ModelStatus): void {
  if (status === next) return
  status = next
  for (const fn of [...listeners]) fn()
}

/** The model is not coming: show the procedural region again (before the listeners remount the building). */
export function markModelFailed(): void {
  if (status === 'failed') return
  releaseRegion()
  setModelStatus('failed')
}

/** For tests. */
export function resetModelStatus(): void {
  status = 'idle'
  listeners.clear()
}
