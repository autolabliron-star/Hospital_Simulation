import { describe, expect, it } from 'vitest'
import {
  AmbientLight,
  BoxGeometry,
  DataTexture,
  Group,
  HalfFloatType,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Texture,
  type Material,
  WebGLRenderTarget,
} from 'three'
import { nextBatch, WarmupRun, type WarmupOptions, type WarmupSnapshot } from './run'
import { fakeGl, manualClock, type FakeGl, type FakeGlOptions } from './testkit'

const box = new BoxGeometry(1, 1, 1)

function envTexture(): Texture {
  const t = new Texture()
  ;(t as unknown as { isRenderTargetTexture: boolean }).isRenderTargetTexture = true
  return t
}

function canvasLike(): Texture {
  const t = new Texture({ width: 2, height: 2 } as unknown as HTMLImageElement)
  t.needsUpdate = true
  return t
}

function mesh(name: string, material: Material, visible = true): Mesh {
  const m = new Mesh(box, material)
  m.name = name
  m.visible = visible
  return m
}

/** A scene like the hospital's in miniature: always-visible building, a hidden walk-only group, a hidden overview-only group, an idle effect. */
function hospital() {
  const scene = new Scene()
  scene.name = 'scene'
  scene.environment = envTexture()
  const lights = new Group()
  lights.name = 'lights'
  lights.add(new AmbientLight())
  scene.add(lights)
  const wall = new MeshStandardMaterial({ name: 'wall' })
  const ceiling = new MeshStandardMaterial({ name: 'ceiling', map: canvasLike() })
  const label = new MeshBasicMaterial({ name: 'label', map: canvasLike() })
  const emote = new ShaderMaterial({ name: 'emote', uniforms: { map: { value: canvasLike() } } })
  const building = new Group()
  building.name = 'building'
  building.add(mesh('wall', wall))
  const walk = new Group()
  walk.name = 'walk'
  walk.visible = false
  walk.add(mesh('ceiling', ceiling))
  const overview = new Group()
  overview.name = 'overview'
  overview.visible = false
  overview.add(mesh('labels', label))
  scene.add(building, walk, overview, mesh('emotes', emote, false))
  return { scene, wall, ceiling, label, emote, camera: new PerspectiveCamera() }
}

interface Setup extends ReturnType<typeof hospital> {
  gl: FakeGl
  clock: ReturnType<typeof manualClock>
  snapshots: WarmupSnapshot[]
  run: WarmupRun
}

function setup(gl: FakeGlOptions = {}, options: WarmupOptions = {}, clockOptions?: Parameters<typeof manualClock>[0]): Setup {
  const h = hospital()
  const fake = fakeGl(h.scene, gl)
  const clock = manualClock(clockOptions)
  const snapshots: WarmupSnapshot[] = []
  const run = new WarmupRun(fake, h.scene, h.camera, { scheduler: clock, onUpdate: (s) => snapshots.push(s), ...options })
  return { ...h, gl: fake, clock, snapshots, run }
}

const visibilities = (scene: Scene): Record<string, boolean> => {
  const out: Record<string, boolean> = {}
  scene.traverse((o) => {
    if (o.name) out[o.name] = o.visible
  })
  return out
}

