/**
 * The warm-up as a small state machine with no React and no DOM in it, so node tests drive it with a fake renderer and a manual clock.
 *
 * Why: a shader compile or a texture upload that lands for the first time while the presenter is demoing is a stall of 10 to 100 ms. Everything
 * the demo can show is made ready behind the loading screen instead, once:
 *
 *   settling    wait until the layers have mounted (the scene stops growing) and the environment map exists
 *   compiling   `compileAsync` (or `compile`, when it is missing) of every graphical object of the mounted scene, one job per object, in time-boxed
 *               slices with a frame between them so the loading screen keeps moving. Two passes: against a stand-in render target like the
 *               composer's (a half-float target: the programs the post-processing chain draws with) and against the canvas. Every slice
 *               reveals the hidden walk-only, overview-only and not-yet-needed objects, compiles, and puts the visibility back, all in one
 *               synchronous block (no frame is ever drawn with them revealed)
 *   finishing   wait until the driver reports every program ready (KHR_parallel_shader_compile compiles on other threads)
 *   linking     first-use work of every program: three looks up the uniform and attribute locations the first time a program is used, which
 *               the first draw would otherwise pay (a few ms each for the lit programs), so it is done here, once per distinct program
 *   textures    `initTexture` for every texture of the scene: canvas textures, atlases, the pose data texture (found in the uniforms the renderer
 *               built, not on the material), the environment map. Then (F-12) the geometry: a compile builds programs but uploads no vertex
 *               or instance buffer, and three uploads those the first time an object is drawn, so the first Tab into the walk, the first
 *               ride to Level 2 and the first appearance of each avatar band would each pay for theirs. One render of the whole scene with
 *               everything revealed and frustum culling suspended, into the same tiny stand-in target as the compile (4 x 4 pixels, nothing
 *               to see and no pixel cost), uploads them all. The static shadow map is switched off for that render, or it would be baked
 *               with the revealed objects in it.
 *   done        `ready`. A failure or a time limit still ends here: a warm-up that never ends must not keep the presenter out.
 *
 * Extras (registry.ts: the palette) that no mesh holds are compiled through hidden keeper meshes that are never added to the scene.
 *
 * Best effort and never throws: whatever fails is recorded (`failed`) and the demo is left exactly as it was without a warm-up.
 */
import { BoxGeometry, Group, HalfFloatType, Mesh, WebGLRenderTarget, type Camera, type Material, type Object3D, type Scene, type Texture, type WebGLRenderer } from 'three'
import {
  collectMaterials,
  collectTextures,
  graphical,
  planJobs,
  revealHidden,
  type CompileJob,
  type ProgramLike,
  type PropertiesLike,
} from './collect'

/** The slice of the renderer the warm-up uses. `WebGLRenderer` has exactly these. */
export interface WarmupGl {
  getRenderTarget(): WebGLRenderTarget | null
  setRenderTarget(target: WebGLRenderTarget | null): void
  compile(root: Object3D, camera: Camera, targetScene?: Object3D | null): unknown
  /** Missing in an old or restricted context: the warm-up falls back to `compile`. */
  compileAsync?(root: Object3D, camera: Camera, targetScene?: Object3D | null): Promise<unknown>
  initTexture(texture: Texture): void
  /** Draws a frame (used once, into the stand-in target, to upload geometry). Missing: that step is skipped. */
  render?(scene: Scene, camera: Camera): void
  /** The static shadow map's switches (the geometry render must not consume `needsUpdate`). */
  shadowMap?: { needsUpdate: boolean; autoUpdate: boolean }
  info?: { programs?: readonly unknown[] | null; reset?: () => void }
  properties?: PropertiesLike
}

/** The real renderer as the warm-up's gl (a cast: WebGLRenderer has exactly these members). */
export function asWarmupGl(gl: WebGLRenderer): WarmupGl {
  return gl as unknown as WarmupGl
}

export type WarmupPhase = 'idle' | 'settling' | 'compiling' | 'finishing' | 'linking' | 'textures' | 'done'
export type WarmupPass = 'composer' | 'canvas'

