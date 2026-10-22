/**
 * The authored building's reflection probes (`?building=model` only): Blender-rendered equirectangular HDRs (Radiance RGBE, made by the building
 * pipeline), each loaded with three's HDRLoader and turned into a PMREM once (the same 256 cube-UV layout as the room and hospital environments,
 * so binding one recompiles nothing), bound as `scene.environment` while the camera is inside that probe's zone on its storey (Lighting.tsx
 * swaps it, the daylight driver writes its intensity: look.ts LOBBY_ENV_MATCH).
 *
 * Which probes exist (decided with the building's source, src/scene/building/model/source.ts):
 *   zones   every manifest zone with a `probe` (its HDR, its eye, its box; the zone's own rects say where it is bound). A manifest without
 *           any probe but with the lobby zone keeps the pilot's `env_lobby.hdr` for the lobby.
 *   pilot   one: `env_lobby.hdr` over PILOT_REGION, as before the rollout.
 *
 * Two ways to load them (Lighting.tsx owns the call; see docs/handover/rollout-runtime.md):
 *   loadLobbyEnvironment   (today's call) the PRIMARY probe only (the lobby's, else the first): bound only inside its own zone.
 *   loadZoneProbes         every probe; `zoneProbeTexture()` is the one to bind for the camera's zone (per-zone binding).
 *
 * Each load is a warm gate in Lighting.tsx: the loading screen waits for it. A missing file, a dev server answering with its index page, a corrupt
 * HDR: that probe resolves null and everything stays as it was, silently. Presentation mode (C) reads the bound probe box-projected onto its
 * zone's box (src/scene/building/model/reflections.ts `setReflectionBox`, written here when the camera's zone changes).
 */
import { PMREMGenerator, type Texture, type WebGLRenderTarget, type WebGLRenderer, EquirectangularReflectionMapping } from 'three'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { BUILDING_MODEL_ON } from '@/scene/building/model/flags'
import { getBuildingSource, getManifest, whenBuildingSourceKnown } from '@/scene/building/model/source'
import { LOBBY_BOX, LOBBY_PROBE_POS, setReflectionBox } from '@/scene/building/model/reflections'
import { inPilotRegion } from '@/scene/building/model/region'
import { zoneContainsDrawn, zoneDef, type ZoneDef } from '@/scene/building/model/zones'
import type { Bounds, BuildingManifest } from '@/scene/building/model/manifest'
import { LEVEL_Y, type LevelId } from '@/sim/levels'

export const LOBBY_ENV_FILE = 'assets/building/env_lobby.hdr'

/** A storey's interior: the camera is under this height (drawn metres) over the storey's floor; level 2 is drawn 4.2 m higher. */
export const LOBBY_MAX_Y = 3.6

/** Set by Lighting.tsx while the primary probe is built; read by the daylight driver's caller. */
export const lobbyProbe: { ready: boolean } = { ready: false }

export interface ZoneProbeEntry {
  /** A zone id, or `pilot`. */
  zone: string
  level: LevelId
  /** The zone's rects (null: the pilot region). */
  def: ZoneDef | null
  /** Under the site base. */
  file: string
  eye: { x: number; y: number; z: number }
  box: Bounds
  /** The PMREM texture once loaded (per-zone binding), else null. */
  texture: Texture | null
}

const entries: ZoneProbeEntry[] = []
let primary: ZoneProbeEntry | null = null
let perZone = false
let current: ZoneProbeEntry | null = null

const LOBBY_LEGACY_BOX: Bounds = { ...LOBBY_BOX }

/** The probes of a building source (pure; tests call it with a manifest). */
export function probeEntriesFor(source: 'pilot' | 'zones', manifest: BuildingManifest | null): ZoneProbeEntry[] {
  const legacy = (zone: string, def: ZoneDef | null): ZoneProbeEntry => ({ zone, level: 1, def, file: LOBBY_ENV_FILE, eye: { ...LOBBY_PROBE_POS }, box: LOBBY_LEGACY_BOX, texture: null })
  if (source === 'pilot' || !manifest) return [legacy('pilot', null)]
  const out: ZoneProbeEntry[] = []
  for (const z of manifest.zones) {
    const def = zoneDef(z.id)
    if (!z.probe || !def) continue
    out.push({ zone: z.id, level: z.level, def, file: `assets/building/${z.probe.hdr}`, eye: { ...z.probe.position }, box: z.probe.box, texture: null })
  }
  if (out.length === 0 && manifest.zones.some((z) => z.id === 'lobby')) out.push(legacy('lobby', zoneDef('lobby') ?? null))
  return out
}

