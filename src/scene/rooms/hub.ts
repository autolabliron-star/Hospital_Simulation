/**
 * Nurse hubs: a curved counter that opens toward the corridor at the counter door, two workstations with screens
 * (in front of the staff spots) and a chart rack. Written once in hub coordinates, placed through a ward frame, so
 * hub B is hub A mirrored in z.
 *
 *   hub coordinates:  u = metres east of x = 0,  v = metres from the corridor wall into the hub
 */
import { BANDS } from '@/sim/places'
import type { WardId } from '@/sim/types'
import { wardFrame, type Frame, type LayoutBuilder } from '@/scene/building/layout/builder'
import { TILE } from '@/scene/building/layout/screenTiles'

/** The back counter: an elliptical arc (centre line) from the west end over the back to the east end. */
const ARC = { cu: 0, cv: 2.9, a: 4.0, b: 2.35, steps: 14, depth: 0.55, height: 1.02 } as const

function curvedCounter(f: Frame, id: string): void {
  const { cu, cv, a, b, steps, depth, height } = ARC
  for (let i = 0; i < steps; i++) {
    const t0 = Math.PI - (i / steps) * Math.PI
    const t1 = Math.PI - ((i + 1) / steps) * Math.PI
    const p0 = { u: cu + a * Math.cos(t0), v: cv + b * Math.sin(t0) }
    const p1 = { u: cu + a * Math.cos(t1), v: cv + b * Math.sin(t1) }
    const mu = (p0.u + p1.u) / 2
    const mv = (p0.v + p1.v) / 2
    const du = p1.u - p0.u
    const dv = p1.v - p0.v
    const len = Math.hypot(du, dv) + 0.09
    // heading of the segment's local +z along the chord
    const ry = Math.atan2(du, dv)
    f.rbox(mu, 0, mv, depth, height - 0.04, len, 'whitePlastic', { ry, r: 0.04 })
    f.rbox(mu, height - 0.04, mv, depth + 0.1, 0.045, len, 'woodOak', { ry, r: 0.02 })
    f.rect(`${id}:counter${i}`, mu, mv, depth + 0.1, len, { ry })
  }
  // soft light strip along the front of the counter top
  f.box(cu, height + 0.005, cv + b - depth / 2 - 0.02, 0.9, 0.012, 0.03, 'glowTeal', { cast: false })
}

function workstation(f: Frame, id: string, wardLabel: string, su: number, spotNode: string): void {
  const v = 1.8
  f.rbox(su, 0, v, 2.0, 0.74, 0.7, 'whitePlastic', { r: 0.03 })
  f.rbox(su, 0.74, v, 2.06, 0.04, 0.76, 'woodOak', { r: 0.02 })
  f.display(su - 0.4, 1.08, v + 0.1, 0.5, 0.32, TILE.chart, { ry: 0, lean: 0.1 })
  f.display(su + 0.4, 1.08, v + 0.1, 0.5, 0.32, TILE.list, { ry: 0, lean: 0.1 })
  f.rbox(su, 0.78, v - 0.12, 0.44, 0.015, 0.14, 'whitePlastic', { r: 0.005, cast: false }) // keyboard
  f.rect(`${id}:desk${wardLabel}`, su, v, 2.06, 0.76, { serves: { nodes: [spotNode], reach: 1.6 } })
}

function chartRack(f: Frame, id: string, ru: number, rv: number): void {
  f.rbox(ru, 0, rv, 0.4, 1.15, 1.2, 'woodOak', { r: 0.03 })
  f.box(ru + 0.205, 0.2, rv, 0.01, 0.75, 1.0, 'wallMint', { cast: false })
  for (let i = 0; i < 6; i++) f.box(ru, 1.15, rv - 0.5 + i * 0.2, 0.28, 0.2, 0.1, i % 2 ? 'fabricTeal' : 'linen', { cast: false })
  f.rect(`${id}:rack`, ru, rv, 0.4, 1.2)
}

function medCabinet(f: Frame, id: string, mu: number, mv: number): void {
  f.rbox(mu, 0, mv, 0.45, 1.05, 1.1, 'whitePlastic', { r: 0.04 })
  f.box(mu - 0.23, 0.3, mv, 0.012, 0.5, 0.9, 'wallMint', { cast: false })
  f.box(mu - 0.236, 0.9, mv, 0.012, 0.05, 0.3, 'glowTeal')
  f.rect(`${id}:cabinet`, mu, mv, 0.45, 1.1)
}

export function buildHub(b: LayoutBuilder, w: WardId): void {
  b.area = w === 'A' ? 'hubA' : 'hubB'
  const f = wardFrame(b, w, 0, BANDS.roomWall)
  const id = `hub${w}`
  curvedCounter(f, id)
  workstation(f, id, 'W', -2.5, `hub:${w}:spot:0`)
  workstation(f, id, 'E', 2.5, `hub:${w}:spot:1`)
  chartRack(f, id, -4.55, 0.95)
  medCabinet(f, id, 4.6, 1.2)
  // a plant at the counter's west end
  f.cyl(-4.5, 0, 4.2, 0.34, 0.3, 'whitePlastic')
  f.sphere(-4.5, 0.3, 4.2, 0.5, 0.6, 0.5, 'leaf')
  f.circle(`${id}:plant`, -4.5, 4.2, 0.26)
}