describe('the warm-up run: progress and ready', () => {
  it('goes through the phases in order, never reports ready before the end, and its progress never goes down', async () => {
    const s = setup()
    expect(s.run.snapshot).toMatchObject({ phase: 'idle', progress: 0, ready: false })
    const done = await s.run.start()
    const phases = [...new Set(s.snapshots.map((x) => x.phase))]
    expect(phases).toEqual(['settling', 'compiling', 'finishing', 'linking', 'textures', 'done'])
    for (const x of s.snapshots.slice(0, -1)) expect(x.ready).toBe(false)
    for (let i = 1; i < s.snapshots.length; i++) expect(s.snapshots[i].progress).toBeGreaterThanOrEqual(s.snapshots[i - 1].progress)
    expect(done).toMatchObject({ phase: 'done', progress: 1, ready: true, failed: false, timedOut: false, cancelled: false })
  })

  it('compiles every material of the scene (hidden groups and the idle effect included) and uploads every texture', async () => {
    const s = setup()
    const done = await s.run.start()
    expect(done.stats.materials).toBe(4)
    for (const m of [s.wall, s.ceiling, s.label, s.emote]) expect(s.gl.properties!.get(m).programs).toBeDefined()
    // map of the ceiling and the label, the emote atlas (a shader uniform) and the environment
    expect(done.stats.textures).toBe(4)
    expect(s.gl.initialised).toHaveLength(4)
    expect(done.stats.programs).toBe(s.gl.programs.length)
    expect(done.stats.programs).toBeGreaterThanOrEqual(8) // 4 materials x (composer, canvas)
  })

  it('does the first-use work of every distinct program once (uniform and attribute lookups), so the first draw does not', async () => {
    const s = setup()
    const done = await s.run.start()
    expect(done.stats.linked).toBe(s.gl.programs.length)
    expect(s.gl.linked.size).toBe(s.gl.programs.length)
    expect([...s.gl.linked.values()].every((n) => n === 1)).toBe(true)
  })

  it('does not touch a program the driver has not finished (it would stall until it has)', async () => {
    const s = setup({ neverResolves: true, pendingChecks: 1e9 }, { readyWaitMs: 50 })
    const done = await s.run.start()
    expect(done.stats.linked).toBe(0)
    expect(s.gl.linked.size).toBe(0)
  })

  it('spreads the compile over several frames when each slice is short', async () => {
    const s = setup({}, { sliceMs: 1 }, { tickMs: 2 })
    const wall = new MeshStandardMaterial()
    for (let i = 0; i < 40; i++) s.scene.add(mesh(`extra-${i}`, wall))
    let framesBeforeCompile = -1
    s.run = new WarmupRun(s.gl, s.scene, s.camera, {
      scheduler: s.clock,
      sliceMs: 1,
      onUpdate: (x) => {
        if (x.phase === 'compiling' && framesBeforeCompile < 0) framesBeforeCompile = s.clock.frames
      },
    })
    await s.run.start()
    // every pass of 44 jobs takes several slices, each followed by a frame (the settle wait alone is about six frames)
    expect(s.clock.frames - framesBeforeCompile).toBeGreaterThan(6)
    expect(s.gl.calls.length).toBeGreaterThan(10)
  })

  it('waits for programs the driver is still compiling, and for compileAsync', async () => {
    const s = setup({ pendingChecks: 6 })
    const done = await s.run.start()
    expect(done.ready).toBe(true)
    expect(done.stats.readyMs).toBeGreaterThan(0)
  })

  it('stops waiting for programs that never become ready, and still reports ready (not failed)', async () => {
    const s = setup({ neverResolves: true, pendingChecks: 1e9 }, { readyWaitMs: 100 })
    const done = await s.run.start()
    expect(done.ready).toBe(true)
    expect(done.timedOut).toBe(false)
    expect(done.stats.readyMs).toBeGreaterThanOrEqual(100)
    expect(s.gl.initialised.length).toBeGreaterThan(0) // the textures still go up
  })

  it('reports ready once the overall limit passes, flagged as timed out', async () => {
    const s = setup({ neverResolves: true, pendingChecks: 1e9 }, { maxMs: 200, readyWaitMs: 1e9 })
    const done = await s.run.start()
    expect(done).toMatchObject({ ready: true, timedOut: true, phase: 'done', progress: 1 })
  })
})

describe('the warm-up run: the renderer is left exactly as it was', () => {
  it('reveals the hidden objects while compiling and puts the visibility back exactly', async () => {
    const s = setup()
    const before = visibilities(s.scene)
    expect(before).toMatchObject({ walk: false, overview: false, emotes: false, wall: true })
    await s.run.start()
    expect(s.gl.calls.length).toBeGreaterThan(0)
    for (const c of s.gl.calls) expect(c.visible).toMatchObject({ walk: true, overview: true, emotes: true, ceiling: true, labels: true })
    expect(visibilities(s.scene)).toEqual(before)
  })

  it('never reveals a light (it would change the light counts the programs are compiled for)', async () => {
    const s = setup()
    const light = s.scene.getObjectByName('lights')!
    light.visible = false
    const ambient = light.children[0]
    ambient.visible = false
    await s.run.start()
    for (const c of s.gl.calls) expect(c.visible.lights).toBe(false)
    expect(light.visible).toBe(false)
    expect(ambient.visible).toBe(false)
  })

  it('compiles against a half-float stand-in for the composer, then against the canvas, and puts the real target back', async () => {
    const s = setup()
    expect(s.gl.getRenderTarget()).toBeNull()
    await s.run.start()
    const composer = s.gl.calls.filter((c) => c.target !== null)
    const canvas = s.gl.calls.filter((c) => c.target === null)
    expect(composer.length).toBeGreaterThan(0)
    expect(canvas.length).toBe(composer.length)
    expect(composer[0].target!.texture.type).toBe(HalfFloatType)
    // composer first, canvas second
    const firstCanvas = s.gl.calls.findIndex((c) => c.target === null)
    let lastComposer = -1
    s.gl.calls.forEach((c, i) => {
      if (c.target !== null) lastComposer = i
    })
    expect(firstCanvas).toBeGreaterThan(lastComposer)
    expect(s.gl.getRenderTarget()).toBeNull()
  })

  it('restores a render target the caller had set', async () => {
    const s = setup()
    const mine = new WebGLRenderTarget(2, 2)
    s.gl.setRenderTarget(mine)
    await s.run.start()
    expect(s.gl.getRenderTarget()).toBe(mine)
  })

  it('can skip the canvas pass', async () => {
    const s = setup({}, { passes: ['composer'] })
    const done = await s.run.start()
    expect(s.gl.calls.every((c) => c.target !== null)).toBe(true)
    expect(done.stats.passes).toEqual(['composer'])
  })

  it('does not take any object out of the scene (batches are virtual groups)', async () => {
    const s = setup()
    const parents = new Map<string, unknown>()
    s.scene.traverse((o) => o.name && parents.set(o.name, o.parent))
    const children = s.scene.children.length
    await s.run.start()
    s.scene.traverse((o) => o.name && expect(o.parent, o.name).toBe(parents.get(o.name)))
    expect(s.scene.children).toHaveLength(children)
  })
})

