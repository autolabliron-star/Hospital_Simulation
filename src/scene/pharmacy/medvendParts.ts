/**
 * MedVend contents: the 144 bin trays (12 x 6 per face), the packs standing in the stocked bins, and the unit box
 * the gantry parts and glow pills are scaled from. Instance data is plain numbers so the node tests can count it and
 * check that every stocked bin holds exactly one medicine.
 */
import { BoxGeometry, type BufferGeometry, Color } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MEDICINES } from '@/content/catalogue'
import { binPosition } from '@/sim/meds/dispenser'
import { PHARMACY } from '@/sim/places'
import type { WardId } from '@/sim/types'
import { BIN_PACKS, DOCKS, FACE_SIGN, HAND_Y, MV, PACK, PORT, WARDS } from './layout'

export const BIN_SLOTS = PHARMACY.bins.columns * PHARMACY.bins.rows

/**
 * A tray open at the back and the front, built facing +z ("out"); faces are turned half a turn for ward A. The picker
 * works behind the bins and reaches forward into them, while the glass front shows the packs and, through the open
 * backs, the gantry at work.
 */
export function binGeometry(): BufferGeometry {
  const { w, h, d } = MV.bin
  const t = 0.015
  const parts = [
    new BoxGeometry(w, 0.02, d).translate(0, -h / 2 + 0.01, 0),
    new BoxGeometry(t, h, d).translate(-w / 2 + t / 2, 0, 0),
    new BoxGeometry(t, h, d).translate(w / 2 - t / 2, 0, 0),
    new BoxGeometry(w, 0.04, t).translate(0, -h / 2 + 0.02, d / 2 - t / 2),
  ]
  const merged = mergeGeometries(parts, false)
  for (const g of parts) g.dispose()
  if (!merged) throw new Error('MedVend: could not merge the bin tray')
  return merged
}

export function packGeometry(): BufferGeometry {
  return new BoxGeometry(PACK.x, PACK.y, PACK.z)
}

export interface Placement {
  x: number
  y: number
  z: number
  /** Rotation about y (0 for ward B's face, pi for ward A's). */
  yaw: number
}

export interface BinInstance extends Placement {
  ward: WardId
  bin: number
  /** The medicine id stocked in this slot, or null for an empty bin. */
  medId: string | null
}

export interface PackInstance extends Placement {
  ward: WardId
  bin: number
  medId: string
}

const MED_BY_BIN = new Map<number, string>(MEDICINES.map((m) => [m.bin, m.id]))

/**
 * The volume the top dock port and the hand feeding it occupy: the port opening's width (or the palm's, if wider) from
 * the bin fronts out to the glass, and from the tray cradle's underside to the top of the palm at the pushing height.
 */
export function portWindow(dockX: number): { x0: number; x1: number; y0: number; y1: number } {
  const half = Math.max(PORT.w / 2, MV.palm.w / 2) + 0.01
  return { x0: dockX - half, x1: dockX + half, y0: PORT.y0 - 0.01, y1: Math.max(PORT.y1, HAND_Y + MV.palm.h / 2) + 0.01 }
}

/** Is this bin slot in the way of a top dock port or the hand feeding it? Those slots are the face's port windows: no tray there. */
export function isPortWindow(ward: WardId, bin: number): boolean {
  const p = { x: 0, y: 0 }
  binPosition(bin, p)
  for (const d of DOCKS) {
    if (d.ward !== ward) continue
    const win = portWindow(d.x)
    const overlapX = p.x - MV.bin.w / 2 < win.x1 && p.x + MV.bin.w / 2 > win.x0
    const overlapY = p.y - MV.bin.h / 2 < win.y1 && p.y + MV.bin.h / 2 > win.y0
    if (overlapX && overlapY) return true
  }
  return false
}

/** Every bin slot of both faces, except the port windows where the transfer tray passes through the grid. */
export function binInstances(): BinInstance[] {
  const out: BinInstance[] = []
  const p = { x: 0, y: 0 }
  for (const w of WARDS) {
    const s = FACE_SIGN[w]
    for (let bin = 0; bin < BIN_SLOTS; bin++) {
      if (isPortWindow(w, bin)) continue
      binPosition(bin, p)
      out.push({ ward: w, bin, medId: MED_BY_BIN.get(bin) ?? null, x: p.x, y: p.y, z: s * MV.bin.out, yaw: s < 0 ? Math.PI : 0 })
    }
  }
  return out
}

/** Packs standing in the stocked bins: 5 across, 2 layers. */
export function packInstances(): PackInstance[] {
  const out: PackInstance[] = []
  for (const b of binInstances()) {
    if (b.medId === null) continue
    for (let layer = 0; layer < BIN_PACKS.layers; layer++) {
      for (let c = 0; c < BIN_PACKS.columns; c++) {
        const lx = (c - (BIN_PACKS.columns - 1) / 2) * BIN_PACKS.pitchX
        const ly = BIN_PACKS.y0 + layer * BIN_PACKS.pitchY
        // local x flips with the face's half turn; out stays at the bin's depth
        const sx = b.yaw === 0 ? 1 : -1
        out.push({ ward: b.ward, bin: b.bin, medId: b.medId, x: b.x + sx * lx, y: b.y + ly, z: b.z, yaw: b.yaw })
      }
    }
  }
  return out
}

/** Tray tint: a hint of the stocked medicine's colour, or pale for an empty bin. */
export function binTint(medId: string | null, out: Color): Color {
  const med = medId === null ? undefined : MEDICINES.find((m) => m.id === medId)
  if (!med) return out.set('#e4ecea')
  return out.set('#f4f8f7').lerp(new Color(med.color), 0.22)
}

/** Parts of the gantry per face, all scaled from one unit box (see Gantry.tsx for what each one does). */
export const GANTRY_PARTS = ['mast', 'carriage', 'arm', 'palm', 'fingerL', 'fingerR', 'pack'] as const
export type GantryPart = (typeof GANTRY_PARTS)[number]

/**
 * Instances of the one gantry mesh: the parts of each face's picker, then one transfer-tray plate per dock port
 * (instance `WARDS.length * GANTRY_PARTS.length + dockIndex`).
 */
export const TRAY_BASE = WARDS.length * GANTRY_PARTS.length
export const GANTRY_INSTANCES = TRAY_BASE + DOCKS.length
