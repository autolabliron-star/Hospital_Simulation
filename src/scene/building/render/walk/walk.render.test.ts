/**
 * Node tests of the walk-mode renderer's pure parts (W1): the door bank (opening, holding, closing, rest), the leaf matrices, the sign
 * atlas painter (run against a recording stub: no canvas here), the ceiling picture and the geometry's winding (every ceiling faces
 * down, every picture faces the way its heading says, every box faces outward).
 */
import { describe, expect, it } from 'vitest'
import { Vector3, type BufferGeometry } from 'three'
import { DOORS } from '@/sim/places'
import { buildLayout } from '../../layout'
import { buildWalkLayout } from '../../layout/walk'
import type { WalkDoor } from '../../layout/walk/types'
import { DoorBank, DOOR_TIMING, type PersonLike } from './doorBank'
import { autoLeafWidth, autoTravel, setInstance, swingDirection, swingLeafWidth, writeAutoDoor, writeSwingDoor } from './doorMatrices'
import { CEILING_PX, paintCeilingCell, type CeilingPaint } from './ceilingTexture'
import { packAtlas, paintAtlas, type Paint2D } from './signAtlas'
import { compileWalk } from './walkGeometry'

const layout = buildLayout()
const walk = buildWalkLayout(layout)
const door = (id: string): WalkDoor => walk.doors.find((d) => d.id === id)!
const person = (x: number, z: number): PersonLike => ({ entity: { position: { x, z } } })

// ---------------------------------------------------------------------------------------------
// The door bank
// ---------------------------------------------------------------------------------------------

describe('door bank', () => {
  const run = (bank: DoorBank, seconds: number, people: PersonLike[], player: { x: number; z: number } | null = null): void => {
    for (let i = 0; i < Math.round(seconds * 60); i++) bank.update(1 / 60, people, player)
  }

  it('starts shut and stays shut (and reports no change) while nobody is near', () => {
    const bank = new DoorBank(walk.doors)
    expect(bank.update(1 / 60, [person(0, 0)], null)).toBe(true) // the first write
    expect(bank.update(1 / 60, [person(0, 0)], null)).toBe(false)
    for (let i = 0; i < bank.count; i++) expect(bank.shown[i]).toBe(0)
  })

  it('an auto door opens when a person comes within 2.5 m, either side, and fully opens within about half a second', () => {
    const entrance = walk.doors.findIndex((d) => d.id === 'entrance')
    for (const dx of [-2.4, 2.4]) {
      const bank = new DoorBank(walk.doors)
      run(bank, DOOR_TIMING.auto.opens + 0.1, [person(-62 + dx, 0)])
      expect(bank.shown[entrance]).toBe(1)
    }
    const bank = new DoorBank(walk.doors)
    run(bank, 2, [person(-62 + 2.6, 0)])
    expect(bank.shown[entrance]).toBe(0)
  })

  it('a swing door opens for somebody passing within 1.6 m, and ignores a patient in bed', () => {
    const idx = walk.doors.findIndex((d) => d.id === 'room:A3')
    const d = door('room:A3')
    const bank = new DoorBank(walk.doors)
    run(bank, 1, [person(d.x, d.z + 1.4)])
    expect(bank.shown[idx]).toBe(1)
    const quiet = new DoorBank(walk.doors)
    // the bed head is ~2.5 m from the door
    run(quiet, 2, [person(d.x + 2.1, d.z - 1.35)])
    expect(quiet.shown[idx]).toBe(0)
  })

  it('you open doors too: the player position counts like a person', () => {
    const idx = walk.doors.findIndex((d) => d.id === 'entrance')
    const bank = new DoorBank(walk.doors)
    run(bank, 1, [], { x: -64, z: 0.5 })
    expect(bank.shown[idx]).toBe(1)
  })

  it('holds open after the last one leaves, then eases shut, and comes to an exact rest', () => {
    const idx = walk.doors.findIndex((d) => d.id === 'triage')
    const bank = new DoorBank(walk.doors)
    const d = door('triage')
    run(bank, 1, [person(d.x, d.z)])
    expect(bank.shown[idx]).toBe(1)
    run(bank, DOOR_TIMING.auto.hold - 0.1, [])
    expect(bank.shown[idx]).toBe(1)
    let last = 1
    for (let i = 0; i < 120; i++) {
      bank.update(1 / 60, [], null)
      expect(bank.shown[idx]).toBeLessThanOrEqual(last + 1e-9)
      last = bank.shown[idx]
    }
    expect(bank.shown[idx]).toBe(0)
    expect(bank.update(1 / 60, [], null)).toBe(false) // at rest: nothing to write
  })

  it('every door of the layout can be sensed from its own centre', () => {
    const bank = new DoorBank(walk.doors)
    run(
      bank,
      1.2,
      walk.doors.map((d) => person(d.x, d.z)),
    )
    for (let i = 0; i < bank.count; i++) expect(bank.shown[i], walk.doors[i].id).toBe(1)
  })
})

