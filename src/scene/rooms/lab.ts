/**
 * W4: the automated lab's static room (x -31..-25, z 16..22, behind the blood-draw centre across corridor B): the 0.86 m bench under the
 * one-way U track with its two turntables, the module housings on the outer side (quality camera, two centrifuges, decapper, blood count,
 * chemistry and immunoassay analysers, coagulation, recapper, the glass-door cold archive), the receive station under the pneumatic tube's drop,
 * the review desk and the status totem. Everything is merged per material like the rest of the building (0 extra draw calls: every prim uses a
 * material and shadow-flag combination the building already has). The moving parts (lids, rotors, probes, grippers), the tubes and the lights
 * are the rig's (src/scene/lab/rig.ts) and stand on the numbers of src/scene/lab/labDims.ts, which this file draws from.
 *
 * Footprints keep people and you out of the furniture and 0.35 m clear of the nav routes (the layout tests judge that). The door (x -27.0..-25.6)
 * swings both ways and the building picks its hinge side from the furniture: the biohazard bin by the east wall makes it the WEST side, where the lab
 * is open, so the leaf never sweeps you into the 0.5 m pocket east of the opening; the quarter disc about the west hinge and the U's mouth stay empty.
 * The review desk faces west, towards the scientist's spot LAB.tech[0] (-28, 19.3).
 */
import type { Frame, LayoutBuilder } from '../building/layout/builder'
import type { MatKey } from '../building/layout/types'
import {
  ARCHIVE_SHELF_Y,
  BENCH,
  BENCH_LEGS,
  BEZEL,
  CAMERA_ARCH,
  centrifuge,
  DESK,
  gripperAt,
  housingOf,
  probeAt,
  PROBE_IDS,
  RECEIVE,
  RECEIVE_HOOD,
  SCREENS,
  TOTEM,
  TURNTABLES,
  type Housing,
} from '../lab/labDims'

/** Bounds-style box (x0..x1, y0..y1, z0..z1); never casts into the baked sun shadow (indoors), which keeps every prim in an existing merged mesh. */
function B(f: Frame, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: MatKey, color?: string): void {
  f.box((x0 + x1) / 2, y0, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, mat, { cast: false, ...(color ? { color } : {}) })
}

/** A soft-cornered box from bounds. */
function R(f: Frame, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: MatKey, r = 0.03): void {
  f.rbox((x0 + x1) / 2, y0, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, mat, { cast: false, r })
}

/** A vertical cylinder at (x, z) with diameter `d` from y0 to y1. */
function C(f: Frame, x: number, z: number, d: number, y0: number, y1: number, mat: MatKey): void {
  f.cyl(x, y0, z, d, y1 - y0, mat, { cast: false })
}

/** A dark screen bezel standing BEZEL proud of the wall or face at (x, y, z), size w x h, for a screen that faces `dir` (e: +x, w: -x, n: -z, s: +z). */
function bezel(f: Frame, x: number, y: number, z: number, w: number, h: number, dir: 'e' | 'w' | 'n' | 's'): void {
  const t = BEZEL
  if (dir === 'e' || dir === 'w') {
    const x0 = dir === 'e' ? x : x - t
    B(f, x0, x0 + t, y - h / 2, y + h / 2, z - w / 2, z + w / 2, 'metalDark')
  } else {
    const z0 = dir === 's' ? z : z - t
    B(f, x - w / 2, x + w / 2, y - h / 2, y + h / 2, z0, z0 + t, 'metalDark')
  }
}

// ---------------------------------------------------------------------------------------------
// Bench and track
// ---------------------------------------------------------------------------------------------

