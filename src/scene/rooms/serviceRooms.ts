/**
 * The side rooms along the wards: staff room (A), family lounge (A), clean supply (B) and quiet room (B), the two lift
 * lobbies and the planters and benches of the main corridor (the spine). Simple, believable furniture sets that hug the
 * walls and keep off the small route triangles around each door.
 *
 * Ward B rooms are the ward A frame mirrored in z (`wardFrame`): `v` runs from the corridor wall toward the outer wall.
 */
import { BANDS } from '@/sim/places'
import { wardFrame, type Frame, type LayoutBuilder } from '@/scene/building/layout/builder'
import { TILE } from '@/scene/building/layout/screenTiles'
import type { MatKey } from '@/scene/building/layout/types'

function chair(f: Frame, id: string, x: number, z: number, heading: number, mat: MatKey = 'fabricTeal', seatId?: string): void {
  const c = f.sub(x, z, heading)
  if (seatId) f.seat(seatId, 'lounge', x, z, 0.47, { ry: heading })
  c.cyl(0, 0, 0, 0.42, 0.03, 'metalDark')
  c.cyl(0, 0.03, 0, 0.05, 0.38, 'metalDark')
  c.rbox(0, 0.4, 0, 0.46, 0.07, 0.46, mat, { r: 0.03 })
  c.rbox(0, 0.46, -0.21, 0.44, 0.4, 0.06, mat, { r: 0.03, rx: 0.08 })
  f.circle(id, x, z, 0.28)
}

function plant(f: Frame, id: string, x: number, z: number, scale = 1): void {
  f.cyl(x, 0, z, 0.38 * scale, 0.34 * scale, 'whitePlastic')
  f.sphere(x, 0.34 * scale, z, 0.56 * scale, 0.72 * scale, 0.56 * scale, 'leaf')
  f.sphere(x + 0.08 * scale, 0.82 * scale, z, 0.36 * scale, 0.42 * scale, 0.36 * scale, 'leafDark')
  f.circle(id, x, z, 0.3 * scale)
}

/** `seatPrefix` makes it a two-seater (cushion top 0.5 m): seats `<prefix>:0` and `<prefix>:1`, either side of the middle. */
function sofa(f: Frame, id: string, x: number, z: number, heading: number, len = 2.2, seatPrefix?: string): void {
  const c = f.sub(x, z, heading) // faces local +z; the back is at -z
  if (seatPrefix) for (let k = 0; k < 2; k++) c.seat(`${seatPrefix}:${k}`, 'lounge', (k - 0.5) * (len / 2), 0.05, 0.5)
  c.rbox(0, 0.05, 0, len, 0.35, 0.85, 'fabricSage', { r: 0.05 })
  c.rbox(0, 0.4, -0.3, len, 0.45, 0.22, 'fabricSage', { r: 0.07 })
  for (const s of [-1, 1]) c.rbox(s * (len / 2 - 0.09), 0.4, 0, 0.18, 0.3, 0.85, 'fabricSage', { r: 0.06 })
  for (const s of [-1, 1]) c.rbox(s * (len / 4), 0.4, 0.05, len / 2 - 0.2, 0.12, 0.6, 'fabricSage', { r: 0.05 })
  f.rect(id, x, z, len, 0.85, { ry: heading })
}

function coffeeTable(f: Frame, id: string, x: number, z: number, w = 0.9, d = 0.5): void {
  f.rbox(x, 0, z, w, 0.4, d, 'woodOak', { r: 0.04 })
  f.rbox(x, 0.4, z, w + 0.04, 0.03, d + 0.04, 'whitePlastic', { r: 0.015 })
  f.rect(id, x, z, w + 0.04, d + 0.04)
}

function armchair(f: Frame, id: string, x: number, z: number, heading: number, mat: MatKey = 'fabricTeal', seatId?: string): void {
  const c = f.sub(x, z, heading)
  if (seatId) c.seat(seatId, 'lounge', 0, 0.05, 0.42)
  c.rbox(0, 0.05, 0, 0.8, 0.35, 0.8, mat, { r: 0.07 })
  c.rbox(0, 0.4, -0.3, 0.8, 0.45, 0.2, mat, { r: 0.07 })
  for (const s of [-1, 1]) c.rbox(s * 0.34, 0.4, 0, 0.14, 0.26, 0.8, mat, { r: 0.05 })
  f.circle(id, x, z, 0.46)
}