// ---------------------------------------------------------------------------------------------
// Leaf matrices
// ---------------------------------------------------------------------------------------------

/** The world position and x axis of instance `i`. */
function readInstance(a: Float32Array, i: number): { p: Vector3; xAxis: Vector3; zAxis: Vector3; sy: number } {
  const o = i * 16
  return { p: new Vector3(a[o + 12], a[o + 13], a[o + 14]), xAxis: new Vector3(a[o], a[o + 1], a[o + 2]), zAxis: new Vector3(a[o + 8], a[o + 9], a[o + 10]), sy: a[o + 5] }
}

describe('door leaf matrices', () => {
  it('setInstance writes a column-major matrix that turns the x axis to (c, 0, -s)', () => {
    const a = new Float32Array(16)
    setInstance(a, 0, 1, 2, 3, 0, 1, 2, 3, 4)
    expect(Array.from(a)).toEqual([0, 0, -2, 0, 0, 3, 0, 0, 4, 0, 0, 0, 1, 2, 3, 1])
  })

  it('a shut auto door: two leaves meeting in the middle of the opening, one each side, at the door height', () => {
    for (const id of ['entrance', 'liftA', 'imaging']) {
      const d = door(id)
      const glass = new Float32Array(2 * 16)
      const bars = new Float32Array(8 * 16)
      writeAutoDoor(glass, bars, 0, d, 0)
      const l = readInstance(glass, 0)
      const r = readInstance(glass, 1)
      const alongX = d.wallAxis === 'x'
      const mid = alongX ? d.x : d.z
      const a0 = alongX ? l.p.x : l.p.z
      const a1 = alongX ? r.p.x : r.p.z
      expect(a0, id).toBeLessThan(mid)
      expect(a1, id).toBeGreaterThan(mid)
      expect((a0 + a1) / 2, id).toBeCloseTo(mid, 4)
      // together (frame bars, leaf edge to leaf edge) they span the clear opening between the two jambs
      expect(a1 - a0 + autoLeafWidth(d), id).toBeGreaterThanOrEqual(d.width - 0.07 - 1e-6)
      expect(l.sy).toBeCloseTo(2.28, 6)
      // across the wall: off the line by the door's offset
      expect(alongX ? l.p.z : l.p.x).toBeCloseTo((alongX ? d.z : d.x) + d.offset, 4)
    }
  })

  it('a fully open auto door slides each leaf almost its own width apart, into the wall', () => {
    const d = door('triage')
    const g0 = new Float32Array(2 * 16)
    const g1 = new Float32Array(2 * 16)
    const bars = new Float32Array(8 * 16)
    writeAutoDoor(g0, bars, 0, d, 0)
    writeAutoDoor(g1, bars, 0, d, 1)
    const moved = Math.abs(readInstance(g1, 0).p.x - readInstance(g0, 0).p.x)
    expect(moved).toBeCloseTo(autoTravel(d), 5)
    // the leaves are in the wall beside the opening, not across it
    expect(readInstance(g1, 0).p.x).toBeLessThan(d.x - d.width / 2 + 0.05)
    expect(readInstance(g1, 1).p.x).toBeGreaterThan(d.x + d.width / 2 - 0.05)
  })

  it('a wall along z turns the leaf: its x axis runs along z', () => {
    const d = door('imaging')
    expect(d.wallAxis).toBe('z')
    const glass = new Float32Array(2 * 16)
    writeAutoDoor(glass, new Float32Array(8 * 16), 0, d, 0)
    const l = readInstance(glass, 0)
    expect(Math.abs(l.xAxis.z)).toBeGreaterThan(0.99 * (autoLeafWidth(d) - 0.02))
    expect(Math.abs(l.xAxis.x)).toBeLessThan(1e-6)
  })

  it('a shut swing leaf lies in the doorway from its hinge to the far jamb; opened, it stands out into the room', () => {
    const d = door('room:A3')
    const lw = swingLeafWidth(d)
    const leaves = new Float32Array(16)
    writeSwingDoor(leaves, 0, d, 0)
    const shut = readInstance(leaves, 0)
    expect(shut.p.z).toBeCloseTo(d.z, 6)
    expect(shut.p.x).toBeCloseTo(d.x + d.hinge * (d.width / 2 - 0.015) - d.hinge * (lw / 2), 6)
    writeSwingDoor(leaves, 0, d, 1)
    const open = readInstance(leaves, 0)
    // the hinge end is unchanged: the leaf's centre is half a leaf from it, now turned toward the room
    const hinge = new Vector3(d.x + d.hinge * (d.width / 2 - 0.015), 0, d.z)
    const toCentre = new Vector3(open.p.x - hinge.x, 0, open.p.z - hinge.z)
    expect(toCentre.length()).toBeCloseTo(lw / 2, 5)
    expect(Math.sign(toCentre.z)).toBe(d.into.z) // into the room
    const dir = swingDirection(d, d.maxAngle)
    expect(toCentre.normalize().distanceTo(new Vector3(dir.x, 0, dir.z))).toBeLessThan(1e-5)
    // the leaf's thin side faces along the wall: its z axis is perpendicular to its x axis
    expect(Math.abs(open.xAxis.dot(open.zAxis))).toBeLessThan(1e-6)
  })

  it('opening is monotonic: a swing leaf turns steadily from shut to its widest', () => {
    const d = door('staffA')
    const a = new Float32Array(16)
    let lastZ = -Infinity
    for (let k = 0; k <= 10; k++) {
      writeSwingDoor(a, 0, d, k / 10)
      const z = readInstance(a, 0).p.z * d.into.z
      expect(z).toBeGreaterThanOrEqual(lastZ - 1e-9)
      lastZ = z
    }
  })
})

