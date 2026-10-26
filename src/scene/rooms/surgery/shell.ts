/**
 * R2 (agent B): the level-2 rooms around the OR, in sim coordinates (places.ts `l2`): pre-op bays and admissions desk, PACU bays and the
 * nurse island, the family lounge's recliners and sofas, the theatre staff room, sterile supply, the hall's scrub sink, the theatre corridor
 * and the two lift lobbies, and the floor slab the storey stands on. Everything is written in DRAWN x (the numbers of the plan in
 * docs/R2-SURGERY.md) through one frame at sim x = drawn + LEVEL2_DX; the places.ts anchors are read back into drawn x with `drawn()`.
 *
 * Seats: `surgeryBed:preop:<i>` and `surgeryBed:pacu:<i>` (pose 'lie', the mattress top at `BED_TOP` = 0.8 m, the heading runs from the head toward
 * the feet), `waiting:l2PreOp:S:<i>`, `lounge:l2Lounge:*`, `lounge:l2Staff:*` and `bench:l2Corridor:*` (the approach spots are picked when the layout
 * is finished, 0.4 m clear of every footprint). The OR itself (table, consoles, vision cart, anaesthesia, booms) is `or.ts`, agent O's.
 *
 * Keep-clear rules this file follows (the layout tests judge them): every footprint stays half a wall inside its area and 0.35 m from every nav
 * node and edge; the contract's spots (the nurse and desk spots, the theatre base, the scrub spots, the viewing spot, the lift spots) are 0.3 m or more
 * from every footprint, and nothing stands in front of a door: the quarter disc the staff door sweeps, the spurs of the others and the hall's
 * centre line stay empty.
 *
 * Materials are a deliberately short list, so the whole storey merges into about a dozen meshes: the same palette entries the building
 * already has, in the same shadow flags (every prim here lies on level 2, which never casts into the baked sun shadow: layout/index.ts).
 */
import { LEVEL2_DX, l2 } from '@/sim/levels'
import type { Vec2 } from '@/sim/types'
import { BANDS, PACU, PREOP, SURGERY } from '@/sim/places'
import { wardFrame, type Frame, type LayoutBuilder } from '@/scene/building/layout/builder'
import { TILE } from '@/scene/building/layout/screenTiles'

/** The top of the mattress of a pre-op or recovery trolley: the seat height of the patient lying on it. */
export const BED_TOP = 0.8
/** The thickness of the floor slab under level 2 (drawn: 3.0 m up to the level-2 floor at 4.2 m, a plenum in between). */
export const SLAB = { thickness: 1.18, proud: 0.13 } as const

/** A sim x of the places.ts anchors as a drawn x. */
const drawn = (simX: number): number => simX - LEVEL2_DX

// ---------------------------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------------------------

/**
 * A surgical trolley bed in a frame whose +z runs from the head to the feet: wheels, a hydraulic column, the platform and the mattress (top at
 * `BED_TOP`), a pillow, a folded blanket over the feet and two side rails. Footprint 0.86 x 2.0 m.
 */
function trolley(c: Frame, id: string): void {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.cyl(sx * 0.3, 0, sz * 0.75, 0.12, 0.1, 'metalDark')
  c.rbox(0, 0.1, 0, 0.56, 0.06, 1.5, 'metalDark', { r: 0.02 })
  c.cyl(0, 0.16, 0, 0.18, 0.42, 'frame')
  c.rbox(0, 0.58, 0, 0.74, 0.08, 1.96, 'whitePlastic', { r: 0.03 })
  c.rbox(0, 0.66, 0, 0.7, BED_TOP - 0.66, 1.9, 'whitePlastic', { r: 0.05 })
  c.rbox(0, BED_TOP, 0.32, 0.68, 0.03, 1.15, 'fabricTeal', { r: 0.015 })
  c.rbox(0, BED_TOP, -0.74, 0.5, 0.1, 0.3, 'whitePlastic', { r: 0.045 })
  for (const sx of [-1, 1]) c.rbox(sx * 0.38, BED_TOP, 0.0, 0.03, 0.2, 0.9, 'frame', { r: 0.012 })
  c.rect(`${id}:trolley`, 0, 0, 0.86, 2.0)
}

