import { beforeEach, describe, expect, it } from 'vitest'
import { Mesh, MeshStandardMaterial, BoxGeometry, PerspectiveCamera, Scene } from 'three'
import { PUBLISH_INTERVAL_MS, WarmupPublisher, type WarmupPublish } from './publisher'
import { createWarmProbe, installWarmProbe } from './probe'
import { clearWarmSources, registerWarmSource, warmExtras, warmSourceNames } from './registry'
import { WarmupRun, type WarmupSnapshot } from './run'
import { fakeGl, manualClock } from './testkit'
import { resetWarmup, useWarmup } from './warmup.store'

const snap = (over: Partial<WarmupSnapshot> = {}): WarmupSnapshot => ({
  phase: 'compiling',
  progress: 0.3,
  ready: false,
  failed: false,
  timedOut: false,
  cancelled: false,
  stats: {} as WarmupSnapshot['stats'],
  ...over,
})

describe('the publisher (about 4 Hz, never per slice)', () => {
  it('lets a change of phase and the end through at once, and holds the rest back until the interval has passed', () => {
    let t = 0
    const out: WarmupPublish[] = []
    const p = new WarmupPublisher((s) => out.push(s), () => t)
    expect(p.push(snap({ phase: 'settling', progress: 0.01 }))).toBe(true)
    t += 10
    expect(p.push(snap({ phase: 'settling', progress: 0.02 }))).toBe(false)
    t += 10
    expect(p.push(snap({ phase: 'compiling', progress: 0.1 }))).toBe(true) // new phase
    t += 100
    expect(p.push(snap({ progress: 0.2 }))).toBe(false)
    t += PUBLISH_INTERVAL_MS
    expect(p.push(snap({ progress: 0.3 }))).toBe(true) // interval passed
    t += 1
    expect(p.push(snap({ phase: 'done', progress: 1, ready: true }))).toBe(true) // the end is never held back
    expect(out.map((s) => s.progress)).toEqual([0.01, 0.1, 0.3, 1])
  })

  it('publishes at most about 4 times a second under a flood of updates', () => {
    let t = 0
    let n = 0
    const p = new WarmupPublisher(() => n++, () => t)
    for (t = 0; t < 2000; t += 5) p.push(snap())
    expect(n).toBeLessThanOrEqual(1 + Math.ceil(2000 / PUBLISH_INTERVAL_MS))
    expect(PUBLISH_INTERVAL_MS).toBeGreaterThanOrEqual(250)
  })
})

describe('the warm-up store', () => {
  beforeEach(resetWarmup)

  it('starts not ready and not entered', () => {
    expect(useWarmup.getState()).toMatchObject({ ready: false, entered: false, progress: 0, phase: 'idle' })
  })

  it('never goes backwards: progress, ready and the failure flags only grow', () => {
    const s = useWarmup.getState()
    s.publish({ phase: 'compiling', progress: 0.6, ready: false, failed: true, timedOut: false })
    s.publish({ phase: 'compiling', progress: 0.4, ready: false, failed: false, timedOut: false })
    expect(useWarmup.getState()).toMatchObject({ progress: 0.6, failed: true })
    s.publish({ phase: 'done', progress: 1, ready: true, failed: false, timedOut: false })
    s.publish({ phase: 'textures', progress: 0.9, ready: false, failed: false, timedOut: false })
    expect(useWarmup.getState()).toMatchObject({ ready: true, progress: 1 })
  })

  it('enter is idempotent, and the watchdog makes it ready (timed out) only if it was not already', () => {
    const s = useWarmup.getState()
    s.giveUp()
    expect(useWarmup.getState()).toMatchObject({ ready: true, timedOut: true, progress: 1 })
    resetWarmup()
    s.publish({ phase: 'done', progress: 1, ready: true, failed: false, timedOut: false })
    s.giveUp()
    expect(useWarmup.getState().timedOut).toBe(false)
    s.enter()
    s.enter()
    expect(useWarmup.getState().entered).toBe(true)
  })
})

describe('the registry of extras', () => {
  beforeEach(clearWarmSources)

  it('collects registered materials and textures once each, and removes a source when asked', () => {
    const m = new MeshStandardMaterial()
    const off = registerWarmSource({ name: 'a', materials: () => [m] })
    registerWarmSource({ name: 'b', materials: () => [m] })
    expect(warmSourceNames()).toEqual(['a', 'b'])
    expect(warmExtras().materials).toEqual([m])
    off()
    expect(warmSourceNames()).toEqual(['b'])
  })

  it('replaces a source of the same name, and a stale remover does not remove the replacement', () => {
    const first = new MeshStandardMaterial()
    const second = new MeshStandardMaterial()
    const offFirst = registerWarmSource({ name: 'x', materials: () => [first] })
    registerWarmSource({ name: 'x', materials: () => [second] })
    offFirst()
    expect(warmExtras().materials).toEqual([second])
  })

  it('skips a source that throws and keeps the others', () => {
    const m = new MeshStandardMaterial()
    registerWarmSource({
      name: 'broken',
      materials: () => {
        throw new Error('boom')
      },
    })
    registerWarmSource({ name: 'ok', materials: () => [m] })
    expect(warmExtras().materials).toEqual([m])
  })
})

describe('the ?probe=1 helpers', () => {
  it('report programs(), missing() and state() from the renderer, and take themselves off the window', async () => {
    clearWarmSources()
    const scene = new Scene()
    const built = new MeshStandardMaterial({ name: 'built' })
    const never = new MeshStandardMaterial({ name: 'never' })
    scene.add(new Mesh(new BoxGeometry(), built))
    const gl = fakeGl(scene)
    const camera = new PerspectiveCamera()
    const run = new WarmupRun(gl, scene, camera, { scheduler: manualClock(), settle: { requireEnvironment: false } })
    const orphan = new MeshStandardMaterial({ name: 'orphan' })
    const probe = createWarmProbe(gl, scene, run, () => ({ materials: [orphan], textures: [] }))
    // before the warm-up: nothing is compiled
    expect(probe.programs()).toBe(0)
    expect(probe.missing()).toHaveLength(2)
    expect(probe.materials()).toBe(1)
    await run.start()
    expect(probe.programs()).toBe(2) // composer + canvas of the one material
    // the scene's material is built; the orphan was not part of this run (no extras were given to it)
    expect(probe.missing()).toHaveLength(1)
    expect(probe.missing()[0]).toMatch(/^extra:orphan#/)
    expect(probe.state().ready).toBe(true)
    // a new mesh appearing later (a first-use compile waiting to happen) shows up as missing
    const late = new Mesh(new BoxGeometry(), never)
    late.name = 'late'
    scene.add(late)
    expect(probe.missing().some((n) => n.startsWith('late:never#'))).toBe(true)

    const target: Record<string, unknown> = {}
    const off = installWarmProbe(target, probe)
    expect(target.__hospitalWarm).toBe(probe)
    off()
    expect('__hospitalWarm' in target).toBe(false)
  })
})