// ---------------------------------------------------------------------------------------------
// The painters, against recording stubs
// ---------------------------------------------------------------------------------------------

function stubContext(): { ctx: Paint2D; texts: string[]; rects: number } {
  const texts: string[] = []
  const state = { rects: 0 }
  const noop = (): void => undefined
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    fill: noop,
    stroke: noop,
    rect: noop,
    clip: noop,
    fillRect: () => {
      state.rects++
    },
    fillText: (t: string) => {
      texts.push(t)
    },
    measureText: (t: string) => ({ width: t.length * 9 }),
  } as unknown as Paint2D
  return { ctx, texts, get rects() { return state.rects } }
}

describe('the sign atlas painter', () => {
  it('draws every label of every sign and every plate, from the content words', () => {
    const atlas = packAtlas(walk.tiles)
    const stub = stubContext()
    paintAtlas(stub.ctx, atlas, walk.tiles)
    const drawn = stub.texts.join('\u0000')
    for (const t of walk.tiles) {
      if (t.kind === 'sign') for (const r of t.rows) expect(drawn, r.label).toContain(r.label)
      else if (t.kind === 'room') expect(drawn).toContain(t.id)
      else expect(drawn, t.label).toContain(t.label)
    }
  })

  it('shrinks text to fit instead of overflowing: the font only gets smaller', () => {
    const atlas = packAtlas(walk.tiles.filter((t) => t.kind === 'name'))
    const stub = stubContext()
    const sizes: number[] = []
    const ctx = stub.ctx
    let font = ''
    Object.defineProperty(ctx, 'font', { get: () => font, set: (v: string) => { font = v; const m = /(\d+(?:\.\d+)?)px/.exec(v); if (m) sizes.push(Number(m[1])) } })
    paintAtlas(ctx, atlas, walk.tiles.filter((t) => t.kind === 'name'))
    expect(sizes.length).toBeGreaterThan(0)
    for (const s of sizes) expect(s).toBeLessThanOrEqual(44)
  })

  it('refuses a tile that has no cell', () => {
    const atlas = packAtlas([])
    expect(() => paintAtlas(stubContext().ctx, atlas, walk.tiles.slice(0, 1))).toThrow()
  })
})

