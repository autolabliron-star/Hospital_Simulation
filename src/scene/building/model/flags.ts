/**
 * The authored (Blender) building is the default (owner, 2026-10-22): it draws the designed lobby and hides the procedural static architecture it
 * replaces. `?building=procedural` keeps the old procedural building (for comparison, or as a manual fallback; a failed load also falls back by
 * itself, ./modelStatus.ts). Pure, so node can test it.
 */
export type BuildingSource = 'procedural' | 'model'

export function parseBuildingFlag(search: string): BuildingSource {
  try {
    return new URLSearchParams(search).get('building') === 'procedural' ? 'procedural' : 'model'
  } catch {
    return 'model'
  }
}

/** This page's choice, read once (procedural in node, where no model can load). */
export const BUILDING_SOURCE: BuildingSource = typeof window === 'undefined' ? 'procedural' : parseBuildingFlag(window.location.search)
export const BUILDING_MODEL_ON = BUILDING_SOURCE === 'model'
