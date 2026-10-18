/**
 * Test helpers for the warm-up (not a test file itself): a fake renderer that records what the warm-up asks of it, and a manual clock.
 * three.js objects (Scene, Mesh, materials, render targets) are the real ones: they need no GL until they are drawn.
 */
import type { Camera, Material, Object3D, Texture, WebGLRenderTarget } from 'three'
import { Scene } from 'three'
import { graphical } from './collect'
import type { Scheduler, WarmupGl } from './run'

export interface CompileCall {
  fn: 'compile' | 'compileAsync'
  /** The root handed in: the names of its children when it is a batch, its own name otherwise. */
  roots: string[]
  /** The target scene (third argument), or null. */
  targetScene: Object3D | null
  /** The render target set at that moment. */
  target: WebGLRenderTarget | null
  /** `visible` of every named object of the scene, at that moment. */
  visible: Record<string, boolean>
}

export interface FakeGlOptions {
  /** Provide `compileAsync` (default true). */
  async?: boolean
  /** The first `n` readiness checks of any program say "not ready yet". */
  pendingChecks?: number
  /** `compileAsync` returns a promise that never settles. */
  neverResolves?: boolean
  /** Every compile call throws. */
  throws?: boolean
  /** `initTexture` throws for the n-th texture (1-based). */
  initThrowsAt?: number
}

export interface FakeGl extends WarmupGl {
  calls: CompileCall[]
  initialised: Texture[]
  /** Distinct programs "built" (info.programs). */
  programs: unknown[]
  /** How many times each program's `getUniforms` was called. */
  linked: Map<string, number>
  /** Render target changes, in order (null is the canvas). */
  targets: (WebGLRenderTarget | null)[]
}

export function fakeGl(scene: Scene, options: FakeGlOptions = {}): FakeGl {
  let current: WebGLRenderTarget | null = null
  let pending = options.pendingChecks ?? 0
  const props = new WeakMap<object, Record<string, unknown>>()
  const keys = new Set<string>()

  const snapshot = (): Record<string, boolean> => {
    const out: Record<string, boolean> = {}
    scene.traverse((o) => {
      if (o.name) out[o.name] = o.visible
    })
    return out
  }

  const build = (root: Object3D): void => {
    root.traverse((o) => {
      if (!graphical(o)) return
      const raw = (o as Object3D & { material?: Material | Material[] }).material
      for (const material of Array.isArray(raw) ? raw : raw ? [raw] : []) {
        const key = `${material.uuid}|${current === null ? 'canvas' : 'composer'}`
        let p = props.get(material)
        if (!p) {
          p = {}
          props.set(material, p)
        }
        p.programs ??= new Map()
        const programs = p.programs as Map<string, { isReady: () => boolean; getUniforms: () => unknown }>
        if (!programs.has(key)) {
          programs.set(key, {
            isReady: () => pending-- <= 0,
            getUniforms: () => gl.linked.set(key, (gl.linked.get(key) ?? 0) + 1),
          })
          keys.add(key)
          gl.programs.push(key)
        }
        p.currentProgram = [...programs.values()][0]
      }
    })
  }

  const record = (fn: CompileCall['fn'], root: Object3D, targetScene: Object3D | null | undefined): void => {
    if (options.throws) throw new Error('lost context')
    gl.calls.push({
      fn,
      roots: root.children.length > 0 && !root.name ? root.children.map((c) => c.name || c.type) : [root.name || root.type],
      targetScene: targetScene ?? null,
      target: current,
      visible: snapshot(),
    })
    build(root)
  }

  const gl: FakeGl = {
    calls: [],
    initialised: [],
    programs: [],
    linked: new Map(),
    targets: [],
    info: { programs: [] },
    getRenderTarget: () => current,
    setRenderTarget: (t) => {
      current = t
      gl.targets.push(t)
    },
    compile: (root, _camera: Camera, targetScene) => {
      record('compile', root, targetScene)
    },
    initTexture: (t) => {
      if (options.initThrowsAt === gl.initialised.length + 1) {
        gl.initialised.push(t)
        throw new Error('bad image')
      }
      gl.initialised.push(t)
    },
    properties: { get: (o) => (props.get(o) ?? props.set(o, {}).get(o)!) as never },
  }
  gl.info = { programs: gl.programs }
  if (options.async !== false) {
    gl.compileAsync = (root, _camera: Camera, targetScene) => {
      record('compileAsync', root, targetScene)
      return options.neverResolves ? new Promise(() => undefined) : Promise.resolve(null)
    }
  }
  return gl
}

export interface ManualClock extends Scheduler {
  time: number
  frames: number
}

/** A clock that moves only when told: a frame costs `frameMs`, and every `now()` call costs `tickMs`. */
export function manualClock({ frameMs = 16, tickMs = 0 }: { frameMs?: number; tickMs?: number } = {}): ManualClock {
  const c: ManualClock = {
    time: 0,
    frames: 0,
    now: () => (c.time += tickMs),
    frame: async () => {
      c.frames++
      c.time += frameMs
    },
  }
  return c
}