/**
 * A vitals monitor on a floor pole (a weighted base, the pole and the bezel, facing local +z), standing at the local point. The live face (R3,
 * src/scene/monitors) goes in the bezel, at anchor `monitorId`; 1.5 : 1 like its layout.
 */
function monitorPole(c: Frame, id: string, monitorId: string, lx: number, lz: number): void {
  c.cyl(lx, 0, lz, 0.34, 0.03, 'metalDark')
  c.cyl(lx, 0.03, lz, 0.045, 1.5, 'metalDark')
  c.bedMonitor(monitorId, lx, 1.52, lz + 0.03, 0.465, 0.32, { ry: 0, lean: 0.22 })
  c.circle(`${id}:monitor`, lx, lz, 0.2)
}

/** An IV pole: the stem, a five-point base, and two bags hanging at the top. */
function ivPole(c: Frame, id: string, lx: number, lz: number): void {
  c.cyl(lx, 0, lz, 0.4, 0.03, 'frame')
  c.cyl(lx, 0.03, lz, 0.03, 1.75, 'frame')
  c.rbox(lx, 1.74, lz, 0.34, 0.03, 0.03, 'frame', { r: 0.01 })
  for (const s of [-1, 1]) c.rbox(lx + s * 0.1, 1.5, lz, 0.1, 0.22, 0.03, 'whitePlastic', { r: 0.02 })
  c.circle(`${id}:iv`, lx, lz, 0.22)
}

/**
 * A half-drawn curtain between two bays at x: a panel from the wall's inner face `zWall` over the head half of the bed (`toward` is +1 when the
 * room lies to the south of the wall, -1 to the north), its gathered end, and the track above it running on to the rail across the front, at `zRail`.
 */
function curtain(f: Frame, id: string, x: number, zWall: number, toward: 1 | -1, zRail: number): void {
  const zNear = zWall + toward * 0.05
  const zFar = zNear + toward * 1.9
  const mid = (zNear + zFar) / 2
  f.box(x, 0.3, mid, 0.04, 1.75, 1.9, 'fabricSage')
  f.capsule(x, 0.3, zFar - toward * 0.1, 0.2, 1.75, 'fabricSage')
  f.box(x, 2.1, (zNear + zRail) / 2, 0.03, 0.03, Math.abs(zRail - zNear), 'frame')
  f.rect(`${id}:curtain`, x, mid, 0.14, 1.9)
}

/**
 * A sofa for `len` metres facing local +z; `seatPrefix` makes it a two-seater (seats `<prefix>:0`, `<prefix>:1`). `approaches` (world, sim x) sets the
 * seats' approach spots by hand where the builder's search would find none.
 */
function sofa(f: Frame, id: string, x: number, z: number, heading: number, seatPrefix: string, len = 2.2, approaches?: readonly Vec2[]): void {
  const c = f.sub(x, z, heading)
  for (let k = 0; k < 2; k++) c.seat(`${seatPrefix}:${k}`, 'lounge', (k - 0.5) * (len / 2), 0.05, 0.5, approaches ? { approach: approaches[k] } : {})
  c.rbox(0, 0.05, 0, len, 0.35, 0.85, 'fabricSage', { r: 0.05 })
  c.rbox(0, 0.4, -0.3, len, 0.45, 0.22, 'fabricSage', { r: 0.07 })
  for (const s of [-1, 1]) c.rbox(s * (len / 2 - 0.09), 0.4, 0, 0.18, 0.3, 0.85, 'fabricSage', { r: 0.06 })
  c.rbox(-0.5, 0.4, 0.05, len / 2 - 0.2, 0.12, 0.6, 'fabricSage', { r: 0.05 })
  c.rbox(0.5, 0.4, 0.05, len / 2 - 0.2, 0.12, 0.6, 'fabricSage', { r: 0.05 })
  f.rect(id, x, z, len, 0.85, { ry: heading })
}

