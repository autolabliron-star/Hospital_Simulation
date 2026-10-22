/**
 * The smart patient room. One function writes a room ONCE in room coordinates and places it through a ward frame, so
 * ward B is ward A mirrored in z (positions mirrored, geometry untouched).
 *
 *   room coordinates:  u = metres east of the room's west wall,  v = metres from the corridor wall toward the window
 *   (so the bed head is at v ~ 0.35, the window wall at v = 6, the door at u ~ 1.1)
 *
 * Contents: bed with linen (at `room.bed`, head to the corridor wall; its head section and pillow are the live backrest part, see
 * ./bedParts.ts), an over-bed table with a place for the meal tray, bedside screen on an arm (bezel only, the picture is live), ceiling
 * vitals sensor, family sofa under the window, side table, visitor chair (at `room.chair`), a bathroom pod in the window
 * corner, a plant and a low oak sideboard. Door frame and sliding leaf are part of the shell.
 *
 * Every position that the contract already has (bed, chair, bed heading) is read from the RoomSpec.
 */
import { BANDS, type RoomSpec } from '@/sim/places'
import { roomNodeId } from '@/sim/nav/ids'
import { wardFrame, type Frame, type LayoutBuilder } from '@/scene/building/layout/builder'
import { BACKREST, BED, BEDSIDE_SCREEN, FOOT_SECTION, MADE_BLANKET, MATTRESS, OVERBED } from './bedParts'

function bed(f: Frame, id: string, bu: number, bv: number): void {
  // legs and base
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.cyl(bu + sx * 0.4, 0, bv + sz * 0.88, 0.07, 0.2, 'metalDark')
  f.rbox(bu, 0.2, bv, BED.w, 0.12, BED.l, 'whitePlastic', { r: 0.04 })
  // mattress foot section and linen. The head section (the backrest, with the pillow on it) is NOT here: it is its own instanced part
  // (src/scene/meals/ward) so it can tilt with the sim's recline; this builder only draws the part that stays flat.
  f.rbox(bu, MATTRESS.y0, bv + FOOT_SECTION.dv, MATTRESS.w, MATTRESS.top - MATTRESS.y0, FOOT_SECTION.length, 'linen', { r: MATTRESS.r })
  // a made bed: the blanket lies flat on the mattress from the hinge to the foot, with a teal fold at its top edge. A patient in the bed is covered
  // by the crowd's own blanket (actors/crowd/gear.ts), which stands well above this one and takes the place of it
  f.rbox(bu, MATTRESS.top, bv + 0.44, 0.9, MADE_BLANKET, 1.08, 'linen', { r: MADE_BLANKET / 2 })
  f.rbox(bu, MATTRESS.top, bv + BACKREST.hingeDv + 0.09, 0.91, MADE_BLANKET + 0.012, 0.18, 'fabricTeal', { r: 0.012 })
  // head and foot boards
  f.rbox(bu, 0.22, bv - BED.l / 2 - 0.02, BED.w + 0.02, 0.78, 0.06, 'woodOak', { r: 0.02 })
  f.rbox(bu, 0.22, bv + BED.l / 2 + 0.02, BED.w + 0.02, 0.42, 0.05, 'whitePlastic', { r: 0.02 })
  // side rails
  for (const sx of [-1, 1]) f.rbox(bu + sx * 0.49, 0.5, bv - 0.35, 0.03, 0.2, 0.9, 'frame', { r: 0.012 })
  f.rect(`${id}:bed`, bu, bv, BED.w + 0.02, BED.l + 0.08)
}

/** The over-bed table on the window side of the bed: a C-frame on casters, its plate across the lap (the tray stands on it). */
export function overBedTable(f: Frame, id: string, bu: number, bv: number): void {
  const { plate, column, foot } = OVERBED
  const cu = bu + column.du
  const cv = bv + column.dv
  f.rbox(cu, 0, cv, foot.w, foot.h, foot.d, 'metalDark', { r: 0.012, cast: false }) // foot plate on the floor
  for (const sz of [-1, 1]) f.cyl(cu, 0, cv + sz * (foot.d / 2 - 0.04), 0.05, 0.03, 'rubber', { cast: false }) // casters
  f.rbox(cu, column.y0, cv, column.w, column.h, column.w, 'metalDark', { r: 0.015, cast: false }) // upright
  // arm from the upright over to the plate
  const armLen = column.du - plate.du
  f.rbox(bu + plate.du + armLen / 2, plate.y - 0.035, bv + plate.dv, armLen, 0.035, 0.05, 'metalDark', { r: 0.012, cast: false })
  f.rbox(bu + plate.du, plate.y, bv + plate.dv, plate.w, plate.h, plate.d, 'woodOak', { r: 0.014 })
  // overhead: the plate and arm hang over the bed and the foot is a flat plate against the rail, so nobody routes round it (the nurse's
  // way from the door to the MedDrawer runs along this side of the bed)
  f.rect(`${id}:overbed`, cu, cv, foot.w + 0.06, foot.d, { overhead: true })
}

