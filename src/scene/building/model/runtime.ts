/**
 * The zone rollout's runtime (`?building=model` with a manifest): which zones load when, what is drawn, what the warm-up gets.
 *
 *   before Enter   (behind the warm-up gate `building-zones`) the shared material textures (all of them: every zone uses them, they load once),
 *                  a skeleton of EVERY zone (./skeleton.ts: proxy materials, so every program is compiled before Enter), the OVERVIEW PROXY of
 *                  every zone that has one (./farModel.ts: one draw each, one shared unlit program; a zone's procedural cell is hidden as soon as
 *                  its proxy is mounted), and the PRIORITY zones (the one you start in and its neighbours), one after the other (at most one
 *                  zone transcoding at a time).
 *   after Enter    the rest stream in, one at a time, nearest to the camera first: load (workers decode the geometry and transcode the
 *                  lightmaps), then a few frames of upload (./uploader.ts), then the zone is mounted and its procedural cell hidden in the same
 *                  call (./cells.ts). A zone that fails keeps its cell (and warns once).
 *   every frame    the clip planes, which zones are drawn and how (full model near the camera, overview proxy far: ./culling.ts); a
 *                  streaming frame also takes one upload step. Both representations stay resident and warm: a switch only flips `visible`.
 *   failures       a zone whose full model fails keeps its procedural cell (its proxy is dropped too, so the region looks as it always did); a
 *                  zone whose proxy fails or is missing draws its full model at every distance.
 *
 * Pure over its dependencies (loaders, the skeleton parser), so node drives it with fakes; the GPU steps are behind `frame`'s renderer.
 */
import { Group, type Camera, type Material, type Scene, type Texture, type WebGLRenderer } from 'three'
import { splatDepthStandIn, type SplatDepth } from '../splat/depth'
import { SPLAT_ZONE, splatSwap } from '../splat/flags'
import { cellReplaced, setCellReplaced } from './cells'

/**
 * How many times a zone's procedural cell was hidden or brought back (a proxy or a model mounted, a failed zone's proxy dropped). ZonesModel
 * re-bakes the static sun shadow in an effect when it changes, so the hidden procedural furniture leaves the shadow map too (the shadow is never
 * re-rendered from frame code). A full model that streams in after its proxy changes no cell, so it costs no shadow re-render.
 */
let commits = 0
const commitListeners = new Set<() => void>()
function bumpCommits(): void {
  commits++
  for (const fn of commitListeners) fn()
}
export const zoneCommits = (): number => commits
export function subscribeZoneCommits(fn: () => void): () => void {
  commitListeners.add(fn)
  return () => {
    commitListeners.delete(fn)
  }
}
import { clipOfLevel } from './clip'
import { loadFarModel, type FarModel } from './farModel'
import { cullEntry, cullZones, setVisibilitySets, type CullEntry, type CullView } from './culling'
import { lightmapUrl, normalizeUrl, type BuildingManifest, type ManifestZone } from './manifest'
import { materialsOf, skeletonGlb, skeletonLightmapStub, skeletonStubTexture, type GltfJson } from './skeleton'
import type { SharedTextures } from './sharedTextures'
import { ZoneUploader, uploadJob, type UploadJob } from './uploader'
import { geometryBytes, loadZone, prepareZoneScene, type ZoneLoaders, type ZoneModel } from './zoneLoader'
import { drawnX, neighboursOf, zoneAtDrawn, zoneDef, zoneDistance } from './zones'
import { levelOf, type LevelId } from '@/sim/levels'

export type ZoneState = 'pending' | 'loading' | 'uploading' | 'ready' | 'failed'

export interface ZoneSlot {
  zone: ManifestZone
  entry: CullEntry
  state: ZoneState
  model: ZoneModel | null
  /** The glb's bytes when the skeleton fetch got the whole file. */
  prefetched: ArrayBuffer | null
  proxies: Material[]
  job: UploadJob | null
  error: string | null
  /** The overview proxy, once mounted (null: none in the manifest, not loaded yet, failed, or dropped with a failed zone). */
  far: FarModel | null
  /** The splat pilot's depth-only copy of the model (../splat/depth.ts), for the `?splat=` zone only; drawn while the splat stands in. */
  splatDepth: SplatDepth | null
}