/** A recliner chair facing local +z (the foot rest side): the seat, a tilted back, two arms and the raised leg rest. Footprint 0.8 x 1.05 m. */
function recliner(f: Frame, id: string, x: number, z: number, heading: number, seatId: string, prefer: readonly number[]): void {
  const c = f.sub(x, z, heading)
  c.seat(seatId, 'lounge', 0, -0.1, 0.46, { prefer, far: 1.3 })
  c.cyl(0, 0, 0.0, 0.5, 0.06, 'metalDark')
  c.rbox(0, 0.06, -0.05, 0.72, 0.38, 0.62, 'fabricTeal', { r: 0.07 })
  c.rbox(0, 0.4, -0.38, 0.72, 0.62, 0.2, 'fabricTeal', { r: 0.08, rx: 0.2 })
  for (const s of [-1, 1]) c.rbox(s * 0.34, 0.38, -0.05, 0.1, 0.22, 0.6, 'fabricTeal', { r: 0.04 })
  c.rbox(0, 0.26, 0.5, 0.6, 0.1, 0.42, 'fabricTeal', { r: 0.04, rx: -0.12 })
  f.rect(id, x, z, 0.8, 1.05, { ry: heading })
}

function coffeeTable(f: Frame, id: string, x: number, z: number, heading: number, w = 0.9, d = 0.5): void {
  const c = f.sub(x, z, heading)
  c.rbox(0, 0, 0, w, 0.4, d, 'woodOak', { r: 0.04 })
  c.rbox(0, 0.4, 0, w + 0.04, 0.03, d + 0.04, 'whitePlastic', { r: 0.015 })
  f.rect(id, x, z, w + 0.04, d + 0.04, { ry: heading })
}

/** A plain chair at a table, facing local +z; `seatId` registers a seat. */
function chair(f: Frame, id: string, x: number, z: number, heading: number, seatId: string): void {
  const c = f.sub(x, z, heading)
  c.seat(seatId, 'lounge', 0, 0, 0.47)
  c.cyl(0, 0, 0, 0.42, 0.03, 'metalDark')
  c.cyl(0, 0.03, 0, 0.05, 0.38, 'metalDark')
  c.rbox(0, 0.4, 0, 0.46, 0.07, 0.46, 'fabricTeal', { r: 0.03 })
  c.rbox(0, 0.46, -0.21, 0.44, 0.4, 0.06, 'fabricTeal', { r: 0.03, rx: 0.08 })
  f.circle(id, x, z, 0.28)
}

/** A potted plant (two spheres of foliage in a pot): the one green accent of the storey, in the sage and teal of the fabrics. */
function plant(f: Frame, id: string, x: number, z: number, scale = 1): void {
  f.cyl(x, 0, z, 0.38 * scale, 0.34 * scale, 'whitePlastic')
  f.sphere(x, 0.34 * scale, z, 0.56 * scale, 0.72 * scale, 0.56 * scale, 'fabricSage')
  f.sphere(x + 0.08 * scale, 0.82 * scale, z, 0.36 * scale, 0.42 * scale, 0.36 * scale, 'fabricTeal')
  f.circle(id, x, z, 0.3 * scale)
}

/** A row of waiting chairs on a beam, facing local +z. */
function seatRow(f: Frame, id: string, n: number, pitch: number, seatPrefix: string): void {
  const w = n * pitch
  f.rbox(0, 0.1, 0, w, 0.06, 0.28, 'metalDark', { r: 0.02 })
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * pitch
    f.rbox(x, 0.3, 0.02, pitch - 0.07, 0.07, 0.46, 'fabricTeal', { r: 0.03 })
    f.rbox(x, 0.34, -0.2, pitch - 0.07, 0.38, 0.06, 'fabricTeal', { r: 0.03, rx: 0.1 })
    f.cyl(x, 0, 0, 0.05, 0.3, 'metalDark')
    f.seat(`${seatPrefix}:${i}`, 'waiting', x, 0.02, 0.37)
  }
  f.rect(id, 0, 0, w, 0.55)
}

