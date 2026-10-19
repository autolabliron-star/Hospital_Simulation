/**
 * Waypoint graph and A* for PEOPLE (pattern: Waltz `NavGraph`).
 *
 * Nodes:
 *   corridor    centre line of each ward corridor (|z| = 14): at every door x and every 4 m, plus the spine
 *               junction at x = -42
 *   spine       the main N-S spine (x = -42), lift doors and lift insides
 *   lobby       entrance, reception, kiosks, the lobby/spine opening, triage and ER doors
 *   per room    doorOutside -> door -> doorInside -> bedside, drawerSpot, chair (+ two bed-foot nodes so the
 *               drawer spot, which sits between the bed and the side wall, is reachable around the bed)
 *   hubs        counter door (0, +-16) -> inside -> the nurse work spots
 *   command     door -> aisle -> seats
 *   pharmacy    pharmacist door -> desk
 *   atrium      openings -> garden, cafe
 *   staff       staff room / supply / lounge / quiet room, DOCTORS_BASE
 *   open        a coarse lattice inside big halls (lobby, triage, ER, diagnostics, atrium, ...)
 *
 * Rules (enforced in `NavGraph.link`, so no edge can break them):
 *   - an edge exists only if `segmentWalkable` holds with margin 0.3;
 *   - inside a corridor an edge is either perpendicular (a door spur) or along the centre line, never a
 *     diagonal.
 * W2: the MedPods ride a ceiling rail, so the whole corridor floor is the people's: there is no lane rule.
 *
 * `planRoute` snaps both ends to nodes, runs A*, then shortens the route inside single open rooms and drops
 * collinear waypoints (door waypoints are kept). A point inside a corridor snaps by stepping perpendicular onto
 * the centre line, never diagonally. Ties break by node index, so the same call always gives the same route.
 */
import { getLayout } from '@/scene/building/layout'
import {
  ARRIVALS,
  ATRIUM,
  COMMAND_SEATS,
  DEPARTURES,
  DOCTORS_BASE,
  DOORS,
  LOBBY,
  NURSE_HUB,
  PHARMACY,
  ROOMS,
  WALL,
  areaAt,
  areaById,
  wardSign,
  type AreaId,
  type DoorSpec,
} from '../places'
import type { Vec2, WardId } from '../types'
import { roomNodeId, seatNodeId, type RoomNodePart } from './ids'
import {
  FURNITURE_MARGIN,
  corridorLineZ,
  inCorridorBand,
  isWalkable,
  nearestWalkable,
  segmentInOpenZone,
  segmentTouchesCorridor,
  segmentWalkable,
} from './layout'

/** Clearance a graph edge keeps from walls and beds. */
export const NAV_MARGIN = 0.3

export type NodeKind = 'corridor' | 'spine' | 'door' | 'inside' | 'anchor' | 'open' | 'seat'

export interface NavNode {
  index: number
  id: string
  x: number
  z: number
  kind: NodeKind
  /** Nodes of one group are linked pairwise by visibility (a room, a hall). */
  group: string
}

export interface NavEdge {
  a: number
  b: number
  len: number
}

interface Link {
  to: number
  cost: number
}

export { roomNodeId, type RoomNodePart }

// ---------------------------------------------------------------------------------------------
// Edge rules
// ---------------------------------------------------------------------------------------------

/** Inside a corridor a segment must be a perpendicular spur or lie on the centre line. */
function corridorRuleOk(ax: number, az: number, bx: number, bz: number): boolean {
  const ward = segmentTouchesCorridor(ax, az, bx, bz)
  if (!ward) return true
  if (Math.abs(bx - ax) < 1e-6) return true
  const zc = corridorLineZ(ward)
  return Math.abs(az - zc) < 1e-6 && Math.abs(bz - zc) < 1e-6
}

/**
 * Can a body walk the straight line a -> b under all nav rules (walkable at `margin` from walls and beds and `solidMargin`
 * from furniture, corridor rule)?
 */
function lineOk(ax: number, az: number, bx: number, bz: number, margin: number, solidMargin = margin): boolean {
  if (!segmentWalkable(ax, az, bx, bz, margin, 0.25, solidMargin)) return false
  return corridorRuleOk(ax, az, bx, bz)
}

export class NavGraph {
  readonly nodes: NavNode[] = []
  readonly adj: Link[][] = []
  readonly edges: NavEdge[] = []
  readonly byId = new Map<string, number>()

  add(id: string, x: number, z: number, kind: NodeKind, group = ''): number {
    const existing = this.byId.get(id)
    if (existing !== undefined) return existing
    const index = this.nodes.length
    this.nodes.push({ index, id, x, z, kind, group })
    this.adj.push([])
    this.byId.set(id, index)
    return index
  }

  /** A second name for an existing node. */
  alias(id: string, index: number): void {
    if (!this.byId.has(id)) this.byId.set(id, index)
  }

  /** Link two nodes if every nav rule holds for the straight segment. Returns whether they are linked. */
  link(a: number, b: number): boolean {
    if (a === b) return false
    if (this.adj[a].some((l) => l.to === b)) return true
    const na = this.nodes[a]
    const nb = this.nodes[b]
    if (!lineOk(na.x, na.z, nb.x, nb.z, NAV_MARGIN, FURNITURE_MARGIN)) return false
    const len = Math.hypot(na.x - nb.x, na.z - nb.z)
    this.adj[a].push({ to: b, cost: len })
    this.adj[b].push({ to: a, cost: len })
    this.edges.push({ a, b, len })
    return true
  }

