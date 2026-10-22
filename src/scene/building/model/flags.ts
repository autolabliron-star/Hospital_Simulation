/**
 * Wave 3 flag: `?building=model` draws the authored (Blender) pilot lobby and hides the procedural static architecture in the pilot region.
 * Anything else (no flag, `?building=procedural`, junk) keeps the procedural building. Pure, so node can test it.
 */
export type BuildingSource = 'procedural' | 'model'

export function parseBuildingFlag(search: string): BuildingSource {
  try {
    return new URLSearchParams(search).get('building') === 'model' ? 'model' : 'procedural'
  } catch {
    return 'procedural'
  }
}

/** This page's choice, read once (procedural in node). */
export const BUILDING_SOURCE: BuildingSource = parseBuildingFlag(typeof window === 'undefined' ? '' : window.location.search)
export const BUILDING_MODEL_ON = BUILDING_SOURCE === 'model'
