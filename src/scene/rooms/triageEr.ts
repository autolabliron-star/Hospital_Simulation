/**
 * Triage (4 bays) and the emergency department (6 bays): curtain rails and curtains, trolley beds and monitors in a row
 * along the outer wall, a nurse station and supply run along the free side walls.
 *
 * The halls' nav lattice leaves a free band about 2.4 m deep along every wall, so the bays live there. Written once in
 * hall coordinates (u east, v from the outer wall inward); the ER is the triage mirrored in z.
 */
import type { AreaId } from '@/sim/places'
import { BUILDING } from '@/sim/places'
import type { Frame, LayoutBuilder } from '@/scene/building/layout/builder'
import { TILE } from '@/scene/building/layout/screenTiles'

const HALL_X0 = -62 + 0.1
const HALL_X1 = -44 - 0.1
/** Deepest the bay furniture goes into the hall (the nav lattice row sits at v = 2.73). */
const BAY_DEPTH = 2.3
const RED = '#e05a4f'

function trolley(f: Frame, id: string, cx: number, v: number): void {
  const w = 0.82
  const l = 1.95
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.cyl(cx + sx * 0.33, 0, v + sz * 0.8, 0.1, 0.1, 'rubber', { cast: false })
  f.rbox(cx, 0.1, v, w - 0.1, 0.1, l - 0.2, 'metalDark', { r: 0.02 })
  f.rbox(cx, 0.2, v, w, 0.1, l, 'whitePlastic', { r: 0.04 })
  f.rbox(cx, 0.3, v, w - 0.06, 0.14, l - 0.06, 'linen', { r: 0.05 })
  f.rbox(cx, 0.43, v + 0.3, w - 0.04, 0.08, 1.2, 'fabricTeal', { r: 0.04 }) // blanket
  f.rbox(cx, 0.43, v - 0.7, 0.5, 0.1, 0.3, 'linen', { r: 0.045 }) // pillow
  for (const sx of [-1, 1]) f.rbox(cx + sx * 0.42, 0.42, v + 0.1, 0.03, 0.16, 1.0, 'frame', { r: 0.012 })
  f.rect(`${id}:trolley`, cx, v, w + 0.04, l + 0.04)
}

function monitorStand(f: Frame, id: string, mx: number, mv: number): void {
  f.cyl(mx, 0, mv, 0.34, 0.03, 'metalDark')
  f.cyl(mx, 0.03, mv, 0.045, 1.2, 'metalDark')
  f.display(mx, 1.3, mv + 0.03, 0.42, 0.3, TILE.vitals, { ry: 0, lean: 0.25 })
  f.circle(`${id}:monitor`, mx, mv, 0.18)
}

/** Curtain rail along the front of the bay and a drawn-back curtain at each end. */
function curtains(f: Frame, id: string, x0: number, x1: number, first: boolean, last: boolean): void {
  const w = x1 - x0
  f.box((x0 + x1) / 2, 1.92, BAY_DEPTH, w, 0.03, 0.04, 'frame', { cast: false })
  for (const [x, edge] of [
    [x0, first],
    [x1, last],
  ] as const) {
    if (edge) continue // the hall walls need no curtain
    const v0 = 0.12 // the wall's inner face
    f.box(x, 0.2, (v0 + BAY_DEPTH) / 2, 0.05, 1.7, BAY_DEPTH - v0, 'wallMint')
    f.capsule(x, 0.2, BAY_DEPTH - 0.1, 0.2, 1.72, 'fabricTeal')
    f.rect(`${id}:curtain@${x.toFixed(2)}`, x, (v0 + BAY_DEPTH) / 2, 0.22, BAY_DEPTH - v0)
  }
}

function bay(f: Frame, id: string, i: number, x0: number, x1: number, first: boolean, last: boolean, er: boolean): void {
  const cx = (x0 + x1) / 2
  trolley(f, id, cx, 1.32)
  // ER: the patient lies on the trolley (mattress top 0.44 m), head to the wall, feet to the hall; the heading runs head
  // to feet. Triage: the patient sits on the trolley's foot end. Both are approached from the hall.
  if (er) f.seat(`erBay:bay:${i}`, 'erBay', cx, 1.32, 0.44, { pose: 'lie', far: 1.6 })
  else f.seat(`triageBay:bay:${i}`, 'triageBay', cx, 2.0, 0.44)
  monitorStand(f, id, cx + Math.min(0.9, (x1 - x0) / 2 - 0.4), 0.55)
  curtains(f, id, x0, x1, first, last)
}