  node(id: string): NavNode {
    const i = this.byId.get(id)
    if (i === undefined) throw new Error(`Unknown nav node ${id}`)
    return this.nodes[i]
  }

  has(id: string): boolean {
    return this.byId.has(id)
  }
}

// ---------------------------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------------------------

/** Problems found while building (a node off walkable ground, a link refused, an unreachable node). Tests require none. */
export const NAV_WARNINGS: string[] = []

export interface ChainEntry {
  x: number
  index: number
}

/** Corridor centre-line nodes per ward, sorted by x (used to snap points inside a corridor). */
export const CORRIDOR_CHAINS: Record<WardId, ChainEntry[]> = { A: [], B: [] }

const DOOR_BY_ID = new Map<string, DoorSpec>(DOORS.map((d) => [d.id, d]))

function doorSpec(id: string): DoorSpec {
  const d = DOOR_BY_ID.get(id)
  if (!d) throw new Error(`Unknown door ${id}`)
  return d
}

const HALF_WALL = WALL.thickness / 2

function buildGraph(): NavGraph {
  const g = new NavGraph()
  const wards: WardId[] = ['A', 'B']

  const must = (a: number, b: number): void => {
    if (!g.link(a, b)) NAV_WARNINGS.push(`link refused: ${g.nodes[a].id} -> ${g.nodes[b].id}`)
  }
  const chain = (ids: number[]): void => {
    for (let i = 1; i < ids.length; i++) must(ids[i - 1], ids[i])
  }
  /** Link every pair of the group's nodes that are within `maxDist` and can see each other. */
  const linkGroup = (group: string, maxDist: number): void => {
    const ids = g.nodes.filter((n) => n.group === group).map((n) => n.index)
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = g.nodes[ids[i]]
        const b = g.nodes[ids[j]]
        if (Math.hypot(a.x - b.x, a.z - b.z) <= maxDist) g.link(ids[i], ids[j])
      }
    }
  }
  /** A coarse lattice of 'open' nodes inside a big hall, skipping spots too close to existing nodes of the group. */
  const lattice = (area: AreaId, group: string, spacing = 6, margin = 0.8, minGap = 1.5): void => {
    const r = areaById(area).rect
    const x0 = r.x0 + HALF_WALL
    const x1 = r.x1 - HALF_WALL
    const z0 = r.z0 + HALF_WALL
    const z1 = r.z1 - HALF_WALL
    const cols = Math.max(1, Math.round((x1 - x0) / spacing))
    const rows = Math.max(1, Math.round((z1 - z0) / spacing))
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = x0 + ((i + 0.5) * (x1 - x0)) / cols
        const z = z0 + ((j + 0.5) * (z1 - z0)) / rows
        if (!isWalkable(x, z, margin, 0.5)) continue
        if (g.nodes.some((n) => n.group === group && Math.hypot(n.x - x, n.z - z) < minGap)) continue
        g.add(`open:${area}:${i}:${j}`, x, z, 'open', group)
      }
    }
  }

  // --- corridor centre lines ---------------------------------------------------------------
  /** Get or create the centre-line node of ward `w` at x. A second id is kept as an alias. */
  const corridorNode = (w: WardId, x: number, id?: string): number => {
    const list = CORRIDOR_CHAINS[w]
    const found = list.find((e) => Math.abs(e.x - x) < 0.05)
    if (found) {
      if (id) g.alias(id, found.index)
      return found.index
    }
    const idx = g.add(id ?? `corridor:${w}:${x.toFixed(1)}`, x, corridorLineZ(w), 'corridor')
    list.push({ x, index: idx })
    return idx
  }

  // --- spine (x = -42) -----------------------------------------------------------------------
  const spineX = (areaById('spine').rect.x0 + areaById('spine').rect.x1) / 2
  const spineJunctionZ = corridorLineZ('B') // 14
  const spineZs = [-spineJunctionZ, -10, -6, -3, 0, 3, 6, 10, spineJunctionZ]
  const spine = new Map<number, number>()
  for (const z of spineZs) spine.set(z, g.add(`spine:${z}`, spineX, z, 'spine', 'spine'))
  chain(spineZs.map((z) => spine.get(z)!))

  // --- lobby, triage, ER ---------------------------------------------------------------------
  const entrance = g.add('lobby:entrance', LOBBY.entrance.x, LOBBY.entrance.z, 'anchor', 'lobby')
  g.add('lobby:reception', LOBBY.reception.at.x, LOBBY.reception.at.z, 'anchor', 'lobby')
  LOBBY.kiosks.forEach((k, i) => g.add(`lobby:kiosk:${i}`, k.x, k.z, 'anchor', 'lobby'))

  const lobbySpine = doorSpec('lobby-spine')
  const lobbyWest = g.add('lobby:spineIn', lobbySpine.center.x - 2, lobbySpine.center.z, 'inside', 'lobby')
  const lobbySpineDoor = g.add('lobby:spineDoor', lobbySpine.center.x, lobbySpine.center.z, 'door')
  must(lobbyWest, lobbySpineDoor)
  must(lobbySpineDoor, spine.get(0)!)

  for (const [door, side, groupName] of [
    ['triage', -1, 'triage'],
    ['er', 1, 'er'],
  ] as const) {
    const d = doorSpec(door)
    const lobbyIn = g.add(`${door}:lobbyIn`, d.center.x, d.center.z - side * 1.5, 'inside', 'lobby')
    const dn = g.add(`${door}:door`, d.center.x, d.center.z, 'door')
    const inside = g.add(`${door}:in`, d.center.x, d.center.z + side * 1.5, 'inside', groupName)
    must(lobbyIn, dn)
    must(dn, inside)
  }

  lattice('lobby', 'lobby')
  lattice('triage', 'triage')
  lattice('er', 'er')
  linkGroup('lobby', 12)
  linkGroup('triage', 12)
  linkGroup('er', 12)

  // --- lifts ---------------------------------------------------------------------------------
  for (const w of wards) {
    const d = doorSpec(`lift${w}`)
    const s = wardSign(w)
    const door = g.add(`lift:${w}:door`, d.center.x, d.center.z, 'door')
    const inside = g.add(`lift:${w}:in`, d.center.x, d.center.z + s * 2.5, 'inside', `lift:${w}`)
    must(spine.get(s * spineJunctionZ)!, door)
    must(door, inside)
  }

  // --- imaging (R1): a hall off the spine; every room opens off it; MRI and CT scan rooms lie behind their control rooms
  {
    const d = doorSpec('imaging')
    const door = g.add('imaging:door', d.center.x, d.center.z, 'door')
    const inside = g.add('imaging:in', d.center.x + 1.5, d.center.z, 'inside', 'imagingHall')
    must(spine.get(0)!, door)
    must(door, inside)
    const hall = areaById('imagingHall').rect
    const hallZ = (hall.z0 + hall.z1) / 2
    // the hall's centre line, with a node in front of every door off it
    const offHall: [string, AreaId][] = [
      ['mriControl', 'mriControl'],
      ['ctControl', 'ctControl'],
      ['xray', 'xray'],
      ['ultrasound', 'ultrasound'],
      ['bloodDraw', 'diagnostics'],
    ]
    const lineXs = [...new Set([d.center.x + 1.5, ...offHall.map(([id]) => doorSpec(id).center.x), hall.x1 - 1.2])].sort((a, b) => a - b)
    const line = new Map<number, number>()
    for (const x of lineXs) line.set(x, x === d.center.x + 1.5 ? inside : g.add(`imaging:line:${x.toFixed(1)}`, x, hallZ, 'inside', 'imagingHall'))
    chain(lineXs.map((x) => line.get(x)!))
    /** door -> a node just inside the room on the far side of the wall from `fromZ` */
    const through = (doorId: string, area: AreaId, from: number): void => {
      const dd = doorSpec(doorId)
      const r = areaById(area).rect
      const into = (r.z0 + r.z1) / 2 > dd.center.z ? 1 : -1
      const dn = g.add(`${doorId}:door`, dd.center.x, dd.center.z, 'door')
      const inn = g.add(`${doorId}:in`, dd.center.x, dd.center.z + into * 1.0, 'inside', area)
      must(from, dn)
      must(dn, inn)
    }
    for (const [doorId, area] of offHall) through(doorId, area, line.get(doorSpec(doorId).center.x)!)
    // MRI and CT: from the control room, through the inner door, into the scan room
    for (const [inner, control, room] of [
      ['mriRoom', 'mriControl', 'mri'],
      ['ctRoom', 'ctControl', 'ct'],
    ] as const) {
      const dd = doorSpec(inner)
      const c = areaById(control).rect
      const ctrlSide = g.add(`${inner}:control`, dd.center.x, (c.z0 + c.z1) / 2, 'inside', control)
      through(inner, room, ctrlSide)
    }
    for (const [, area] of offHall) {
      lattice(area, area, 3.5)
      linkGroup(area, 12)
    }
    for (const area of ['mri', 'ct'] as const) {
      lattice(area, area, 3.5)
      linkGroup(area, 12)
    }
  }

  // --- corridors: spurs first, then the grid, then the chain along the centre line -----------
  for (const w of wards) {
    const s = wardSign(w)

    // patient rooms
    for (const r of ROOMS.filter((q) => q.ward === w)) {
      const group = `room:${r.id}`
      const out = corridorNode(w, r.doorOutside.x, roomNodeId(r.id, 'doorOutside'))
      const door = g.add(roomNodeId(r.id, 'door'), r.door.x, r.door.z, 'door')
      const inside = g.add(roomNodeId(r.id, 'doorInside'), r.doorInside.x, r.doorInside.z, 'inside', group)
      g.add(roomNodeId(r.id, 'bedside'), r.bedside.x, r.bedside.z, 'anchor', group)
      g.add(roomNodeId(r.id, 'drawerSpot'), r.drawerSpot.x, r.drawerSpot.z, 'anchor', group)
      g.add(roomNodeId(r.id, 'chair'), r.chair.x, r.chair.z, 'anchor', group)
      // The drawer spot sits between the bed and the side wall, so the way there leads round the foot of the bed.
      const footZ = r.bed.z + s * (1.05 + 0.8)
      g.add(roomNodeId(r.id, 'footL'), r.bedside.x, footZ, 'inside', group)
      g.add(roomNodeId(r.id, 'footR'), r.drawerSpot.x, footZ, 'inside', group)
      must(out, door)
      must(door, inside)
      linkGroup(group, 6)
    }

    // nurse hub counter
    {
      const d = doorSpec(`hub${w}`)
      const group = `hub:${w}`
      const out = corridorNode(w, d.center.x)
      const door = g.add(`hub:${w}:door`, d.center.x, d.center.z, 'door')
      const inside = g.add(`hub:${w}:in`, d.center.x, d.center.z + s * 1.2, 'inside', group)
      NURSE_HUB[w].forEach((sp, i) => g.add(`hub:${w}:spot:${i}`, sp.at.x, sp.at.z, 'anchor', group))
      must(out, door)
      must(door, inside)
      linkGroup(group, 6)
    }

    // command center: door -> aisle (east of the seats) -> seats
    {
      const d = doorSpec(`command${w}`)
      const out = corridorNode(w, d.center.x)
      const door = g.add(`command:${w}:door`, d.center.x, d.center.z, 'door')
      const inside = g.add(`command:${w}:in`, d.center.x, d.center.z - s * 1.5, 'inside', 'command')
      must(out, door)
      must(door, inside)
    }

    // pharmacist door -> desk (the only way into the core)
    {
      const d = doorSpec(`pharmacist${w}`)
      const out = corridorNode(w, d.center.x)
      const door = g.add(`pharmacy:${w}:door`, d.center.x, d.center.z, 'door')
      const desk = g.add(`pharmacy:${w}:desk`, PHARMACY.desk[w].spot.x, PHARMACY.desk[w].spot.z, 'anchor', `pharmacy:${w}`)
      must(out, door)
      must(door, desk)
    }

    // atrium opening
    {
      const d = doorSpec(`atrium${w}`)
      const out = corridorNode(w, d.center.x)
      const door = g.add(`atrium:${w}:door`, d.center.x, d.center.z, 'door')
      const inside = g.add(`atrium:${w}:in`, d.center.x, d.center.z - s * 1.5, 'inside', 'atrium')
      must(out, door)
      must(door, inside)
    }

    // staff room (A) / clean supply (B) and family lounge (A) / quiet room (B)
    for (const [doorId, groupName, areaId] of [
      [`${w === 'A' ? 'staff' : 'supply'}${w}`, w === 'A' ? 'staff' : 'supply', w === 'A' ? 'staffA' : 'supplyB'],
      [`${w === 'A' ? 'lounge' : 'quiet'}${w}`, w === 'A' ? 'lounge' : 'quiet', w === 'A' ? 'loungeA' : 'quietB'],
    ] as const) {
      const d = doorSpec(doorId)
      const out = corridorNode(w, d.center.x)
      const door = g.add(`${groupName}:door`, d.center.x, d.center.z, 'door')
      const inside = g.add(`${groupName}:in`, d.center.x, d.center.z + s * 1.6, 'inside', groupName)
      must(out, door)
      must(door, inside)
      if (groupName === 'staff') g.add('staff:doctorsBase', DOCTORS_BASE.at.x, DOCTORS_BASE.at.z, 'anchor', groupName)
      lattice(areaId, groupName)
      linkGroup(groupName, 12)
    }

    // W4: the automated lab (ward B side), behind the blood-draw centre
    if (w === 'B') {
      const d = doorSpec('lab')
      const out = corridorNode(w, d.center.x)
      const door = g.add('lab:door', d.center.x, d.center.z, 'door')
      const inside = g.add('lab:in', d.center.x, d.center.z + s * 1.6, 'inside', 'lab')
      must(out, door)
      must(door, inside)
      lattice('lab', 'lab')
      linkGroup('lab', 12)
    }

    // grid every 4 m along the centre line, skipping near-duplicates of a door node
    for (let x = -40; x <= 36; x += 4) {
      if (CORRIDOR_CHAINS[w].some((e) => Math.abs(e.x - x) < 0.5)) continue
      corridorNode(w, x)
    }
    CORRIDOR_CHAINS[w].sort((a, b) => a.x - b.x)
    chain(CORRIDOR_CHAINS[w].map((e) => e.index))
    // spine junction -> corridor west end
    must(spine.get(s * spineJunctionZ)!, CORRIDOR_CHAINS[w][0].index)
  }

  // --- command center interior ---------------------------------------------------------------
  {
    const aisleX = Math.max(...COMMAND_SEATS.map((q) => q.at.x)) + 3
    const seatZs = COMMAND_SEATS.map((q) => q.at.z)
    const aisleZs = [...new Set([-10.5, ...seatZs, 10.5])].sort((a, b) => a - b)
    const aisle = aisleZs.map((z) => g.add(`command:aisle:${z}`, aisleX, z, 'inside', 'command'))
    chain(aisle)
    must(g.byId.get('command:A:in')!, aisle[0])
    must(g.byId.get('command:B:in')!, aisle[aisle.length - 1])
    COMMAND_SEATS.forEach((seat, i) => {
      const n = g.add(`command:seat:${i}`, seat.at.x, seat.at.z, 'anchor', 'command')
      must(n, g.byId.get(`command:aisle:${seat.at.z}`)!)
    })
  }

  // --- atrium interior -----------------------------------------------------------------------
  g.add('atrium:garden', ATRIUM.garden.x, ATRIUM.garden.z, 'anchor', 'atrium')
  g.add('atrium:cafe', ATRIUM.cafe.at.x, ATRIUM.cafe.at.z, 'anchor', 'atrium')
  lattice('atrium', 'atrium')
  linkGroup('atrium', 12)

  // --- arrivals, departures, the doors outside ---------------------------------------------------
  const wrapPi = (a: number): number => a - Math.PI * 2 * Math.round(a / (Math.PI * 2))
  /** Link node `idx` to up to `k` of the nearest nodes it sees, in different directions (so no redundant parallel edges). */
  const linkNearest = (idx: number, k: number, maxDist: number): number => {
    const n = g.nodes[idx]
    const near = g.nodes
      .filter((m) => m.index !== idx && m.kind !== 'seat' && Math.hypot(m.x - n.x, m.z - n.z) <= maxDist)
      .map((m) => ({ m, d: Math.hypot(m.x - n.x, m.z - n.z) }))
      .sort((a, b) => a.d - b.d || a.m.index - b.m.index)
    const dirs: number[] = []
    for (const { m } of near) {
      const ang = Math.atan2(m.x - n.x, m.z - n.z)
      if (dirs.some((d) => Math.abs(wrapPi(d - ang)) < 0.45)) continue
      if (g.link(idx, m.index)) {
        dirs.push(ang)
        if (dirs.length >= k) break
      }
    }
    return dirs.length
  }
  /**
   * Breadth-first search over a 0.25 m grid of free ground in the area of node `idx`, to the nearest other node; the way
   * is string-pulled and added as a few via nodes. For seats that no node sees directly.
   */
  const connectViaGrid = (idx: number): boolean => {
    const n = g.nodes[idx]
    const area = areaAt(n.x, n.z)
    if (!area) return false
    const cs = 0.25
    const x0 = area.rect.x0 + HALF_WALL
    const z0 = area.rect.z0 + HALF_WALL
    const cols = Math.ceil((area.rect.x1 - HALF_WALL - x0) / cs)
    const rows = Math.ceil((area.rect.z1 - HALF_WALL - z0) / cs)
    const cx = (c: number) => x0 + (c + 0.5) * cs
    const cz = (r: number) => z0 + (r + 0.5) * cs
    const free = new Uint8Array(cols * rows)
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) free[r * cols + c] = isWalkable(cx(c), cz(r), NAV_MARGIN, FURNITURE_MARGIN) ? 1 : 0
    const cellOf = (x: number, z: number) => Math.min(rows - 1, Math.max(0, Math.floor((z - z0) / cs))) * cols + Math.min(cols - 1, Math.max(0, Math.floor((x - x0) / cs)))
    const goals = new Map<number, number>()
    for (const m of g.nodes) {
      if (m.kind === 'seat' || m.index === idx) continue
      if (m.x < x0 || m.x > x0 + cols * cs || m.z < z0 || m.z > z0 + rows * cs) continue
      const c = cellOf(m.x, m.z)
      if (!goals.has(c)) goals.set(c, m.index)
    }
    const start = cellOf(n.x, n.z)
    free[start] = 1
    const parent = new Int32Array(cols * rows).fill(-2)
    parent[start] = -1
    const queue: number[] = [start]
    let goalCell = -1
    for (let head = 0; head < queue.length && goalCell < 0; head++) {
      const cur = queue[head]
      if (goals.has(cur) && cur !== start) {
        goalCell = cur
        break
      }
      const r = Math.floor(cur / cols)
      const c = cur % cols
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue
          const rr = r + dr
          const cc = c + dc
          if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue
          const nx = rr * cols + cc
          if (parent[nx] !== -2 || !free[nx]) continue
          if (dr !== 0 && dc !== 0 && (!free[r * cols + cc] || !free[rr * cols + c])) continue
          parent[nx] = cur
          queue.push(nx)
        }
      }
    }
    if (goalCell < 0) return false
    const target = g.nodes[goals.get(goalCell)!]
    const pts: Vec2[] = [{ x: n.x, z: n.z }]
    const cells: number[] = []
    for (let c = goalCell; c >= 0; c = parent[c]) cells.push(c)
    cells.reverse()
    for (const c of cells.slice(1)) pts.push({ x: cx(c % cols), z: cz(Math.floor(c / cols)) })
    pts.push({ x: target.x, z: target.z })
    // string-pull: from each kept point, jump to the farthest point it sees
    const keep: Vec2[] = [pts[0]]
    let i = 0
    while (i < pts.length - 1) {
      let j = pts.length - 1
      while (j > i + 1 && !lineOk(pts[i].x, pts[i].z, pts[j].x, pts[j].z, NAV_MARGIN, FURNITURE_MARGIN)) j--
      keep.push(pts[j])
      i = j
    }
    let prev = idx
    for (let k = 1; k < keep.length - 1; k++) {
      const via = g.add(`${n.id}~via${k}`, keep[k].x, keep[k].z, 'inside', n.group)
      if (!g.link(prev, via)) return false
      prev = via
    }
    return g.link(prev, target.index)
  }
  // Where people appear and vanish (they fade in and out on the spot), and the two outside doors.
  const arrEntrance = g.add('arrival:entrance', ARRIVALS.entrance.at.x, ARRIVALS.entrance.at.z, 'anchor', 'lobby')
  if (linkNearest(arrEntrance, 2, 8) === 0) NAV_WARNINGS.push('arrival:entrance is not linked')
  const arrAmbulance = g.add('arrival:ambulance', ARRIVALS.ambulance.at.x, ARRIVALS.ambulance.at.z, 'anchor', 'er')
  if (linkNearest(arrAmbulance, 2, 12) === 0) NAV_WARNINGS.push('arrival:ambulance is not linked')
  for (const [doorId, from] of [
    ['entrance', arrEntrance],
    ['ambulance', arrAmbulance],
  ] as const) {
    const d = doorSpec(doorId)
    const door = g.add(`door:${doorId}`, d.center.x, d.center.z, 'door')
    must(from, door)
  }
  DEPARTURES.lifts.forEach((p, i) => {
    const n = g.add(`departure:lift:${i}`, p.x, p.z, 'anchor', `lift:${i === 0 ? 'A' : 'B'}`)
    if (linkNearest(n, 2, 8) === 0) NAV_WARNINGS.push(`departure:lift:${i} is not linked`)
  })

  // --- seats: a node at every approach spot, linked into the graph --------------------------------
  const seatNodes: number[] = []
  const seats = getLayout().seats
  for (const seat of seats) {
    const at = seat.approach
    const same = g.nodes.find((m) => Math.abs(m.x - at.x) < 1e-6 && Math.abs(m.z - at.z) < 1e-6)
    if (same) {
      g.alias(seatNodeId(seat.id), same.index)
      continue
    }
    seatNodes.push(g.add(seatNodeId(seat.id), at.x, at.z, 'seat', seat.area))
  }
  for (const idx of seatNodes) {
    let linked = linkNearest(idx, 2, 10)
    if (linked === 0) linked = linkNearest(idx, 2, 40)
    // a seat tucked into a pocket of furniture: find the free way out on a fine grid, then string-pull it into a few nodes
    if (linked === 0 && connectViaGrid(idx)) linked = 1
    if (linked === 0) NAV_WARNINGS.push(`seat approach not linked: ${g.nodes[idx].id}`)
  }
  // neighbours in a row (lobby seats, benches) are linked too, so a queue along a row can shuffle along
  for (let i = 0; i < seatNodes.length; i++) {
    for (let j = i + 1; j < seatNodes.length; j++) {
      const a = g.nodes[seatNodes[i]]
      const b = g.nodes[seatNodes[j]]
      if (Math.hypot(a.x - b.x, a.z - b.z) <= 1.3) g.link(seatNodes[i], seatNodes[j])
    }
  }

  // --- sanity ---------------------------------------------------------------------------------
  for (const n of g.nodes) {
    if (!isWalkable(n.x, n.z, NAV_MARGIN)) NAV_WARNINGS.push(`node off walkable ground: ${n.id} (${n.x}, ${n.z})`)
  }
  const seen = new Uint8Array(g.nodes.length)
  const stack = [entrance]
  seen[entrance] = 1
  while (stack.length > 0) {
    const i = stack.pop()!
    for (const l of g.adj[i]) {
      if (!seen[l.to]) {
        seen[l.to] = 1
        stack.push(l.to)
      }
    }
  }
  for (const n of g.nodes) if (!seen[n.index]) NAV_WARNINGS.push(`unreachable node: ${n.id}`)
  return g
}

