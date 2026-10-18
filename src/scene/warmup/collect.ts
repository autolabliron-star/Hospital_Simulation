/**
 * What the warm-up looks at, as pure functions over a three.js object tree (no renderer, no DOM, so node tests drive them).
 *
 *   graphical / collectMaterialUses / collectMaterials   every (object, material) pair the renderer would compile: the same test three's
 *                                                         own `compile` uses (Mesh, Points, Line, Sprite), hidden objects included
 *   planJobs                                              one compile job per graphical object, so the compile can be spread over frames
 *   revealHidden                                          make the hidden walk-only, overview-only and not-yet-needed objects visible,
 *                                                         and put every one of them back exactly
 *   collectTextures                                       every texture a material holds, directly, in a ShaderMaterial's uniforms, or in
 *                                                         the uniforms the renderer built for it (a patched standard material's `uPose`)
 */
import type { Material, Object3D, Scene, Texture } from 'three'

/** The objects three's `compile` prepares a material for (see WebGLRenderer.compile). */
export function graphical(o: Object3D): boolean {
  const g = o as Object3D & { isMesh?: boolean; isPoints?: boolean; isLine?: boolean; isSprite?: boolean }
  return g.isMesh === true || g.isPoints === true || g.isLine === true || g.isSprite === true
}

function isLight(o: Object3D): boolean {
  return (o as Object3D & { isLight?: boolean }).isLight === true
}

/** A material of an object, as an array (a mesh may carry one or several). */
function materialsOf(o: Object3D): Material[] {
  const m = (o as Object3D & { material?: Material | Material[] }).material
  if (!m) return []
  return Array.isArray(m) ? m : [m]
}

export interface MaterialUse {
  object: Object3D
  material: Material
}

/** Every (object, material) pair under `root`, in scene order. Hidden objects count: three compiles them too. */
export function collectMaterialUses(root: Object3D, out: MaterialUse[] = []): MaterialUse[] {
  root.traverse((o) => {
    if (!graphical(o)) return
    for (const material of materialsOf(o)) out.push({ object: o, material })
  })
  return out
}

/** Every distinct material under `root`. */
export function collectMaterials(root: Object3D): Material[] {
  const seen = new Set<Material>()
  root.traverse((o) => {
    if (!graphical(o)) return
    for (const m of materialsOf(o)) seen.add(m)
  })
  return [...seen]
}

/** Display name of a use, for the probe and for test failures: `object:material`. */
export function useName(use: MaterialUse): string {
  const o = use.object.name || use.object.type
  const m = use.material.name || use.material.type
  return `${o}:${m}#${use.material.uuid.slice(0, 8)}`
}

// ---------------------------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------------------------

export interface CompileJob {
  /** What to hand to `compile(root, camera, scene)`. */
  root: Object3D
  label: string
}

/** Objects that have a light somewhere in their subtree (themselves included): compiling one of them on its own would count the light twice. */
function holdsLight(root: Object3D): Set<Object3D> {
  const held = new Set<Object3D>()
  root.traverse((o) => {
    if (!isLight(o)) return
    for (let p: Object3D | null = o; p; p = p.parent) held.add(p)
  })
  return held
}

/**
 * One job per graphical object. three's `compile(object, camera, scene)` gathers the lights of `scene` and of `object`, so an object that
 * has a light inside it would count that light twice and compile the wrong programs: if any graphical object does, the plan falls back to
 * one job for the whole scene (nothing in the hospital does today; Lighting keeps its lights as plain children of the scene).
 */
export function planJobs(scene: Object3D): CompileJob[] {
  const held = holdsLight(scene)
  const jobs: CompileJob[] = []
  let conflict = false
  scene.traverse((o) => {
    if (!graphical(o)) return
    if (held.has(o)) conflict = true
    jobs.push({ root: o, label: o.name || o.type })
  })
  return conflict ? [{ root: scene, label: 'scene' }] : jobs
}

