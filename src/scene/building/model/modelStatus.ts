/**
 * The pilot lobby's load status (the path without a zone manifest). Safety net (F-45): the procedural prims the pilot replaces live in their
 * own cell meshes (./region.ts, ./cells.ts), drawn until the pilot is mounted; a pilot that fails (missing or corrupt .glb or lightmap, KTX2
 * transcode error, timeout) never hides them, so the lobby never loses its walls and nothing is rebuilt. The zones keep their own state
 * (./runtime.ts). Plain module state (no React), read through subscribe/getSnapshot.
 */

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

/** The model is not coming (its procedural cell simply stays drawn). */
export function markModelFailed(): void {
  if (status === 'failed') return
  setModelStatus('failed')
}

/** For tests. */
export function resetModelStatus(): void {
  status = 'idle'
  listeners.clear()
}
