/**
 * Turns the walk-mode layout into geometry (W1): pure three.js (no DOM, no React), so the draw-call and triangle budget is measured in
 * node by walk.test.ts. Boxes are written straight into typed arrays (position, normal, uv: the same attributes every mesh here uses).
 *
 *   per chunk (./../../layout/walk/chunks.ts)   one mesh of `wall` boxes, one of `frame` boxes, one ceiling mesh
 *   once for the building                       one `glass` mesh (the upper glazing) and one sign mesh (hanging signs and plates)
 *   doors                                       three instanced meshes, built by WalkBuilding from `doorCounts()`
 *
 * A box that crosses a chunk edge is cut there, so a long corridor wall does not make one chunk's bounds span the whole building.
 */
import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute } from 'three'
import { CHUNK_COUNT, CHUNK_EDGES, chunkOfX } from '../../layout/walk/chunks'
import type { CeilingPiece, QuadPlacement, WalkBox, WalkBoxMat, WalkDoor, WalkLayout, WalkPart } from '../../layout/walk/types'
import type { PackedAtlas } from './signAtlas'

class Buf {
  readonly pos: number[] = []
  readonly nor: number[] = []
  readonly uv: number[] = []
  readonly idx: number[] = []

  private vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): number {
    const i = this.pos.length / 3
    this.pos.push(x, y, z)
    this.nor.push(nx, ny, nz)
    this.uv.push(u, v)
    return i
  }

  /** A quad from four corners, counter-clockwise seen from the side the normal points to. */
  quad(a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[], n: readonly number[], uvs: readonly (readonly [number, number])[]): void {
    const i0 = this.vertex(a[0], a[1], a[2], n[0], n[1], n[2], uvs[0][0], uvs[0][1])
    const i1 = this.vertex(b[0], b[1], b[2], n[0], n[1], n[2], uvs[1][0], uvs[1][1])
    const i2 = this.vertex(c[0], c[1], c[2], n[0], n[1], n[2], uvs[2][0], uvs[2][1])
    const i3 = this.vertex(d[0], d[1], d[2], n[0], n[1], n[2], uvs[3][0], uvs[3][1])
    this.idx.push(i0, i1, i2, i0, i2, i3)
  }

  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void {
    const UV: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [1, 1], [0, 1]]
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], UV)
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], UV)
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], UV)
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], UV)
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], UV)
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], UV)
  }

  get empty(): boolean {
    return this.idx.length === 0
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3))
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2))
    const max = this.pos.length / 3
    g.setIndex(max < 65535 ? new Uint16BufferAttribute(this.idx, 1) : new Uint32BufferAttribute(this.idx, 1))
    g.computeBoundingSphere()
    g.computeBoundingBox()
    return g
  }
}

/** The box cut at every chunk edge it crosses. */
function cutAtChunkEdges(b: WalkBox): WalkBox[] {
  const cuts = [b.x0, ...CHUNK_EDGES.filter((e) => e > b.x0 + 1e-9 && e < b.x1 - 1e-9), b.x1]
  const out: WalkBox[] = []
  for (let i = 0; i + 1 < cuts.length; i++) out.push({ ...b, x0: cuts[i], x1: cuts[i + 1] })
  return out
}

function ceilingQuad(buf: Buf, c: CeilingPiece): void {
  // seen from below (the normal points down): (x0,z0) -> (x1,z0) -> (x1,z1) is counter-clockwise from underneath
  buf.quad(
    [c.x0, c.y, c.z0],
    [c.x1, c.y, c.z0],
    [c.x1, c.y, c.z1],
    [c.x0, c.y, c.z1],
    [0, -1, 0],
    [
      [c.u0, c.v0],
      [c.u1, c.v0],
      [c.u1, c.v1],
      [c.u0, c.v1],
    ],
  )
}

/** A picture on a quad whose normal looks along `heading`: its right-hand edge (seen from the front) runs along (cos h, -sin h). */
function pictureQuad(buf: Buf, q: QuadPlacement, atlas: PackedAtlas): void {
  const cell = atlas.cells.get(q.tile)
  if (!cell) throw new Error(`walk signs: tile ${q.tile} is not in the atlas`)
  const tx = Math.cos(q.heading)
  const tz = -Math.sin(q.heading)
  const hw = q.w / 2
  const hh = q.h / 2
  const at = (s: number, t: number): number[] => [q.cx + tx * hw * s, q.cy + hh * t, q.cz + tz * hw * s]
  const u0 = cell.x / atlas.width
  const u1 = (cell.x + cell.w) / atlas.width
  const vTop = 1 - cell.y / atlas.height
  const vBottom = 1 - (cell.y + cell.h) / atlas.height
  buf.quad(
    at(-1, -1),
    at(1, -1),
    at(1, 1),
    at(-1, 1),
    [Math.sin(q.heading), 0, Math.cos(q.heading)],
    [
      [u0, vBottom],
      [u1, vBottom],
      [u1, vTop],
      [u0, vTop],
    ],
  )
}