// ---------------------------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------------------------

export interface Revealed {
  /** How many objects were made visible. */
  count: number
  /** Put every one of them back to hidden. Safe to call twice. */
  restore(): void
}

/**
 * Make every hidden object under `root` visible (the walk-only building in the overview, the overview-only parked doors and floor labels in
 * walk mode, the emote icons and the selection ring while nobody uses them) and hand back the way to undo exactly that. Lights, and anything
 * with a light inside, are left alone: a light switched on here would change the light counts the programs are compiled for.
 *
 * The caller reveals, compiles and restores inside ONE synchronous block, so no frame is ever drawn with the objects revealed.
 */
export function revealHidden(root: Object3D): Revealed {
  const held = holdsLight(root)
  const flipped: Object3D[] = []
  root.traverse((o) => {
    if (o.visible || isLight(o) || held.has(o)) return
    o.visible = true
    flipped.push(o)
  })
  let restored = false
  return {
    count: flipped.length,
    restore() {
      if (restored) return
      restored = true
      for (const o of flipped) o.visible = false
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------------------------

interface TextureLike {
  isTexture?: boolean
  isRenderTargetTexture?: boolean
  isVideoTexture?: boolean
  isDepthTexture?: boolean
  version?: number
  image?: unknown
}

/**
 * Worth handing to `initTexture`: it has pixels (version above zero and an image), or it is a render-target texture (the environment map:
 * already on the GPU, `initTexture` just binds it). Videos and depth textures are left to the renderer.
 */
export function isWarmable(value: unknown): value is Texture {
  const t = value as TextureLike | null
  if (!t || t.isTexture !== true || t.isVideoTexture || t.isDepthTexture) return false
  return t.isRenderTargetTexture === true || ((t.version ?? 0) > 0 && t.image != null)
}

function addTextures(value: unknown, into: Set<Texture>): void {
  if (Array.isArray(value)) {
    for (const v of value) if (isWarmable(v)) into.add(v)
  } else if (isWarmable(value)) into.add(value)
}

function addUniforms(uniforms: unknown, into: Set<Texture>): void {
  if (!uniforms || typeof uniforms !== 'object') return
  for (const u of Object.values(uniforms as Record<string, { value?: unknown } | null>)) addTextures(u?.value, into)
}

/** The renderer's own bookkeeping for a material (`WebGLRenderer.properties`): after a compile it holds the uniforms the shader patches added. */
export interface ProgramLike {
  /** False while the driver is still compiling (KHR_parallel_shader_compile). */
  isReady?: () => boolean
  /** The first call looks up every uniform and attribute location (and checks the link): a cost the first draw would otherwise pay. */
  getUniforms?: () => unknown
}

export interface PropertiesLike {
  get(object: object): { uniforms?: unknown; programs?: Map<unknown, ProgramLike | undefined>; currentProgram?: ProgramLike }
}

export interface TextureSources {
  /** Wherever the renderer keeps what it built per material; read after the compile. */
  properties?: PropertiesLike
  /** Textures that are not on any material of the scene (registered by modules). */
  extra?: readonly Texture[]
}

/** Every distinct, warmable texture of the materials under `root`, of the scene's environment and background, and of `extra`. */
export function collectTextures(root: Object3D, sources: TextureSources = {}): Texture[] {
  const found = new Set<Texture>()
  const scene = root as Scene
  addTextures((scene as { environment?: unknown }).environment, found)
  addTextures((scene as { background?: unknown }).background, found)
  const visit = (m: Material): void => {
    for (const value of Object.values(m)) addTextures(value, found)
    addUniforms((m as Material & { uniforms?: unknown }).uniforms, found)
    if (sources.properties) addUniforms(sources.properties.get(m).uniforms, found)
  }
  for (const m of collectMaterials(root)) visit(m)
  for (const t of sources.extra ?? []) addTextures(t, found)
  return [...found]
}