/** A steel rack against a wall: four shelves of wrapped instrument sets, `len` long (along local x) and 0.5 deep, 1.9 high. */
function rack(f: Frame, id: string, x: number, z: number, heading: number, len: number): void {
  const c = f.sub(x, z, heading) // local +z points away from the wall it stands against
  for (const s of [-1, 1]) c.box(s * (len / 2 - 0.025), 0, 0, 0.05, 1.9, 0.5, 'frame')
  c.box(0, 0, 0, len, 0.08, 0.5, 'frame')
  c.box(0, 1.9, 0, len, 0.03, 0.5, 'frame')
  const n = Math.max(2, Math.round(len / 0.5))
  for (let level = 0; level < 4; level++) {
    const y = 0.3 + level * 0.4
    c.box(0, y, 0, len - 0.1, 0.025, 0.48, 'frame')
    for (let i = 0; i < n; i++) {
      const t = -len / 2 + 0.1 + (i + 0.5) * ((len - 0.2) / n)
      const w = (len - 0.2) / n - 0.06
      // wrapped sets in teal, sterile-wrapped drapes in white
      c.rbox(t, y + 0.025, 0.0, w, 0.18 - (i % 2) * 0.04, 0.4, (i + level) % 3 === 0 ? 'whitePlastic' : 'fabricTeal', { r: 0.02 })
    }
  }
  f.rect(id, x, z, len, 0.5, { ry: heading })
}

// ---------------------------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------------------------

function buildPreOp(b: LayoutBuilder, D: Frame): void {
  b.area = 'l2PreOp'
  const zBed = PREOP.bays[0].at.z
  PREOP.bays.forEach((spot, i) => {
    const bx = drawn(spot.at.x)
    const c = D.sub(bx, zBed, 0) // +z runs from the head (north) to the feet
    trolley(c, `l2:preop:bed${i}`)
    D.seat(`surgeryBed:preop:${i}`, 'surgeryBed', bx, zBed, BED_TOP, { pose: 'lie', ry: 0, far: 1.8 })
    monitorPole(c, `l2:preop:bed${i}`, `preop:${i}`, 0.72, -0.62)
    ivPole(c, `l2:preop:bed${i}`, -0.62, -0.45)
  })
  // curtains: a half-drawn panel between the bays and at the east end, and the rail across the front of the row
  const xs = PREOP.bays.map((s) => drawn(s.at.x))
  const dividers = [...xs.slice(0, -1).map((x, i) => (x + xs[i + 1]) / 2), xs[xs.length - 1] + 1.4]
  const zRail = zBed + 1.85
  dividers.forEach((x, i) => curtain(D, `l2:preop:div${i}`, x, -21.9, 1, zRail))
  D.box((-61.5 + dividers[dividers.length - 1]) / 2, 2.1, zRail, dividers[dividers.length - 1] + 61.5, 0.03, 0.03, 'frame')
  // overhead (no collision): lets the authored theatres zone replace the rail with its ceiling track (REPLACES footprint:l2:preop:div*)
  D.rect('l2:preop:divRail', (-61.5 + dividers[dividers.length - 1]) / 2, zRail, 0.2, 0.2, { overhead: true }) // a marker at the rail's centre (hiding is by prim centre)

  // the admissions desk: a slim counter between the nurse's spot and the guest's (1.0 m apart: the nurse faces east, the guest west)
  const dx = (drawn(PREOP.nurse.at.x) + drawn(PREOP.desk.at.x)) / 2
  const dz = PREOP.desk.at.z
  D.rbox(dx, 0, dz, 0.3, 1.0, 1.7, 'whitePlastic', { r: 0.03 })
  D.rbox(dx, 1.0, dz, 0.4, 0.05, 1.8, 'woodOak', { r: 0.02 })
  D.box(dx + 0.151, 0.9, dz, 0.012, 0.04, 1.3, 'glowTeal')
  D.display(dx - 0.1, 1.32, dz - 0.45, 0.5, 0.32, TILE.chart, { ry: -Math.PI / 2, lean: 0.12 })
  D.display(dx - 0.1, 1.32, dz + 0.45, 0.5, 0.32, TILE.list, { ry: -Math.PI / 2, lean: 0.12 })
  D.rect('l2:preop:desk', dx, dz, 0.4, 1.8)

  // waiting chairs along the south wall, facing north, with an information screen above them
  seatRow(D.sub(-53.0, -10.62, Math.PI), 'l2:preop:waiting', 4, 0.62, 'waiting:l2PreOp:S')
  D.display(-53.0, 1.55, -10.125, 0.9, 0.56, TILE.reception, { ry: Math.PI, lean: 0.04 })
  coffeeTable(D, 'l2:preop:table', -55.4, -10.62, 0, 0.5, 0.5)
  plant(D, 'l2:preop:plant', -50.8, -10.65, 1.1)
  // a run of supply cabinets on the solid south wall, west of the waiting chairs
  D.rbox(-59.8, 0, -10.4, 3.0, 0.9, 0.5, 'whitePlastic', { r: 0.03 })
  D.rbox(-59.8, 0.9, -10.4, 3.06, 0.04, 0.56, 'woodOak', { r: 0.015 })
  D.rect('l2:preop:supply', -59.8, -10.4, 3.06, 0.56)
}