function buildBench(f: Frame): void {
  for (const leg of BENCH_LEGS) {
    // the cabinet under the belt, the slab on it, and the belt strip (darker) the pucks ride on
    B(f, leg.x0 + 0.02, leg.x1 - 0.02, 0.05, BENCH.slabTop - BENCH.slabThick, leg.z0 + 0.02, leg.z1 - 0.02, 'whitePlastic')
    B(f, leg.x0 + 0.04, leg.x1 - 0.04, 0, 0.05, leg.z0 + 0.04, leg.z1 - 0.04, 'metalDark')
    B(f, leg.x0, leg.x1, BENCH.slabTop - BENCH.slabThick, BENCH.slabTop, leg.z0, leg.z1, 'frame')
    const west = leg.id === 'west'
    const south = leg.id === 'south'
    if (west) B(f, leg.x0 + 0.03, leg.x1 - 0.03, BENCH.slabTop, BENCH.y - 0.004, leg.z0 + 0.02, leg.z1 - 0.12, 'rubber')
    else if (south) B(f, leg.x0 + 0.0, leg.x1 - 0.0, BENCH.slabTop, BENCH.y - 0.004, leg.z0 + 0.03, leg.z1 - 0.03, 'rubber')
    else B(f, leg.x0 + 0.03, leg.x1 - 0.03, BENCH.slabTop, BENCH.y - 0.004, leg.z0 + 0.12, leg.z1 - 0.12, 'rubber')
    // guard rails either side of the two lanes (0.12 apart): thin metal strips, a few mm tall
    if (west) {
      for (const dx of [-0.105, 0.105]) B(f, -30.0 + dx - 0.004, -30.0 + dx + 0.004, BENCH.slabTop, BENCH.y + 0.012, leg.z0 + 0.02, leg.z1 - 0.12, 'frame')
    } else if (south) {
      for (const dz of [-0.105, 0.105]) B(f, leg.x0, leg.x1, BENCH.slabTop, BENCH.y + 0.012, 21.0 + dz - 0.004, 21.0 + dz + 0.004, 'frame')
    } else {
      for (const dx of [-0.105, 0.105]) B(f, -25.95 + dx - 0.004, -25.95 + dx + 0.004, BENCH.slabTop, BENCH.y + 0.012, leg.z0 + 0.12, leg.z1 - 0.12, 'frame')
    }
    f.rect(`lab:bench:${leg.id}`, (leg.x0 + leg.x1) / 2, (leg.z0 + leg.z1) / 2, leg.x1 - leg.x0, leg.z1 - leg.z0)
  }
  // the two turntables: a dark disc over the belt where the lanes cross
  for (const t of TURNTABLES) {
    C(f, t.x, t.z, t.r * 2, BENCH.slabTop, BENCH.y + 0.004, 'metalDark')
    C(f, t.x, t.z, t.r * 1.2, BENCH.y + 0.004, BENCH.y + 0.008, 'frame')
  }
}

// ---------------------------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------------------------

/** An accent stripe of a module's colour on the face that looks at the track (a coloured instance, the building's existing tinted boxes). */
function accent(f: Frame, h: Housing, y: number, color: string): void {
  const t = 0.012
  switch (h.face) {
    case 'n':
      B(f, h.x0 + 0.03, h.x1 - 0.03, y, y + 0.025, h.z0 + 0.03 - 0.004, h.z0 + 0.03 + t, 'tinted', color)
      break
    case 'e':
      B(f, h.x1 - 0.03 - t, h.x1 - 0.03 + 0.004, y, y + 0.025, h.z0 + 0.03, h.z1 - 0.03, 'tinted', color)
      break
    case 'w':
      B(f, h.x0 + 0.03 - 0.004, h.x0 + 0.03 + t, y, y + 0.025, h.z0 + 0.03, h.z1 - 0.03, 'tinted', color)
      break
    case 's':
      B(f, h.x0 + 0.03, h.x1 - 0.03, y, y + 0.025, h.z1 - 0.03 - t, h.z1 - 0.03 + 0.004, 'tinted', color)
      break
  }
}

/** A dark window on the track-facing face of a housing, between heights y0 and y1, inset `m` from the sides. */
function faceWindow(f: Frame, h: Housing, y0: number, y1: number, m: number): void {
  const t = 0.008
  switch (h.face) {
    case 'n':
      B(f, h.x0 + m, h.x1 - m, y0, y1, h.z0 + 0.03, h.z0 + 0.03 + t, 'screen')
      break
    case 'e':
      B(f, h.x1 - 0.03 - t + 0.002, h.x1 - 0.03 + 0.002, y0, y1, h.z0 + m, h.z1 - m, 'screen')
      break
    case 'w':
      B(f, h.x0 + 0.03 - 0.002, h.x0 + 0.03 + t - 0.002, y0, y1, h.z0 + m, h.z1 - m, 'screen')
      break
    case 's':
      B(f, h.x0 + m, h.x1 - m, y0, y1, h.z1 - 0.03 - t, h.z1 - 0.03, 'screen')
      break
  }
}

