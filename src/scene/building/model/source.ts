/**
 * `?building=model`: where the authored building comes from, decided once at load: the zone manifest (public/assets/building/manifest.json)
 * when there is one, else the pilot lobby (assets/building/pilot-lobby.glb), exactly as before the rollout. The decision picks the coverage
 * (./region.ts) BEFORE the procedural building is compiled, so src/scene/building/index.tsx mounts the procedural meshes only once it is known
 * (a few ms: one small fetch, behind the loading screen). Plain module state with subscribe/getSnapshot (no React state per entity).
 *
 * The warm-up gate `building-source` stays open from the first ask until the chosen model component has committed (`notifyBuildingCommitted`;
 * it then holds its own gate for its own loads), so the warm-up never looks at a building that is still being decided.
 */
import { registerWarmGate } from '@/scene/warmup/registry'
import { BUILDING_MODEL_ON } from './flags'
import { fetchManifest, type BuildingManifest, type FetchText } from './manifest'
import { pilotCoverage, setCoverage, zoneCoverage } from './region'

export type BuildingSourceState = 'procedural' | 'pending' | 'pilot' | 'zones'

let state: BuildingSourceState = BUILDING_MODEL_ON ? 'pending' : 'procedural'
let manifest: BuildingManifest | null = null
let started: Promise<BuildingSourceState> | null = null
let resolveCommitted: (() => void) | null = null
const listeners = new Set<() => void>()

export const getBuildingSource = (): BuildingSourceState => state
export const getManifest = (): BuildingManifest | null => manifest

export function subscribeBuildingSource(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function set(next: BuildingSourceState): void {
  state = next
  for (const fn of [...listeners]) fn()
}

export interface SourceOptions {
  fetcher?: FetchText
  /** Tests: decide as if `?building=model` were on. */
  modelOn?: boolean
  warn?: (msg: string) => void
}

/** Decide (once) between the zone manifest and the pilot. Never rejects. */
export function startBuildingSource(base: string, opts: SourceOptions = {}): Promise<BuildingSourceState> {
  if (started) return started
  const on = opts.modelOn ?? BUILDING_MODEL_ON
  if (!on) {
    state = 'procedural'
    started = Promise.resolve(state)
    return started
  }
  if (state === 'procedural') state = 'pending'
  const warn = opts.warn ?? ((m: string) => console.warn(m))
  const committed = new Promise<void>((r) => {
    resolveCommitted = r
  })
  started = fetchManifest(base, opts.fetcher).then((r) => {
    if (r.ok) {
      for (const w of r.warnings) warn(`building manifest: ${w}`)
      const unknown: string[] = []
      setCoverage(zoneCoverage(r.manifest.zones.map((z) => ({ id: z.id, replaces: z.replaces })), unknown))
      if (unknown.length) warn(`building manifest: unknown replaces keys (nothing replaced for them): ${unknown.join(', ')}`)
      manifest = r.manifest
      set('zones')
    } else {
      // no manifest is the normal state until the zone pipeline ships one: the pilot path, silently
      setCoverage(pilotCoverage())
      set('pilot')
    }
    return state
  })
  registerWarmGate('building-source', started.then(() => committed))
  return started
}

/** The model component (pilot or zones) has mounted and registered its own gate: the source gate may close. */
export function notifyBuildingCommitted(): void {
  resolveCommitted?.()
}

/** The decision, once made (or at once when the page is procedural). */
export function whenBuildingSourceKnown(base: string): Promise<BuildingSourceState> {
  return started ?? startBuildingSource(base)
}

/** For tests. */
export function resetBuildingSourceForTests(): void {
  state = BUILDING_MODEL_ON ? 'pending' : 'procedural'
  manifest = null
  started = null
  resolveCommitted = null
  listeners.clear()
  setCoverage(null)
}