function buildPacu(b: LayoutBuilder, D: Frame): void {
  b.area = 'l2Pacu'
  const zBed = PACU.bays[0].at.z
  const xs = PACU.bays.map((s) => drawn(s.at.x))
  PACU.bays.forEach((spot, i) => {
    const bx = drawn(spot.at.x)
    const c = D.sub(bx, zBed, Math.PI) // +z runs from the head (south) to the feet (north)
    trolley(c, `l2:pacu:bed${i}`)
    D.seat(`surgeryBed:pacu:${i}`, 'surgeryBed', bx, zBed, BED_TOP, { pose: 'lie', ry: Math.PI, far: 1.8 })
    monitorPole(c, `l2:pacu:bed${i}`, `pacu:${i}`, 0.72, -0.62)
    ivPole(c, `l2:pacu:bed${i}`, -0.62, -0.45)
  })
  // half-drawn curtains between the bays (the head ends are against the south wall) and the rail along the front of the row
  const zRail = zBed - 1.85
  xs.slice(0, -1).forEach((x, i) => curtain(D, `l2:pacu:div${i}`, (x + xs[i + 1]) / 2, 21.9, -1, zRail))
  D.box(-48.5, 2.1, zRail, 7.8, 0.03, 0.03, 'frame')
  D.rect('l2:pacu:divRail', -48.5, zRail, 0.2, 0.2, { overhead: true }) // overhead marker at the rail's centre: the authored zone's ceiling track replaces the rail

  // the nurse island, and the nurse's screens turned toward the bays
  const ix = drawn(PACU.island.at.x)
  const iz = PACU.island.at.z
  D.rbox(ix, 0, iz, 2.3, 0.94, 0.7, 'whitePlastic', { r: 0.04 })
  D.rbox(ix, 0.94, iz, 2.4, 0.05, 0.8, 'woodOak', { r: 0.02 })
  D.display(ix - 0.5, 1.28, iz + 0.15, 0.5, 0.32, TILE.chart, { ry: 0, lean: 0.12 })
  // the central station (R3: the live face of all three bays, src/scene/monitors), 1.6 : 1 like its layout
  D.bedMonitor('pacu:station', ix + 0.5, 1.28, iz + 0.15, 0.494, 0.32, { ry: 0, lean: 0.12 })
  D.box(ix, 0.5, iz + 0.352, 2.0, 0.05, 0.012, 'glowTeal')
  D.rect('l2:pacu:island', ix, iz, 2.4, 0.8)
  // supply cabinets along the west wall, north of the bays: z 12.2..15.6, between the cryo suite's two doors (R4)
  D.rbox(-52.55, 0, 13.9, 0.5, 0.9, 3.3, 'whitePlastic', { r: 0.03 })
  D.rbox(-52.55, 0.9, 13.9, 0.55, 0.04, 3.4, 'woodOak', { r: 0.015 })
  D.rect('l2:pacu:supply', -52.55, 13.9, 0.55, 3.4)
  plant(D, 'l2:pacu:plant', -45.0, 10.9, 1.1)
}