function buildCentrifuges(f: Frame): void {
  for (let i = 0; i < 2; i++) {
    const c = centrifuge(i)
    const h = c.h
    // body, the rim round the opening (the lid sits on it), the bowl floor
    R(f, h.x0, h.x1, 0, c.bodyTop, h.z0, h.z1, 'whitePlastic', 0.03)
    B(f, h.x0, h.x0 + (c.cx - c.openHalf - h.x0), c.bodyTop, c.rimTop, h.z0, h.z1, 'whitePlastic')
    B(f, c.cx + c.openHalf, h.x1, c.bodyTop, c.rimTop, h.z0, h.z1, 'whitePlastic')
    B(f, c.cx - c.openHalf, c.cx + c.openHalf, c.bodyTop, c.rimTop, h.z0, c.cz - c.openHalf, 'whitePlastic')
    B(f, c.cx - c.openHalf, c.cx + c.openHalf, c.bodyTop, c.rimTop, c.cz + c.openHalf, h.z1, 'whitePlastic')
    C(f, c.cx, c.cz, 0.5, c.bodyTop, c.bodyTop + 0.012, 'metalDark')
    // a plinth, a hinge block under the lid's west edge, the loading port window and the accent on the east face (towards the belt)
    B(f, h.x0 + 0.02, h.x1 - 0.02, 0, 0.06, h.z0 + 0.02, h.z1 - 0.02, 'metalDark')
    B(f, h.x0, h.x0 + 0.03, c.rimTop - 0.02, c.rimTop + 0.01, c.cz - 0.1, c.cz + 0.1, 'metalDark')
    B(f, h.x1 - 0.004, h.x1 + 0.0, 0.875, 0.915, c.cz - 0.12, c.cz + 0.12, 'screen')
    B(f, h.x1 - 0.012, h.x1 + 0.004, 0.93, 0.95, h.z0 + 0.04, h.z1 - 0.04, 'tinted', '#5ea89c')
    f.rect(`lab:cfg${i}`, (h.x0 + h.x1) / 2, (h.z0 + h.z1) / 2, h.x1 - h.x0, h.z1 - h.z0)
  }
}

function buildCamera(f: Frame): void {
  const a = CAMERA_ARCH
  for (const x of [a.xLeft, a.xRight - a.post]) B(f, x, x + a.post, BENCH.y, a.beamY1, a.z0, a.z1, 'whitePlastic')
  B(f, a.xLeft, a.xRight, a.beamY0, a.beamY1, a.z0, a.z1, 'whitePlastic')
  // the lens block under the beam and the dark hood over the pucks
  B(f, (a.xLeft + a.xRight) / 2 - 0.05, (a.xLeft + a.xRight) / 2 + 0.05, a.beamY0 - 0.045, a.beamY0, (a.z0 + a.z1) / 2 - 0.05, (a.z0 + a.z1) / 2 + 0.05, 'metalDark')
  B(f, a.xLeft + 0.01, a.xRight - 0.01, a.beamY1, a.beamY1 + 0.025, a.z0 + 0.02, a.z1 - 0.02, 'metalDark')
}

function buildDecapRecap(f: Frame): void {
  // decapper (west side, faces east): a tall cabinet with a head over the belt
  {
    const h = housingOf('decap')
    R(f, h.x0, h.x1, 0, 0.9, h.z0, h.z1, 'whitePlastic', 0.03)
    R(f, h.x0 + 0.02, h.x1 - 0.03, 0.9, h.h - 0.05, h.z0 + 0.03, h.z1 - 0.03, 'whitePlastic', 0.03)
    B(f, h.x0 + 0.04, h.x1 - 0.05, h.h - 0.05, h.h, h.z0 + 0.05, h.z1 - 0.05, 'metalDark')
    // the arm over the belt, and the cap bin on top
    const g = gripperAt('decap')
    B(f, h.x1 - 0.05, g.x + 0.06, 1.14, 1.2, g.z - 0.045, g.z + 0.045, 'metalDark')
    B(f, h.x0 + 0.1, h.x0 + 0.24, h.h, h.h + 0.07, h.z0 + 0.12, h.z0 + 0.3, 'metalDark')
    B(f, h.x0, h.x0 + 0.03, 0.18, 0.23, h.z0 + 0.1, h.z1 - 0.1, 'metalDark')
    accent(f, h, 1.12, '#8a95a0')
    faceWindow(f, h, 0.9, 1.1, 0.1)
    f.rect('lab:decap', (h.x0 + h.x1) / 2, (h.z0 + h.z1) / 2, h.x1 - h.x0, h.z1 - h.z0)
  }
  // recapper (east side, faces west)
  {
    const h = housingOf('recap')
    R(f, h.x0, h.x1, 0, 0.9, h.z0, h.z1, 'whitePlastic', 0.03)
    R(f, h.x0 + 0.03, h.x1 - 0.02, 0.9, h.h - 0.05, h.z0 + 0.03, h.z1 - 0.03, 'whitePlastic', 0.03)
    B(f, h.x0 + 0.05, h.x1 - 0.04, h.h - 0.05, h.h, h.z0 + 0.05, h.z1 - 0.05, 'metalDark')
    const g = gripperAt('recap')
    B(f, g.x - 0.06, h.x0 + 0.05, 1.14, 1.2, g.z - 0.045, g.z + 0.045, 'metalDark')
    B(f, h.x1 - 0.2, h.x1 - 0.06, h.h, h.h + 0.07, h.z0 + 0.1, h.z0 + 0.24, 'metalDark')
    accent(f, h, 1.12, '#8a95a0')
    faceWindow(f, h, 0.9, 1.1, 0.08)
    f.rect('lab:recap', (h.x0 + h.x1) / 2, (h.z0 + h.z1) / 2, h.x1 - h.x0, h.z1 - h.z0)
  }
}

