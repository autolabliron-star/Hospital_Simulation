/**
 * The minimap (walk mode), pure: how a world position lands on the map, which way the arrow points, the pod colours, the short
 * area labels and the pulse of the "your order" marker. North is up (the plan's -z), so the map always reads like the floor plan
 * on the wall: you turn, the arrow turns, the building stays put. The whole building fits: that is the point of a map that
 * says where the pod carrying your order is.
 *
 * Map pixels: x runs east (right), y runs south (down). World heading is atan2(dx, dz): 0 faces +z (south, down the map).
 */
import { AREAS, areaById, type AreaId } from '@/sim/places'
import type { PodLight } from '@/sim/types'

/** What the map shows: the whole building (x -62..40, z -22..22) plus the paved apron you start on (x from -74). */
export const MAP_BOUNDS = { x0: -76, x1: 42, z0: -24, z1: 24 } as const

export interface MapFrame {
  x0: number
  z0: number
  /** Map pixels per metre. */
  scale: number
  width: number
  height: number
}

/** A frame `widthPx` wide that holds the bounds, with its height following the plan's shape. */
export function mapFrame(widthPx: number, b: { x0: number; x1: number; z0: number; z1: number } = MAP_BOUNDS): MapFrame {
  const scale = widthPx / (b.x1 - b.x0)
  return { x0: b.x0, z0: b.z0, scale, width: widthPx, height: (b.z1 - b.z0) * scale }
}

export function toMapX(f: MapFrame, x: number): number {
  return (x - f.x0) * f.scale
}

export function toMapY(f: MapFrame, z: number): number {
  return (z - f.z0) * f.scale
}

/** The canvas rotation that turns an arrow drawn pointing up (north) to face a world heading. */
export function arrowAngle(heading: number): number {
  return Math.PI - heading
}

/** Pod dots by their light ring: teal carrying medicine, amber waiting, green just delivered, white idle. */
export const POD_COLOR: Record<PodLight, string> = { teal: '#1f9e8f', amber: '#f0a33a', green: '#3fb56b', white: '#ffffff' }

export const MAP_INK = '#1c2b2a'
export const ARROW_COLOR = '#0d6f64'
/** The ring round the pod that carries your order, and the diamond at its destination. */
export const ORDER_COLOR = '#e8590c'

/** Short names for the areas the map labels (the longer `Area.label`s do not fit a 4 m wide room at map size). */
export const MAP_LABELS: readonly { area: AreaId; text: string }[] = [
  { area: 'lobby', text: 'Lobby' },
  { area: 'triage', text: 'Triage' },
  { area: 'er', text: 'ER' },
  { area: 'imagingHall', text: 'Imaging' },
  { area: 'mri', text: 'MRI' },
  { area: 'ct', text: 'CT' },
  { area: 'xray', text: 'X-ray' },
  { area: 'ultrasound', text: 'US' },
  { area: 'diagnostics', text: 'Blood' },
  { area: 'command', text: 'Command' },
  { area: 'core', text: 'Pharmacy' },
  { area: 'atrium', text: 'Atrium' },
  { area: 'corridorA', text: 'Ward A' },
  { area: 'corridorB', text: 'Ward B' },
  { area: 'hubA', text: 'Hub A' },
  { area: 'hubB', text: 'Hub B' },
]

export interface LabelBox {
  /** Centre of the label, map pixels. */
  x: number
  y: number
  /** The room's size on the map. */
  w: number
  h: number
}

/** Where an area's label goes: the centre of its rectangle, and how much room it has. */
export function labelBox(f: MapFrame, area: AreaId): LabelBox {
  const r = areaById(area).rect
  return { x: toMapX(f, (r.x0 + r.x1) / 2), y: toMapY(f, (r.z0 + r.z1) / 2), w: (r.x1 - r.x0) * f.scale, h: (r.z1 - r.z0) * f.scale }
}

/**
 * How a label `textWidth` wide in a `fontPx` font goes in the room (with a little air): along it ('h'), turned a quarter if the
 * room is tall and narrow (the command center, 'v'), or left off (null) when it would spill out over the walls. The letters are
 * about three quarters of the font size tall (capitals, no descenders).
 */
export function labelLayout(box: LabelBox, textWidth: number, fontPx: number): 'h' | 'v' | null {
  const height = fontPx * 0.75 + 2
  if (textWidth + 4 <= box.w && height <= box.h) return 'h'
  if (textWidth + 4 <= box.h && height <= box.w) return 'v'
  return null
}

/** The area fill colours of the fallback plan (drawn until the real floor plan has decoded, and where it has no floor). */
export const AREA_FILL: Record<string, string> = {
  public: '#efe9dc',
  clinical: '#dfeae7',
  staff: '#e2e7ee',
  robot: '#cdd5d3',
  room: '#f1ece1',
  service: '#e3e6e5',
}

/** Every area the fallback plan draws, big ones first so the rooms sit on top of the bands they are in. */
export function fallbackAreas(): { id: AreaId; kind: string; rect: { x0: number; x1: number; z0: number; z1: number } }[] {
  return AREAS.slice()
    .sort((a, b) => (b.rect.x1 - b.rect.x0) * (b.rect.z1 - b.rect.z0) - (a.rect.x1 - a.rect.x0) * (a.rect.z1 - a.rect.z0))
    .map((a) => ({ id: a.id, kind: a.kind, rect: a.rect }))
}

/** 0..1, 1.2 s round: the ring round your pod swells and fades so the eye finds it. */
export function pulse(nowMs: number): number {
  return 0.5 - 0.5 * Math.cos((nowMs / 1200) * Math.PI * 2)
}

/** How often the minimap is redrawn. */
export const MAP_REDRAW_MS = 100