function buildLounge(b: LayoutBuilder, D: Frame): void {
  b.area = 'l2Lounge'
  // R4: the lounge is the north half of the old room (z 2..10); the cryoablation suite took the south half (cryoRoom.ts).
  // three recliners facing the west window, approached from the room behind them, and a fourth in the south-west corner facing north
  for (const [i, z] of [4.0, 6.2, 8.4].entries()) {
    recliner(D, `l2:lounge:recliner${i}`, -60.9, z, -Math.PI / 2, `lounge:l2Lounge:recliner:${i}`, [Math.PI, 2.4, -2.4, Math.PI / 2, -Math.PI / 2])
  }
  recliner(D, 'l2:lounge:recliner3', -58.4, 9.3, Math.PI, 'lounge:l2Lounge:recliner:3', [Math.PI / 2, -Math.PI / 2, 0.7, -0.7])
  for (const z of [5.1, 7.3]) {
    D.cyl(-60.9, 0, z, 0.42, 0.45, 'woodOak')
    D.circle(`l2:lounge:side${z}`, -60.9, z, 0.24)
  }
  // a sofa against the east wall facing west and one against the hall wall facing south, a low table in front of each
  sofa(D, 'l2:lounge:sofa0', -53.7, 6.6, -Math.PI / 2, 'lounge:l2Lounge:sofa0')
  // the south-facing sofa's front is its table: its guests step out at the ends (set by hand: the builder's search looks only 1 m out)
  sofa(D, 'l2:lounge:sofa1', -54.6, 2.55, 0, 'lounge:l2Lounge:sofa1', 2.2, [
    { x: l2(-56.15), z: 3.0 },
    { x: l2(-53.65), z: 3.6 },
  ])
  coffeeTable(D, 'l2:lounge:table0', -55.5, 6.6, -Math.PI / 2, 0.9, 0.5)
  coffeeTable(D, 'l2:lounge:table1', -54.6, 3.9, 0, 0.9, 0.5)
  // a soft rug under the sofa group, and a tea and water station on the south wall (the cryo control room is behind it)
  D.plane(-56.2, 0.012, 6.6, 3.0, 3.6, 'fabricSage')
  D.rect('l2:lounge:rug', -56.2, 6.6, 0.2, 0.2, { overhead: true }) // a marker at the rug's centre (not an obstacle): lets the authored zone replace the rug
  const tx = -55.4
  const tz = 9.55
  D.rbox(tx, 0, tz, 3.2, 0.9, 0.6, 'whitePlastic', { r: 0.03 })
  D.rbox(tx, 0.9, tz, 3.26, 0.04, 0.66, 'woodOak', { r: 0.015 })
  D.cyl(tx + 1.1, 0.94, tz, 0.16, 0.32, 'metalDark')
  D.rbox(tx - 1.1, 0.94, tz - 0.05, 0.4, 0.3, 0.4, 'whitePlastic', { r: 0.04 })
  D.rect('l2:lounge:tea', tx, tz, 3.26, 0.66)
  D.rbox(-53.5, 0, 8.6, 0.34, 1.1, 0.34, 'whitePlastic', { r: 0.05 })
  D.cyl(-53.5, 1.1, 8.6, 0.2, 0.18, 'glass')
  D.circle('l2:lounge:cooler', -53.5, 8.6, 0.22)
  plant(D, 'l2:lounge:plantN', -61.2, 2.7, 1.2)
  plant(D, 'l2:lounge:plantS', -61.2, 9.4, 1.2)
}

