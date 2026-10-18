/**
 * W3: moving things your body cannot pass (door leaves today), as a registry so the player never imports the doors and the doors never import
 * the player. Each source owns a flat Float64Array of oriented floor boxes, rewritten every frame at FRAME_PRIORITY.doors (before you move),
 * and says how many boxes are live in `count`. Contract glue, owned by the orchestrator.
 *
 * One box is BLOCKER_STRIDE numbers: cx, cz (centre), ux, uz (unit axis u on the floor), hu (half extent along u), hv (half extent along
 * v = (-uz, ux)). A source with count 0 blocks nothing.
 */
export const BLOCKER_STRIDE = 6

export interface BlockerSource {
  /** Shown in tests and failures ("walk doors", "pharmacist doors"). */
  readonly name: string
  /** Live boxes at the start of `data`. */
  count: number
  readonly data: Float64Array
}

const sources: BlockerSource[] = []

/** Add a source (replacing one of the same name). Returns the function that removes it: call it on unmount. */
export function registerBlockers(src: BlockerSource): () => void {
  const i = sources.findIndex((s) => s.name === src.name)
  if (i >= 0) sources[i] = src
  else sources.push(src)
  return () => {
    const j = sources.indexOf(src)
    if (j >= 0) sources.splice(j, 1)
  }
}

/** Every registered source. The same array on every call (no allocation): read it, never keep or mutate it. */
export function blockerSources(): readonly BlockerSource[] {
  return sources
}

/** For tests. */
export function clearBlockers(): void {
  sources.length = 0
}