const ANALYSER_ACCENT: Record<string, string> = { haem: '#d9546a', chem: '#2bb3a0', immuno: '#5a8fe0', coag: '#e6a53a' }

function buildAnalysers(f: Frame): void {
  for (const id of PROBE_IDS) {
    const { h, x, z } = probeAt(id)
    const south = h.face === 'n'
    // lower body, a dark band (the reagent drawer line), the upper cover, its dark top plate
    R(f, h.x0, h.x1, 0, 0.86, h.z0, h.z1, 'whitePlastic', 0.03)
    B(f, h.x0 + 0.01, h.x1 - 0.01, 0.86, 0.9, h.z0 + 0.01, h.z1 - 0.01, 'metalDark')
    if (south) R(f, h.x0 + 0.02, h.x1 - 0.02, 0.9, h.h - 0.05, h.z0 + 0.03, h.z1 - 0.03, 'whitePlastic', 0.04)
    else R(f, h.x0 + 0.03, h.x1 - 0.03, 0.9, h.h - 0.05, h.z0 + 0.02, h.z1 - 0.02, 'whitePlastic', 0.04)
    B(f, h.x0 + 0.04, h.x1 - 0.04, h.h - 0.05, h.h, h.z0 + 0.05, h.z1 - 0.05, 'metalDark')
    accent(f, h, 0.93, ANALYSER_ACCENT[id])
    faceWindow(f, h, 1.0, h.h - 0.12, id === 'chem' ? 0.12 : 0.08)
    // the arm over the belt that carries the probe
    if (south) B(f, x - 0.05, x + 0.05, 1.14, 1.2, z - 0.01, h.z0 + 0.04, 'metalDark')
    else B(f, x - 0.01, h.x0 + 0.04, 1.14, 1.2, z - 0.05, z + 0.05, 'metalDark')
    f.rect(`lab:${id}`, (h.x0 + h.x1) / 2, (h.z0 + h.z1) / 2, h.x1 - h.x0, h.z1 - h.z0)
  }
  // the chemistry analyser is the big one: a reagent carousel under a smoked cover on top
  {
    const h = housingOf('chem')
    const cx = (h.x0 + h.x1) / 2
    const cz = (h.z0 + h.z1) / 2
    C(f, cx, cz + 0.02, 0.62, h.h, h.h + 0.09, 'frame')
    C(f, cx, cz + 0.02, 0.5, h.h + 0.09, h.h + 0.11, 'metalDark')
    // a second dark window and a touch screen frame on the front: it has two sample stations
    B(f, cx + 0.42, cx + 0.66, 0.95, 1.1, h.z0 + 0.03, h.z0 + 0.04, 'metalDark')
  }
  // the blood count analyser: a reagent drawer pull and a small display on the front
  {
    const h = housingOf('haem')
    B(f, h.x0 + 0.15, h.x1 - 0.15, 0.6, 0.64, h.z0 - 0.0, h.z0 + 0.012, 'frame')
  }
}

