/**
 * R5 wave 3: the CT suite's anaesthesia machine, drawn with the cryo rig's own instance pools (MAT.tinted boxes and cylinders with instance colours: no
 * new draw call, no new material). It stands at `CRYO_SUITE.anaesMachine` (0.64 x 0.78 m, heading pi: its front, where the anaesthetist stands and the
 * hoses leave, faces north to the table's head) and is drawn ALWAYS: its footprint (`l2:cryo:anaes`) is permanent, kidney days included.
 *
 * It is the OR's procedural machine (src/scene/rooms/surgery/or.ts `buildAnaesthesia`) in the same shape, in the pools' primitives: a plinth on four
 * castors, a cabinet with three drawers, a work surface carrying the ventilator (a unit and a bellows under a dome) and a yellow vaporiser, a tower with
 * the monitor's bezel (the monitor itself is a tile of the cryo screens: `ANAES_SCREEN`), the breathing circuit's hoses sagging from the ventilator and two
 * gas supply hoses down the tower's back. Parts are written once, at creation (a machine does not move): nothing runs per frame.
 *
 * `PARTS` is in the machine's own frame: x across (0.64 wide), y up, z toward its front (the +z of heading 0); `toWorld` turns it by the heading.
 */
import { Color } from 'three'
import { putSegment, putYawed } from '@/scene/surgery/matrices'
import { CRYO_SUITE } from '@/sim/places'

const M = CRYO_SUITE.anaesMachine
const H = M.at.heading
const C = Math.cos(H)
const S = Math.sin(H)

/** Local (machine frame) to the sim frame: x across, z toward the front. (putYawed's convention: local +x is (cos h, 0, -sin h), local +z is (sin h, 0, cos h).) */
export function toWorld(lx: number, lz: number): { x: number; z: number } {
  return { x: M.at.at.x + C * lx + S * lz, z: M.at.at.z - S * lx + C * lz }
}

export type Palette = 'white' | 'graphite' | 'steel' | 'bezel' | 'unit' | 'glass' | 'yellow' | 'hoseA' | 'hoseB' | 'gasWhite' | 'gasBlue'
const HEX: Readonly<Record<Palette, string>> = {
  white: '#eef1f3',
  graphite: '#2b2f33',
  steel: '#c3cacf',
  bezel: '#1d2125',
  unit: '#4a5359',
  glass: '#d4e2ea',
  yellow: '#e2c13a',
  hoseA: '#7aa7c0',
  hoseB: '#a9bfcc',
  gasWhite: '#f2f4f5',
  gasBlue: '#4d7fb3',
}
export const ANAES_COLOURS: Readonly<Record<Palette, Color>> = Object.fromEntries((Object.keys(HEX) as Palette[]).map((k) => [k, new Color(HEX[k])])) as Record<Palette, Color>

/** A box (lx, ly, lz its centre; w across, h up, d front to back) or a cylinder (diameter w, height h) in the machine's frame. */
interface Solid {
  name: string
  kind: 'box' | 'cyl'
  lx: number
  ly: number
  lz: number
  w: number
  h: number
  d: number
  colour: Palette
}
/** A hose: a cylinder of diameter `dia` from A to B (local frames). */
interface Hose {
  name: string
  kind: 'hose'
  a: [number, number, number]
  b: [number, number, number]
  dia: number
  colour: Palette
}
export type Part = Solid | Hose

const box = (name: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, colour: Palette): Solid => ({ name, kind: 'box', lx: (x0 + x1) / 2, ly: (y0 + y1) / 2, lz: (z0 + z1) / 2, w: x1 - x0, h: y1 - y0, d: z1 - z0, colour })
const cyl = (name: string, lx: number, lz: number, dia: number, y0: number, y1: number, colour: Palette): Solid => ({ name, kind: 'cyl', lx, ly: (y0 + y1) / 2, lz, w: dia, h: y1 - y0, d: dia, colour })
const hose = (name: string, a: [number, number, number], b: [number, number, number], dia: number, colour: Palette): Hose => ({ name, kind: 'hose', a, b, dia, colour })

/** The tower's front face (local z) and where the monitor's bezel and quad stand. */
export const TOWER_FRONT = 0.1
const SCREEN = { w: 0.4, h: 0.26, tilt: 0.12 } as const
/** The top of the monitor's glass is about `monitorY` over the floor (places.ts), so it centres half its height below. */
const SCREEN_Y = M.monitorY - SCREEN.h / 2