function buildStaffRoom(b: LayoutBuilder, D: Frame): void {
  b.area = 'l2Staff'
  // lockers along the north wall
  for (let i = 0; i < 6; i++) {
    D.rbox(-61.2 + i * 0.5, 0, -9.6, 0.46, 1.9, 0.5, 'frame', { r: 0.02 })
    D.box(-61.2 + i * 0.5, 1.2, -9.34, 0.03, 0.2, 0.01, 'metalDark')
  }
  D.rect('l2:staff:lockers', -59.95, -9.6, 3.0, 0.5)
  // a sofa and a low table at the west window, facing east
  sofa(D, 'l2:staff:sofa', -61.05, -5.2, Math.PI / 2, 'lounge:l2Staff:sofa')
  coffeeTable(D, 'l2:staff:table', -59.2, -5.2, Math.PI / 2, 0.9, 0.5)
  // a meeting table with four chairs
  D.rbox(-55.6, 0.68, -5.6, 1.4, 0.04, 0.8, 'woodOak', { r: 0.02 })
  for (const t of [-0.55, 0.55]) D.rbox(-55.6 + t, 0, -5.6, 0.05, 0.68, 0.6, 'whitePlastic', { r: 0.015 })
  D.rect('l2:staff:meeting', -55.6, -5.6, 1.4, 0.8)
  for (const [k, [cx, cz, h]] of (
    [
      [-56.0, -6.6, 0],
      [-55.2, -6.6, 0],
      [-56.0, -4.6, Math.PI],
      [-55.2, -4.6, Math.PI],
    ] as const
  ).entries()) {
    chair(D, `l2:staff:chair${k}`, cx, cz, h, `lounge:l2Staff:chair:${k}`)
  }
  // the kitchenette along the east wall
  D.rbox(-53.6, 0, -8.0, 0.6, 0.9, 2.6, 'whitePlastic', { r: 0.03 })
  D.rbox(-53.6, 0.9, -8.0, 0.66, 0.04, 2.66, 'woodOak', { r: 0.02 })
  D.rbox(-53.55, 0.94, -8.8, 0.4, 0.3, 0.5, 'whitePlastic', { r: 0.04 })
  D.cyl(-53.6, 0.94, -7.4, 0.16, 0.32, 'metalDark')
  D.rbox(-53.6, 0.94, -6.9, 0.4, 0.04, 0.4, 'frame', { r: 0.01 })
  D.rect('l2:staff:kitchen', -53.6, -8.0, 0.66, 2.66)
  plant(D, 'l2:staff:plant', -61.2, -2.9, 1.0)
  // (the theatre base spot, THEATRE_BASE, is in the middle of the room, facing the door: nothing is placed within a metre of it)
}

function buildSterile(b: LayoutBuilder, D: Frame): void {
  b.area = 'l2Sterile'
  // tray racks on the north wall (three), the west wall and the east wall, with the middle left free
  for (const x of [-51.3, -48.4, -45.5]) rack(D, `l2:sterile:rackN${x}`, x, -9.65, 0, 2.6)
  rack(D, 'l2:sterile:rackW', -52.65, -6.8, Math.PI / 2, 3.2)
  rack(D, 'l2:sterile:rackE', -44.35, -6.0, -Math.PI / 2, 3.6)
}