/** The ward bed: the patient lies in the mattress (top MATTRESS.top = 0.49 m), head to the corridor wall, feet toward the window. */
function bedSeat(f: Frame, room: RoomSpec, bu: number, bv: number): void {
  // local +z is the way to the window in both wards, so heading(0) is the contract's bedHeading
  f.seat(`bed:${room.id}`, 'bed', bu, bv, MATTRESS.top, { pose: 'lie', approach: room.bedside })
}

function bedsideScreen(f: Frame, id: string, bu: number): void {
  // slim arm out of the corridor wall, display hanging over the bed head
  const s = BEDSIDE_SCREEN
  const u = bu + s.du
  f.box(u, 1.16, 0.26, 0.035, 0.035, 0.32, 'metalDark', { cast: false })
  // the bezel only: the picture is drawn by the live bedside-screen layer (src/scene/meals/ward), one tile per room that redraws
  // when the room's occupant or state changes (the same place and size as `bedAnchors(room).screen`)
  f.rbox(u, s.y - s.h / 2, s.v, s.w, s.h, s.t, 'metalDark', { ry: 0, rx: -s.lean, r: Math.min(0.012, s.t / 2 - 0.001), cast: false })
  f.rect(`${id}:screen`, u, 0.4, 0.42, 0.34, { overhead: true })
}

function headwall(f: Frame, bu: number): void {
  f.box(bu, 0.55, 0.115, 1.05, 0.58, 0.03, 'wallMint', { cast: false })
  f.rbox(bu, 1.1, 0.13, 1.0, 0.09, 0.05, 'frame', { r: 0.02, cast: false })
  f.box(bu - 0.3, 0.7, 0.135, 0.06, 0.06, 0.012, 'glowTeal')
}

function ceilingSensor(f: Frame, id: string, bu: number, bv: number): void {
  f.cyl(bu, 2.4, bv, 0.34, 0.035, 'sensorDisc', { cast: false })
  f.torus(bu, 2.37, bv, 0.5, 0.045, 'whitePlastic', { cast: false })
  f.circle(`${id}:sensor`, bu, bv, 0.25, { overhead: true })
}

function sofa(f: Frame, id: string, su: number, sv: number): void {
  const w = 1.9
  const d = 0.85
  f.rbox(su, 0.05, sv, w, 0.35, d, 'fabricSage', { r: 0.05 })
  f.rbox(su, 0.4, sv + 0.3, w, 0.45, 0.22, 'fabricSage', { r: 0.07 }) // backrest toward the window
  for (const sx of [-1, 1]) f.rbox(su + sx * (w / 2 - 0.09), 0.4, sv, 0.18, 0.3, d, 'fabricSage', { r: 0.06 })
  for (const sx of [-1, 1]) f.rbox(su + sx * 0.43, 0.4, sv - 0.05, 0.8, 0.12, 0.6, 'fabricSage', { r: 0.05 })
  f.rbox(su - 0.7, 0.52, sv + 0.1, 0.34, 0.3, 0.1, 'fabricTeal', { r: 0.045, rx: -0.25 }) // scatter cushions
  f.rbox(su + 0.7, 0.52, sv + 0.1, 0.34, 0.3, 0.1, 'fabricTeal', { r: 0.045, rx: -0.25 })
  for (const sx of [-1, 1]) f.cyl(su + sx * (w / 2 - 0.1), 0, sv - 0.3, 0.05, 0.06, 'metalDark')
  f.rect(`${id}:sofa`, su, sv, w, d)
}

function sideTable(f: Frame, id: string, tu: number, tv: number): void {
  f.cyl(tu, 0, tv, 0.26, 0.02, 'metalDark')
  f.cyl(tu, 0.02, tv, 0.05, 0.42, 'metalDark')
  f.cyl(tu, 0.44, tv, 0.42, 0.035, 'woodOak')
  // a small warm lamp on the table
  f.cyl(tu, 0.475, tv, 0.08, 0.03, 'metalDark', { cast: false })
  f.sphere(tu, 0.5, tv, 0.14, 0.17, 0.14, 'glowWarm', { cast: false })
  f.circle(`${id}:table`, tu, tv, 0.22)
}

