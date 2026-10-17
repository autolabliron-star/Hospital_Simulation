/**
 * The static geometry of the glass Pharmacy Core, merged per palette material (so the whole core's static
 * scenery is eight draw calls): polished floor (plain: the MedPods hang from a ceiling rail now, so there is no lane
 * paint, arrow, pad or dock plate on it), four full-height glass walls with the two pharmacist door openings and the four
 * small rail portals near the top of the corridor walls, frame posts and rails, the white MedVend island with oak ends,
 * the gantry rails, the four top dock ports with their tray cradles, the charging contacts on the overhead rank and the
 * two pharmacist desks.
 *
 * Pure three.js geometry and plain data: nothing here reads sim state, so the node tests can count triangles and
 * check clearances. `solids` lists the footprint of every solid piece, for those tests.
 */
import { BoxGeometry, type BufferGeometry, PlaneGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { CORE, ROBOT } from '@/sim/places'
import {
  CONTACT,
  DESKS,
  DESK,
  DOCKS,
  DOOR,
  FACE_SIGN,
  faceGlassPanels,
  GLASS_OUT,
  ISLAND,
  ISLAND_CX,
  MV,
  OPENINGS,
  PORT,
  PORTAL,
  portalsOf,
  RANK_SLOTS,
  TRAY,
  WALL_GLASS,
  wallGlassPanels,
  wallSegments,
  wallSolidIntervals,
  WARDS,
} from './layout'

export type CorePartKey = 'floor' | 'glass' | 'frame' | 'white' | 'wood' | 'metal' | 'screen' | 'glow'

export interface Solid {
  id: string
  x0: number
  x1: number
  z0: number
  z1: number
  y0: number
  y1: number
  /** Part of the overhead rail's charging hardware: it sits ON the rail (above the pods), by design on the lane's centre line. */
  onRail?: boolean
}

export interface CoreStatic {
  geometries: Record<CorePartKey, BufferGeometry>
  solids: Solid[]
}

class Collector {
  readonly bag: Record<CorePartKey, BufferGeometry[]> = { floor: [], glass: [], frame: [], white: [], wood: [], metal: [], screen: [], glow: [] }
  readonly solids: Solid[] = []

  add(key: CorePartKey, g: BufferGeometry): void {
    this.bag[key].push(g)
  }

  box(key: CorePartKey, w: number, h: number, d: number, x: number, y: number, z: number, solid?: { id: string; onRail?: boolean }): void {
    this.add(key, new BoxGeometry(w, h, d).translate(x, y, z))
    if (solid) this.solids.push({ id: solid.id, x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y0: y - h / 2, y1: y + h / 2, onRail: solid.onRail })
  }

  merged(): Record<CorePartKey, BufferGeometry> {
    const out = {} as Record<CorePartKey, BufferGeometry>
    for (const key of Object.keys(this.bag) as CorePartKey[]) {
      const m = mergeGeometries(this.bag[key], false)
      for (const g of this.bag[key]) g.dispose()
      if (!m) throw new Error(`Pharmacy core: nothing to merge for ${key}`)
      out[key] = m
    }
    return out
  }
}

/** A glass pane in a plane of constant z (a corridor wall), from an x/y rectangle. */
function paneAtZ(r: { x0: number; x1: number; y0: number; y1: number }, z: number): BufferGeometry {
  return new PlaneGeometry(r.x1 - r.x0, r.y1 - r.y0).translate((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, z)
}

const POST = 0.1

// ---------------------------------------------------------------------------------------------
// Walls and rail portals
// ---------------------------------------------------------------------------------------------

function buildWalls(c: Collector): void {
  // corner posts
  for (const x of [CORE.x0, CORE.x1]) for (const z of [CORE.z0, CORE.z1]) c.box('frame', 0.14, 3, 0.14, x, 1.5, z, { id: `corner:${x},${z}` })

  const gapHalf = PORTAL.width / 2 + PORTAL.jamb
  // the two corridor walls (N at z0, S at z1): pharmacist doors and rail portals
  for (const side of ['N', 'S'] as const) {
    const z = side === 'N' ? CORE.z0 : CORE.z1
    const inward = side === 'N' ? 1 : -1
    // glass: continuous below the portals, full height elsewhere
    for (const r of wallGlassPanels(side)) c.add('glass', paneAtZ(r, z))
    for (const seg of wallSegments(side)) {
      const len = seg.b - seg.a
      if (len < 0.2) continue
      const mid = (seg.a + seg.b) / 2
      // the top frame bar is cut at the portals (the rail passes through there); the floor rail is continuous
      for (const iv of wallSolidIntervals(seg.a, seg.b, side)) c.box('frame', iv.b - iv.a, 0.08, 0.1, (iv.a + iv.b) / 2, 2.96, z)
      c.box('frame', len, 0.1, 0.06, mid, 0.05, z)
      // posts at the open ends (the door jambs), and at most every 3 m between (never in a portal)
      if (seg.aOpen) c.box('frame', POST, 3, POST, seg.a + POST / 2, 1.5, z, { id: `jamb:${side}:${seg.a.toFixed(2)}` })
      if (seg.bOpen) c.box('frame', POST, 3, POST, seg.b - POST / 2, 1.5, z, { id: `jamb:${side}:${seg.b.toFixed(2)}` })
      const n = Math.ceil(len / 3)
      for (let i = 1; i < n; i++) {
        const x = seg.a + (len * i) / n
        if (portalsOf(side).some((p) => Math.abs(p.x - x) < gapHalf + 0.1)) continue
        c.box('frame', 0.08, 3, 0.08, x, 1.5, z, { id: `post:${side}:${i}:${seg.a.toFixed(2)}` })
      }
    }

    // rail portals: two slim jamb strips up to the ceiling, a sill under the opening, a small teal sill light
    for (const p of portalsOf(side)) {
      const h = PORTAL.y1 - PORTAL.y0
      for (const s of [-1, 1]) {
        c.box('frame', PORTAL.jamb, h, PORTAL.depth, p.x + s * (PORTAL.width / 2 + PORTAL.jamb / 2), (PORTAL.y0 + PORTAL.y1) / 2, z, { id: `portal-jamb:${p.id}:${s < 0 ? 'L' : 'R'}` })
      }
      c.box('frame', PORTAL.width + 2 * PORTAL.jamb, PORTAL.sill.h, PORTAL.depth, p.x, PORTAL.y0 - PORTAL.sill.h / 2, z, { id: `portal-sill:${p.id}` })
      c.box('glow', 0.4, 0.01, 0.012, p.x, PORTAL.y0 - PORTAL.sill.h / 2, z + inward * (PORTAL.depth / 2 + 0.004))
    }

    // over each pharmacist door: a glass transom above the door, a lintel and the continuous top rail
    for (const o of OPENINGS.filter((q) => q.side === side)) {
      const top = WALL_GLASS.y1
      const y0 = DOOR.height + 0.07
      c.add('glass', new PlaneGeometry(o.width, top - y0).translate(o.x, (top + y0) / 2, z))
      c.box('frame', o.width, 0.08, 0.1, o.x, 2.96, z)
      c.box('frame', o.width + 0.2, 0.07, 0.1, o.x, DOOR.height + 0.035, z)
      // a small teal sensor strip on the inner face of the lintel
      c.box('glow', Math.min(0.4, o.width * 0.4), 0.025, 0.02, o.x, DOOR.height - 0.02, z + inward * 0.06)
    }
  }

  // the east and west walls (against the command centre and the atrium)
  const WALL_H = WALL_GLASS.y1 - WALL_GLASS.y0
  const WALL_MID_Y = (WALL_GLASS.y0 + WALL_GLASS.y1) / 2
  for (const x of [CORE.x0, CORE.x1]) {
    const H = CORE.z1 - CORE.z0
    c.add('glass', new PlaneGeometry(H, WALL_H).rotateY(Math.PI / 2).translate(x, WALL_MID_Y, 0))
    c.box('frame', 0.1, 0.08, H, x, 2.96, 0)
    c.box('frame', 0.06, 0.1, H, x, 0.05, 0)
    const n = Math.round(H / 3)
    for (let i = 1; i < n; i++) c.box('frame', 0.08, 3, 0.08, x, 1.5, CORE.z0 + (H * i) / n, { id: `post:${x}:${i}` })
  }
}

// ---------------------------------------------------------------------------------------------
// The MedVend island: casing, glass faces with their top dock ports, gantry rails, tray cradles
// ---------------------------------------------------------------------------------------------

function buildIsland(c: Collector): void {
  const W = ISLAND.x1 - ISLAND.x0
  const D = ISLAND.z1 - ISLAND.z0
  const inner = MV.headerY - MV.kick
  // casing: plinth, header, central spine; oak end caps
  c.box('white', W + 0.2, MV.kick, D + 0.2, ISLAND_CX, MV.kick / 2, 0)
  c.solids.push({ id: 'island', x0: ISLAND.x0 - 0.1, x1: ISLAND.x1 + 0.1, z0: ISLAND.z0 - 0.1, z1: ISLAND.z1 + 0.1, y0: 0, y1: ISLAND.height })
  c.box('white', W + 0.2, ISLAND.height - MV.headerY, D + 0.2, ISLAND_CX, (MV.headerY + ISLAND.height) / 2, 0)
  c.box('white', W - 0.2, inner, 0.84, ISLAND_CX, MV.kick + inner / 2, 0)
  for (const x of [ISLAND.x0, ISLAND.x1]) c.box('wood', 0.2, inner, D, x, MV.kick + inner / 2, 0)
  // header under-light along both faces
  for (const s of [-1, 1]) c.box('glow', W - 1.2, 0.03, 0.04, ISLAND_CX, MV.headerY - 0.02, s * (GLASS_OUT - 0.1))

  for (const w of WARDS) {
    const s = FACE_SIGN[w]
    // full-height glass face (with a port opening at each dock) and mullions
    for (const r of faceGlassPanels(w)) c.add('glass', paneAtZ(r, s * GLASS_OUT))
    for (let x = ISLAND.x0; x <= ISLAND.x1 + 1e-6; x += 2) c.box('frame', 0.06, inner, 0.06, x, MV.kick + inner / 2, s * GLASS_OUT)
    // gantry rails (the mast rides between them, the carriage rides the mast)
    c.box('metal', W - 0.4, 0.05, 0.08, ISLAND_CX, MV.kick + 0.06, s * MV.mastOut)
    c.box('metal', W - 0.4, 0.05, 0.08, ISLAND_CX, MV.headerY - 0.06, s * MV.mastOut)
  }

  // the top dock ports: a frame round the opening and the cradle the transfer tray rides in (the tray itself is animated)
  const hw = PORT.w / 2
  const portH = PORT.y1 - PORT.y0
  const cradleTop = TRAY.topY - TRAY.t - 0.005
  const cradleFront = GLASS_OUT + PORT.frameDepth / 2
  for (const d of DOCKS) {
    const s = FACE_SIGN[d.ward]
    c.box('frame', PORT.w + 2 * PORT.frame, PORT.frame, PORT.frameDepth, d.x, PORT.y1 + PORT.frame / 2, s * GLASS_OUT)
    c.box('frame', PORT.w + 2 * PORT.frame, PORT.frame, PORT.frameDepth, d.x, PORT.y0 - PORT.frame / 2, s * GLASS_OUT)
    for (const sx of [-1, 1]) c.box('frame', PORT.frame, portH, PORT.frameDepth, d.x + sx * (hw + PORT.frame / 2), (PORT.y0 + PORT.y1) / 2, s * GLASS_OUT)
    c.box('metal', TRAY.cradle.w, TRAY.cradle.t, cradleFront - TRAY.cradle.back, d.x, cradleTop - TRAY.cradle.t / 2, s * ((cradleFront + TRAY.cradle.back) / 2))
    // the hardware stays inside the glass plus its frame: well short of the docked pod's side
    const out0 = GLASS_OUT - PORT.frameDepth / 2
    const out1 = GLASS_OUT + PORT.frameDepth / 2
    c.solids.push({
      id: `port:${d.ward}${d.port}`,
      x0: d.x - hw - PORT.frame,
      x1: d.x + hw + PORT.frame,
      z0: s < 0 ? -out1 : out0,
      z1: s < 0 ? -out0 : out1,
      y0: PORT.y0 - PORT.frame,
      y1: PORT.y1 + PORT.frame,
    })
  }
}

// ---------------------------------------------------------------------------------------------
// The overhead charging rank, desks
// ---------------------------------------------------------------------------------------------

function buildRankContacts(c: Collector): void {
  for (const r of RANK_SLOTS) {
    for (const sx of [-1, 1]) {
      c.box('metal', CONTACT.t, CONTACT.h, CONTACT.length, ROBOT.rankX + sx * CONTACT.x, CONTACT.y, r.z, { id: `contact:${r.ward}${r.slot}:${sx < 0 ? 'L' : 'R'}`, onRail: true })
    }
  }
}

function buildDesks(c: Collector): void {
  for (const d of DESKS) {
    // built facing +z (towards the island), then turned to the desk's heading
    const yaw = Math.atan2(d.forward.x, d.forward.z)
    const turn = (g: BufferGeometry) => g.rotateY(yaw).translate(d.centre.x, 0, d.centre.z)
    const top = DESK.top - DESK.topT / 2
    c.add('wood', turn(new BoxGeometry(DESK.w, DESK.topT, DESK.d).translate(0, top, 0)))
    for (const sx of [-1, 1]) c.add('white', turn(new BoxGeometry(0.04, top - DESK.topT / 2, DESK.d - 0.06).translate(sx * (DESK.w / 2 - 0.04), (top - DESK.topT / 2) / 2, 0)))
    c.add('white', turn(new BoxGeometry(DESK.w - 0.14, 0.45, 0.03).translate(0, 0.45, DESK.d / 2 - 0.05)))
    // monitor: stand, dark panel (its glowing display is dynamic), keyboard
    c.add('frame', turn(new BoxGeometry(0.06, 0.2, 0.06).translate(0, DESK.top + 0.1, 0.12)))
    c.add('screen', turn(new BoxGeometry(0.56, 0.32, 0.03).translate(0, DESK.top + 0.36, 0.12)))
    c.add('frame', turn(new BoxGeometry(0.36, 0.015, 0.12).translate(0, DESK.top + 0.0075, -0.12)))
    c.solids.push({ id: `desk:${d.ward}`, ...d.rect, y0: 0, y1: DESK.top + 0.55 })
  }
}

/** All static geometry of the core, one merged geometry per palette material. */
export function buildCoreStatic(): CoreStatic {
  const c = new Collector()
  c.add('floor', new PlaneGeometry(CORE.x1 - CORE.x0, CORE.z1 - CORE.z0).rotateX(-Math.PI / 2))
  buildWalls(c)
  buildIsland(c)
  buildRankContacts(c)
  buildDesks(c)
  return { geometries: c.merged(), solids: c.solids }
}
