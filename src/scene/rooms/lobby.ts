/**
 * The lobby: reception desk at LOBBY.reception (a U-shaped desk the receptionist stands inside), two self check-in
 * kiosks at LOBBY.kiosks, and waiting seats in rows along the free north and south walls.
 *
 * The lobby's nav lattice covers most of the floor, so seats hug the walls where no route runs; the reception desk and
 * the kiosks are stations (their nav nodes ARE where people stand), which is what `serves` records.
 */
import { LOBBY } from '@/sim/places'
import type { Frame, LayoutBuilder } from '@/scene/building/layout/builder'
import { TILE } from '@/scene/building/layout/screenTiles'

function receptionDesk(b: LayoutBuilder): void {
  const f = b.atSpot(LOBBY.reception) // local +z faces the visitors (east)
  const serves = { nodes: ['lobby:reception'], reach: 2.0 }
  // the bar in front of the receptionist (0.62 m ahead), and two returns running back past her
  f.rbox(0, 0, 0.95, 2.7, 1.0, 0.6, 'whitePlastic', { r: 0.05 })
  f.rbox(0, 1.0, 0.95, 2.82, 0.045, 0.72, 'woodOak', { r: 0.02 })
  for (const s of [-1, 1]) {
    f.rbox(s * 1.12, 0, 0.35, 0.5, 0.76, 1.3, 'whitePlastic', { r: 0.04 })
    f.rbox(s * 1.12, 0.76, 0.35, 0.58, 0.04, 1.38, 'woodOak', { r: 0.02 })
  }
  // mint front panel and a glowing name strip toward the visitors
  f.box(0, 0.25, 1.262, 2.4, 0.6, 0.012, 'wallMint', { cast: false })
  f.box(0, 0.96, 1.272, 1.6, 0.03, 0.012, 'glowTeal')
  // screens on the bar, facing the receptionist
  f.display(-0.5, 1.24, 0.85, 0.5, 0.32, TILE.reception, { ry: Math.PI, lean: 0.3 })
  f.display(0.5, 1.24, 0.85, 0.5, 0.32, TILE.chart, { ry: Math.PI, lean: 0.3 })
  f.rect('lobby:reception', 0, 0.48, 3.0, 1.6, { serves })
}

function kiosk(b: LayoutBuilder, i: number): void {
  const k = LOBBY.kiosks[i]
  // the kiosk stands 0.65 m south of the spot where the guest stands, screen facing the guest (north)
  const f = b.at(k.x, k.z + 0.7, Math.PI)
  f.rbox(0, 0, 0, 0.5, 0.18, 0.4, 'metalDark', { r: 0.03 })
  f.rbox(0, 0.18, 0, 0.36, 0.95, 0.24, 'whitePlastic', { r: 0.05 })
  f.display(0, 1.22, 0.12, 0.46, 0.34, TILE.kiosk, { ry: 0, lean: 0.35, t: 0.05, bezel: 'whitePlastic' })
  f.box(0, 0.95, 0.125, 0.2, 0.04, 0.012, 'glowTeal')
  f.rect(`lobby:kiosk${i}`, 0, 0, 0.5, 0.4, { serves: { nodes: [`lobby:kiosk:${i}`], reach: 1.1 } })
}

/**
 * A row of `n` waiting seats on a shared beam, facing local +z. `group` says which door the row serves: the north rows
 * face the triage door, the south rows the ER door (the ER has no seats of its own, so its patients wait here too).
 */
function seatRow(f: Frame, id: string, n: number, pitch: number, group: 'triage' | 'er', row: string): void {
  const w = n * pitch
  f.rbox(0, 0.1, 0, w, 0.06, 0.28, 'metalDark', { r: 0.02 })
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * pitch
    f.rbox(x, 0.3, 0.02, pitch - 0.07, 0.07, 0.46, 'fabricTeal', { r: 0.03 })
    f.rbox(x, 0.34, -0.2, pitch - 0.07, 0.38, 0.06, 'fabricTeal', { r: 0.03, rx: 0.1 })
    f.cyl(x, 0, 0, 0.05, 0.3, 'metalDark')
    f.seat(`waiting:${group}:${row}:${i}`, 'waiting', x, 0.02, 0.37)
  }
  f.rect(id, 0, 0, w, 0.55)
}

function plant(f: Frame, id: string, x: number, z: number): void {
  f.cyl(x, 0, z, 0.42, 0.38, 'whitePlastic')
  f.sphere(x, 0.38, z, 0.6, 0.8, 0.6, 'leaf')
  f.sphere(x + 0.1, 0.9, z + 0.05, 0.4, 0.5, 0.4, 'leafDark')
  f.circle(id, x, z, 0.3)
}

export function buildLobby(b: LayoutBuilder): void {
  b.area = 'lobby'
  const w = b.world
  receptionDesk(b)
  LOBBY.kiosks.forEach((_, i) => kiosk(b, i))

  // north wall: two rows of four, facing south; south wall: two rows of three, facing north
  seatRow(b.at(-59.6, -5.3, 0), 'lobby:seatsN1', 4, 0.62, 'triage', 'N1')
  seatRow(b.at(-56.9, -5.3, 0), 'lobby:seatsN2', 3, 0.62, 'triage', 'N2')
  seatRow(b.at(-59.6, 5.3, Math.PI), 'lobby:seatsS1', 4, 0.62, 'er', 'S1')
  seatRow(b.at(-56.9, 5.3, Math.PI), 'lobby:seatsS2', 3, 0.62, 'er', 'S2')
  plant(w, 'lobby:plantNW', -61.5, -5.2)
  plant(w, 'lobby:plantSW', -61.5, 5.2)

  // a low side table at the end of the north rows (against the wall, off the routes)
  w.cyl(-54.9, 0, -5.2, 0.5, 0.42, 'woodOak')
  w.circle('lobby:sideTable', -54.9, -5.2, 0.26)
}
