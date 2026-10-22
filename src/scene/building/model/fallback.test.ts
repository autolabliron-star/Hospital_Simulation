/**
 * F-45 / F-46: `?building=model` must never leave the lobby without walls, and must not compile the model on the first lobby frame.
 * The pilot's prims live in their own cell meshes (./region.ts, ./cells.ts): drawn until the pilot is, kept when it fails.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture, type WebGLRenderer } from 'three'
import { compileLayout } from '../render/compile'
import { bindCellsUnder, cellOfName, resetCells, setCellReplaced } from './cells'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { clearWarmGates, clearWarmSources, warmGatesPending, warmSourceNames } from '@/scene/warmup/registry'
import { buildLayout } from '../layout'
import { lightmapNameOf } from './lightmaps'
import { ensurePilotModel, loadPilotModel, notifyModelCommitted, resetPilotModelForTests, type PilotLoaders } from './loader'
import { getModelStatus, resetModelStatus } from './modelStatus'
import { PILOT_CELL, hidesPrim, hidesWalkPart, pilotCoverage, primCell, setCoverage, walkPartCell } from './region'

const DIR = join(process.cwd(), 'public/assets/building')
const GLB = join(DIR, 'pilot-lobby.glb')

const renderer = { localClippingEnabled: false } as unknown as WebGLRenderer

/** A stand-in model with two lightmapped meshes. */
function fakeScene(files: string[]): Group {
  const root = new Group()
  for (const f of files) {
    const m = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial())
    m.userData.lightmap = f
    root.add(m)
  }
  return root
}

function fakeLoaders(opts: { scene?: Group | Error; failLightmaps?: string[]; hang?: boolean }): PilotLoaders & { disposed: () => number } {
  let disposed = 0
  return {
    gltf: {
      loadAsync: () => {
        if (opts.hang) return new Promise(() => undefined)
        if (opts.scene instanceof Error) return Promise.reject(opts.scene)
        return Promise.resolve({ scene: opts.scene ?? fakeScene(['a.ktx2', 'b.ktx2']) })
      },
    },
    ktx2: {
      loadAsync: (url: string) =>
        opts.failLightmaps?.some((f) => url.endsWith(f)) ? Promise.reject(new Error(`cannot transcode ${url}`)) : Promise.resolve(new Texture()),
      dispose: () => {
        disposed++
      },
    },
    disposed: () => disposed,
  }
}

describe('the authored pilot-lobby.glb names only lightmaps that exist', () => {
  const present = existsSync(GLB)
  it.skipIf(!present)('every lightmap file named in the glb is in public/assets/building', async () => {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    loader.register(() => ({ name: 'KHR_texture_basisu', loadTexture: () => Promise.resolve(new Texture()) }))
    const buf = readFileSync(GLB)
    const gltf = await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '')
    const named = new Set<string>()
    gltf.scene.traverse((o) => {
      const f = lightmapNameOf(o)
      if (f) named.add(f)
    })
    expect(named.size).toBeGreaterThan(0)
    const missing = [...named].filter((f) => !existsSync(join(DIR, f)))
    expect(missing).toEqual([])
  })
})

describe('loadPilotModel fails instead of drawing a broken lobby', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined))
  afterEach(() => vi.restoreAllMocks())

  it('loads a good model', async () => {
    const l = fakeLoaders({})
    const m = await loadPilotModel(renderer, '/', { loaders: l })
    expect(m.scene.name).toBe('building-model')
    expect(l.disposed()).toBe(1)
  })
  it('rejects a missing or corrupt glb', async () => {
    const l = fakeLoaders({ scene: new Error('404') })
    await expect(loadPilotModel(renderer, '/', { loaders: l })).rejects.toThrow('404')
    expect(l.disposed()).toBe(1) // the transcoder workers are released on failure too
  })
  it('rejects when one lightmap is missing or does not transcode (a baked surface without its lightmap would be black)', async () => {
    const l = fakeLoaders({ failLightmaps: ['b.ktx2'] })
    await expect(loadPilotModel(renderer, '/', { loaders: l })).rejects.toThrow(/b\.ktx2/)
    expect(l.disposed()).toBe(1)
  })
  it('rejects a glb with no meshes', async () => {
    await expect(loadPilotModel(renderer, '/', { loaders: fakeLoaders({ scene: new Group() }) })).rejects.toThrow(/no meshes/)
  })
  it('rejects on a load timeout', async () => {
    await expect(loadPilotModel(renderer, '/', { loaders: fakeLoaders({ hang: true }), timeoutMs: 20 })).rejects.toThrow(/timed out/)
  })
})