function visitorChair(f: Frame, id: string, room: RoomSpec, cu: number, cv: number, bu: number, bv: number): void {
  // faces the bed
  const rel = Math.atan2(bu - cu, bv - cv)
  const c = f.sub(cu, cv, rel)
  c.cyl(0, 0, 0, 0.36, 0.025, 'metalDark')
  c.cyl(0, 0.02, 0, 0.05, 0.4, 'metalDark')
  c.rbox(0, 0.42, 0, 0.46, 0.07, 0.46, 'fabricTeal', { r: 0.03 })
  c.rbox(0, 0.46, -0.22, 0.44, 0.42, 0.06, 'fabricTeal', { r: 0.03, rx: 0.12 })
  c.rbox(0.25, 0.62, 0, 0.04, 0.04, 0.34, 'metalDark', { cast: false }) // arm bar
  f.circle(`${id}:chair`, cu, cv, 0.3, { serves: { nodes: [roomNodeId(room.id, 'chair')], reach: 0.6 } })
  f.seat(`visitor:${room.id}`, 'visitor', cu, cv, 0.49, { ry: rel })
}

/** A compact wet-room pod tucked into the window corner, kept low (below the section cut) so it doesn't block the view in. */
function bathroomPod(f: Frame, id: string, pu: number, pv: number, w: number, d: number, h = 0.98): void {
  f.rbox(pu, 0, pv, w, h, d, 'whitePlastic', { r: 0.12 })
  f.rbox(pu, h, pv, w, 0.04, d, 'wallCap', { r: 0.02 })
  // door panel on the face toward the sofa, and a teal "free" light
  f.box(pu - w / 2 - 0.008, 0.08, pv - d / 2 + 0.5, 0.02, h - 0.2, 0.64, 'wallMint', { cast: false })
  f.box(pu - w / 2 - 0.02, 0.46, pv - d / 2 + 0.26, 0.025, 0.18, 0.025, 'frame', { cast: false })
  f.box(pu - w / 2 - 0.012, h - 0.14, pv - d / 2 + 0.18, 0.014, 0.06, 0.06, 'glowTeal')
  f.rect(`${id}:bath`, pu, pv, w, d)
}

function plant(f: Frame, id: string, pu: number, pv: number, scale = 1): void {
  f.cyl(pu, 0, pv, 0.3 * scale, 0.28 * scale, 'whitePlastic')
  f.cyl(pu, 0.26 * scale, pv, 0.26 * scale, 0.03, 'trunk', { cast: false })
  f.sphere(pu, 0.3 * scale, pv, 0.46 * scale, 0.56 * scale, 0.46 * scale, 'leaf')
  f.sphere(pu + 0.1 * scale, 0.62 * scale, pv - 0.05 * scale, 0.34 * scale, 0.4 * scale, 0.34 * scale, 'leafDark')
  f.sphere(pu - 0.1 * scale, 0.58 * scale, pv + 0.08 * scale, 0.3 * scale, 0.36 * scale, 0.3 * scale, 'leaf')
  f.circle(`${id}:plant`, pu, pv, 0.25 * scale)
}

function sideboard(f: Frame, id: string, su: number, sv: number, d: number, len: number): void {
  f.rbox(su, 0, sv, d, 0.78, len, 'woodOak', { r: 0.03 })
  f.rbox(su, 0.78, sv, d + 0.02, 0.03, len + 0.02, 'whitePlastic', { r: 0.012 })
  f.box(su + d / 2 + 0.005, 0.5, sv, 0.01, 0.04, len * 0.7, 'frame', { cast: false }) // handle line
  // a small flat display on top (a family photo frame / tablet dock)
  f.rbox(su, 0.81, sv - 0.3, 0.18, 0.28, 0.04, 'whitePlastic', { r: 0.015, rx: 0.12, ry: Math.PI / 2 })
  f.rect(`${id}:sideboard`, su, sv, d, len)
}

export function buildPatientRoom(b: LayoutBuilder, room: RoomSpec): void {
  b.area = `room:${room.id}`
  const f = wardFrame(b, room.ward, room.rect.x0, BANDS.roomWall)
  const id = room.id
  const bedL = f.toLocal(room.bed.x, room.bed.z)
  const chairL = f.toLocal(room.chair.x, room.chair.z)
  const bu = bedL.lx
  const bv = bedL.lz

  bed(f, id, bu, bv)
  bedSeat(f, room, bu, bv)
  overBedTable(f, id, bu, bv)
  headwall(f, bu)
  // overhead (no collision): lets an authored ward zone replace the procedural headwall (REPLACES footprint:A* / B*)
  f.rect(`${id}:headwall`, bu, 0.17, 1.1, 0.12, { overhead: true })
  bedsideScreen(f, id, bu)
  ceilingSensor(f, id, bu, bv)
  visitorChair(f, id, room, chairL.lx, chairL.lz, bu, bv)

  sofa(f, id, 2.5, 5.42)
  sideTable(f, id, 1.2, 5.55)
  plant(f, id, 0.42, 5.45)
  bathroomPod(f, id, 4.35, 5.2, 1.1, 1.4)
  sideboard(f, id, 0.32, 2.95, 0.38, 1.5)
}