export const PARTS: readonly Part[] = [
  // plinth, castors, cabinet with three drawers (seams and handles on the front)
  box('plinth', -0.29, 0.29, 0.06, 0.14, -0.35, 0.35, 'graphite'),
  ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => cyl(`castor ${sx} ${sz}`, sx * 0.25, sz * 0.31, 0.08, 0, 0.08, 'graphite'))),
  box('cabinet', -0.3, 0.3, 0.14, 0.78, -0.37, 0.37, 'white'),
  ...[0, 1, 2].map((i) => box(`drawer seam ${i}`, -0.26, 0.26, 0.3 + i * 0.16, 0.306 + i * 0.16, 0.37, 0.374, 'graphite')),
  ...[0, 1, 2].map((i) => box(`drawer handle ${i}`, -0.1, 0.1, 0.38 + i * 0.16, 0.395 + i * 0.16, 0.374, 0.388, 'steel')),
  // the work surface, the tower behind it, the monitor's bezel on the tower's front
  box('work surface', -0.32, 0.32, 0.78, 0.82, -0.39, 0.39, 'steel'),
  box('tower', -0.3, 0.3, 0.82, M.size.h, -0.32, TOWER_FRONT, 'white'),
  box('monitor bezel', -SCREEN.w / 2 - 0.02, SCREEN.w / 2 + 0.02, SCREEN_Y - SCREEN.h / 2 - 0.02, SCREEN_Y + SCREEN.h / 2 + 0.02, TOWER_FRONT, TOWER_FRONT + 0.008, 'bezel'),
  // the ventilator on the work surface: the unit (left), the vaporiser (middle) and the bellows under its dome (right)
  box('ventilator unit', -0.3, -0.11, 0.82, 1.04, 0.1, 0.32, 'unit'),
  cyl('vaporiser', -0.01, 0.2, 0.1, 0.82, 0.98, 'yellow'),
  cyl('vaporiser cap', -0.01, 0.2, 0.07, 0.98, 1.02, 'graphite'),
  cyl('bellows', 0.17, 0.22, 0.22, 0.82, 1.04, 'glass'),
  cyl('bellows dome', 0.17, 0.22, 0.18, 1.04, 1.08, 'graphite'),
  // the breathing circuit: two hoses leave the ventilator's front, sag and hang on the cabinet's corner on their way to the patient
  hose('circuit A 1', [-0.22, 0.94, 0.32], [-0.2, 0.9, 0.46], 0.028, 'hoseA'),
  hose('circuit A 2', [-0.2, 0.9, 0.46], [-0.14, 0.82, 0.52], 0.028, 'hoseA'),
  hose('circuit B 1', [-0.16, 0.94, 0.32], [-0.12, 0.9, 0.46], 0.028, 'hoseB'),
  hose('circuit B 2', [-0.12, 0.9, 0.46], [-0.06, 0.82, 0.52], 0.028, 'hoseB'),
  // the gas supply hoses (oxygen white, nitrous oxide blue): out of the tower's back, then hanging behind the cabinet toward the wall's outlets
  hose('supply O2 1', [-0.09, 1.3, -0.32], [-0.09, 1.2, -0.46], 0.026, 'gasWhite'),
  hose('supply O2 2', [-0.09, 1.2, -0.46], [-0.09, 0.45, -0.5], 0.026, 'gasWhite'),
  hose('supply N2O 1', [0.09, 1.3, -0.32], [0.09, 1.2, -0.46], 0.026, 'gasBlue'),
  hose('supply N2O 2', [0.09, 1.2, -0.46], [0.09, 0.45, -0.5], 0.026, 'gasBlue'),
]

/** How many boxes and cylinders (the hoses are cylinders) the machine needs in the rig's pools. */
export const ANAES_BOXES = PARTS.filter((p) => p.kind === 'box').length
export const ANAES_CYLS = PARTS.filter((p) => p.kind !== 'box').length

/** The monitor's quad, in the sim frame: just in front of the bezel, its top at `monitorY`, leaning back a little, facing the machine's front. */
export const ANAES_SCREEN = (() => {
  const p = toWorld(0, TOWER_FRONT + 0.012)
  return { x: p.x, y: SCREEN_Y, z: p.z, w: SCREEN.w, h: SCREEN.h, heading: H, tilt: SCREEN.tilt }
})()

/** The pool slots a part got (tests read them): index in its pool. */
export interface PlacedPart {
  part: Part
  pool: 'box' | 'cyl'
  index: number
}

/**
 * Write the machine into the pools' matrix arrays and colours starting at `boxBase` and `cylBase`. `setColor(pool, index, colour)` sets the instance colour.
 * Runs once at the rig's creation. Returns where each part went.
 */
export function writeAnaesMachine(bm: Float32Array, cm: Float32Array, boxBase: number, cylBase: number, setColor: (pool: 'box' | 'cyl', index: number, c: Color) => void): PlacedPart[] {
  const placed: PlacedPart[] = []
  let b = boxBase
  let c = cylBase
  for (const part of PARTS) {
    if (part.kind === 'hose') {
      const a = toWorld(part.a[0], part.a[2])
      const e = toWorld(part.b[0], part.b[2])
      // the hint only has to be any direction across the hose: the world's x axis (a hose never runs along it here)
      putSegment(cm, c, a.x, part.a[1], a.z, e.x, part.b[1], e.z, part.dia, part.dia, 1, 0, 0)
      setColor('cyl', c, ANAES_COLOURS[part.colour])
      placed.push({ part, pool: 'cyl', index: c++ })
      continue
    }
    const p = toWorld(part.lx, part.lz)
    if (part.kind === 'box') {
      putYawed(bm, b, p.x, part.ly, p.z, part.w, part.h, part.d, H)
      setColor('box', b, ANAES_COLOURS[part.colour])
      placed.push({ part, pool: 'box', index: b++ })
    } else {
      putYawed(cm, c, p.x, part.ly, p.z, part.w, part.h, part.d, H)
      setColor('cyl', c, ANAES_COLOURS[part.colour])
      placed.push({ part, pool: 'cyl', index: c++ })
    }
  }
  return placed
}