export interface RuntimeDeps {
  base: string
  manifest: BuildingManifest
  loaders: ZoneLoaders
  shared: SharedTextures
  /** A glb's JSON chunk (and the whole file when the server sent it). */
  fetchJson(url: string): Promise<{ json: GltfJson; whole: ArrayBuffer | null }>
  /** Parse a skeleton glb (no external files: its textures are stand-ins). */
  parseSkeleton(buffer: ArrayBuffer): Promise<{ scene: Group }>
  /** Called when everything that will ever load has (the transcoder workers can go). */
  onIdle?(): void
  warn?(msg: string, err?: unknown): void
  timeoutMs?: number
}

/**
 * The zones to load before Enter: the one at the start point and its neighbours (a start outside every zone takes the nearest). When the
 * manifest has none of them, the listed zone nearest the start, so the first thing you see is never procedural for want of a choice.
 */
export function priorityZones(manifest: BuildingManifest, simX: number, simZ: number): string[] {
  const listed = new Set(manifest.zones.map((z) => z.id))
  const level = levelOf(simX)
  const x = drawnX(simX)
  const start = zoneAtDrawn(level, x, simZ)
  const near = start ? [start, ...neighboursOf(start)].filter((id) => listed.has(id)) : []
  if (near.length) return near
  let best: string | null = null
  let bd = Infinity
  for (const z of manifest.zones) {
    const def = zoneDef(z.id)
    if (!def) continue
    const d = zoneDistance(def, x, simZ) + (z.level === level ? 0 : 1000)
    if (d < bd) {
      bd = d
      best = z.id
    }
  }
  return best ? [best] : []
}

/** The next zone to stream: a pending one on the camera's level first, then the nearest to the camera (drawn x, z). */
export function nextZone(slots: readonly ZoneSlot[], level: LevelId, x: number, z: number): ZoneSlot | null {
  let best: ZoneSlot | null = null
  let bestScore = Infinity
  for (const s of slots) {
    if (s.state !== 'pending') continue
    const score = zoneDistance(s.entry.def, x, z) + (s.zone.level === level ? 0 : 1000)
    if (score < bestScore) {
      bestScore = score
      best = s
    }
  }
  return best
}

export class ZoneRuntime {
  readonly root = new Group()
  /** The skeletons, hidden: the warm-up reveals and compiles them; removed once every zone has settled. */
  readonly skeletons = new Group()
  readonly slots: ZoneSlot[]
  private readonly entries: CullEntry[]
  private readonly uploader = new ZoneUploader()
  private uploading: ZoneSlot | null = null
  private streaming = false
  private disposed = false
  private readonly view: CullView = { walking: false, shown: 1, overview: true, x: -11, y: 60, z: 0 }
  private readonly deps: RuntimeDeps

  constructor(deps: RuntimeDeps) {
    this.deps = deps
    this.root.name = 'building-zones'
    this.skeletons.name = 'building-zone-skeletons'
    this.skeletons.visible = false
    this.root.add(this.skeletons)
    this.slots = deps.manifest.zones.map((zone) => {
      const def = zoneDef(zone.id)!
      return {
        zone,
        entry: cullEntry(def, zone.bounds),
        state: 'pending' as ZoneState,
        model: null,
        prefetched: null,
        proxies: [],
        job: null,
        error: null,
        far: null,
        splatDepth: null,
      }
    })
    this.entries = this.slots.map((s) => s.entry)
    setVisibilitySets(this.entries, (id) => this.slots.find((s) => s.zone.id === id)?.zone.visibleFrom ?? null)
  }

  slot(id: string): ZoneSlot | undefined {
    return this.slots.find((s) => s.zone.id === id)
  }

  /** Everything the warm-up must compile and upload: the proxies, the loaded zones' materials, the shared textures, the lightmaps. */
  warmMaterials(): Material[] {
    const out: Material[] = []
    for (const s of this.slots) {
      out.push(...s.proxies)
      if (s.model) out.push(...s.model.materials)
      if (s.far) out.push(s.far.material)
      if (s.splatDepth) out.push(s.splatDepth.material)
    }
    return out
  }

  warmTextures(): Texture[] {
    const out: Texture[] = [...this.deps.shared.textures(), skeletonStubTexture(), skeletonLightmapStub()]
    for (const s of this.slots) {
      if (s.model) out.push(...s.model.lightmaps)
      if (s.far) out.push(s.far.texture)
    }
    return out
  }

  private preloading: Promise<void> | null = null

  /** Before Enter: shared textures, every skeleton, the priority zones. Once (a second call returns the first's promise). Never rejects. */
  preload(priority: readonly string[]): Promise<void> {
    this.preloading ??= this.preloadNow(priority)
    return this.preloading
  }

  get disposedAlready(): boolean {
    return this.disposed
  }