export interface Scheduler {
  now(): number
  /** Let the page breathe: one animation frame, or a short timer in a tab that is not drawing. */
  frame(): Promise<void>
}

/** One animation frame, or 50 ms in a tab that is not drawing, whichever comes first. */
export function frameBreak(): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (!done) {
        done = true
        resolve()
      }
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(finish)
    setTimeout(finish, 50)
  })
}

export const browserScheduler: Scheduler = {
  now: () => performance.now(),
  frame: frameBreak,
}

export interface WarmupStats {
  /** Shader programs the renderer holds before the warm-up and after it. */
  programsBefore: number
  programs: number
  /** Distinct materials of the mounted scene, and of the extras that no mesh holds. */
  materials: number
  keepers: number
  textures: number
  jobs: number
  /** Distinct programs whose first-use lookups were done. */
  linked: number
  /** F-12: the geometry upload render ran to its end (false: skipped, or it failed and the buffers upload on first draw as before). */
  geometryUploaded: boolean
  /** Jobs whose compile threw (the rest carried on). */
  failedJobs: number
  /** Most objects revealed at once around a compile slice (walk-only, overview-only, idle effects). */
  revealed: number
  passes: WarmupPass[]
  /** True when `compileAsync` was used, false for the `compile` fallback. */
  usedCompileAsync: boolean
  settleMs: number
  compileMs: number
  readyMs: number
  linkMs: number
  textureMs: number
  geometryMs: number
  totalMs: number
}

export interface WarmupSnapshot {
  phase: WarmupPhase
  /** 0..1, never goes down. */
  progress: number
  /** Everything is warm (or the warm-up gave up: see `failed` and `timedOut`). */
  ready: boolean
  failed: boolean
  timedOut: boolean
  cancelled: boolean
  stats: WarmupStats
}

export interface WarmupOptions {
  /** Which targets to compile against. Default: both. Pass `['composer']` if nothing is ever drawn straight to the canvas. */
  passes?: readonly WarmupPass[]
  /** The stand-in render target of the composer pass: a half-float target with the composer's sample count. */
  standIn?: { size?: number; samples?: number }
  /** Reveal hidden objects around each compile slice (default true). */
  reveal?: boolean
  /** Upload every geometry and instance buffer with one hidden-reveal render at the end (default true; F-12). */
  geometry?: boolean
  /** Longest stretch of compiling or uploading before the page gets a frame, ms. */
  sliceMs?: number
  /**
   * Wait for the scene to stop growing and for `scene.environment`. While a warm gate is open (registry.ts `registerWarmGate`: the people
   * loading, the light volume baking) the wait goes on, up to `gateMaxMs` instead of `maxMs`.
   */
  settle?: { minFrames?: number; stableFrames?: number; maxMs?: number; requireEnvironment?: boolean; gateMaxMs?: number }
  /** How many warm gates are still open (registry.ts `warmGatesPending`). Default: none. */
  gatesPending?: () => number
  /** Longest wait for the drivers to finish compiling, ms. */
  readyWaitMs?: number
  /** Overall limit, ms: after it the warm-up reports ready anyway. */
  maxMs?: number
  /** Materials and textures that no mesh of the scene holds (see registry.ts). */
  extras?: () => { materials: readonly Material[]; textures: readonly Texture[] }
  scheduler?: Scheduler
  onUpdate?: (snapshot: WarmupSnapshot) => void
}

const DEFAULTS = {
  sliceMs: 8,
  readyWaitMs: 8000,
  maxMs: 20000,
  settle: { minFrames: 3, stableFrames: 3, maxMs: 3000, requireEnvironment: true, gateMaxMs: 10000 },
  standIn: { size: 4, samples: 4 },
} as const

/** How much of the bar each phase fills. They add up to one. */
const WEIGHT = { settle: 0.06, compile: 0.44, finish: 0.16, link: 0.12, textures: 0.22 } as const
type Part = keyof typeof WEIGHT

/** Jobs in the first compile batch; the size then follows how long the last batch took (see `nextBatch`). */
const FIRST_BATCH = 8
const MAX_BATCH = 48