export const NAV: NavGraph = buildGraph()

export function nodePos(id: string): Vec2 {
  const n = NAV.node(id)
  return { x: n.x, z: n.z }
}

// ---------------------------------------------------------------------------------------------
// A*
// ---------------------------------------------------------------------------------------------

class MinHeap {
  private ids: number[] = []
  private keys: number[] = []

  get size(): number {
    return this.ids.length
  }

  /** Smaller key first; equal keys by smaller id, so the pop order is deterministic. */
  private less(a: number, b: number): boolean {
    return this.keys[a] < this.keys[b] || (this.keys[a] === this.keys[b] && this.ids[a] < this.ids[b])
  }

  private swap(a: number, b: number): void {
    const ti = this.ids[a]
    this.ids[a] = this.ids[b]
    this.ids[b] = ti
    const tk = this.keys[a]
    this.keys[a] = this.keys[b]
    this.keys[b] = tk
  }

  push(id: number, key: number): void {
    this.ids.push(id)
    this.keys.push(key)
    let i = this.ids.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!this.less(i, p)) break
      this.swap(i, p)
      i = p
    }
  }

  pop(): number {
    const top = this.ids[0]
    const lastId = this.ids.pop()!
    const lastKey = this.keys.pop()!
    if (this.ids.length > 0) {
      this.ids[0] = lastId
      this.keys[0] = lastKey
      let i = 0
      const n = this.ids.length
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < n && this.less(l, m)) m = l
        if (r < n && this.less(r, m)) m = r
        if (m === i) break
        this.swap(i, m)
        i = m
      }
    }
    return top
  }
}

