/**
 * The command center: a curved video wall at COMMAND_WALL (the live map arrives in M4 as a texture on these panels),
 * a desk with two screens in front of every coordinator seat, office chairs, and a round situation table with a map top.
 *
 * The room is enclosed by full-height glass (see walls.ts) on a dark slate floor, so the screens glow.
 *
 * R1 narrowed it to x -22..-12 (10 m). The nav aisle runs at x = COMMAND_SEATS.x + 3 from z -10.5 to 10.5 and the seat
 * spurs cross to it, so everything else lives west of the aisle (the round table between the middle desks) or east of it
 * (plants), each at least 0.35 m clear.
 */
import { COMMAND_SEATS, COMMAND_WALL } from '@/sim/places'
import type { Frame, LayoutBuilder } from '@/scene/building/layout/builder'
import { TILE } from '@/scene/building/layout/screenTiles'

/** Radius of curvature of the video wall (it curves in toward the seats), metres. */
const WALL_RADIUS = 16
const PANELS = 9
const PANEL_Y0 = 0.95
const PANEL_H = COMMAND_WALL.height - PANEL_Y0
const BASE_H = PANEL_Y0

function videoWall(b: LayoutBuilder, f: Frame): void {
  const span = COMMAND_WALL.z1 - COMMAND_WALL.z0
  const dz = span / PANELS
  const cx = COMMAND_WALL.x + WALL_RADIUS // centre of curvature
  for (let i = 0; i < PANELS; i++) {
    const z = COMMAND_WALL.z0 + (i + 0.5) * dz
    const x = COMMAND_WALL.x + (WALL_RADIUS - Math.sqrt(WALL_RADIUS * WALL_RADIUS - z * z))
    const heading = Math.atan2(cx - x, -z)
    const width = dz * 1.02
    // base cabinet and panel bezel
    f.rbox(x, 0, z, width, BASE_H, 0.5, 'metalDark', { ry: heading, r: 0.03 })
    f.rbox(x + Math.sin(heading) * 0.02, PANEL_Y0, z + Math.cos(heading) * 0.02, width, PANEL_H, 0.12, 'metalDark', { ry: heading, r: 0.02 })
    // the screen sits on the face toward the seats; its slice of the wall texture
    b.commandWall.push({
      x: x + Math.sin(heading) * 0.085,
      z: z + Math.cos(heading) * 0.085,
      heading,
      width: width - 0.06,
      y0: PANEL_Y0 + 0.03,
      height: PANEL_H - 0.06,
      // the panels face east and u grows northward (the seated viewer's right), so the north panel shows the last slice
      u0: (PANELS - 1 - i) / PANELS,
      u1: (PANELS - i) / PANELS,
    })
    f.rect(`command:wall${i}`, x, z, width, 0.5, { ry: heading })
  }
  // a soft teal light line along the foot of the wall
  const x = COMMAND_WALL.x + 0.3
  f.box(x, 0.02, 0, 0.04, 0.025, 14.5, 'glowTeal', { cast: false })
}

function coordinatorDesk(b: LayoutBuilder, i: number): void {
  const seat = COMMAND_SEATS[i]
  const f = b.atSpot(seat) // local +z faces the wall
  const node = `command:seat:${i}`
  // office chair
  f.cyl(0, 0, 0, 0.46, 0.04, 'metalDark')
  f.cyl(0, 0.04, 0, 0.06, 0.36, 'metalDark')
  f.rbox(0, 0.4, 0, 0.5, 0.08, 0.48, 'fabricTeal', { r: 0.035 })
  f.rbox(0, 0.48, -0.23, 0.46, 0.5, 0.07, 'fabricTeal', { r: 0.035, rx: 0.1 })
  f.circle(`command:chair${i}`, 0, 0, 0.3, { serves: { nodes: [node], reach: 0.9 } })
  f.seat(`command:desk:${i}`, 'command', 0, 0, 0.48)
  // desk in front
  const dz = 0.43 + 0.39
  f.rbox(0, 0.7, dz, 2.4, 0.04, 0.78, 'whitePlastic', { r: 0.015 })
  f.box(-1.14, 0, dz, 0.05, 0.7, 0.7, 'metalDark')
  f.box(1.14, 0, dz, 0.05, 0.7, 0.7, 'metalDark')
  f.box(0, 0.3, dz + 0.3, 2.2, 0.38, 0.02, 'whitePlastic', { cast: false })
  f.display(-0.55, 1.07, dz + 0.12, 0.62, 0.36, TILE.map, { ry: Math.PI, lean: 0.1 })
  f.display(0.55, 1.07, dz + 0.12, 0.62, 0.36, TILE.list, { ry: Math.PI, lean: 0.1 })
  f.rbox(0, 0.74, dz - 0.16, 0.44, 0.015, 0.14, 'whitePlastic', { r: 0.005, cast: false })
  f.rect(`command:desk${i}`, 0, dz, 2.4, 0.78)
}

/** The situation table sits between the two middle desks, west of the nav aisle (x = -14.6). */
const TABLE = { x: -16.2, z: 0 } as const

function situationTable(f: Frame): void {
  const x = TABLE.x
  const z = TABLE.z
  f.cyl(x, 0, z, 0.9, 0.04, 'metalDark')
  f.cyl(x, 0.04, z, 0.14, 0.68, 'metalDark')
  f.cyl(x, 0.72, z, 1.7, 0.05, 'whitePlastic')
  f.screen(x, 0.775, z, 1.35, 1.35, TILE.map, { lean: Math.PI / 2 })
  f.circle('command:table', x, z, 0.9)
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4
    const cx = x + Math.cos(a) * 1.32
    const cz = z + Math.sin(a) * 1.32
    const c = f.sub(cx, cz, Math.atan2(x - cx, z - cz))
    c.cyl(0, 0, 0, 0.4, 0.03, 'metalDark')
    c.cyl(0, 0.03, 0, 0.05, 0.38, 'metalDark')
    c.rbox(0, 0.4, 0, 0.44, 0.07, 0.44, 'fabricSage', { r: 0.03 })
    c.rbox(0, 0.45, -0.2, 0.42, 0.34, 0.06, 'fabricSage', { r: 0.03 })
    f.circle(`command:stool${k}`, cx, cz, 0.27)
    f.seat(`command:stool:${k}`, 'command', cx, cz, 0.47, { ry: Math.atan2(x - cx, z - cz), prefer: [Math.PI, 2.4, -2.4, Math.PI / 2, -Math.PI / 2] })
  }
}

function plants(f: Frame): void {
  // two in each far corner (the west ones behind the video wall's ends, the east ones east of the aisle) and two midway
  // along the east wall
  const spots: [number, number][] = [
    [-12.8, -10.6],
    [-12.8, 10.6],
    [-21.2, -11.0],
    [-21.2, 11.0],
    [-12.8, -5.5],
    [-12.8, 5.5],
  ]
  spots.forEach(([x, z], i) => {
    f.cyl(x, 0, z, 0.4, 0.34, 'whitePlastic')
    f.sphere(x, 0.34, z, 0.56, 0.7, 0.56, 'leaf')
    f.sphere(x + 0.08, 0.8, z, 0.36, 0.4, 0.36, 'leafDark')
    f.circle(`command:plant${i}`, x, z, 0.3)
  })
}

export function buildCommand(b: LayoutBuilder): void {
  b.area = 'command'
  const w = b.world
  videoWall(b, w)
  COMMAND_SEATS.forEach((_, i) => coordinatorDesk(b, i))
  situationTable(w)
  plants(w)
}