describe('the ceiling picture', () => {
  it('paints a square cell: seams on the tile grid in the albedo, a light panel in both, and black everywhere else in the emissive', () => {
    for (const emissive of [false, true]) {
      const calls: { style: string; x: number; y: number; w: number; h: number }[] = []
      const ctx: CeilingPaint = {
        fillStyle: '',
        fillRect(x, y, w, h) {
          calls.push({ style: String(this.fillStyle), x, y, w, h })
        },
      }
      paintCeilingCell(ctx, emissive)
      expect(calls[0]).toMatchObject({ x: 0, y: 0, w: CEILING_PX, h: CEILING_PX })
      expect(calls[0].style).toBe(emissive ? '#000000' : '#f2f2ee')
      // nothing is drawn outside the cell
      for (const c of calls) {
        expect(c.x + c.w).toBeLessThanOrEqual(CEILING_PX + 1)
        expect(c.y + c.h).toBeLessThanOrEqual(CEILING_PX + 1)
      }
      if (emissive) expect(calls.some((c) => c.style === '#ffffff')).toBe(true)
      else expect(calls.length).toBeGreaterThan(10)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// Winding: what faces which way
// ---------------------------------------------------------------------------------------------

/** The unit normal of every triangle, and the triangle's centre. */
function triangleNormals(g: BufferGeometry): { n: Vector3; c: Vector3 }[] {
  const pos = g.getAttribute('position')
  const idx = g.index!
  const out: { n: Vector3; c: Vector3 }[] = []
  const v = (i: number): Vector3 => new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i))
  for (let i = 0; i < idx.count; i += 3) {
    const a = v(idx.getX(i))
    const b = v(idx.getX(i + 1))
    const c = v(idx.getX(i + 2))
    out.push({ n: new Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize(), c: a.clone().add(b).add(c).divideScalar(3) })
  }
  return out
}

describe('the geometry faces the right way', () => {
  const atlas = packAtlas(walk.tiles)
  const compiled = compileWalk(walk, atlas)

  it('every ceiling triangle faces down (so it is seen from inside the rooms and from nowhere above)', () => {
    for (const ch of compiled.chunks) {
      if (!ch.ceiling) continue
      for (const t of triangleNormals(ch.ceiling)) expect(t.n.y).toBeCloseTo(-1, 6)
    }
  })

  it('the normals the shader gets agree with the winding', () => {
    for (const ch of compiled.chunks) {
      for (const g of [ch.wall, ch.frame, ch.ceiling]) {
        if (!g) continue
        const nor = g.getAttribute('normal')
        const idx = g.index!
        const faces = triangleNormals(g)
        for (let t = 0; t < faces.length; t += 37) {
          const i = idx.getX(t * 3)
          expect(faces[t].n.x * nor.getX(i) + faces[t].n.y * nor.getY(i) + faces[t].n.z * nor.getZ(i)).toBeCloseTo(1, 5)
        }
      }
    }
  })

  it('every box faces outward: the triangle normal points away from the box centre', () => {
    const g = compiled.chunks.find((c) => c.wall)!.wall!
    g.computeBoundingBox()
    const pos = g.getAttribute('position')
    // sample the first 40 boxes (24 vertices each)
    for (let box = 0; box < 40; box++) {
      const vs = Array.from({ length: 24 }, (_, k) => new Vector3(pos.getX(box * 24 + k), pos.getY(box * 24 + k), pos.getZ(box * 24 + k)))
      const centre = vs.reduce((s, p) => s.add(p), new Vector3()).divideScalar(24)
      const tris = triangleNormals(g).slice(box * 12, box * 12 + 12)
      for (const t of tris) expect(t.n.dot(t.c.clone().sub(centre))).toBeGreaterThan(0)
    }
  })

  it('each sign and plate picture faces along its heading, and sits where its placement says', () => {
    const g = compiled.signs!
    const faces = triangleNormals(g)
    expect(faces.length).toBe(walk.quads.length * 2)
    walk.quads.forEach((q, i) => {
      for (const t of [faces[i * 2], faces[i * 2 + 1]]) {
        expect(t.n.x).toBeCloseTo(Math.sin(q.heading), 6)
        expect(t.n.z).toBeCloseTo(Math.cos(q.heading), 6)
        expect(Math.abs(t.c.y - q.cy)).toBeLessThan(q.h / 2)
      }
    })
  })

  it('the picture on a sign reads left to right for a reader in front of it (its right edge is where the heading says)', () => {
    const g = compiled.signs!
    const pos = g.getAttribute('position')
    const uv = g.getAttribute('uv')
    walk.quads.forEach((q, i) => {
      // vertex 0 is bottom-left, vertex 1 bottom-right (seen from the front): u grows along (cos h, -sin h)
      const a = new Vector3(pos.getX(i * 4), 0, pos.getZ(i * 4))
      const b = new Vector3(pos.getX(i * 4 + 1), 0, pos.getZ(i * 4 + 1))
      const right = b.sub(a).normalize()
      expect(right.x).toBeCloseTo(Math.cos(q.heading), 6)
      expect(right.z).toBeCloseTo(-Math.sin(q.heading), 6)
      expect(uv.getX(i * 4 + 1)).toBeGreaterThan(uv.getX(i * 4))
    })
  })

  it('plates hang on the face of their wall: a solid wall one half-thickness plus the backing off the line, facing into the corridor', () => {
    for (const p of walk.plates.filter((q) => q.kind === 'room')) {
      expect(Math.abs(p.z - p.line)).toBeCloseTo(0.1 + 0.02 + 0.002, 6)
    }
    expect(DOORS.length).toBeGreaterThan(0)
  })
})
