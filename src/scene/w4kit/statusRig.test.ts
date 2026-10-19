/**
 * The W4 status atlas in node: hidden until registered, repainted only when a version moves, uploaded at most 2 Hz, snapped by a Jump, one draw
 * call, and it shares the bedside material's program key. A recording double stands in for the canvas.
 */
import { describe, expect, it } from 'vitest'
import { Matrix4 } from 'three'
import { createBedsideMaterial } from '@/scene/meals/ward/wardParts'
import { W4_TILE, W4_TILE_COUNT, type W4Tile } from './tiles'
import { createStatusRig, STATUS_CHECK, STATUS_UPLOAD, type StatusAtlas } from './statusRig'
import { paintBackground, paintBar, paintChip, paintStat, paintText, paintTitle } from './tilePaint'

function fakeAtlas() {
  const painted: { i: number; blank: boolean }[] = []
  const texture = { needsUpdate: false, uploads: 0, dispose() {} }
  let flag = false
  Object.defineProperty(texture, 'needsUpdate', {
    get: () => flag,
    set: (v: boolean) => {
      flag = v
      if (v) texture.uploads++
    },
  })
  const atlas: StatusAtlas = { texture, paint: (i, p) => void painted.push({ i, blank: p === null }) }
  return { atlas, painted, texture }
}

function tile(over: Partial<W4Tile> & { v?: { n: number } } = {}): W4Tile & { v: { n: number }; paints: number } {
  const v = over.v ?? { n: 1 }
  const t = {
    anchor: { at: { x: -28.1, y: 1.3, z: 16.4 }, heading: 0, w: 0.4, h: 0.25 },
    version: () => v.n,
    paint: () => {
      t.paints++
    },
    v,
    paints: 0,
    ...over,
  }
  return t as W4Tile & { v: { n: number }; paints: number }
}

const matrixOf = (m: { getMatrixAt(i: number, m: Matrix4): void }, i: number): Matrix4 => {
  const out = new Matrix4()
  m.getMatrixAt(i, out)
  return out
}