/**
 * How many jobs the next batch holds: aim for `sliceMs` of work per batch, grow at most twofold, and keep between one and MAX_BATCH.
 * A cached program costs a few microseconds and a new one a few milliseconds, so a fixed size would either crawl or stall.
 */
export function nextBatch(current: number, tookMs: number, sliceMs: number): number {
  const factor = Math.min(2, sliceMs / Math.max(tookMs, 0.25))
  return Math.min(MAX_BATCH, Math.max(1, Math.round(current * factor)))
}

const emptyStats = (): WarmupStats => ({
  programsBefore: 0,
  programs: 0,
  materials: 0,
  keepers: 0,
  textures: 0,
  jobs: 0,
  linked: 0,
  geometryUploaded: false,
  failedJobs: 0,
  revealed: 0,
  passes: [],
  usedCompileAsync: false,
  settleMs: 0,
  compileMs: 0,
  readyMs: 0,
  linkMs: 0,
  textureMs: 0,
  geometryMs: 0,
  totalMs: 0,
})

/** Programs of a material the driver has not finished compiling. */
export function pendingPrograms(properties: PropertiesLike, material: Material): number {
  const programs = properties.get(material).programs
  let pending = 0
  if (programs) for (const p of programs.values()) if (p && p.isReady?.() === false) pending++
  return pending
}

/** Has the renderer built a program for this material (in any variant), and is it ready? */
export function hasProgram(properties: PropertiesLike, material: Material): boolean {
  const p = properties.get(material)
  const programs = p.programs
  if (!programs || programs.size === 0) return false
  return pendingPrograms(properties, material) === 0
}

export class WarmupRun {
  private snap: WarmupSnapshot = { phase: 'idle', progress: 0, ready: false, failed: false, timedOut: false, cancelled: false, stats: emptyStats() }
  private readonly parts: Record<Part, number> = { settle: 0, compile: 0, finish: 0, link: 0, textures: 0 }
  private readonly clock: Scheduler
  private startedAt = 0
  private cancelled = false
  private keeperGeometry: BoxGeometry | null = null
  /** Materials the compile prepared, for the readiness wait and the texture pass. */
  private warmed: Material[] = []
  private keepers: Object3D[] = []
  private pending: Promise<unknown>[] = []

  constructor(
    private readonly gl: WarmupGl,
    private readonly scene: Scene,
    private readonly camera: Camera,
    private readonly options: WarmupOptions = {},
  ) {
    this.clock = options.scheduler ?? browserScheduler
  }

  get snapshot(): WarmupSnapshot {
    return this.snap
  }

  /** Stop at the next slice. A cancelled run never reports ready. */
  cancel(): void {
    this.cancelled = true
    this.snap = { ...this.snap, cancelled: true, ready: false }
  }

  private get expired(): boolean {
    const over = this.clock.now() - this.startedAt > (this.options.maxMs ?? DEFAULTS.maxMs)
    if (over && !this.snap.timedOut) this.snap = { ...this.snap, timedOut: true }
    return over
  }

  private set(patch: Partial<WarmupSnapshot>): void {
    this.snap = { ...this.snap, ...patch }
    this.options.onUpdate?.(this.snap)
  }

  private advance(part: Part, fraction: number): void {
    this.parts[part] = Math.max(this.parts[part], Math.min(1, Math.max(0, fraction)))
    let p = 0
    for (const k of Object.keys(WEIGHT) as Part[]) p += WEIGHT[k] * this.parts[k]
    this.set({ progress: Math.max(this.snap.progress, Math.min(1, p)) })
  }

  private fail(): void {
    if (!this.snap.failed) this.snap = { ...this.snap, failed: true }
  }

  private stat(patch: Partial<WarmupStats>): void {
    this.snap = { ...this.snap, stats: { ...this.snap.stats, ...patch } }
  }