/** A way from a free point onto the graph: via the points in `pre`, then to node `i`; `d` is the walked length. */
interface Anchor {
  i: number
  d: number
  pre: Vec2[]
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

function exactNode(p: Vec2): number {
  for (const n of NAV.nodes) if (Math.abs(n.x - p.x) < 1e-6 && Math.abs(n.z - p.z) < 1e-6) return n.index
  return -1
}

/** Point inside a corridor: step perpendicular onto the centre line, then continue along it to the bracketing nodes. */
function corridorAnchors(w: WardId, p: Vec2): Anchor[] {
  const zc = corridorLineZ(w)
  const proj: Vec2 = { x: p.x, z: zc }
  const onLine = Math.abs(p.z - zc) < 1e-6
  const pre: Vec2[] = onLine ? [] : [proj]
  const lead = onLine ? 0 : Math.abs(p.z - zc)
  const list = CORRIDOR_CHAINS[w]
  let lo: ChainEntry | null = null
  let hi: ChainEntry | null = null
  for (const e of list) {
    if (e.x <= p.x + 1e-6) lo = e
    if (e.x >= p.x - 1e-6 && !hi) hi = e
  }
  const out: Anchor[] = []
  if (lo && hi && lo.index === hi.index) {
    out.push({ i: lo.index, d: lead + Math.abs(lo.x - p.x), pre: pre.length > 0 && Math.abs(lo.x - p.x) < 1e-6 ? [] : pre })
    return out
  }
  if (lo) out.push({ i: lo.index, d: lead + Math.abs(p.x - lo.x), pre })
  if (hi) out.push({ i: hi.index, d: lead + Math.abs(hi.x - p.x), pre })
  return out
}

/** The nearest `k` nodes that `origin` sees along a legal straight line, nearest first (ties by node index). */
function visibleNodes(origin: Vec2, lead: number, pre: Vec2[], margin: number, k: number, solidMargin = margin): Anchor[] {
  const cand: { i: number; d: number }[] = []
  for (const n of NAV.nodes) cand.push({ i: n.index, d: Math.hypot(n.x - origin.x, n.z - origin.z) })
  cand.sort((a, b) => a.d - b.d || a.i - b.i)
  const out: Anchor[] = []
  const tried = Math.min(cand.length, 60)
  for (let c = 0; c < tried && out.length < k; c++) {
    const n = NAV.nodes[cand[c].i]
    if (lineOk(origin.x, origin.z, n.x, n.z, margin, solidMargin)) out.push({ i: n.index, d: lead + cand[c].d, pre })
  }
  return out
}

/**
 * A point in a pocket between furniture sees no node directly: step to a nearby free spot (a ring of candidates round
 * the point, nearest first) from which a node is visible, and walk via that spot.
 */
function ringAnchors(p: Vec2, k: number): Anchor[] {
  const found: Anchor[] = []
  for (const r of [0.6, 1.0, 1.5, 2.2, 3.0]) {
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2
      const q: Vec2 = { x: p.x + Math.sin(ang) * r, z: p.z + Math.cos(ang) * r }
      if (!isWalkable(q.x, q.z, NAV_MARGIN, FURNITURE_MARGIN)) continue
      if (!lineOk(p.x, p.z, q.x, q.z, NAV_MARGIN, FURNITURE_MARGIN)) continue
      for (const v of visibleNodes(q, r, [q], NAV_MARGIN, 1, FURNITURE_MARGIN)) found.push(v)
    }
    if (found.length >= k) break
  }
  found.sort((a, b) => a.d - b.d || a.i - b.i)
  return found.slice(0, k)
}