describe('the warm-up run: without compileAsync (or KHR_parallel_shader_compile)', () => {
  it('falls back to compile and still finishes ready, with every material prepared', async () => {
    const s = setup({ async: false })
    const done = await s.run.start()
    expect(done.ready).toBe(true)
    expect(done.stats.usedCompileAsync).toBe(false)
    expect(s.gl.calls.length).toBeGreaterThan(0)
    expect(s.gl.calls.every((c) => c.fn === 'compile')).toBe(true)
    for (const m of [s.wall, s.ceiling, s.label, s.emote]) expect(s.gl.properties!.get(m).programs).toBeDefined()
  })

  it('uses compileAsync when it is there', async () => {
    const s = setup()
    const done = await s.run.start()
    expect(done.stats.usedCompileAsync).toBe(true)
    expect(s.gl.calls.every((c) => c.fn === 'compileAsync')).toBe(true)
  })
})

describe('the warm-up run: failure is recorded, never thrown', () => {
  it('a compile that throws is flagged, the visibility and the target are restored, and the textures still go up', async () => {
    const s = setup({ throws: true })
    const before = visibilities(s.scene)
    const done = await s.run.start()
    expect(done).toMatchObject({ ready: true, failed: true })
    expect(done.stats.failedJobs).toBeGreaterThan(0)
    expect(visibilities(s.scene)).toEqual(before)
    expect(s.gl.getRenderTarget()).toBeNull()
    expect(done.stats.textures).toBeGreaterThan(0)
  })

  it('a texture that will not upload does not stop the others', async () => {
    const s = setup({ initThrowsAt: 1 })
    const done = await s.run.start()
    expect(done.ready).toBe(true)
    expect(s.gl.initialised).toHaveLength(4)
  })

  it('can be cancelled in the middle of the compile: it reports nothing as ready and leaves the scene as it found it', async () => {
    const s = setup({}, { sliceMs: 1 }, { tickMs: 2 })
    for (let i = 0; i < 40; i++) s.scene.add(mesh(`extra-${i}`, s.wall))
    const before = visibilities(s.scene)
    const frame = s.clock.frame
    s.clock.frame = async () => {
      await frame()
      if (s.run.snapshot.phase === 'compiling') s.run.cancel()
    }
    const done = await s.run.start()
    expect(done).toMatchObject({ cancelled: true, ready: false })
    expect(s.gl.calls.length).toBeGreaterThan(0)
    expect(s.gl.calls.length).toBeLessThan(40)
    expect(visibilities(s.scene)).toEqual(before)
    expect(s.gl.getRenderTarget()).toBeNull()
  })
})