  /** Run to the end. Never rejects. */
  async start(): Promise<WarmupSnapshot> {
    this.startedAt = this.clock.now()
    this.stat({ programsBefore: this.gl.info?.programs?.length ?? 0 })
    const stages: [WarmupPhase, () => Promise<void>][] = [
      ['settling', () => this.settle()],
      ['compiling', () => this.compile()],
      ['finishing', () => this.waitReady()],
      ['linking', () => this.linkPrograms()],
      ['textures', () => this.uploadTextures()],
    ]
    for (const [phase, stage] of stages) {
      if (this.cancelled || this.expired) break
      this.set({ phase })
      try {
        await stage()
      } catch {
        this.fail()
      }
    }
    this.cleanup()
    if (this.cancelled) return this.snap
    for (const k of Object.keys(WEIGHT) as Part[]) this.parts[k] = 1
    this.stat({ programs: this.gl.info?.programs?.length ?? 0, totalMs: this.clock.now() - this.startedAt })
    this.set({ phase: 'done', progress: 1, ready: true })
    return this.snap
  }

  // --- settling ------------------------------------------------------------------------------------

  private signature(): string {
    let n = 0
    this.scene.traverse((o) => {
      if (graphical(o)) n++
    })
    return `${n}|${this.scene.children.length}|${this.scene.environment ? 1 : 0}`
  }

  private async settle(): Promise<void> {
    const o = { ...DEFAULTS.settle, ...this.options.settle }
    const t0 = this.clock.now()
    let frames = 0
    let stable = 0
    let last = this.signature()
    const pending = this.options.gatesPending ?? (() => 0)
    // an open gate (people loading, the light volume baking) stretches the wait to its own limit
    const limit = () => (pending() > 0 ? Math.max(o.maxMs, o.gateMaxMs) : o.maxMs)
    while (!this.cancelled && this.clock.now() - t0 < limit()) {
      await this.clock.frame()
      frames++
      const sig = this.signature()
      stable = sig === last ? stable + 1 : 0
      last = sig
      this.advance('settle', frames / (o.minFrames + o.stableFrames))
      if (frames >= o.minFrames && stable >= o.stableFrames && (!o.requireEnvironment || this.scene.environment) && pending() === 0) break
    }
    this.stat({ settleMs: this.clock.now() - t0 })
  }

  // --- compiling -----------------------------------------------------------------------------------

  private createStandIn(): WebGLRenderTarget {
    const s = { ...DEFAULTS.standIn, ...this.options.standIn }
    return new WebGLRenderTarget(s.size, s.size, { type: HalfFloatType, samples: s.samples })
  }

  /** Hidden keeper meshes for the extra materials that no mesh of the scene holds. Never added to the scene. */
  private keeperJobs(inScene: ReadonlySet<Material>): CompileJob[] {
    const extras = this.options.extras?.()
    if (!extras) return []
    const jobs: CompileJob[] = []
    for (const material of extras.materials) {
      if (inScene.has(material)) continue
      this.keeperGeometry ??= new BoxGeometry(1, 1, 1)
      const mesh = new Mesh(this.keeperGeometry, material)
      mesh.name = `warm-keeper:${material.name || material.type}`
      jobs.push({ root: mesh, label: mesh.name })
      this.keepers.push(mesh)
    }
    return jobs
  }

  /**
   * One batch: compileAsync when the renderer has it (its sync part compiles; the promise waits for the drivers), compile otherwise. The batch is
   * a virtual group: its `children` are the jobs' roots, assigned without `add` so none of them is re-parented out of the scene. A job that is
   * the scene itself (the plan's fallback) is compiled as the scene, never through the group, or its lights would be counted twice.
   */
  private compileBatch(batch: Group, roots: readonly Object3D[]): void {
    const gl = this.gl
    const whole = roots.length === 1 && roots[0] === this.scene
    const root = whole ? this.scene : batch
    const target = whole ? null : this.scene
    if (typeof gl.compileAsync === 'function') {
      const p = gl.compileAsync(root, this.camera, target)
      p.catch(() => undefined)
      this.pending.push(p)
    } else {
      gl.compile(root, this.camera, target)
    }
  }

