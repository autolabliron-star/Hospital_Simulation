/**
 * R5: the pictures the watch overlay can show as a picture-in-picture (src/ui/watch/Inset.tsx): the endoscope (the OR's live canvas), and later the
 * ultrasound image and the CT plan / live CT. A registry, so the machines never import the watch UI and the watch UI never imports a machine: a layer
 * registers its canvas at mount, and the inset copies it with `drawImage` whenever `paints` has moved on (the source repaints at ≤ 4 Hz while watched).
 *
 * `wanted` is how a source knows somebody is watching it (the inset sets it while it is shown), so it can repaint at its hot rate: read it in a frame
 * callback (a plain field, no allocation).
 */

/** The insets a shot can ask for. */
export type InsetId = 'endo' | 'us' | 'ctPlan' | 'ctLive'

export interface InsetSource {
  readonly id: InsetId
  /** The canvas to copy (an HTMLCanvasElement or an OffscreenCanvas in the browser; anything `drawImage` takes). */
  readonly canvas: unknown
  /** Its width and height in pixels. */
  readonly width: number
  readonly height: number
  /** How many times it has repainted: the inset copies again when this changes. */
  paints(): number
}

const sources = new Map<InsetId, InsetSource>()

/** Which insets are on screen now (the overlay writes it; the sources read it every frame). */
export const insetWanted: Record<InsetId, boolean> = { endo: false, us: false, ctPlan: false, ctLive: false }

/** Register (or replace) a source. Returns the function that removes it (only if it is still the one registered). */
export function registerInsetSource(source: InsetSource): () => void {
  sources.set(source.id, source)
  return () => {
    if (sources.get(source.id) === source) sources.delete(source.id)
  }
}

/** The registered source for an inset, or null. */
export function insetSource(id: InsetId): InsetSource | null {
  return sources.get(id) ?? null
}

/** For tests. */
export function clearInsetSources(): void {
  sources.clear()
  for (const k of Object.keys(insetWanted) as InsetId[]) insetWanted[k] = false
}