describe('the warm-up run: extras and the plan', () => {
  it('compiles registered materials that no mesh holds through hidden keepers that never enter the scene', async () => {
    const orphan = new MeshStandardMaterial({ name: 'orphan', map: canvasLike() })
    const s = setup({}, { extras: () => ({ materials: [orphan], textures: [] }) })
    const children = s.scene.children.length
    const done = await s.run.start()
    expect(done.stats.keepers).toBe(1)
    expect(s.gl.properties!.get(orphan).programs).toBeDefined()
    expect(s.scene.children).toHaveLength(children)
    expect(s.gl.initialised).toContain(orphan.map)
  })

  it('does not make a keeper for an extra material the scene already holds', async () => {
    const holder: { wall?: Material } = {}
    const s = setup({}, { extras: () => ({ materials: [holder.wall!], textures: [] }) })
    holder.wall = s.wall
    const done = await s.run.start()
    expect(done.stats.keepers).toBe(0)
  })

  it('finds textures that only exist in the uniforms the renderer built (a patched standard material), and registered extra textures', async () => {
    const pose = new DataTexture(new Float32Array(4), 1, 1)
    pose.needsUpdate = true
    const extra = canvasLike()
    const s = setup({}, { extras: () => ({ materials: [], textures: [extra] }) })
    s.gl.properties!.get(s.wall).uniforms = { uPose: { value: pose } }
    await s.run.start()
    expect(s.gl.initialised).toContain(pose)
    expect(s.gl.initialised).toContain(extra)
  })

  it('compiles the whole scene as one job, with no target scene, when an object has a light inside it', async () => {
    const s = setup()
    const holder = s.scene.getObjectByName('wall')!
    holder.add(new AmbientLight())
    await s.run.start()
    expect(s.gl.calls.length).toBeGreaterThan(0)
    for (const c of s.gl.calls) {
      expect(c.roots).toEqual(['scene'])
      expect(c.targetScene).toBeNull()
    }
  })

  it('compiles per object, against the real scene, so the lights are counted once', async () => {
    const s = setup()
    await s.run.start()
    for (const c of s.gl.calls) expect(c.targetScene).toBe(s.scene)
  })
})

describe('the settle wait', () => {
  it('waits for the environment map, then goes on once the scene has stopped growing', async () => {
    const s = setup()
    s.scene.environment = null
    // the environment shows up a few frames in, like <Lighting />'s effect
    const frame = s.clock.frame
    s.clock.frame = async () => {
      await frame()
      if (s.clock.frames === 10) s.scene.environment = envTexture()
    }
    let framesAtCompile = -1
    s.run = new WarmupRun(s.gl, s.scene, s.camera, {
      scheduler: s.clock,
      onUpdate: (x) => {
        if (x.phase === 'compiling' && framesAtCompile < 0) framesAtCompile = s.clock.frames
      },
    })
    const done = await s.run.start()
    expect(done.ready).toBe(true)
    // it did not start compiling before the environment existed
    expect(framesAtCompile).toBeGreaterThanOrEqual(10)
  })

  it('gives up waiting for the environment after its limit and goes on', async () => {
    const s = setup({}, { settle: { maxMs: 100 } })
    s.scene.environment = null
    const done = await s.run.start()
    expect(done.ready).toBe(true)
    expect(done.stats.settleMs).toBeGreaterThanOrEqual(100)
  })

  it('holds while a warm gate is open (people loading, a bake), then goes on; a gate that never closes gives up at its own limit', async () => {
    let open = 1
    const s = setup({}, { gatesPending: () => open })
    const frame = s.clock.frame
    s.clock.frame = async () => {
      await frame()
      if (s.clock.frames === 40) open = 0 // well past the usual six-frame settle
    }
    let framesAtCompile = -1
    s.run = new WarmupRun(s.gl, s.scene, s.camera, {
      scheduler: s.clock,
      gatesPending: () => open,
      onUpdate: (x) => {
        if (x.phase === 'compiling' && framesAtCompile < 0) framesAtCompile = s.clock.frames
      },
    })
    const done = await s.run.start()
    expect(done.ready).toBe(true)
    expect(framesAtCompile).toBeGreaterThanOrEqual(40)

    // never closes: the wait passes the normal 3 s limit and stops at the gate limit
    const stuck = setup({}, { gatesPending: () => 1, settle: { maxMs: 100, gateMaxMs: 500 } })
    const late = await stuck.run.start()
    expect(late.ready).toBe(true)
    expect(late.stats.settleMs).toBeGreaterThanOrEqual(500)
    expect(late.stats.settleMs).toBeLessThan(600)
  })

  it('does not wait for the environment when it is not required', async () => {
    const s = setup({}, { settle: { requireEnvironment: false, maxMs: 100000 } })
    s.scene.environment = null
    const done = await s.run.start()
    expect(done.stats.settleMs).toBeLessThan(1000)
  })
})

describe('nextBatch', () => {
  it('grows (at most twofold) when the last batch was cheap and shrinks when it was slow, within 1..48', () => {
    expect(nextBatch(8, 0, 8)).toBe(16)
    expect(nextBatch(40, 0, 8)).toBe(48)
    expect(nextBatch(8, 8, 8)).toBe(8)
    expect(nextBatch(8, 32, 8)).toBe(2)
    expect(nextBatch(1, 1e6, 8)).toBe(1)
  })
})