  private async compile(): Promise<void> {
    const t0 = this.clock.now()
    const passes = [...new Set(this.options.passes ?? (['composer', 'canvas'] as const))]
    const sceneMaterials = collectMaterials(this.scene)
    const jobs = [...planJobs(this.scene), ...this.keeperJobs(new Set(sceneMaterials))]
    this.warmed = [...sceneMaterials, ...this.keepers.flatMap(collectMaterials)]
    this.stat({ materials: sceneMaterials.length, keepers: this.keepers.length, jobs: jobs.length, passes, usedCompileAsync: typeof this.gl.compileAsync === 'function' })
    const total = jobs.length * passes.length
    const slice = this.options.sliceMs ?? DEFAULTS.sliceMs
    const virtual = new Group()
    let done = 0
    let failedJobs = 0
    let batch = FIRST_BATCH
    let standIn: WebGLRenderTarget | null = null
    try {
      for (const pass of passes) {
        let target: WebGLRenderTarget | null = null
        if (pass === 'composer') {
          try {
            standIn ??= this.createStandIn()
            target = standIn
          } catch {
            this.fail()
            done += jobs.length
            continue
          }
        }
        let i = 0
        while (i < jobs.length && !this.cancelled && !this.expired) {
          // reveal, compile and restore inside one synchronous block: no frame is ever drawn with the hidden objects revealed
          const revealed = this.options.reveal === false ? null : revealHidden(this.scene)
          const previous = this.gl.getRenderTarget()
          const sliceStart = this.clock.now()
          try {
            this.gl.setRenderTarget(target)
            do {
              const end = Math.min(jobs.length, i + batch)
              const roots = jobs.slice(i, end).map((j) => j.root)
              virtual.children = roots
              const t = this.clock.now()
              try {
                this.compileBatch(virtual, roots)
              } catch {
                failedJobs += end - i
              }
              batch = nextBatch(batch, this.clock.now() - t, slice)
              done += end - i
              i = end
            } while (i < jobs.length && this.clock.now() - sliceStart < slice)
          } finally {
            this.gl.setRenderTarget(previous)
            revealed?.restore()
            if (revealed) this.stat({ revealed: Math.max(this.snap.stats.revealed, revealed.count) })
          }
          this.advance('compile', total === 0 ? 1 : done / total)
          if (i < jobs.length) await this.clock.frame()
        }
      }
    } finally {
      virtual.children = []
      standIn?.dispose()
    }
    if (failedJobs > 0) this.fail()
    this.stat({ failedJobs, compileMs: this.clock.now() - t0 })
    this.advance('compile', 1)
  }

  // --- finishing -----------------------------------------------------------------------------------

  private pendingMaterials(): number {
    const props = this.gl.properties
    if (!props) return 0
    let n = 0
    for (const m of this.warmed) if (pendingPrograms(props, m) > 0) n++
    return n
  }

  private async waitReady(): Promise<void> {
    const t0 = this.clock.now()
    const limit = t0 + (this.options.readyWaitMs ?? DEFAULTS.readyWaitMs)
    let settled = this.pending.length === 0
    if (!settled) {
      Promise.all(this.pending).then(
        () => (settled = true),
        () => (settled = true),
      )
    }
    const total = Math.max(1, this.warmed.length)
    while (!this.cancelled && !this.expired && this.clock.now() < limit) {
      const waiting = this.pendingMaterials()
      this.advance('finish', 1 - waiting / total)
      if (settled && waiting === 0) break
      await this.clock.frame()
    }
    this.stat({ readyMs: this.clock.now() - t0 })
    this.advance('finish', 1)
  }

  // --- linking -------------------------------------------------------------------------------------

  /** Every distinct program of the warmed materials that is ready, once each. */
  private readyPrograms(): ProgramLike[] {
    const props = this.gl.properties
    if (!props) return []
    const seen = new Set<ProgramLike>()
    for (const m of this.warmed) {
      const programs = props.get(m).programs
      if (!programs) continue
      for (const p of programs.values()) if (p && p.isReady?.() !== false) seen.add(p)
    }
    return [...seen]
  }