// ---------------------------------------------------------------------------------------------
// Staff room (ward A)
// ---------------------------------------------------------------------------------------------

function buildStaffRoom(b: LayoutBuilder): void {
  b.area = 'staffA'
  const f = wardFrame(b, 'A', -40, BANDS.roomWall) // u east from x = -40, v from the corridor wall toward the window
  // north wall (v 4.1..5.8): lockers, kitchenette, two doctors' desks
  for (let i = 0; i < 6; i++) {
    f.rbox(0.75 + i * 0.5, 0, 5.4, 0.46, 1.25, 0.5, 'wallMint', { r: 0.03 })
    f.box(0.75 + i * 0.5, 0.95, 5.14, 0.3, 0.02, 0.01, 'frame', { cast: false })
  }
  f.rect('staff:lockers', 2.0, 5.4, 3.0, 0.5)
  // kitchenette
  f.rbox(6.8, 0, 5.5, 3.4, 0.9, 0.6, 'whitePlastic', { r: 0.03 })
  f.rbox(6.8, 0.9, 5.5, 3.46, 0.04, 0.66, 'woodOak', { r: 0.02 })
  f.rbox(5.9, 0.94, 5.45, 0.5, 0.3, 0.4, 'whitePlastic', { r: 0.04 }) // microwave
  f.box(5.9, 1.0, 5.24, 0.3, 0.16, 0.01, 'screen', { cast: false })
  f.cyl(7.6, 0.94, 5.5, 0.16, 0.32, 'metalDark')
  f.sphere(7.6, 1.2, 5.5, 0.1, 0.1, 0.1, 'glowWarm', { cast: false })
  f.rbox(8.6, 0.94, 5.5, 0.4, 0.04, 0.4, 'frame', { r: 0.01 }) // sink
  f.rect('staff:kitchen', 6.8, 5.5, 3.46, 0.66)
  // doctors' desks (two) with monitors, facing the window wall
  for (const [i, u] of [11.4, 13.4].entries()) {
    f.rbox(u, 0, 5.3, 1.7, 0.74, 0.7, 'whitePlastic', { r: 0.03 })
    f.rbox(u, 0.74, 5.3, 1.76, 0.04, 0.76, 'woodOak', { r: 0.02 })
    f.display(u, 1.07, 5.42, 0.6, 0.36, TILE.chart, { ry: Math.PI, lean: 0.1 })
    f.rect(`staff:desk${i}`, u, 5.3, 1.76, 0.76)
    chair(f, `staff:deskChair${i}`, u, 4.5, Math.PI, 'fabricTeal', `lounge:staffA:desk:${i}`)
  }
  // soft seating in the south-west corner
  sofa(f, 'staff:sofa', 1.9, 1.0, 0, 2.2, 'lounge:staffA:sofa')
  coffeeTable(f, 'staff:table', 1.9, 2.15)
  plant(f, 'staff:plantA', 0.45, 3.2)
  // the south-east table with four chairs
  f.cyl(12.6, 0, 1.9, 0.9, 0.72, 'woodOak')
  f.circle('staff:round', 12.6, 1.9, 0.46)
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4
    const cx = 12.6 + Math.cos(a) * 0.85
    const cz = 1.9 + Math.sin(a) * 0.85
    chair(f, `staff:chair${k}`, cx, cz, Math.atan2(12.6 - cx, 1.9 - cz), 'fabricSage', `lounge:staffA:chair:${k}`)
  }
  plant(f, 'staff:plantB', 14.5, 0.6)
}

// ---------------------------------------------------------------------------------------------
// Family lounge (A) and quiet room (B): same footprint, mirrored wards
// ---------------------------------------------------------------------------------------------