describe('the status screens rig', () => {
  it('is one instanced mesh of 16 quads, all hidden until a tile registers', () => {
    const { atlas } = fakeAtlas()
    const reg = new Map<number, W4Tile>()
    const rig = createStatusRig({ atlas, tiles: () => reg })
    expect(rig.mesh.count).toBe(W4_TILE_COUNT)
    rig.step({ generation: 0, now: 0 })
    expect(rig.shown()).toEqual([])
    for (let i = 0; i < W4_TILE_COUNT; i++) expect(matrixOf(rig.mesh, i).determinant()).toBe(0)
    rig.dispose()
  })

  it('places a registered tile at its anchor (heading, size, tilt) and paints it once', () => {
    const { atlas, painted } = fakeAtlas()
    const reg = new Map<number, W4Tile>()
    const t = tile({ anchor: { at: { x: -30.9, y: 1.55, z: 18.35 }, heading: Math.PI / 2, w: 0.5, h: 0.31, tilt: 0.2 } })
    reg.set(W4_TILE.centrifuge, t)
    const rig = createStatusRig({ atlas, tiles: () => reg })
    rig.step({ generation: 0, now: 0 })
    expect(rig.shown()).toEqual([W4_TILE.centrifuge])
    const m = matrixOf(rig.mesh, W4_TILE.centrifuge)
    expect(m.elements[12]).toBeCloseTo(-30.9, 5)
    expect(m.elements[13]).toBeCloseTo(1.55, 5)
    expect(m.elements[14]).toBeCloseTo(18.35, 5)
    // facing +x: the quad's normal (its local +z) points along +x (tilted up a little)
    const nx = m.elements[8]
    const nz = m.elements[10]
    expect(nx).toBeGreaterThan(0.4)
    expect(Math.abs(nz)).toBeLessThan(1e-6)
    expect(painted).toEqual([{ i: W4_TILE.centrifuge, blank: false }])
    expect(t.paints).toBe(0) // the (fake) atlas decides when to call the painter
    rig.dispose()
  })

  it('repaints only the tiles whose version changed, and only at the 4 Hz check', () => {
    const { atlas, painted } = fakeAtlas()
    const a = tile()
    const b = tile()
    const reg = new Map<number, W4Tile>([
      [W4_TILE.labStatus, a],
      [W4_TILE.archive, b],
    ])
    const rig = createStatusRig({ atlas, tiles: () => reg })
    rig.step({ generation: 0, now: 0 })
    expect(painted.length).toBe(2)
    // a quiet second: no repaint at all, however many frames
    for (let f = 1; f <= 60; f++) rig.step({ generation: 0, now: f / 60 })
    expect(painted.length).toBe(2)
    // one tile changes between two checks: only that one repaints, at the next check
    a.v.n = 2
    rig.step({ generation: 0, now: 1 + STATUS_CHECK / 2 })
    expect(painted.length).toBe(2)
    rig.step({ generation: 0, now: 1 + STATUS_CHECK + 0.01 })
    expect(painted.slice(2)).toEqual([{ i: W4_TILE.labStatus, blank: false }])
    expect(rig.stats.paints).toBe(3)
    rig.dispose()
  })

  it('checks the registry at 4 Hz, not per frame', () => {
    const { atlas } = fakeAtlas()
    const rig = createStatusRig({ atlas, tiles: () => new Map() })
    for (let f = 0; f < 240; f++) rig.step({ generation: 0, now: f / 60 })
    // 4 seconds of frames: about 16 checks (plus the first)
    expect(rig.stats.checks).toBeGreaterThanOrEqual(15)
    expect(rig.stats.checks).toBeLessThanOrEqual(18)
    rig.dispose()
  })

  it('uploads the canvas at most twice a second, however often tiles change', () => {
    const { atlas, texture } = fakeAtlas()
    const t = tile()
    const reg = new Map<number, W4Tile>([[W4_TILE.labReceive, t]])
    const rig = createStatusRig({ atlas, tiles: () => reg })
    const seconds = 10
    for (let f = 0; f < seconds * 60; f++) {
      t.v.n = f // the version moves every frame
      rig.step({ generation: 0, now: f / 60 })
    }
    expect(texture.uploads).toBeLessThanOrEqual(Math.ceil(seconds / STATUS_UPLOAD) + 1)
    expect(texture.uploads).toBeGreaterThan(seconds) // and it does keep up: about 2 Hz
    rig.dispose()
  })

  it('shows a tile that registers later and hides one that is removed (blanking its cell)', () => {
    const { atlas, painted } = fakeAtlas()
    const reg = new Map<number, W4Tile>()
    const rig = createStatusRig({ atlas, tiles: () => reg })
    rig.step({ generation: 0, now: 0 })
    reg.set(W4_TILE.archive, tile())
    rig.step({ generation: 0, now: 1 })
    expect(rig.shown()).toEqual([W4_TILE.archive])
    reg.delete(W4_TILE.archive)
    rig.step({ generation: 0, now: 2 })
    expect(rig.shown()).toEqual([])
    expect(painted[painted.length - 1]).toEqual({ i: W4_TILE.archive, blank: true })
    expect(matrixOf(rig.mesh, W4_TILE.archive).determinant()).toBe(0)
    rig.dispose()
  })

  it('a Jump (a new generation) repaints every tile at once', () => {
    const { atlas, painted } = fakeAtlas()
    const reg = new Map<number, W4Tile>([
      [W4_TILE.labStatus, tile()],
      [W4_TILE.centrifuge, tile()],
    ])
    const rig = createStatusRig({ atlas, tiles: () => reg })
    rig.step({ generation: 0, now: 0 })
    const before = painted.length
    rig.step({ generation: 0, now: 0.01 })
    expect(painted.length).toBe(before)
    rig.step({ generation: 1, now: 0.02 })
    expect(painted.length).toBe(before + 2)
    rig.dispose()
  })

  it('a painter that throws does not break the frame', () => {
    const atlas: StatusAtlas = {
      texture: { needsUpdate: false, dispose() {} },
      paint: () => {
        throw new Error('boom')
      },
    }
    const reg = new Map<number, W4Tile>([[W4_TILE.labStatus, tile()]])
    const rig = createStatusRig({ atlas, tiles: () => reg })
    expect(() => rig.step({ generation: 0, now: 0 })).not.toThrow()
    rig.dispose()
  })

  it('draws as ONE mesh and shares the bedside material program key', () => {
    const rig = createStatusRig({ atlas: null, tiles: () => new Map() })
    let meshes = 0
    rig.group.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh) meshes++
    })
    expect(meshes).toBe(1)
    expect(rig.material.customProgramCacheKey()).toBe(createBedsideMaterial(null).customProgramCacheKey())
    rig.dispose()
  })

  it('the tile registry holds the lab tiles at the contract indexes', () => {
    expect(W4_TILE_COUNT).toBe(16)
    expect([W4_TILE.labStatus, W4_TILE.centrifuge, W4_TILE.labReceive, W4_TILE.archive]).toEqual([10, 11, 12, 13])
  })
})

/** A recording canvas context: every call is noted, nothing is drawn. */
function recordingContext() {
  const texts: string[] = []
  const calls: string[] = []
  const target: Record<string, unknown> = {
    measureText: (s: string) => ({ width: s.length * 9 }),
    fillText: (s: string) => void texts.push(s),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  }
  const ctx = new Proxy(target, {
    get: (t, k: string) => (k in t ? t[k] : (...args: unknown[]) => void calls.push(`${k}(${args.length})`)),
    set: (t, k: string, v) => {
      t[k] = v
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, texts, calls }
}

describe('the status tile drawing kit', () => {
  it('draws without a DOM, on any 2D context', () => {
    const { ctx, texts, calls } = recordingContext()
    paintBackground(ctx, 320, 200, 'amber')
    paintTitle(ctx, 320, 'LAB')
    paintText(ctx, 'hello', 10, 10, 20)
    paintBar(ctx, 10, 100, 200, 12, 0.4, 'green')
    paintBar(ctx, 10, 120, 200, 12, 0)
    const w = paintChip(ctx, 10, 150, 'STAT', 'red')
    paintStat(ctx, 10, 70, '12', 'Samples')
    expect(texts).toEqual(['LAB', 'hello', 'STAT', '12', 'Samples'])
    expect(w).toBeGreaterThan(24)
    expect(calls.length).toBeGreaterThan(5)
  })
})