  private async linkPrograms(): Promise<void> {
    const t0 = this.clock.now()
    const programs = this.readyPrograms()
    const slice = this.options.sliceMs ?? DEFAULTS.sliceMs
    let done = 0
    while (done < programs.length && !this.cancelled && !this.expired) {
      const start = this.clock.now()
      while (done < programs.length && this.clock.now() - start < slice) {
        try {
          programs[done].getUniforms?.()
        } catch {
          /* a program that failed to link reports it on first use anyway */
        }
        done++
      }
      this.advance('link', done / programs.length)
      if (done < programs.length) await this.clock.frame()
    }
    this.stat({ linked: done, linkMs: this.clock.now() - t0 })
    this.advance('link', 1)
  }

  // --- textures ------------------------------------------------------------------------------------

  private async uploadTextures(): Promise<void> {
    const t0 = this.clock.now()
    const extra = this.options.extras?.().textures ?? []
    const sources = { properties: this.gl.properties, extra }
    const list = new Set<Texture>(collectTextures(this.scene, sources))
    for (const keeper of this.keepers) for (const t of collectTextures(keeper, sources)) list.add(t)
    const textures = [...list]
    const slice = this.options.sliceMs ?? DEFAULTS.sliceMs
    let done = 0
    while (done < textures.length && !this.cancelled && !this.expired) {
      const start = this.clock.now()
      while (done < textures.length && this.clock.now() - start < slice) {
        try {
          this.gl.initTexture(textures[done])
        } catch {
          /* a texture that will not upload now will try again when it is drawn */
        }
        done++
      }
      this.advance('textures', (0.85 * done) / textures.length)
      if (done < textures.length) await this.clock.frame()
    }
    this.stat({ textures: done, textureMs: this.clock.now() - t0 })
    this.advance('textures', 0.85)
    if (!this.cancelled && !this.expired && this.options.geometry !== false) {
      await this.clock.frame() // the loading screen paints before the one long synchronous step
      this.uploadGeometry()
    }
    this.advance('textures', 1)
  }

  // --- geometry ------------------------------------------------------------------------------------

  /**
   * F-12: one render of everything into the stand-in target, so every vertex and instance buffer is on the GPU before the first real frame.
   * Hidden objects are revealed and frustum culling is switched off (the walk building is far outside the overview's frustum, level 2 too),
   * all in one synchronous block, and put back exactly. Best effort: a render that throws leaves the buffers to upload on first draw.
   */
  private uploadGeometry(): void {
    const gl = this.gl
    if (typeof gl.render !== 'function') return
    const t0 = this.clock.now()
    const shadow = gl.shadowMap
    const shadowNeeds = shadow?.needsUpdate
    const shadowAuto = shadow?.autoUpdate
    const previous = gl.getRenderTarget()
    let standIn: WebGLRenderTarget | null = null
    let revealed: ReturnType<typeof revealHidden> | null = null
    const uncull: Object3D[] = []
    let ok = false
    try {
      standIn = this.createStandIn()
      revealed = revealHidden(this.scene)
      this.scene.traverse((o) => {
        if (graphical(o) && o.frustumCulled) {
          o.frustumCulled = false
          uncull.push(o)
        }
      })
      if (shadow) {
        shadow.needsUpdate = false
        shadow.autoUpdate = false
      }
      gl.setRenderTarget(standIn)
      gl.render(this.scene, this.camera)
      ok = true
    } catch {
      /* the buffers upload when each object is first drawn, as they did before this step existed */
    } finally {
      for (const o of uncull) o.frustumCulled = true
      revealed?.restore()
      if (shadow) {
        shadow.needsUpdate = shadowNeeds ?? false
        shadow.autoUpdate = shadowAuto ?? false
      }
      gl.setRenderTarget(previous)
      standIn?.dispose()
      gl.info?.reset?.() // the probe's per-frame counters should not carry this render
    }
    this.stat({ geometryUploaded: ok, geometryMs: this.clock.now() - t0 })
  }

  // --- end -----------------------------------------------------------------------------------------

  private cleanup(): void {
    this.keeperGeometry?.dispose()
    this.keeperGeometry = null
    this.pending = []
  }

  /** Materials of the mounted scene and of the keepers the compile prepared (for the probe). */
  warmedMaterials(): readonly Material[] {
    return this.warmed
  }
}
