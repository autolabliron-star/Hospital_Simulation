/** F-12: the warm-up's geometry step. One render of the whole scene, revealed and unculled, into the stand-in target, then everything put back. */
import { describe, expect, it } from 'vitest'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, Texture, WebGLRenderTarget, type Camera, type Object3D } from 'three'
import { WarmupRun } from './run'
import { fakeGl, manualClock } from './testkit'

interface Seen {
  walkVisible: boolean
  culledMeshes: number
  target: WebGLRenderTarget | null
  shadowNeeds: boolean
  shadowAuto: boolean
}

function world() {
  const scene = new Scene()
  const env = new Texture()
  ;(env as unknown as { isRenderTargetTexture: boolean }).isRenderTargetTexture = true
  scene.environment = env
  const box = new BoxGeometry(1, 1, 1)
  const wall = new Mesh(box, new MeshStandardMaterial({ name: 'wall' }))
  wall.name = 'wall'
  const walk = new Group()
  walk.name = 'walk'
  walk.visible = false
  const ceiling = new Mesh(box, new MeshStandardMaterial({ name: 'ceiling' }))
  ceiling.name = 'ceiling'
  walk.add(ceiling)
  scene.add(wall, walk)
  return { scene, wall, walk, ceiling }
}

function rig(options: { renderThrows?: boolean; noRender?: boolean } = {}) {
  const w = world()
  const gl = fakeGl(w.scene)
  const seen: Seen[] = []
  const shadow = { needsUpdate: true, autoUpdate: false }
  gl.shadowMap = shadow
  if (!options.noRender) {
    gl.render = (scene: Scene, _camera: Camera) => {
      let culled = 0
      scene.traverse((o: Object3D) => {
        if ((o as Mesh).isMesh && o.frustumCulled) culled++
      })
      seen.push({ walkVisible: w.walk.visible, culledMeshes: culled, target: gl.getRenderTarget(), shadowNeeds: shadow.needsUpdate, shadowAuto: shadow.autoUpdate })
      if (options.renderThrows) throw new Error('lost context')
    }
  }
  const run = new WarmupRun(gl, w.scene, new PerspectiveCamera(), { scheduler: manualClock(), settle: { minFrames: 1, stableFrames: 1 } })
  return { ...w, gl, seen, shadow, run }
}

describe('the warm-up geometry upload (F-12)', () => {
  it('renders the whole scene once, revealed and unculled, into a render target, with the shadow map left alone', async () => {
    const r = rig()
    const snap = await r.run.start()
    expect(r.seen).toHaveLength(1)
    expect(r.seen[0].walkVisible).toBe(true)
    expect(r.seen[0].culledMeshes).toBe(0)
    expect(r.seen[0].target).toBeInstanceOf(WebGLRenderTarget)
    expect(r.seen[0].shadowNeeds).toBe(false)
    expect(r.seen[0].shadowAuto).toBe(false)
    expect(snap.stats.geometryUploaded).toBe(true)
    expect(snap.ready).toBe(true)
  })

  it('puts everything back: hidden groups hidden, culling on, shadow flags and render target as they were', async () => {
    const r = rig()
    r.shadow.autoUpdate = true
    await r.run.start()
    expect(r.walk.visible).toBe(false)
    expect(r.wall.frustumCulled).toBe(true)
    expect(r.ceiling.frustumCulled).toBe(true)
    expect(r.shadow.needsUpdate).toBe(true)
    expect(r.shadow.autoUpdate).toBe(true)
    expect(r.gl.getRenderTarget()).toBeNull()
  })

  it('a render that throws leaves the demo as it was and the warm-up still ready', async () => {
    const r = rig({ renderThrows: true })
    const snap = await r.run.start()
    expect(snap.ready).toBe(true)
    expect(snap.failed).toBe(false)
    expect(snap.stats.geometryUploaded).toBe(false)
    expect(r.walk.visible).toBe(false)
    expect(r.wall.frustumCulled).toBe(true)
    expect(r.shadow.needsUpdate).toBe(true)
  })

  it('is skipped by a renderer without render(), and by geometry: false', async () => {
    const a = rig({ noRender: true })
    expect((await a.run.start()).stats.geometryUploaded).toBe(false)
    const b = rig()
    const run = new WarmupRun(b.gl, b.scene, new PerspectiveCamera(), { scheduler: manualClock(), geometry: false, settle: { minFrames: 1, stableFrames: 1 } })
    await run.start()
    expect(b.seen).toHaveLength(0)
  })

  it('progress still reaches 1 and never goes down', async () => {
    const r = rig()
    const seenProgress: number[] = []
    const run = new WarmupRun(r.gl, r.scene, new PerspectiveCamera(), { scheduler: manualClock(), settle: { minFrames: 1, stableFrames: 1 }, onUpdate: (s) => seenProgress.push(s.progress) })
    const snap = await run.start()
    expect(snap.progress).toBe(1)
    for (let i = 1; i < seenProgress.length; i++) expect(seenProgress[i]).toBeGreaterThanOrEqual(seenProgress[i - 1])
  })
})