export interface WalkChunk {
  index: number
  wall: BufferGeometry | null
  frame: BufferGeometry | null
  ceiling: BufferGeometry | null
}

export interface DoorCounts {
  /** Auto doors: two glass leaves and eight frame bars (four per leaf) each. */
  auto: number
  swing: number
}

export interface CompiledWalk {
  chunks: WalkChunk[]
  /** The upper glazing of the outer shell (all chunks in one mesh: a few hundred thin boxes). */
  glass: BufferGeometry | null
  /** Hanging signs and plates (all pictures in one mesh, one atlas texture). */
  signs: BufferGeometry | null
  doors: DoorCounts
}

export const BARS_PER_AUTO_LEAF = 4

export function doorCounts(doors: readonly WalkDoor[]): DoorCounts {
  return { auto: doors.filter((d) => d.kind === 'auto').length, swing: doors.filter((d) => d.kind === 'swing').length }
}

/** `hide` (Wave 3, `?building=model`): boxes (mat, centre x, z) and ceiling tiles the authored model replaces are left out. Undefined hides nothing. */
export function compileWalk(layout: WalkLayout, atlas: PackedAtlas, hide?: (mat: WalkBoxMat | 'ceiling', x: number, z: number, part?: WalkPart) => boolean): CompiledWalk {
  const wall: Buf[] = []
  const frame: Buf[] = []
  const ceil: Buf[] = []
  for (let i = 0; i < CHUNK_COUNT; i++) {
    wall.push(new Buf())
    frame.push(new Buf())
    ceil.push(new Buf())
  }
  const glass = new Buf()
  const byMat: Record<WalkBoxMat, (chunk: number) => Buf> = {
    wall: (c) => wall[c],
    frame: (c) => frame[c],
    glass: () => glass,
  }
  for (const box of layout.boxes) {
    if (hide?.(box.mat, (box.x0 + box.x1) / 2, (box.z0 + box.z1) / 2, box.part)) continue
    for (const part of box.mat === 'glass' ? [box] : cutAtChunkEdges(box)) {
      const buf = byMat[part.mat](chunkOfX((part.x0 + part.x1) / 2))
      buf.box(part.x0, part.x1, part.y0, part.y1, part.z0, part.z1)
    }
  }
  for (const c of layout.ceilings) if (!hide?.('ceiling', (c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2)) ceilingQuad(ceil[chunkOfX((c.x0 + c.x1) / 2)], c)
  const signs = new Buf()
  for (const q of layout.quads) pictureQuad(signs, q, atlas)

  return {
    chunks: wall.map((_, index) => ({
      index,
      wall: wall[index].empty ? null : wall[index].geometry(),
      frame: frame[index].empty ? null : frame[index].geometry(),
      ceiling: ceil[index].empty ? null : ceil[index].geometry(),
    })),
    glass: glass.empty ? null : glass.geometry(),
    signs: signs.empty ? null : signs.geometry(),
    doors: doorCounts(layout.doors),
  }
}

export interface WalkBudget {
  /** Meshes drawn in walk mode on top of the overview building: chunk meshes, glass, signs and the three door meshes. */
  drawCalls: number
  triangles: number
  chunkMeshes: number
}

const triangles = (g: BufferGeometry | null): number => (g?.index ? g.index.count / 3 : 0)

/** What walk mode adds to a frame (every mesh visible: the worst case, since culling only removes). */
export function estimateWalkBudget(c: CompiledWalk): WalkBudget {
  let calls = 0
  let tris = 0
  let chunkMeshes = 0
  for (const ch of c.chunks) {
    for (const g of [ch.wall, ch.frame, ch.ceiling]) {
      if (!g) continue
      chunkMeshes++
      calls++
      tris += triangles(g)
    }
  }
  for (const g of [c.glass, c.signs]) {
    if (!g) continue
    calls++
    tris += triangles(g)
  }
  const { auto, swing } = c.doors
  if (auto > 0) {
    calls += 2 // glass leaves (2 triangles each) and their frame bars (a box each)
    tris += auto * 2 * 2 + auto * 2 * BARS_PER_AUTO_LEAF * 12
  }
  if (swing > 0) {
    calls += 1
    tris += swing * 12
  }
  return { drawCalls: calls, triangles: tris, chunkMeshes }
}

export function disposeWalk(c: CompiledWalk): void {
  for (const ch of c.chunks) {
    ch.wall?.dispose()
    ch.frame?.dispose()
    ch.ceiling?.dispose()
  }
  c.glass?.dispose()
  c.signs?.dispose()
}
