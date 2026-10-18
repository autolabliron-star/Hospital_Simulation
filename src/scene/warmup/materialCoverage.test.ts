/**
 * The proof that the warm-up is complete, in node: a NEW material that the warm-up would not reach fails here.
 *
 *   1. source scan   every place in src/ that builds a material is listed in manifest.ts with the way the warm-up reaches it. A new `new XxxMaterial(`,
 *                    a new R3F `<meshXxxMaterial>` or a new `.clone()` of a material that is not listed fails, with the file named.
 *   2. enumeration   every material the scene modules actually build is recorded as it is constructed (a hook on `Material`), the modules that
 *                    return their whole scene graph are built the way their layers mount them, the real warm-up runs over that scene against a
 *                    fake renderer, and every recorded material must have been given a program. A material created but not reachable (nothing
 *                    holds it, nothing registers it) is named. A material created AFTER the warm-up, while a simulated minute plays, fails too:
 *                    that one would compile for the first time in front of the audience.
 *
 * The negative controls at the end prove neither check is vacuous.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Material, Mesh, MeshStandardMaterial, BoxGeometry, PerspectiveCamera, Scene } from 'three'
import { createRecorder, mockSurface } from '@/scene/imaging/images/mockCanvas'
import { collectMaterials } from './collect'
import { MATERIAL_SITES, materialSitesIn, stripComments } from './manifest'
import { clearWarmSources, warmExtras } from './registry'
import { WarmupRun } from './run'
import { fakeGl, manualClock, type FakeGl } from './testkit'

const ROOT = process.cwd()

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) sources(p, out)
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(p)
  }
  return out
}

describe('the source scan (manifest.ts)', () => {
  it('counts constructor calls, R3F elements and clones, and ignores comments', () => {
    expect(materialSitesIn('const m = new MeshBasicMaterial({})')).toBe(1)
    expect(materialSitesIn('const m = new ShaderMaterial({ a: 1 })\nconst n = new MeshStandardMaterial()')).toBe(2)
    expect(materialSitesIn('<meshBasicMaterial color="#fff" />')).toBe(1)
    expect(materialSitesIn('const r = fadeMaterial(MAT.tintedGlow.clone(), "x")')).toBe(1)
    expect(materialSitesIn('const r = bodyMaterial.clone()')).toBe(1)
    expect(materialSitesIn('// new MeshBasicMaterial() in a comment\n/* new ShaderMaterial() */\nconst x = 1')).toBe(0)
    expect(materialSitesIn(" * (never `new MeshStandardMaterial` per mesh)")).toBe(0)
    expect(materialSitesIn('const geo = new BoxGeometry(); geo.clone()')).toBe(0)
    expect(stripComments("const u = 'http://example.com' // trailing")).toContain('http://example.com')
  })

  it('lists exactly the places in src/ that build a material, so a new one cannot escape the warm-up unseen', () => {
    const found: Record<string, number> = {}
    for (const file of sources(join(ROOT, 'src'))) {
      const n = materialSitesIn(readFileSync(file, 'utf8'))
      if (n > 0) found[relative(ROOT, file)] = n
    }
    const unlisted = Object.keys(found).filter((f) => !(f in MATERIAL_SITES))
    const stale = Object.keys(MATERIAL_SITES).filter((f) => !(f in found))
    const changed = Object.keys(found)
      .filter((f) => f in MATERIAL_SITES && MATERIAL_SITES[f].count !== found[f])
      .map((f) => `${f}: manifest says ${MATERIAL_SITES[f].count}, source has ${found[f]}`)
    const how =
      ' Make sure the material sits on a mesh that is mounted at load (the warm-up walks the whole scene, hidden groups included) or register it with registerWarmSource, then update MATERIAL_SITES in src/scene/warmup/manifest.ts.'
    expect(unlisted, `material built in a file the manifest does not list.${how}`).toEqual([])
    expect(changed, `the number of material construction sites changed.${how}`).toEqual([])
    expect(stale, 'the manifest lists a file that no longer builds a material: remove the entry').toEqual([])
  })

  it('gives every entry a reason', () => {
    for (const [file, site] of Object.entries(MATERIAL_SITES)) {
      expect(site.count, file).toBeGreaterThan(0)
      expect(site.where.length, file).toBeGreaterThan(10)
      expect(['palette', 'mounted', 'offline'], file).toContain(site.via)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// The enumeration
// ---------------------------------------------------------------------------------------------

/** Every Material is recorded the moment it is constructed (the constructor assigns `uuid` once, so a setter on the prototype sees each one). */
const created: Material[] = []
function installMaterialHook(): () => void {
  const proto = Material.prototype as unknown as Record<string, unknown>
  Object.defineProperty(proto, 'uuid', {
    configurable: true,
    get: () => undefined,
    set(this: Material, value: string) {
      Object.defineProperty(this, 'uuid', { value, writable: true, configurable: true, enumerable: true })
      created.push(this)
    },
  })
  return () => {
    delete proto.uuid
  }
}

/** The modules draw their textures on `document.createElement('canvas')`: a recording stand-in is enough, nothing is rasterised here. */
function installDom(): () => void {
  const rec = createRecorder()
  const canvas = (): unknown => {
    const surface = mockSurface(256, 256, rec)
    return Object.assign(surface.canvas, { style: {}, getContext: () => surface.ctx })
  }
  const g = globalThis as unknown as { document?: unknown }
  const before = g.document
  g.document = { createElement: (tag: string) => (tag === 'canvas' ? canvas() : { style: {} }) }
  return () => {
    if (before === undefined) delete g.document
    else g.document = before
  }
}

interface Assembled {
  scene: Scene
  gl: FakeGl
  /** The materials built before the warm-up. */
  built: Material[]
  /** Materials built while the day played after it. */
  late: Material[]
  names: Map<Material, string>
  palette: readonly Material[]
}

const undo: (() => void)[] = []
let world: Assembled

/** The materials with no program in the fake renderer. */
function withoutProgram(gl: FakeGl, list: readonly Material[]): Material[] {
  return list.filter((m) => !((gl.properties!.get(m).programs as Map<unknown, unknown> | undefined)?.size ?? 0))
}

beforeAll(async () => {
  undo.push(installDom(), installMaterialHook())
  clearWarmSources()
  // import AFTER the hook: module-level materials (the palette, the machines') are recorded as they are built
  const { MAT, ALL_MATERIALS } = await import('@/scene/materials')
  const { registerDefaultWarmSources } = await import('./sources')
  const { getLayout } = await import('@/scene/building/layout')
  const { createCrowdRig, driveCrowd } = await import('@/scene/actors/crowd/crowdRig')
  const { createMealBotsRig } = await import('@/scene/meals/botsRig')
  const { createTraysRig } = await import('@/scene/meals/traysRig')
  const { createWardRig } = await import('@/scene/meals/ward/wardRig')
  const { lifeOf } = await import('@/scene/meals/life')
  const { createRig, updateRig } = await import('@/scene/imaging/machines/rig')
  const { monitorMaterial } = await import('@/scene/imaging/machines/machineMaterials')
  const { Simulation } = await import('@/sim/Simulation')

  // what the layers mount, built by the very functions the layers call
  const scene = new Scene()
  const crowd = createCrowdRig()
  for (const o of crowd.objects) scene.add(o)
  const bots = createMealBotsRig()
  const trays = createTraysRig()
  const ward = createWardRig()
  const machines = createRig(getLayout().consoleScreens, monitorMaterial)
  scene.add(bots.group, trays.group, ward.group, machines.root)
  // the building is merged meshes of palette materials: one stand-in mesh per palette key the layout uses
  const used = new Set(getLayout().prims.map((p) => p.mat))
  for (const key of used) {
    const m = new Mesh(new BoxGeometry(), MAT[key])
    m.name = `building:${key}`
    scene.add(m)
  }

  const offSources = registerDefaultWarmSources()
  undo.push(offSources)
  const gl = fakeGl(scene)
  const run = new WarmupRun(gl, scene, new PerspectiveCamera(), { scheduler: manualClock(), extras: warmExtras, settle: { requireEnvironment: false } })
  const built = created.slice()
  const done = await run.start()
  expect(done.ready).toBe(true)

  // play: a simulated minute with every rig stepping, the way the frame loop does it
  const sim = new Simulation(7, { population: false })
  const life = lifeOf(sim)
  for (let k = 0; k < 60 * 60; k++) {
    sim.step(1 / 60)
    sim.sync(0.5)
    const t = k / 60
    driveCrowd(crowd, sim.entities, 60, 40, 40, 1 / 60, t)
    ward.step({ life, generation: 0, simDt: 1 / 60, now: t })
    bots.step(life, 1 / 60, t)
    trays.step(life, 1 / 60)
    updateRig(machines, sim.imaging.scanners, 1 / 60, t)
  }

  const names = new Map<Material, string>()
  for (const m of created) names.set(m, `${m.name || m.type}#${m.uuid.slice(0, 8)}`)
  world = { scene, gl, built, late: created.slice(built.length), names, palette: ALL_MATERIALS }
}, 120000)

afterAll(() => {
  for (const off of undo.reverse()) off()
  clearWarmSources()
})

describe('every material the scene modules build', () => {
  it('is recorded as it is constructed (the palette, the crowd, the MealBots, the trays, the ward, the machines)', () => {
    // the palette's thirty-odd plus the crowd's seven, the MealBot's three, the machines' six, ...: the hook sees a lot, or it is not working
    expect(world.palette.length).toBeGreaterThan(25)
    for (const m of world.palette) expect(world.built, 'the palette is built while the hook is on').toContain(m)
    expect(world.built.length).toBeGreaterThanOrEqual(world.palette.length + 15)
  })

  it('gets a program from the warm-up: reachable through the mounted scene or registered as an extra', () => {
    const unreached = withoutProgram(world.gl, world.built).map((m) => world.names.get(m))
    expect(unreached, 'built by a scene module, but neither on a mesh of the mounted scene nor registered with registerWarmSource').toEqual([])
  })

  it('is warmed once and never again: nothing builds a new material while the day plays', () => {
    expect(
      world.late.map((m) => world.names.get(m)),
      'a material was created after the warm-up (it would compile for the first time during the demo): build it at mount',
    ).toEqual([])
  })

  it('has a mounted-scene material for the mounted parts, hidden ones included (the crowd ring, the MealBot keepers)', () => {
    const inScene = new Set(collectMaterials(world.scene))
    const crowdBodies = [...inScene].filter((m) => (m as MeshStandardMaterial).customProgramCacheKey?.().startsWith('hospital-crowd-body'))
    expect(crowdBodies).toHaveLength(3)
    const hidden: string[] = []
    world.scene.traverse((o) => {
      if (!o.visible && (o as Mesh).isMesh) hidden.push(o.name)
    })
    expect(hidden).toContain('crowd-ring')
  })

  it('shows up as unwarmed when nothing holds it (negative control: a stray material is caught)', () => {
    const stray = new MeshStandardMaterial({ name: 'stray' })
    const missing = withoutProgram(world.gl, [...world.built, stray])
    expect(missing).toEqual([stray])
    expect(created.at(-1)).toBe(stray) // and the hook saw it, so a late material would be reported too
  })
})