function anchorsFor(p: Vec2, k = 4): Anchor[] {
  const exact = exactNode(p)
  if (exact >= 0) return [{ i: exact, d: 0, pre: [] }]
  const w = inCorridorBand(p.x, p.z)
  if (w) return corridorAnchors(w, p)
  let out = visibleNodes(p, 0, [], NAV_MARGIN, k, FURNITURE_MARGIN)
  if (out.length === 0) out = ringAnchors(p, k)
  if (out.length === 0) out = visibleNodes(p, 0, [], 0.25, k, 0.25)
  if (out.length === 0) out = visibleNodes(p, 0, [], 0, k)
  if (out.length === 0) {
    // Not on walkable ground (inside a bed, a wall): step to the nearest walkable point first.
    const snap: Vec2 = { x: p.x, z: p.z }
    nearestWalkable(p.x, p.z, NAV_MARGIN, snap)
    if (Math.abs(snap.x - p.x) > 1e-9 || Math.abs(snap.z - p.z) > 1e-9) {
      const inner = anchorsFor(snap, k)
      out = inner.map((a) => ({ i: a.i, d: a.d + dist(p, snap), pre: [snap, ...a.pre] }))
    }
  }
  return out
}

interface Search {
  nodes: number[]
  start: Anchor
  goal: Anchor
}