function buildHall(b: LayoutBuilder, D: Frame): void {
  b.area = 'l2Hall'
  const s = SURGERY.scrubSink
  const sx = drawn(s.at.x)
  const sz = s.at.z
  // the scrub trough on the OR's north wall: a stainless basin on a splashback, two gooseneck taps worked by knee levers, soap and brush dispensers
  D.box(sx, 1.0, 1.87, s.w, 0.55, 0.04, 'frame')
  D.rbox(sx, 0.82, sz, s.w, 0.2, s.d, 'frame', { r: 0.04 })
  D.rbox(sx, 1.0, sz, s.w - 0.1, 0.01, s.d - 0.1, 'metalDark', { r: 0.02 })
  for (const t of [-0.5, 0.5]) {
    D.cyl(sx + t, 1.0, 1.72, 0.04, 0.3, 'frame')
    D.rbox(sx + t, 1.28, 1.55, 0.04, 0.04, 0.34, 'frame', { r: 0.015 })
    D.box(sx + t, 0.35, 1.78, 0.05, 0.4, 0.04, 'metalDark')
    D.rbox(sx + t, 0.35, 1.5, 0.08, 0.04, 0.3, 'metalDark', { r: 0.015 })
    D.rbox(sx + t, 1.25, 1.84, 0.1, 0.2, 0.06, 'whitePlastic', { r: 0.02 })
  }
  D.rect('l2:hall:scrub', sx, sz, s.w, s.d)
  // a gown and mask cabinet on the north wall
  D.rbox(-53.2, 0, -1.7, 0.9, 1.9, 0.4, 'whitePlastic', { r: 0.03 })
  D.box(-53.2, 1.0, -1.495, 0.7, 0.8, 0.01, 'glass')
  D.rect('l2:hall:cabinet', -53.2, -1.7, 0.9, 0.4)
  D.box(-60.6, 1.2, -1.88, 0.5, 0.3, 0.03, 'fabricTeal')
}

function buildCorridor(b: LayoutBuilder, D: Frame): void {
  b.area = 'l2Corridor'
  // two benches on the glazed east side, backs to the glass: you sit facing west, toward the OR window
  for (const [i, z] of [-6.5, 8.0].entries()) {
    D.rbox(-40.5, 0, z, 0.45, 0.42, 2.0, 'woodOak', { r: 0.04 })
    D.rbox(-40.32, 0.42, z, 0.1, 0.4, 2.0, 'woodOak', { r: 0.04 })
    D.rect(`l2:corridor:bench${i}`, -40.45, z, 0.5, 2.0)
    for (let k = 0; k < 2; k++) D.seat(`bench:l2Corridor:${i}:${k}`, 'bench', -40.55, z + (k - 0.5), 0.42, { ry: -Math.PI / 2 })
  }
}

function buildLifts(b: LayoutBuilder): void {
  for (const w of ['A', 'B'] as const) {
    b.area = w === 'A' ? 'l2LiftA' : 'l2LiftB'
    const f = wardFrame(b, w, LEVEL2_DX - 44, BANDS.roomWall) // u east from drawn x = -44; v toward the outer wall
    for (const u of [1.1, 2.9]) {
      f.box(u, 0, 5.86, 1.3, 1.3, 0.05, 'frame', { cast: false })
      f.box(u - 0.31, 0.02, 5.82, 0.6, 1.26, 0.03, 'metalDark', { cast: false })
      f.box(u + 0.31, 0.02, 5.82, 0.6, 1.26, 0.03, 'metalDark', { cast: false })
      // the car's floor indicator over its doors
      f.box(u, 1.18, 5.82, 0.5, 0.05, 0.02, 'glowTeal')
    }
    f.box(2.0, 0.9, 5.84, 0.07, 0.2, 0.02, 'glowTeal') // call button column between the cars
    f.plane(2.0, 0.012, 4.9, 3.2, 1.1, 'metalDark', { receive: true })
  }
}

/** The floor plate the storey stands on: a slab under the whole footprint, a hair proud of the walls, its top just under the level-2 floor. */
function buildSlab(b: LayoutBuilder, D: Frame): void {
  b.area = 'l2Corridor'
  const w = 22 + 2 * SLAB.proud
  const d = 44 + 2 * SLAB.proud
  D.box(-51, -SLAB.thickness - 0.02, 0, w, SLAB.thickness, d, 'wallCap', { cast: false })
}

export function buildSurgeryShell(b: LayoutBuilder): void {
  const D = b.at(LEVEL2_DX, 0) // drawn x in, sim x out
  buildSlab(b, D)
  buildPreOp(b, D)
  buildPacu(b, D)
  buildLounge(b, D)
  buildStaffRoom(b, D)
  buildSterile(b, D)
  buildHall(b, D)
  buildCorridor(b, D)
  buildLifts(b)
}
