/**
 * R5 wave 2 (agent H): the stage's one merged mesh as plain typed arrays: positions, normals and linear vertex colours for `MACHINE_BODY`, and 16-bit indices. Preallocated
 * once; a rebuild resets the cursors and writes over them, so it allocates nothing. Positions are given in the table's own frame (`d`, `x`, `h`: frame.ts) and stored in
 * the sim frame of the LEVEL table; normals are the area-weighted mean of the faces around each vertex (`finishNormals`).
 */
import type { Rgb } from './colors'
import { CX, CZ, TOP } from './frame'

/** The most vertices and triangles a stage can hold (the budget is about 10 000 triangles: stage.test.ts pins what the builds really use). */
export const MAX_VERTS = 9000
export const MAX_TRIS = 12000

export interface StageMesh {
  pos: Float32Array
  nrm: Float32Array
  col: Float32Array
  idx: Uint16Array
  nv: number
  /** Index count (3 per triangle). */
  ni: number
  /** The colour new vertices take. */
  r: number
  g: number
  b: number
  /** Set when a build ran out of room (a bug the tests catch). */
  overflow: boolean
}

export function newStageMesh(): StageMesh {
  return {
    pos: new Float32Array(MAX_VERTS * 3),
    nrm: new Float32Array(MAX_VERTS * 3),
    col: new Float32Array(MAX_VERTS * 3),
    idx: new Uint16Array(MAX_TRIS * 3),
    nv: 0,
    ni: 0,
    r: 1,
    g: 1,
    b: 1,
    overflow: false,
  }
}

export function resetMesh(m: StageMesh): void {
  m.nv = 0
  m.ni = 0
  m.overflow = false
}

export function setColour(m: StageMesh, c: Rgb): void {
  m.r = c.r
  m.g = c.g
  m.b = c.b
}

/** Add a vertex at (`d`, `x`, `h`) of the table's frame in the current colour; returns its index. */
export function addVert(m: StageMesh, d: number, x: number, h: number): number {
  if (m.nv >= MAX_VERTS) {
    m.overflow = true
    return MAX_VERTS - 1
  }
  const i = m.nv++
  const o = i * 3
  m.pos[o] = CX + x
  m.pos[o + 1] = TOP + h
  m.pos[o + 2] = CZ + d
  m.nrm[o] = 0
  m.nrm[o + 1] = 0
  m.nrm[o + 2] = 0
  m.col[o] = m.r
  m.col[o + 1] = m.g
  m.col[o + 2] = m.b
  return i
}

/** Add a triangle (counter-clockwise seen from its front) and fold its area-weighted normal into its three vertices. */
export function addTri(m: StageMesh, a: number, b: number, c: number): void {
  if (m.ni + 3 > MAX_TRIS * 3) {
    m.overflow = true
    return
  }
  const p = m.pos
  const nr = m.nrm
  const ao = a * 3
  const bo = b * 3
  const co = c * 3
  const ux = p[bo] - p[ao]
  const uy = p[bo + 1] - p[ao + 1]
  const uz = p[bo + 2] - p[ao + 2]
  const vx = p[co] - p[ao]
  const vy = p[co + 1] - p[ao + 1]
  const vz = p[co + 2] - p[ao + 2]
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  nr[ao] += nx
  nr[ao + 1] += ny
  nr[ao + 2] += nz
  nr[bo] += nx
  nr[bo + 1] += ny
  nr[bo + 2] += nz
  nr[co] += nx
  nr[co + 1] += ny
  nr[co + 2] += nz
  m.idx[m.ni] = a
  m.idx[m.ni + 1] = b
  m.idx[m.ni + 2] = c
  m.ni += 3
}

/** Normalise every vertex normal (a vertex no face touched faces up). */
export function finishNormals(m: StageMesh): void {
  const nr = m.nrm
  for (let i = 0; i < m.nv; i++) {
    const o = i * 3
    const l = Math.sqrt(nr[o] * nr[o] + nr[o + 1] * nr[o + 1] + nr[o + 2] * nr[o + 2])
    if (l > 1e-12) {
      nr[o] /= l
      nr[o + 1] /= l
      nr[o + 2] /= l
    } else {
      nr[o] = 0
      nr[o + 1] = 1
      nr[o + 2] = 0
    }
  }
}

/**
 * Triangles of a `rows` x `cols` grid of vertices from `v0` (row-major): rows run toward +d, columns toward +x, the front facing +h (up). `flip` turns it over. A quad
 * `skip`ped (when `skip` is given: one byte per quad, row-major, `cols - 1` per row) is left out: a window.
 */
export function addGrid(m: StageMesh, v0: number, rows: number, cols: number, flip: boolean, skip: Uint8Array | null): void {
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      if (skip !== null && skip[r * (cols - 1) + c] !== 0) continue
      const a = v0 + r * cols + c
      const b = a + 1
      const cc = a + cols
      const e = cc + 1
      if (flip) {
        addTri(m, a, b, cc)
        addTri(m, b, e, cc)
      } else {
        addTri(m, a, cc, b)
        addTri(m, b, cc, e)
      }
    }
  }
}

function boxFace(
  m: StageMesh,
  ax: number, ah: number, ad: number,
  bx: number, bh: number, bd: number,
  cx: number, ch: number, cd: number,
  ex: number, eh: number, ed: number,
  ox: number, oh: number, od: number,
): void {
  const a = addVert(m, ad, ax, ah)
  const b = addVert(m, bd, bx, bh)
  const c = addVert(m, cd, cx, ch)
  const e = addVert(m, ed, ex, eh)
  // the stored frame is (x, h, d): the face normal is (b - a) x (c - a) there
  const ux = bx - ax
  const uh = bh - ah
  const ud = bd - ad
  const vx = cx - ax
  const vh = ch - ah
  const vd = cd - ad
  const nx = uh * vd - ud * vh
  const nh = ud * vx - ux * vd
  const nd = ux * vh - uh * vx
  if (nx * ox + nh * oh + nd * od >= 0) {
    addTri(m, a, b, c)
    addTri(m, a, c, e)
  } else {
    addTri(m, a, c, b)
    addTri(m, a, e, c)
  }
}

/**
 * An axis-aligned box of the table's frame (`d`, `x`, `h` bounds) with flat faces: 24 vertices, 12 triangles. Each face is given as its four corners in turn about the
 * outward direction; the winding is taken from the cross product, so no face can come out inside-out.
 */
export function addBox(m: StageMesh, d0: number, d1: number, x0: number, x1: number, h0: number, h1: number): void {
  // six faces: the outward axis (0 x, 1 h, 2 d, sign) and the four corners as (x, h, d)
  boxFace(m, x1, h0, d0, x1, h1, d0, x1, h1, d1, x1, h0, d1, 1, 0, 0)
  boxFace(m, x0, h0, d0, x0, h0, d1, x0, h1, d1, x0, h1, d0, -1, 0, 0)
  boxFace(m, x0, h1, d0, x0, h1, d1, x1, h1, d1, x1, h1, d0, 0, 1, 0)
  boxFace(m, x0, h0, d0, x1, h0, d0, x1, h0, d1, x0, h0, d1, 0, -1, 0)
  boxFace(m, x0, h0, d1, x1, h0, d1, x1, h1, d1, x0, h1, d1, 0, 0, 1)
  boxFace(m, x0, h0, d0, x0, h1, d0, x1, h1, d0, x1, h0, d0, 0, 0, -1)
}