function buildLounge(b: LayoutBuilder): void {
  b.area = 'loungeA'
  const f = wardFrame(b, 'A', 25, BANDS.roomWall)
  // two sofas under the window with a coffee table each, armchairs in the corners
  sofa(f, 'lounge:sofa0', 3.4, 5.2, Math.PI, 2.2, 'lounge:loungeA:sofa0')
  sofa(f, 'lounge:sofa1', 9.0, 5.2, Math.PI, 2.2, 'lounge:loungeA:sofa1')
  coffeeTable(f, 'lounge:table0', 3.4, 4.0, 1.0, 0.55)
  coffeeTable(f, 'lounge:table1', 9.0, 4.0, 1.0, 0.55)
  armchair(f, 'lounge:arm0', 0.9, 4.6, Math.PI * 0.75, 'fabricTeal', 'lounge:loungeA:arm:0')
  armchair(f, 'lounge:arm1', 14.0, 4.6, -Math.PI * 0.75, 'fabricTeal', 'lounge:loungeA:arm:1')
  plant(f, 'lounge:plant0', 0.5, 2.2)
  plant(f, 'lounge:plant1', 6.2, 5.45, 1.2)
  // a children's corner in the south-east: soft blocks and a mat
  f.plane(13.2, 0.012, 1.5, 1.7, 1.7, 'fabricSage')
  f.rbox(12.7, 0.012, 1.1, 0.42, 0.42, 0.42, 'fabricTeal', { r: 0.1 })
  f.rbox(13.4, 0.012, 1.0, 0.36, 0.36, 0.36, 'wallMint', { r: 0.08 })
  f.rbox(13.0, 0.012, 1.9, 0.38, 0.38, 0.38, 'tinted', { r: 0.09, color: '#f0c36a' })
  f.rect('lounge:play', 13.2, 1.5, 1.7, 1.7)
  // water cooler by the door side wall
  f.rbox(14.4, 0, 3.2, 0.32, 1.1, 0.32, 'whitePlastic', { r: 0.05 })
  f.cyl(14.4, 1.1, 3.2, 0.2, 0.18, 'glass', { cast: false })
  f.circle('lounge:cooler', 14.4, 3.2, 0.2)
}

function buildQuietRoom(b: LayoutBuilder): void {
  b.area = 'quietB'
  const f = wardFrame(b, 'B', 25, BANDS.roomWall)
  // two armchairs facing the window with a low table and a plant between them, a bookshelf on the west wall
  armchair(f, 'quiet:arm0', 3.6, 5.1, Math.PI, 'fabricSage', 'lounge:quietB:arm:0')
  armchair(f, 'quiet:arm1', 6.0, 5.1, Math.PI, 'fabricSage', 'lounge:quietB:arm:1')
  f.rbox(4.8, 0, 5.2, 0.5, 0.42, 0.5, 'woodOak', { r: 0.05 })
  f.circle('quiet:table', 4.8, 5.2, 0.28)
  plant(f, 'quiet:plantW', 0.55, 5.4, 1.3)
  plant(f, 'quiet:plantE', 13.4, 5.4, 1.3)
  f.rbox(1.0, 0, 3.0, 0.4, 1.2, 1.8, 'woodOak', { r: 0.03 })
  for (let i = 0; i < 4; i++) f.box(1.2, 0.2 + i * 0.28, 3.0, 0.02, 0.02, 1.7, 'whitePlastic', { cast: false })
  f.rect('quiet:shelf', 1.0, 3.0, 0.4, 1.8)
  // a calm floor rug under a pair of benches in the south-east
  f.plane(13.1, 0.012, 2.7, 2.4, 2.0, 'fabricSage')
  f.rbox(13.1, 0, 3.0, 1.5, 0.42, 0.45, 'woodOak', { r: 0.05 })
  f.rect('quiet:bench', 13.1, 3.0, 1.5, 0.45)
  for (let k = 0; k < 2; k++) f.seat(`lounge:quietB:bench:${k}`, 'lounge', 13.1 + (k - 0.5) * 0.7, 3.0, 0.42, { ry: Math.PI })
}

// ---------------------------------------------------------------------------------------------
// Clean supply (B)
// ---------------------------------------------------------------------------------------------

function shelfUnit(f: Frame, id: string, u: number, v: number, len: number, alongV: boolean): void {
  const w = alongV ? 0.5 : len
  const d = alongV ? len : 0.5
  f.rbox(u, 0, v, w, 1.25, d, 'woodOak', { r: 0.02 })
  // front boards and boxes of supplies in white and mint
  const n = Math.max(2, Math.round(len / 0.45))
  for (let level = 0; level < 3; level++) {
    for (let i = 0; i < n; i++) {
      const t = -len / 2 + (i + 0.5) * (len / n)
      const mat: MatKey = (i + level) % 3 === 0 ? 'wallMint' : 'linen'
      if (alongV) f.box(u, 0.12 + level * 0.38, v + t, 0.42, 0.26, len / n - 0.07, mat, { cast: false })
      else f.box(u + t, 0.12 + level * 0.38, v, len / n - 0.07, 0.26, 0.42, mat, { cast: false })
    }
  }
  f.rect(id, u, v, w, d)
}