function crashCart(f: Frame, id: string, cu: number, cv: number): void {
  f.rbox(cu, 0.1, cv, 0.6, 0.85, 0.5, 'tinted', { r: 0.04, color: RED })
  f.rbox(cu, 0.95, cv, 0.64, 0.04, 0.54, 'whitePlastic', { r: 0.015 })
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.cyl(cu + sx * 0.24, 0, cv + sz * 0.18, 0.1, 0.1, 'rubber', { cast: false })
  f.box(cu, 0.55, cv + 0.256, 0.3, 0.06, 0.01, 'whitePlastic', { cast: false })
  f.circle(`${id}:cart`, cu, cv, 0.37)
}

function deskWithChairs(f: Frame, id: string, du: number, dv: number, lengthV: number): void {
  // desk against the west wall: u = du (centre), runs along v; chairs on the hall side, facing the desk
  f.rbox(du, 0, dv, 0.7, 0.74, lengthV, 'whitePlastic', { r: 0.03 })
  f.rbox(du, 0.74, dv, 0.76, 0.04, lengthV + 0.06, 'woodOak', { r: 0.02 })
  f.display(du - 0.1, 1.07, dv - lengthV / 4, 0.5, 0.34, TILE.chart, { ry: Math.PI / 2, lean: 0.1 })
  f.display(du - 0.1, 1.07, dv + lengthV / 4, 0.5, 0.34, TILE.list, { ry: Math.PI / 2, lean: 0.1 })
  f.rect(`${id}:desk`, du, dv, 0.76, lengthV + 0.06)
  for (const k of [-1, 1]) {
    const cz = dv + k * (lengthV / 4)
    const c = f.sub(du + 0.9, cz, -Math.PI / 2)
    c.cyl(0, 0, 0, 0.4, 0.03, 'metalDark')
    c.cyl(0, 0.03, 0, 0.05, 0.38, 'metalDark')
    c.rbox(0, 0.4, 0, 0.46, 0.07, 0.46, 'fabricSage', { r: 0.03 })
    c.rbox(0, 0.46, -0.21, 0.44, 0.38, 0.06, 'fabricSage', { r: 0.03 })
    f.circle(`${id}:chair${k < 0 ? 0 : 1}`, du + 0.9, cz, 0.28)
    // the patient's chair at the triage nurse's desk (the desk is west of it: the chair faces west)
    f.seat(`triageBay:desk:${k < 0 ? 0 : 1}`, 'triageBay', du + 0.9, cz, 0.47, { ry: -Math.PI / 2 })
  }
}

function supplyRun(f: Frame, id: string, u: number, v0: number, v1: number): void {
  // base cabinets and a wall unit shelf along the east wall (u = centre of a 0.55 m deep run)
  const len = v1 - v0
  const mv = (v0 + v1) / 2
  f.rbox(u, 0, mv, 0.55, 0.9, len, 'whitePlastic', { r: 0.03 })
  f.rbox(u, 0.9, mv, 0.6, 0.04, len + 0.04, 'woodOak', { r: 0.015 })
  const n = Math.round(len / 0.8)
  for (let i = 0; i < n; i++) f.box(u - 0.28, 0.25, v0 + (i + 0.5) * (len / n), 0.012, 0.6, len / n - 0.08, 'wallMint', { cast: false })
  f.rect(`${id}:supply`, u, mv, 0.6, len + 0.04)
}

/** One hall: a frame whose local +z runs from the outer wall into the hall. */
function hall(b: LayoutBuilder, area: AreaId, f: Frame, bays: number, mirrored: boolean): void {
  b.area = area
  const id = area
  const width = (HALL_X1 - HALL_X0) / bays
  for (let i = 0; i < bays; i++) bay(f, `${id}:bay${i}`, i, HALL_X0 + i * width, HALL_X0 + (i + 1) * width, i === 0, i === bays - 1, mirrored)

  // west band: triage nurse station / ER ambulance handover; east band: supply run and crash cart
  if (!mirrored) {
    deskWithChairs(f, id, -61.45, 9.5, 3.0)
  } else {
    // the ER: a parked stretcher by the ambulance doors (west band)
    trolley(f, `${id}:handover`, -60.8, 7)
  }
  supplyRun(f, id, -44.55, 7.6, 14.2)
  crashCart(f, id, -45.4, 14.9)
}

export function buildTriageEr(b: LayoutBuilder): void {
  // triage: v runs south from the north wall (z = -22)
  hall(b, 'triage', b.at(0, BUILDING.z0, 0, 1), 4, false)
  // er: v runs north from the south wall (z = +22): mirrored in z
  hall(b, 'er', b.at(0, BUILDING.z1, 0, -1), 6, true)
}