describe('the warm-up gate waits for the commit (F-46)', () => {
  beforeEach(() => {
    clearWarmGates()
    clearWarmSources()
    resetPilotModelForTests()
    resetModelStatus()
  })
  it('stays open after the load until the model is mounted', async () => {
    const m = await ensurePilotModel(renderer, '/', { loaders: fakeLoaders({}) })
    expect(m).not.toBeNull()
    expect(getModelStatus()).toBe('ready')
    await Promise.resolve()
    await Promise.resolve()
    expect(warmGatesPending()).toBe(1)
    expect(warmSourceNames()).toContain('building-model')
    notifyModelCommitted()
    await Promise.resolve()
    await Promise.resolve()
    expect(warmGatesPending()).toBe(0)
  })
})

describe('a failed model leaves the procedural region visible (F-45)', () => {
  const layout = buildLayout()
  const lobbyFloor = layout.prims.find((p) => p.shape === 'plane' && p.position[1] <= 0.01 && Math.hypot(p.position[0] + 53, p.position[2]) <= 0.01)

  beforeEach(() => {
    clearWarmGates()
    clearWarmSources()
    resetPilotModelForTests()
    resetModelStatus()
    resetCells()
    setCoverage(pilotCoverage())
  })
  afterEach(() => {
    setCoverage(null)
    resetCells()
  })

  it('compiles the pilot region into its own cell meshes, drawn until the pilot is, and kept drawn when it fails, with one warning', async () => {
    expect(lobbyFloor).toBeDefined()
    expect(primCell(lobbyFloor!.mat, lobbyFloor!.position[0], lobbyFloor!.position[2])).toBe(PILOT_CELL)
    const compiled = compileLayout(layout, 1, (p) => primCell(p.mat, p.position[0], p.position[2]))
    const cellMeshes = compiled.merged.filter((m) => cellOfName(m.key) === PILOT_CELL).map((m) => new Mesh(m.geometry))
    expect(cellMeshes.length).toBeGreaterThan(3)
    const root = new Group()
    root.add(...cellMeshes.map((m, i) => Object.assign(m, { name: compiled.merged.filter((x) => cellOfName(x.key) === PILOT_CELL)[i].key })))
    bindCellsUnder(root)
    // while the model loads, the procedural lobby is drawn (no hole behind the loading screen or after it)
    expect(cellMeshes.every((m) => m.visible)).toBe(true)
    expect(hidesPrim(lobbyFloor!.mat, lobbyFloor!.position[0], lobbyFloor!.position[2])).toBe(false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const seen: string[] = []
    const { subscribeModelStatus } = await import('./modelStatus')
    subscribeModelStatus(() => seen.push(getModelStatus()))
    const m = await ensurePilotModel(renderer, '/', { loaders: fakeLoaders({ failLightmaps: ['a.ktx2'] }) })
    expect(m).toBeNull()
    expect(getModelStatus()).toBe('failed')
    expect(seen).toContain('failed')
    expect(cellMeshes.every((x) => x.visible)).toBe(true)
    // walk mode too: the lobby keeps its procedural ceilings and upper walls
    expect(walkPartCell('ceiling', -53, 0)).toBe(PILOT_CELL)
    expect(hidesWalkPart('ceiling', -53, 0)).toBe(false)
    expect(hidesWalkPart('wall', -62, 3)).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    // a second ask does not retry or warn again
    expect(await ensurePilotModel(renderer, '/', { loaders: fakeLoaders({}) })).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
    // the gate closes after the commit notice even though there is no model
    notifyModelCommitted()
    await Promise.resolve()
    await Promise.resolve()
    expect(warmGatesPending()).toBe(0)
  })

  it('hides the cell in one call once the pilot is drawn, and shows it again if the pilot goes', () => {
    const compiled = compileLayout(layout, 1, (p) => primCell(p.mat, p.position[0], p.position[2]))
    const root = new Group()
    for (const mm of compiled.merged) root.add(Object.assign(new Mesh(mm.geometry), { name: mm.key }))
    bindCellsUnder(root)
    const cell = root.children.filter((o) => cellOfName(o.name) === PILOT_CELL)
    const rest = root.children.filter((o) => cellOfName(o.name) === null)
    setCellReplaced(PILOT_CELL, true)
    expect(cell.every((o) => !o.visible)).toBe(true)
    expect(rest.every((o) => o.visible)).toBe(true)
    expect(hidesWalkPart('ceiling', -53, 0)).toBe(true)
    setCellReplaced(PILOT_CELL, false)
    expect(cell.every((o) => o.visible)).toBe(true)
  })
})