  private async preloadNow(priority: readonly string[]): Promise<void> {
    const { base, manifest, shared } = this.deps
    const tex = await Promise.allSettled(manifest.materials.files.map((f) => shared.load(`${base}assets/building/${f}`)))
    const bad = manifest.materials.files.filter((_, i) => tex[i].status === 'rejected')
    if (bad.length) this.warn(`shared material textures failed to load (the zones draw those materials in their flat colour): ${bad.join(', ')}`)
    await Promise.all([...this.slots.map((s) => this.loadSkeleton(s)), ...this.slots.map((s) => this.loadFar(s))])
    for (const id of priority) {
      const s = this.slot(id)
      if (!s || s.state !== 'pending' || this.disposed) continue
      const m = await this.load(s)
      if (m) this.commit(s, m) // mounted now: the warm-up compiles and uploads it behind the loading screen
    }
  }

  private async loadSkeleton(s: ZoneSlot): Promise<void> {
    const url = normalizeUrl(`${this.deps.base}assets/building/${s.zone.glb}`)
    try {
      const { json, whole } = await this.deps.fetchJson(url)
      s.prefetched = whole
      const { scene } = await this.deps.parseSkeleton(skeletonGlb(json))
      const stub = skeletonLightmapStub()
      prepareZoneScene(scene, () => stub, clipOfLevel(s.zone.level), s.zone.mountOffset)
      scene.name = `building-zone-skeleton-${s.zone.id}`
      s.proxies = materialsOf(scene)
      if (!this.disposed) this.skeletons.add(scene)
    } catch (e) {
      // no proxies: if this zone asks for a program nobody else compiled, compileAsync builds it in parallel while the zone streams
      this.warn(`zone ${s.zone.id}: no skeleton (its programs are compiled when it streams)`, e)
    }
  }

  /** The zone's overview proxy, mounted hidden (the warm-up compiles and uploads it); its procedural cell goes at once. Never rejects. */
  private async loadFar(s: ZoneSlot): Promise<void> {
    if (!s.zone.proxy) return
    try {
      const m = await loadFarModel(s.zone, this.deps.loaders, { base: this.deps.base, clip: clipOfLevel(s.zone.level), timeoutMs: this.deps.timeoutMs })
      if (this.disposed || s.state === 'failed') {
        m.dispose()
        return
      }
      s.far = m
      s.entry.farReady = true
      this.root.add(m.scene)
      this.replaceCell(s.zone.id, true)
    } catch (e) {
      this.warn(`zone ${s.zone.id}: no overview proxy (its full model is drawn at every distance)`, e)
    }
  }

  /** A failed zone loses its proxy too, and its procedural cell comes back. */
  private dropFar(s: ZoneSlot): void {
    const m = s.far
    s.entry.farReady = false
    if (!m) return
    s.far = null
    this.root.remove(m.scene)
    m.dispose()
    this.replaceCell(s.zone.id, false)
  }

  /** Hide (or bring back) a zone's procedural cell; the shadow is re-baked only when that really changes something. */
  private replaceCell(id: string, on: boolean): void {
    if (cellReplaced(id) === on) return
    setCellReplaced(id, on)
    bumpCommits()
  }

  private async load(s: ZoneSlot): Promise<ZoneModel | null> {
    s.state = 'loading'
    try {
      const m = await loadZone(s.zone, this.deps.loaders, {
        base: this.deps.base,
        clip: clipOfLevel(s.zone.level),
        prefetched: s.prefetched,
        timeoutMs: this.deps.timeoutMs,
      })
      s.prefetched = null
      if (this.disposed) {
        m.dispose()
        return null
      }
      return m
    } catch (e) {
      s.prefetched = null
      s.state = 'failed'
      s.error = e instanceof Error ? e.message : String(e)
      this.dropFar(s)
      this.warn(`zone ${s.zone.id} failed to load; its procedural region stays`, e)
      return null
    }
  }

  /** Mount a zone and hide its procedural cell in the same call. */
  private commit(s: ZoneSlot, m: ZoneModel): void {
    s.model = m
    s.job = null
    s.state = 'ready'
    s.entry.ready = true
    m.scene.visible = false // the next frame's culling decides
    if (SPLAT_ZONE === s.zone.id) {
      s.splatDepth = splatDepthStandIn(m.scene, clipOfLevel(s.zone.level))
      this.root.add(s.splatDepth.group)
    }
    this.root.add(m.scene)
    this.replaceCell(s.zone.id, true)
    this.settleIfIdle()
  }

