/**
 * A zone that streams in after Enter goes on the GPU a little per frame, before it is ever drawn, so it never costs a frame of its own:
 *
 *   compile    `compileAsync(zone, camera, scene)` once (the programs exist already from the skeleton proxies, so this only finds them; if one
 *              does not, the driver compiles it in parallel and the zone waits for it instead of stalling a frame)
 *   textures   one `initTexture` per frame (its lightmaps; the shared material textures were uploaded by the warm-up)
 *   geometry   a few meshes per frame (at most UPLOAD_BYTES_PER_FRAME of vertex and index data), drawn once into a 4 x 4 stand-in target with
 *              the scene's own lights and environment (so the program keys are the frame's), which uploads their buffers; as the warm-up does
 *              for the whole scene before Enter (src/scene/warmup/run.ts uploadGeometry), and as three's Reflector renders off-screen in XR
 *              (xr.enabled off for the pass). The renderer's per-frame counters are put back, so `?probe=1` does not count the pass.
 *
 * Only the streaming frames allocate (three's own render bookkeeping); a frame with nothing streaming does no work here at all.
 */
import { Scene, WebGLRenderTarget, type Camera, type Light, type Mesh, type Object3D, type Texture, type WebGLRenderer } from 'three'

/** At most this much vertex and index data is uploaded in one frame (a few ms on the Quest's GPU bus). */
export const UPLOAD_BYTES_PER_FRAME = 1.5 * 1024 * 1024

export type UploadPhase = 'compile' | 'compiling' | 'textures' | 'geometry' | 'done'

export interface UploadJob {
  root: Object3D
  meshes: readonly Mesh[]
  textures: readonly Texture[]
  bytesOf(m: Mesh): number
  phase: UploadPhase
  next: number
}

export function uploadJob(root: Object3D, meshes: readonly Mesh[], textures: readonly Texture[], bytesOf: (m: Mesh) => number): UploadJob {
  return { root, meshes, textures, bytesOf, phase: 'compile', next: 0 }
}

/** The meshes [from, to) of one geometry pass: at least one, then as many as fit the byte budget. */
export function geometryBatchEnd(job: UploadJob, from: number, budget = UPLOAD_BYTES_PER_FRAME): number {
  let to = from
  let bytes = 0
  while (to < job.meshes.length) {
    const b = job.bytesOf(job.meshes[to])
    if (to > from && bytes + b > budget) break
    bytes += b
    to++
  }
  return to
}

export class ZoneUploader {
  private target: WebGLRenderTarget | null = null
  private readonly scratch = new Scene()
  private readonly lights: Light[] = []
  private readonly batch: Object3D[] = []
  private readonly culled: Object3D[] = []

  constructor() {
    this.scratch.name = 'zone-upload-pass'
    this.scratch.matrixWorldAutoUpdate = false // the zone's and the lights' world matrices are already right; touch nothing
  }

  /** One step of a job; returns true when the job is done. Call once a frame while a zone streams. */
  step(gl: WebGLRenderer, scene: Scene, camera: Camera, job: UploadJob): boolean {
    switch (job.phase) {
      case 'compile': {
        job.phase = 'compiling'
        const done = (): void => {
          if (job.phase === 'compiling') job.phase = 'textures'
        }
        try {
          gl.compileAsync(job.root, camera, scene).then(done, done)
        } catch {
          done()
        }
        return false
      }
      case 'compiling':
        return false
      case 'textures': {
        if (job.next < job.textures.length) {
          try {
            gl.initTexture(job.textures[job.next])
          } catch {
            /* it uploads when first drawn */
          }
          job.next++
          return false
        }
        job.phase = 'geometry'
        job.next = 0
        return false
      }
      case 'geometry': {
        if (job.next >= job.meshes.length) {
          job.phase = 'done'
          return true
        }
        const to = geometryBatchEnd(job, job.next)
        this.pass(gl, scene, camera, job.meshes, job.next, to)
        job.next = to
        return false
      }
      default:
        return true
    }
  }

  /** Draw meshes [from, to) once into the stand-in target with the scene's lights and environment. */
  private pass(gl: WebGLRenderer, scene: Scene, camera: Camera, meshes: readonly Mesh[], from: number, to: number): void {
    this.lights.length = 0
    scene.traverseVisible((o) => {
      if ((o as Light).isLight) this.lights.push(o as Light)
    })
    this.batch.length = 0
    this.culled.length = 0
    for (const l of this.lights) this.batch.push(l)
    for (let i = from; i < to; i++) {
      const m = meshes[i]
      if (m.frustumCulled) {
        m.frustumCulled = false
        this.culled.push(m)
      }
      this.batch.push(m)
    }
    const s = this.scratch
    s.environment = scene.environment
    s.environmentIntensity = scene.environmentIntensity
    s.environmentRotation.copy(scene.environmentRotation)
    // the batch's objects keep their parents: the stand-in scene lists them without adopting them (as the warm-up's compile batches do)
    ;(s as unknown as { children: Object3D[] }).children = this.batch
    this.target ??= new WebGLRenderTarget(4, 4)
    const previous = gl.getRenderTarget()
    const xr = gl.xr.enabled
    // the baked sun shadow must not be rendered from this pass's few objects (a pending re-bake waits for the real frame), as in the warm-up
    const shadow = gl.shadowMap
    const shadowAuto = shadow.autoUpdate
    const shadowNeeds = shadow.needsUpdate
    const info = gl.info.render
    const calls = info.calls
    const triangles = info.triangles
    try {
      gl.xr.enabled = false
      shadow.autoUpdate = false
      shadow.needsUpdate = false
      gl.setRenderTarget(this.target)
      gl.render(s, camera)
    } catch {
      /* the buffers upload when each mesh is first drawn */
    } finally {
      gl.setRenderTarget(previous)
      gl.xr.enabled = xr
      shadow.autoUpdate = shadowAuto
      shadow.needsUpdate = shadowNeeds
      info.calls = calls
      info.triangles = triangles
      ;(s as unknown as { children: Object3D[] }).children = []
      s.environment = null
      for (const m of this.culled) m.frustumCulled = true
      this.batch.length = 0
      this.culled.length = 0
      this.lights.length = 0
    }
  }

  dispose(): void {
    this.target?.dispose()
    this.target = null
  }
}
