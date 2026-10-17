/**
 * Floor labels: thin, letter-spaced names lying on the floor (area names, nurse hubs, side rooms and the room numbers just
 * inside each door). Pure data: the renderer draws them once into one canvas atlas with the system font (no CDN fonts).
 */
import { AREAS, BANDS, DOORS, ROOMS, areaById, wardSign } from '@/sim/places'
import type { LayoutBuilder } from '@/scene/building/layout/builder'

const INK = '#4c7b75'
const INK_SOFT = '#6a9690'

export function buildLabels(b: LayoutBuilder): void {
  // big area names: uppercase, light, widely spaced
  const named: { id: string; text: string; x: number; z: number; height: number; maxWidth?: number }[] = [
    { id: 'lobby', text: 'ENTRANCE', x: -56.3, z: -3.8, height: 0.72 },
    { id: 'triage', text: 'TRIAGE', x: -53, z: -14, height: 0.85 },
    { id: 'er', text: 'EMERGENCY', x: -54, z: 14.7, height: 0.8 },
    // the imaging suite: the hall, the four modalities and blood draw (the control rooms are staff areas, unlabelled)
    { id: 'imagingHall', text: 'IMAGING', x: -31.6, z: -0.05, height: 0.62, maxWidth: 5 },
    { id: 'mri', text: 'MRI', x: -37.0, z: -5.75, height: 0.6, maxWidth: 2.2 },
    { id: 'ct', text: 'CT', x: -27.6, z: -5.75, height: 0.6, maxWidth: 2.2 },
    { id: 'xray', text: 'X-RAY', x: -37.4, z: 11.0, height: 0.5, maxWidth: 3.6 },
    { id: 'ultrasound', text: 'ULTRASOUND', x: -31.0, z: 5.6, height: 0.4, maxWidth: 4.6 },
    { id: 'diagnostics', text: 'BLOOD DRAW', x: -25.3, z: 8.9, height: 0.42, maxWidth: 3.6 },
    { id: 'command', text: 'COMMAND CENTER', x: -15, z: -7.2, height: 0.5, maxWidth: 4.9 },
    { id: 'core', text: 'PHARMACY CORE', x: 0, z: -9.8, height: 0.8 },
    { id: 'atrium', text: 'HEALING ATRIUM', x: 23.5, z: 0, height: 0.7 },
    { id: 'hubA', text: 'NURSE HUB A', x: 0, z: -19.4, height: 0.5 },
    { id: 'hubB', text: 'NURSE HUB B', x: 0, z: 19.4, height: 0.5 },
  ]
  for (const n of named) {
    if (!AREAS.some((a) => a.id === n.id)) throw new Error(`labels: unknown area ${n.id}`)
    b.label({ text: n.text, x: n.x, z: n.z, height: n.height, maxWidth: n.maxWidth ?? areaById(n.id as never).rect.x1 - areaById(n.id as never).rect.x0 - 1, color: INK, weight: 'light', spacing: 0.22 })
  }

  // side rooms: small, just inside the door
  const door = (id: string) => DOORS.find((d) => d.id === id)!.center
  const side: { door: string; text: string; dx: number; sign: 1 | -1 }[] = [
    { door: 'staffA', text: 'STAFF ROOM', dx: 2.2, sign: -1 },
    { door: 'loungeA', text: 'FAMILY LOUNGE', dx: -3.5, sign: -1 },
    { door: 'supplyB', text: 'CLEAN SUPPLY', dx: 2.2, sign: 1 },
    { door: 'quietB', text: 'QUIET ROOM', dx: -3.5, sign: 1 },
  ]
  for (const s of side) {
    const c = door(s.door)
    b.label({ text: s.text, x: c.x + s.dx, z: s.sign * (BANDS.roomWall + 0.95), height: 0.36, maxWidth: 4.4, color: INK_SOFT, weight: 'light', spacing: 0.2 })
  }

  // room numbers on the floor just inside each door
  for (const r of ROOMS) {
    b.label({ text: r.id, x: r.rect.x0 + 1.2, z: wardSign(r.ward) * (BANDS.roomWall + 1.85), height: 0.5, maxWidth: 1.6, color: INK, weight: 'regular', spacing: 0.1 })
  }

  b.label({ text: 'AMBULANCE BAY', x: -69, z: 7.5, height: 0.6, maxWidth: 8, color: '#ffffff', weight: 'medium', spacing: 0.2 })
}