function buildArchive(f: Frame): void {
  const h = housingOf('archive')
  const x0 = h.x0
  const x1 = h.x1
  // compressor block, a glass cabinet (back, sides, top), shelves with rack plates, the glass door on the west face (towards the belt)
  R(f, x0, x1, 0, 0.88, h.z0, h.z1, 'whitePlastic', 0.03)
  B(f, x0 + 0.02, x1 - 0.02, 0, 0.05, h.z0 + 0.02, h.z1 - 0.02, 'metalDark')
  B(f, x1 - 0.04, x1, 0.88, h.h, h.z0, h.z1, 'whitePlastic')
  B(f, x0, x1, 0.88, 0.92, h.z0, h.z0 + 0.04, 'whitePlastic')
  B(f, x0, x1, 0.88, 0.92, h.z1 - 0.04, h.z1, 'whitePlastic')
  B(f, x0, x1, 0.88, h.h, h.z0, h.z0 + 0.04, 'whitePlastic')
  B(f, x0, x1, 0.88, h.h, h.z1 - 0.04, h.z1, 'whitePlastic')
  B(f, x0, x1, h.h - 0.04, h.h, h.z0, h.z1, 'whitePlastic')
  for (const y of ARCHIVE_SHELF_Y) {
    B(f, x0 + 0.06, x1 - 0.05, y, y + 0.012, h.z0 + 0.05, h.z1 - 0.05, 'frame')
    for (const rx of [x0 + 0.17, x0 + 0.36]) B(f, rx - 0.07, rx + 0.07, y + 0.012, y + 0.03, h.z0 + 0.07, h.z1 - 0.07, 'metalDark')
  }
  // the glass door (frame + pane), its handle, and the bezel of the status screen above it
  B(f, x0 - 0.012, x0, 0.9, 1.64, h.z0 + 0.04, h.z0 + 0.065, 'frame')
  B(f, x0 - 0.012, x0, 0.9, 1.64, h.z1 - 0.065, h.z1 - 0.04, 'frame')
  B(f, x0 - 0.012, x0, 0.9, 0.925, h.z0 + 0.04, h.z1 - 0.04, 'frame')
  B(f, x0 - 0.012, x0, 1.615, 1.64, h.z0 + 0.04, h.z1 - 0.04, 'frame')
  B(f, x0 - 0.008, x0 - 0.004, 0.925, 1.615, h.z0 + 0.065, h.z1 - 0.065, 'glass')
  B(f, x0 - 0.04, x0 - 0.012, 1.0, 1.4, h.z1 - 0.1, h.z1 - 0.085, 'frame')
  const sc = SCREENS.archive
  bezel(f, x0, sc.at.y, sc.at.z, sc.w + 0.04, sc.h + 0.04, 'w')
  f.rect('lab:archive', (x0 + x1) / 2, (h.z0 + h.z1) / 2, x1 - x0, h.z1 - h.z0)
}

// ---------------------------------------------------------------------------------------------
// The receive station, the totem, the review desk, the wall display
// ---------------------------------------------------------------------------------------------

function buildReceive(f: Frame): void {
  const r = RECEIVE
  const cx = (r.x0 + r.x1) / 2
  R(f, r.x0, r.x1, 0, r.h, r.z0, r.z1, 'whitePlastic', 0.04)
  B(f, r.x0 + 0.02, r.x1 - 0.02, 0, 0.06, r.z0 + 0.02, r.z1 - 0.02, 'metalDark')
  // the hood the tube drops into (the trunk ends inside it at y 1.45), and a funnel collar
  // the hood is clear, so the tube that lands and the tubes waiting for the sorter can be seen standing in it; metal rings at its foot and top
  C(f, RECEIVE_HOOD.x, RECEIVE_HOOD.z, r.hoodR * 2, r.h, r.hoodTop, 'glass')
  C(f, RECEIVE_HOOD.x, RECEIVE_HOOD.z, r.hoodR * 2 + 0.02, r.h, r.h + 0.012, 'frame')
  C(f, RECEIVE_HOOD.x, RECEIVE_HOOD.z, r.hoodR * 2 + 0.03, r.hoodTop - 0.03, r.hoodTop, 'metalDark')
  // the slot the sorter works through, level with the belt start, and the status screen's bezel above it
  B(f, r.x0 + 0.2, r.x1 - 0.2, 0.88, 0.97, r.z1 - 0.004, r.z1 + 0.004, 'screen')
  const sc = SCREENS.labReceive
  bezel(f, sc.at.x, sc.at.y, r.z1, sc.w + 0.04, sc.h + 0.04, 's')
  // the sorter's arm: reaches from the station's face over the belt start
  const g = gripperAt('sort')
  B(f, g.x - 0.04, g.x + 0.04, 1.14, 1.2, r.z1 - 0.02, g.z + 0.05, 'metalDark')
  f.rect('lab:receive', cx, (r.z0 + r.z1) / 2, r.x1 - r.x0, r.z1 - r.z0)
}