/** A* from start anchors to goal anchors (virtual start and goal). Ties break by node index. */
function search(starts: Anchor[], goals: Anchor[], goal: Vec2): Search | null {
  const nodes = NAV.nodes
  const n = nodes.length
  const GOAL = n
  const gScore = new Float64Array(n + 1).fill(Infinity)
  const parent = new Int32Array(n + 1).fill(-1)
  const closed = new Uint8Array(n + 1)
  const startOf = new Map<number, Anchor>()
  const goalOf = new Map<number, Anchor>()
  for (const a of goals) {
    const prev = goalOf.get(a.i)
    if (!prev || a.d < prev.d) goalOf.set(a.i, a)
  }
  const h = (i: number) => Math.hypot(nodes[i].x - goal.x, nodes[i].z - goal.z)
  const open = new MinHeap()
  for (const s of starts) {
    if (s.d < gScore[s.i]) {
      gScore[s.i] = s.d
      startOf.set(s.i, s)
      open.push(s.i, s.d + h(s.i))
    }
  }
  while (open.size > 0) {
    const cur = open.pop()
    if (closed[cur]) continue
    closed[cur] = 1
    if (cur === GOAL) {
      const path: number[] = []
      let c = parent[GOAL]
      while (c >= 0) {
        path.push(c)
        c = parent[c]
      }
      path.reverse()
      return { nodes: path, start: startOf.get(path[0])!, goal: goalOf.get(path[path.length - 1])! }
    }
    const toGoal = goalOf.get(cur)
    if (toGoal) {
      const ng = gScore[cur] + toGoal.d
      if (ng < gScore[GOAL]) {
        gScore[GOAL] = ng
        parent[GOAL] = cur
        open.push(GOAL, ng)
      }
    }
    for (const l of NAV.adj[cur]) {
      if (closed[l.to]) continue
      const ng = gScore[cur] + l.cost
      if (ng < gScore[l.to]) {
        gScore[l.to] = ng
        parent[l.to] = cur
        open.push(l.to, ng + h(l.to))
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// Route shaping
// ---------------------------------------------------------------------------------------------

interface RoutePoint extends Vec2 {
  /** Door waypoints stay in the route even when collinear (so doors can react to walkers). */
  keep: boolean
}

/** String-pulling inside single open rooms only: never across a corridor, a doorway or a bed. */
function shorten(pts: RoutePoint[]): RoutePoint[] {
  if (pts.length <= 2) return pts
  const out: RoutePoint[] = [pts[0]]
  let i = 0
  while (i < pts.length - 1) {
    let j = pts.length - 1
    while (j > i + 1 && !segmentInOpenZone(pts[i].x, pts[i].z, pts[j].x, pts[j].z, NAV_MARGIN, FURNITURE_MARGIN)) j--
    out.push(pts[j])
    i = j
  }
  return out
}

function dropCollinear(pts: RoutePoint[]): RoutePoint[] {
  if (pts.length <= 2) return pts
  const out: RoutePoint[] = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1]
    const b = pts[i]
    const c = pts[i + 1]
    const abx = b.x - a.x
    const abz = b.z - a.z
    const bcx = c.x - b.x
    const bcz = c.z - b.z
    const cross = abx * bcz - abz * bcx
    const dot = abx * bcx + abz * bcz
    const scale = Math.hypot(abx, abz) * Math.hypot(bcx, bcz)
    if (!b.keep && dot > 0 && Math.abs(cross) <= 1e-6 * scale) continue
    out.push(b)
  }
  out.push(pts[pts.length - 1])
  return out
}

/**
 * Plan a walking route. Returns the whole polyline: `from` (as given) first, the exact `to` last, or null if no
 * route exists. `to` and `from` need not be nodes; they snap to the graph.
 */
export function tryPlanRoute(from: Vec2, to: Vec2): Vec2[] | null {
  if (Math.hypot(from.x - to.x, from.z - to.z) < 1e-6) return [{ x: to.x, z: to.z }]
  const starts = anchorsFor(from)
  const goals = anchorsFor(to)
  if (starts.length === 0 || goals.length === 0) return null
  const found = search(starts, goals, to)
  if (!found) return null

  const pts: RoutePoint[] = [{ x: from.x, z: from.z, keep: true }]
  for (const p of found.start.pre) pts.push({ x: p.x, z: p.z, keep: false })
  for (const i of found.nodes) {
    const nd = NAV.nodes[i]
    pts.push({ x: nd.x, z: nd.z, keep: nd.kind === 'door' })
  }
  for (let k = found.goal.pre.length - 1; k >= 0; k--) pts.push({ x: found.goal.pre[k].x, z: found.goal.pre[k].z, keep: false })
  pts.push({ x: to.x, z: to.z, keep: true })

  // drop zero-length legs (a node that sits exactly on `from` or `to`)
  const kept: RoutePoint[] = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const prev = kept[kept.length - 1]
    if (Math.hypot(pts[i].x - prev.x, pts[i].z - prev.z) > 1e-4) kept.push(pts[i])
  }
  if (kept.length < 2) return [{ x: from.x, z: from.z }, { x: to.x, z: to.z }]
  const out = dropCollinear(shorten(kept)).map((p) => ({ x: p.x, z: p.z }))
  // a leg shorter than 1e-4 at the end may have been merged into the previous point: keep `to` exact
  out[out.length - 1] = { x: to.x, z: to.z }
  return out
}

/** Like `tryPlanRoute`, but when no route exists it falls back to the straight line `[from, to]`. */
export function planRoute(from: Vec2, to: Vec2): Vec2[] {
  return tryPlanRoute(from, to) ?? [{ x: from.x, z: from.z }, { x: to.x, z: to.z }]
}

/** Total length of a polyline route. */
export function routeLength(path: readonly Vec2[]): number {
  let len = 0
  for (let i = 1; i < path.length; i++) len += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z)
  return len
}

export function nearestNode(p: Vec2): NavNode
export function nearestNode(x: number, z: number): NavNode
/** The nearest node `p` reaches along a legal straight line (falls back to the nearest by distance). */
export function nearestNode(a: Vec2 | number, z?: number): NavNode {
  const p: Vec2 = typeof a === 'number' ? { x: a, z: z ?? 0 } : a
  const anchors = anchorsFor(p, 1)
  if (anchors.length > 0) {
    let best = anchors[0]
    for (const c of anchors) if (c.d < best.d || (c.d === best.d && c.i < best.i)) best = c
    return NAV.nodes[best.i]
  }
  let bi = 0
  let bd = Infinity
  for (const n of NAV.nodes) {
    const d = Math.hypot(n.x - p.x, n.z - p.z)
    if (d < bd) {
      bd = d
      bi = n.index
    }
  }
  return NAV.nodes[bi]
}