/** (Re)build the registry from the decided source. */
function syncEntries(): void {
  const src = getBuildingSource()
  entries.length = 0
  current = null
  primary = null
  if (src !== 'pilot' && src !== 'zones') return
  for (const e of probeEntriesFor(src, getManifest())) entries.push(e)
  primary = entries.find((e) => e.zone === 'lobby' || e.zone === 'pilot') ?? entries[0] ?? null
}

/** The storey a drawn camera height is inside, or 0 (above the roofs: the overview). */
function storeyAt(y: number): LevelId | 0 {
  if (y < LOBBY_MAX_Y) return 1
  if (y >= LEVEL_Y[2] && y < LEVEL_Y[2] + LOBBY_MAX_Y) return 2
  return 0
}

const usable = (e: ZoneProbeEntry): boolean => (perZone ? e.texture !== null : e === primary && lobbyProbe.ready)

/**
 * The probe for a camera at drawn (x, y, z), or null; when it changes, the box projection follows it. Allocation-free.
 */
export function selectZoneProbe(x: number, y: number, z: number): ZoneProbeEntry | null {
  const level = storeyAt(y)
  let found: ZoneProbeEntry | null = null
  if (level !== 0) {
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      if (e.level !== level || !usable(e)) continue
      if (e.def ? zoneContainsDrawn(e.def, x, z) : level === 1 && inPilotRegion(x, z)) {
        found = e
        break
      }
    }
  }
  if (found !== null && found !== current) setReflectionBox(found.eye, found.box)
  current = found
  return found
}

/** Should the building's probe be bound for a camera at (x, y, z) in drawn coordinates? */
export function lobbyEnvWanted(x: number, y: number, z: number): boolean {
  return BUILDING_MODEL_ON && selectZoneProbe(x, y, z) !== null
}

/** `lobbyEnvWanted` for a camera (anything with a position: the daylight driver's caller passes the scene's). */
export function lobbyEnvForCamera(camera: { position: { x: number; y: number; z: number } }): boolean {
  const p = camera.position
  return lobbyEnvWanted(p.x, p.y, p.z)
}

/** Per-zone binding: the texture of the camera's zone's probe (after `lobbyEnvWanted` said yes this frame), else null. */
export const zoneProbeTexture = (): Texture | null => current?.texture ?? null

/** The parts of three the loader needs, as a function of the renderer (a seam for tests). */
export interface LobbyEnvDeps {
  load(url: string): Promise<Texture>
  pmrem(source: Texture): WebGLRenderTarget
}

async function loadProbe(gl: WebGLRenderer, url: string, deps?: LobbyEnvDeps): Promise<WebGLRenderTarget | null> {
  try {
    const source = await (deps ? deps.load(url) : new HDRLoader().loadAsync(url))
    source.mapping = EquirectangularReflectionMapping
    let target: WebGLRenderTarget
    if (deps) target = deps.pmrem(source)
    else {
      const pmrem = new PMREMGenerator(gl)
      target = pmrem.fromEquirectangular(source)
      pmrem.dispose()
    }
    source.dispose()
    return target
  } catch {
    return null
  }
}

/** Load the PRIMARY probe and PMREM it (today's Lighting.tsx call). Resolves null on any failure. The caller owns the render target. */
export async function loadLobbyEnvironment(gl: WebGLRenderer, base: string, deps?: LobbyEnvDeps): Promise<WebGLRenderTarget | null> {
  await whenBuildingSourceKnown(base)
  syncEntries()
  const target = await loadProbe(gl, `${base}${primary?.file ?? LOBBY_ENV_FILE}`, deps)
  if (target && primary) primary.texture = target.texture
  return target
}

/** Per-zone binding: load every probe (one after the other). The caller owns the result (`dispose` frees every render target). */
export async function loadZoneProbes(gl: WebGLRenderer, base: string, deps?: LobbyEnvDeps): Promise<{ textures: Texture[]; dispose(): void }> {
  await whenBuildingSourceKnown(base)
  syncEntries()
  const targets: WebGLRenderTarget[] = []
  for (const e of entries) {
    const t = await loadProbe(gl, `${base}${e.file}`, deps)
    if (!t) continue
    e.texture = t.texture
    targets.push(t)
  }
  perZone = true
  return {
    textures: targets.map((t) => t.texture),
    dispose: () => {
      perZone = false
      for (const e of entries) e.texture = null
      current = null
      for (const t of targets) t.dispose()
    },
  }
}

/** The registry, for tests. */
export function zoneProbeEntries(): readonly ZoneProbeEntry[] {
  return entries
}

/** For tests: start from nothing (or from a given list). */
export function resetZoneProbesForTests(list: ZoneProbeEntry[] = [], opts: { perZone?: boolean; primary?: string } = {}): void {
  entries.length = 0
  for (const e of list) entries.push(e)
  perZone = opts.perZone ?? false
  primary = entries.find((e) => e.zone === (opts.primary ?? 'lobby')) ?? entries[0] ?? null
  current = null
}