function buildTotem(f: Frame): void {
  const t = TOTEM
  R(f, t.x - t.w / 2, t.x + t.w / 2, 0, t.h, t.z - t.d / 2, t.z + t.d / 2, 'whitePlastic', 0.03)
  B(f, t.x - t.w / 2 - 0.02, t.x + t.w / 2 + 0.02, 0, 0.04, t.z - t.d / 2 - 0.03, t.z + t.d / 2 + 0.03, 'metalDark')
  const sc = SCREENS.labStatus
  bezel(f, sc.at.x, sc.at.y, t.z - t.d / 2, sc.w + 0.04, sc.h + 0.04, 'n')
  // a teal light bar across the top (the lab is open and running)
  B(f, t.x - 0.18, t.x + 0.18, t.h - 0.06, t.h - 0.04, t.z - t.d / 2 - 0.004, t.z - t.d / 2 + 0.0, 'glowTeal')
  f.rect('lab:totem', t.x, t.z, t.w, t.d)
}

function buildDesk(f: Frame): void {
  const d = DESK
  const cx = (d.x0 + d.x1) / 2
  const cz = (d.z0 + d.z1) / 2
  // a standing review desk: top on two panels, a monitor turned to face west (the scientist's spot), a keyboard
  R(f, d.x0, d.x1, 0, d.top - 0.04, d.z0 + 0.04, d.z1 - 0.04, 'whitePlastic', 0.02)
  R(f, d.x0 - 0.02, d.x1 + 0.02, d.top - 0.04, d.top, d.z0, d.z1, 'whitePlastic', 0.015)
  B(f, d.x0 + 0.05, d.x0 + 0.15, d.top, d.top + 0.012, cz - 0.15, cz + 0.15, 'metalDark')
  B(f, cx - 0.05, cx + 0.1, d.top, d.top + 0.12, cz - 0.025, cz + 0.025, 'metalDark')
  B(f, cx - 0.11, cx - 0.08, d.top + 0.12, d.top + 0.5, cz - 0.27, cz + 0.27, 'metalDark')
  B(f, cx - 0.118, cx - 0.11, d.top + 0.14, d.top + 0.48, cz - 0.25, cz + 0.25, 'screen')
  B(f, cx - 0.114, cx - 0.108, d.top + 0.3, d.top + 0.32, cz - 0.2, cz + 0.2, 'glowTeal')
  f.rect('lab:desk', cx, cz, d.x1 - d.x0 + 0.04, d.z1 - d.z0)
}

/**
 * A biohazard bin against the east wall beside the door. It is not only furniture: the lab door's leaf swings both ways and its hinge side is the
 * first one whose sweep clears every footprint. East of the opening there are only 0.5 m between an open east-hinged leaf and the wall, a pocket
 * a person swept along by the leaf cannot stand in (src/scene/player/doorsWalk.test.ts); the bin stands where only the east-hinged leaf would
 * reach, so the leaf is hinged on the west side, where the lab is open.
 */
export const BIN = { x0: -25.72, x1: -25.42, z0: 17.05, z1: 17.35, h: 0.62 } as const
function buildBin(f: Frame): void {
  const b = BIN
  R(f, b.x0, b.x1, 0, b.h, b.z0, b.z1, 'whitePlastic', 0.03)
  B(f, b.x0 - 0.005, b.x1 + 0.005, b.h, b.h + 0.04, b.z0 - 0.005, b.z1 + 0.005, 'tinted', '#e6b422')
  B(f, b.x0 + 0.05, b.x1 - 0.05, b.h + 0.04, b.h + 0.05, b.z0 + 0.12, b.z1 - 0.12, 'metalDark')
  f.rect('lab:bin', (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, b.x1 - b.x0, b.z1 - b.z0)
}

function buildWallDisplay(f: Frame): void {
  const sc = SCREENS.centrifuge
  bezel(f, -30.9, sc.at.y, sc.at.z, sc.w + 0.04, sc.h + 0.04, 'e')
}

export function buildLab(b: LayoutBuilder): void {
  b.area = 'lab'
  const f = b.world
  buildBench(f)
  buildCamera(f)
  buildCentrifuges(f)
  buildDecapRecap(f)
  buildAnalysers(f)
  buildArchive(f)
  buildReceive(f)
  buildTotem(f)
  buildDesk(f)
  buildBin(f)
  buildWallDisplay(f)
}
