import { describe, expect, it } from 'vitest'
import {
  AmbientLight,
  BoxGeometry,
  DirectionalLight,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Texture,
} from 'three'
import { collectMaterialUses, collectMaterials, collectTextures, graphical, isWarmable, planJobs, revealHidden, useName } from './collect'

const tex = (ready = true): Texture => {
  const t = new Texture({ width: 2, height: 2 } as unknown as HTMLImageElement)
  if (ready) t.needsUpdate = true
  return t
}
const renderTargetTexture = (): Texture => {
  const t = new Texture()
  ;(t as unknown as { isRenderTargetTexture: boolean }).isRenderTargetTexture = true
  return t
}
const box = new BoxGeometry()

describe('which objects count', () => {
  it('are the ones three compiles materials for: Mesh, Points, Line, Sprite', () => {
    expect(graphical(new Mesh())).toBe(true)
    expect(graphical(new Points())).toBe(true)
    expect(graphical(new Line())).toBe(true)
    expect(graphical(new Sprite())).toBe(true)
    expect(graphical(new Group())).toBe(false)
    expect(graphical(new AmbientLight())).toBe(false)
  })

  it('collects every (object, material) pair, hidden objects and material arrays included', () => {
    const a = new MeshStandardMaterial({ name: 'a' })
    const b = new MeshBasicMaterial()
    const c = new MeshBasicMaterial()
    const scene = new Scene()
    scene.add(new Mesh(box, a))
    const hidden = new Group()
    hidden.visible = false
    const inner = new Mesh(box, [b, c])
    inner.name = 'inner'
    hidden.add(inner)
    scene.add(hidden)
    scene.add(new Points(box, new PointsMaterial()), new Line(box, new LineBasicMaterial()), new Sprite(new SpriteMaterial()))
    const uses = collectMaterialUses(scene)
    expect(uses).toHaveLength(6)
    expect(collectMaterials(scene)).toHaveLength(6)
    expect(uses.map((u) => u.material)).toEqual(expect.arrayContaining([a, b, c]))
    expect(useName(uses.find((u) => u.material === b)!)).toMatch(/^inner:MeshBasicMaterial#[0-9a-f]{8}$/)
  })

  it('lists a shared material once', () => {
    const shared = new MeshStandardMaterial()
    const scene = new Scene()
    scene.add(new Mesh(box, shared), new Mesh(box, shared))
    expect(collectMaterials(scene)).toEqual([shared])
    expect(collectMaterialUses(scene)).toHaveLength(2)
  })
})

describe('compile jobs', () => {
  it('are one per graphical object, hidden ones included', () => {
    const scene = new Scene()
    const g = new Group()
    g.visible = false
    g.add(new Mesh(box, new MeshBasicMaterial()))
    scene.add(g, new Mesh(box, new MeshBasicMaterial()), new AmbientLight())
    const jobs = planJobs(scene)
    expect(jobs).toHaveLength(2)
    expect(jobs.every((j) => graphical(j.root))).toBe(true)
  })

  it('fall back to the whole scene when an object has a light inside it (it would be counted twice otherwise)', () => {
    const scene = new Scene()
    const holder = new Mesh(box, new MeshBasicMaterial())
    holder.add(new DirectionalLight())
    scene.add(holder, new Mesh(box, new MeshBasicMaterial()))
    const jobs = planJobs(scene)
    expect(jobs).toHaveLength(1)
    expect(jobs[0].root).toBe(scene)
  })

  it('keep plain lights in the scene out of the way (Lighting keeps its lights as children of the scene)', () => {
    const scene = new Scene()
    scene.add(new DirectionalLight(), new Mesh(box, new MeshBasicMaterial()))
    expect(planJobs(scene)).toHaveLength(1)
  })
})

describe('revealing hidden objects', () => {
  it('shows every hidden object and puts each back to hidden exactly, leaving visible ones alone', () => {
    const scene = new Scene()
    const walk = new Group()
    walk.visible = false
    const nested = new Group()
    nested.visible = false
    const ceiling = new Mesh(box, new MeshBasicMaterial())
    ceiling.visible = false
    nested.add(ceiling)
    walk.add(nested)
    const wall = new Mesh(box, new MeshBasicMaterial())
    scene.add(walk, wall)
    const r = revealHidden(scene)
    expect(r.count).toBe(3)
    expect([walk, nested, ceiling, wall].map((o) => o.visible)).toEqual([true, true, true, true])
    r.restore()
    expect([walk, nested, ceiling, wall].map((o) => o.visible)).toEqual([false, false, false, true])
    r.restore() // idempotent
    expect([walk, nested, ceiling, wall].map((o) => o.visible)).toEqual([false, false, false, true])
  })

  it('leaves lights, and groups with a light inside, as they are', () => {
    const scene = new Scene()
    const sun = new DirectionalLight()
    sun.visible = false
    const rig = new Group()
    rig.visible = false
    const inside = new AmbientLight()
    rig.add(inside)
    const plain = new Group()
    plain.visible = false
    scene.add(sun, rig, plain)
    const r = revealHidden(scene)
    expect(r.count).toBe(1)
    expect(sun.visible).toBe(false)
    expect(rig.visible).toBe(false)
    expect(plain.visible).toBe(true)
    r.restore()
    expect(plain.visible).toBe(false)
  })

  it('has nothing to do for an all-visible scene', () => {
    const scene = new Scene()
    scene.add(new Object3D())
    expect(revealHidden(scene).count).toBe(0)
  })
})

describe('collecting textures to upload', () => {
  it('finds every texture of every material: plain fields, material arrays, hidden objects and shader uniforms', () => {
    const a = tex()
    const b = tex()
    const c = tex()
    const d = tex()
    const scene = new Scene()
    scene.add(new Mesh(box, new MeshStandardMaterial({ map: a, emissiveMap: b })))
    const hidden = new Mesh(box, [new MeshBasicMaterial({ map: c }), new MeshBasicMaterial()])
    hidden.visible = false
    scene.add(hidden)
    scene.add(new Mesh(box, new ShaderMaterial({ uniforms: { atlas: { value: d }, other: { value: 3 } } })))
    expect(new Set(collectTextures(scene))).toEqual(new Set([a, b, c, d]))
  })

  it('finds a texture that only exists in the uniforms the renderer built for a patched material (the crowd pose texture)', () => {
    const pose = tex()
    const material = new MeshStandardMaterial()
    const scene = new Scene()
    scene.add(new Mesh(box, material))
    expect(collectTextures(scene)).toEqual([])
    const properties = { get: (o: object) => (o === material ? { uniforms: { uPose: { value: pose }, uLod: { value: 1 }, uFixed: { value: [1, 2] } } } : {}) }
    expect(collectTextures(scene, { properties })).toEqual([pose])
  })

  it('includes the environment, the background, and registered extras; each texture once', () => {
    const env = renderTargetTexture()
    const bg = tex()
    const extra = tex()
    const shared = tex()
    const scene = new Scene()
    scene.environment = env
    scene.background = bg
    scene.add(new Mesh(box, new MeshBasicMaterial({ map: shared })), new Mesh(box, new MeshBasicMaterial({ map: shared })))
    const found = collectTextures(scene, { extra: [extra, shared] })
    expect(found).toHaveLength(4)
    expect(new Set(found)).toEqual(new Set([env, bg, extra, shared]))
  })

  it('leaves out textures with no pixels yet, videos and depth textures', () => {
    const empty = tex(false)
    const video = tex()
    ;(video as unknown as { isVideoTexture: boolean }).isVideoTexture = true
    const depth = tex()
    ;(depth as unknown as { isDepthTexture: boolean }).isDepthTexture = true
    expect(isWarmable(empty)).toBe(false)
    expect(isWarmable(video)).toBe(false)
    expect(isWarmable(depth)).toBe(false)
    expect(isWarmable(tex())).toBe(true)
    expect(isWarmable(renderTargetTexture())).toBe(true)
    expect(isWarmable(null)).toBe(false)
    expect(isWarmable({})).toBe(false)
    const scene = new Scene()
    scene.add(new Mesh(box, new MeshStandardMaterial({ map: empty, emissiveMap: video, bumpMap: depth })))
    expect(collectTextures(scene)).toEqual([])
  })
})