  /** After Enter: stream the remaining zones, one at a time. Idempotent. */
  startStreaming(): void {
    if (this.streaming || this.disposed) return
    this.streaming = true
    void this.streamNext()
  }

  private async streamNext(): Promise<void> {
    if (this.disposed) return
    const s = nextZone(this.slots, this.view.shown, this.view.x, this.view.z)
    if (!s) {
      this.settleIfIdle()
      return
    }
    const m = await this.load(s)
    if (!m) {
      void this.streamNext()
      return
    }
    s.model = m
    s.state = 'uploading'
    s.job = uploadJob(m.scene, m.meshes, m.lightmaps, geometryBytes)
    this.uploading = s
    // `frame` advances the job and calls streamNext when it is done
  }

  private settleIfIdle(): void {
    if (this.disposed || this.slots.some((s) => s.state === 'pending' || s.state === 'loading' || s.state === 'uploading')) return
    // every zone has settled: the proxies' programs are held by the real materials now
    for (const s of this.slots) {
      for (const m of s.proxies) m.dispose()
      s.proxies = []
    }
    this.skeletons.traverse((o) => (o as { geometry?: { dispose(): void } }).geometry?.dispose())
    this.root.remove(this.skeletons)
    this.deps.onIdle?.()
  }

  /** The camera's view for culling and for the streaming order (called by `frame`; tests call it directly). */
  setView(walking: boolean, shown: LevelId, overview: boolean, x: number, y: number, z: number): void {
    const v = this.view
    v.walking = walking
    v.shown = shown
    v.overview = overview
    v.x = x
    v.y = y
    v.z = z
  }

  /** Cull (with the frustum, or none) and write every zone's `visible`: its full model or its proxy. Allocation-free. Returns how many zones are drawn. */
  cull(frustum: Parameters<typeof cullZones>[2]): number {
    const n = cullZones(this.entries, this.view, frustum)
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i]
      const m = s.model
      // the splat pilot (../splat): while a zone's splat is shown, its baked model is not, and the model's depth-only copy is
      const splat = splatSwap.shown && splatSwap.zone === s.zone.id
      if (m !== null && s.state === 'ready') m.scene.visible = this.entries[i].drawFull && !splat
      if (s.splatDepth !== null) s.splatDepth.group.visible = this.entries[i].drawFull && splat
      if (s.far !== null) s.far.scene.visible = this.entries[i].drawFar
    }
    return n
  }

  /** How many zones draw their full model / their proxy this frame (the probe, tests). */
  drawnCounts(): { full: number; far: number } {
    let full = 0
    let far = 0
    for (const e of this.entries) {
      if (e.drawFull) full++
      if (e.drawFar) far++
    }
    return { full, far }
  }

  /** One upload step of the streaming zone, if any (GPU work; nothing when no zone streams). */
  uploadStep(gl: WebGLRenderer, scene: Scene, camera: Camera): void {
    const s = this.uploading
    if (s === null || s.job === null || s.model === null) return
    if (!this.uploader.step(gl, scene, camera, s.job)) return
    this.uploading = null
    this.commit(s, s.model)
    void this.streamNext()
  }

  /** For tests (no GPU): finish the streaming zone's upload at once. */
  finishUploadForTests(): void {
    const s = this.uploading
    if (!s || !s.model) return
    this.uploading = null
    this.commit(s, s.model)
    void this.streamNext()
  }

  get streamingZone(): string | null {
    return this.uploading?.zone.id ?? this.slots.find((s) => s.state === 'loading')?.zone.id ?? null
  }

  private warn(msg: string, err?: unknown): void {
    if (this.deps.warn) this.deps.warn(msg, err)
    else console.warn(`building zones: ${msg}`, err ?? '')
  }

  /** The URLs a zone's lightmaps load from (the probe, tests). */
  lightmapUrls(id: string): string[] {
    const s = this.slot(id)
    return s ? s.zone.lightmaps.map((f) => lightmapUrl(this.deps.base, s.zone, f)) : []
  }

  dispose(): void {
    this.disposed = true
    for (const s of this.slots) {
      s.model?.dispose()
      s.model = null
      s.splatDepth?.dispose()
      s.splatDepth = null
      for (const m of s.proxies) m.dispose()
      s.proxies = []
      if (s.state === 'ready' || s.far) setCellReplaced(s.zone.id, false)
      s.far?.dispose()
      s.far = null
      s.entry.farReady = false
    }
    this.skeletons.traverse((o) => (o as { geometry?: { dispose(): void } }).geometry?.dispose())
    this.root.clear()
    this.uploader.dispose()
  }
}