function buildSupply(b: LayoutBuilder): void {
  b.area = 'supplyB'
  const f = wardFrame(b, 'B', -40, BANDS.roomWall)
  // shelving along the outer wall, west and east walls
  for (let i = 0; i < 4; i++) shelfUnit(f, `supply:shelfN${i}`, 1.8 + i * 3.3, 5.5, 3.0, false)
  shelfUnit(f, 'supply:shelfW', 0.4, 2.3, 2.6, true)
  shelfUnit(f, 'supply:shelfE', 14.6, 2.3, 2.6, true)
  // two linen carts
  for (const [i, u] of [11.6, 12.6].entries()) {
    f.rbox(u, 0.1, 1.2, 0.6, 0.8, 0.9, 'whitePlastic', { r: 0.04 })
    f.box(u, 0.9, 1.2, 0.62, 0.05, 0.92, 'wallMint')
    f.rect(`supply:cart${i}`, u, 1.2, 0.62, 0.92)
  }
  f.rbox(2.2, 0, 1.2, 1.3, 0.9, 0.6, 'whitePlastic', { r: 0.03 })
  f.rbox(2.2, 0.9, 1.2, 1.36, 0.04, 0.66, 'woodOak', { r: 0.02 })
  f.rect('supply:bench', 2.2, 1.2, 1.36, 0.66)
}

// ---------------------------------------------------------------------------------------------
// Lift lobbies and the main corridor (spine)
// ---------------------------------------------------------------------------------------------

function buildLifts(b: LayoutBuilder): void {
  for (const w of ['A', 'B'] as const) {
    b.area = w === 'A' ? 'liftA' : 'liftB'
    const f = wardFrame(b, w, -44, BANDS.roomWall) // u east from x = -44; v toward the outer wall
    for (const u of [1.1, 2.9]) {
      f.box(u, 0, 5.86, 1.3, 1.3, 0.05, 'frame', { cast: false })
      f.box(u - 0.31, 0.02, 5.82, 0.6, 1.26, 0.03, 'metalDark', { cast: false })
      f.box(u + 0.31, 0.02, 5.82, 0.6, 1.26, 0.03, 'metalDark', { cast: false })
    }
    f.box(2.0, 0.9, 5.84, 0.07, 0.2, 0.02, 'glowTeal') // call button column between the cars
    f.plane(2.0, 0.012, 4.9, 3.2, 1.1, 'rubber', { receive: true })
  }
}

function buildSpine(b: LayoutBuilder): void {
  b.area = 'spine'
  const w = b.world
  for (const z of [-9.5, 9.5, -12, 12]) {
    w.cyl(-40.95, 0, z, 0.55, 0.5, 'whitePlastic')
    w.sphere(-40.95, 0.5, z, 0.7, 0.9, 0.7, 'leaf')
    w.circle(`spine:planter${z}`, -40.95, z, 0.35)
  }
  for (const z of [-5, 5]) {
    w.rbox(-40.5, 0, z, 0.45, 0.42, 2.0, 'woodOak', { r: 0.04 })
    w.rbox(-40.32, 0.42, z, 0.1, 0.4, 2.0, 'woodOak', { r: 0.04 })
    w.rect(`spine:bench${z}`, -40.45, z, 0.5, 2.0)
    // the backrest is on the east side, so the bench faces west, into the spine
    for (let k = 0; k < 2; k++) w.seat(`bench:spine:${z < 0 ? 'N' : 'S'}:${k}`, 'bench', -40.55, z + (k - 0.5), 0.42, { ry: -Math.PI / 2 })
  }
}

export function buildServiceRooms(b: LayoutBuilder): void {
  buildStaffRoom(b)
  buildLounge(b)
  buildQuietRoom(b)
  buildSupply(b)
  buildLifts(b)
  buildSpine(b)
}
