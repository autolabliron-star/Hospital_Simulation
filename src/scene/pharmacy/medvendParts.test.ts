import { describe, expect, it } from 'vitest'
import { MEDICINES } from '@/content/catalogue'
import { CONFIG } from '@/sim/config'
import { binPosition } from '@/sim/meds/dispenser'
import { PHARMACY } from '@/sim/places'
import { BIN_PACKS, DOCKS, FACE_SIGN, GLASS_OUT, HAND_Y, MV, PACK, PICK_SLOT, PORT, TRAY, TRAY_TRAVEL, WARDS } from './layout'
import { BIN_SLOTS, binInstances, isPortWindow, packInstances } from './medvendParts'

/** Axis-aligned box in face space: x along the island, y up, out away from the island centre. */
interface Box {
  x0: number
  x1: number
  y0: number
  y1: number
  o0: number
  o1: number
}
const box = (cx: number, cy: number, co: number, hx: number, hy: number, ho: number): Box => ({ x0: cx - hx, x1: cx + hx, y0: cy - hy, y1: cy + hy, o0: co - ho, o1: co + ho })
const overlap = (a: Box, b: Box, eps = 1e-6): boolean =>
  a.x0 < b.x1 - eps && a.x1 > b.x0 + eps && a.y0 < b.y1 - eps && a.y1 > b.y0 + eps && a.o0 < b.o1 - eps && a.o1 > b.o0 + eps

/** The solid pieces of the bins on one face: tray floor, side walls, front lip, and the standing packs. */
function binSolids(ward: 'A' | 'B'): { trays: Box[]; packs: (Box & { bin: number; pick: boolean })[] } {
  const { w, h, d, out } = MV.bin
  const trays: Box[] = []
  for (const b of binInstances().filter((q) => q.ward === ward)) {
    trays.push(box(b.x, b.y - h / 2 + 0.01, out, w / 2, 0.01, d / 2)) // floor
    trays.push(box(b.x - w / 2 + 0.0075, b.y, out, 0.0075, h / 2, d / 2)) // left wall
    trays.push(box(b.x + w / 2 - 0.0075, b.y, out, 0.0075, h / 2, d / 2)) // right wall
    trays.push(box(b.x, b.y - h / 2 + 0.02, out + d / 2 - 0.0075, w / 2, 0.02, 0.0075)) // front lip
  }
  const packs = packInstances()
    .filter((q) => q.ward === ward)
    .map((q) => ({ ...box(q.x, q.y, out, PACK.x / 2, PACK.y / 2, PACK.z / 2), bin: q.bin, pick: Math.abs(q.y - (binPos(q.bin).y + PICK_SLOT.y)) < 1e-9 && Math.abs(q.x - binPos(q.bin).x) < 1e-9 }))
  return { trays, packs }
}
function binPos(bin: number): { x: number; y: number } {
  return binPosition(bin, { x: 0, y: 0 })
}

/** The hand at carriage (x, y) with the arm reaching `reach`, fingers `grip` closed (0 open .. 1 closed). */
function handBoxes(x: number, y: number, reach: number, grip: number): Box[] {
  const hand = MV.handBase + reach
  const hy = y + MV.handMount
  const fx = MV.finger.open - MV.finger.travel * grip
  const fo = hand + MV.finger.d * 0.65
  return [
    box(x, hy, hand, MV.palm.w / 2, MV.palm.h / 2, MV.palm.d / 2),
    box(x - fx, hy, fo, MV.finger.t / 2, MV.finger.h / 2, MV.finger.d / 2),
    box(x + fx, hy, fo, MV.finger.t / 2, MV.finger.h / 2, MV.finger.d / 2),
  ]
}

describe('bins and packs', () => {
  const stocked = MEDICINES.map((m) => m.bin)

  it('every medicine has a bin on both faces, and each stocked bin holds exactly one medicine', () => {
    for (const w of WARDS) {
      const bins = binInstances().filter((b) => b.ward === w)
      for (const m of MEDICINES) {
        const b = bins.find((q) => q.bin === m.bin)
        expect(b, `${m.id} on face ${w}`).toBeDefined()
        expect(b!.medId).toBe(m.id)
      }
      expect(bins.filter((q) => q.medId !== null)).toHaveLength(MEDICINES.length)
    }
    expect(new Set(stocked).size).toBe(stocked.length)
  })

  it('no stocked bin is ever a port window (the transfer tray passes through unstocked positions only)', () => {
    for (const w of WARDS) for (const bin of stocked) expect(isPortWindow(w, bin), `bin ${bin} on ${w}`).toBe(false)
  })

  it('each face loses exactly the two bins at its two dock ports', () => {
    for (const w of WARDS) {
      const omitted = Array.from({ length: BIN_SLOTS }, (_, i) => i).filter((i) => isPortWindow(w, i))
      expect(omitted).toHaveLength(2)
      expect(binInstances().filter((b) => b.ward === w)).toHaveLength(BIN_SLOTS - 2)
    }
  })

  it('every bin and pack lies inside the island and behind the glass', () => {
    const half = (PHARMACY.island.x1 - PHARMACY.island.x0) / 2
    for (const b of binInstances()) {
      expect(Math.abs(b.x) + MV.bin.w / 2).toBeLessThanOrEqual(half)
      expect(b.y - MV.bin.h / 2).toBeGreaterThanOrEqual(MV.kick)
      expect(b.y + MV.bin.h / 2).toBeLessThanOrEqual(MV.headerY)
      expect(Math.abs(b.z) + MV.bin.d / 2).toBeLessThan(PHARMACY.island.z1)
    }
    expect(packInstances().length).toBe(MEDICINES.length * WARDS.length * BIN_PACKS.columns * BIN_PACKS.layers)
  })

  it('the hand rides at the height of the middle pack of the top layer', () => {
    expect(MV.handMount).toBeCloseTo(PICK_SLOT.y, 9)
    expect(PICK_SLOT.x).toBe(0)
  })
})

describe('the picker hand never intersects the bins', () => {
  it('reaching into any stocked bin, with the fingers open or closed on the pack', () => {
    for (const w of WARDS) {
      const { trays, packs } = binSolids(w)
      for (const m of MEDICINES) {
        const p = binPos(m.bin)
        for (const grip of [0, 0.5, 1]) {
          for (const part of handBoxes(p.x, p.y, MV.reachBin, grip)) {
            for (const t of trays) expect(overlap(part, t), `bin ${m.bin} face ${w} grip ${grip} hits a tray`).toBe(false)
            for (const k of packs) if (!(k.bin === m.bin && k.pick)) expect(overlap(part, k), `bin ${m.bin} face ${w} grip ${grip} hits a pack of bin ${k.bin}`).toBe(false)
          }
        }
      }
    }
  })

  it('with the arm retracted, anywhere on the face, including the pack it carries', () => {
    for (const w of WARDS) {
      const { trays, packs } = binSolids(w)
      for (let ix = 0; ix <= 22; ix++) {
        for (let iy = 0; iy <= 10; iy++) {
          const x = PHARMACY.gantry.xMin + ((PHARMACY.gantry.xMax - PHARMACY.gantry.xMin) * ix) / 22
          const y = PHARMACY.gantry.yMin + ((PHARMACY.gantry.yMax - PHARMACY.gantry.yMin) * iy) / 10
          const held = box(x, y + MV.handMount, MV.handBase + MV.packAhead, PACK.x / 2, PACK.y / 2, PACK.z / 2)
          for (const part of [...handBoxes(x, y, 0, 1), held]) {
            for (const t of trays) expect(overlap(part, t)).toBe(false)
            for (const k of packs) expect(overlap(part, k)).toBe(false)
          }
        }
      }
    }
  })

  it('feeding each top dock port at the sim\'s drop height: the arm at every reach from retracted to the tray, fingers open or closed', () => {
    for (const d of DOCKS) {
      const { trays, packs } = binSolids(d.ward)
      for (const reach of [0, MV.reachTray / 2, MV.reachTray]) {
        for (const grip of [0, 1]) {
          for (const part of handBoxes(d.x, CONFIG.pharmacy.dropHeight, reach, grip)) {
            for (const t of trays) expect(overlap(part, t), `${d.ward}${d.port} reach ${reach}`).toBe(false)
            for (const k of packs) expect(overlap(part, k), `${d.ward}${d.port} reach ${reach}`).toBe(false)
          }
        }
      }
    }
  })

  it('the hand stays inside the island: it never reaches the glass or the port frame', () => {
    const front = MV.handBase + MV.reachTray + MV.finger.d * 0.65 + MV.finger.d / 2
    expect(front).toBeLessThan(GLASS_OUT - PORT.frameDepth / 2)
  })

  it('the tray plate and the pack standing on it are clear of every bin and pack on the face, at every extension', () => {
    for (const d of DOCKS) {
      const { trays, packs } = binSolids(d.ward)
      for (let i = 0; i <= 20; i++) {
        const back = TRAY.stowedBack + (TRAY_TRAVEL * i) / 20
        const plate = box(d.x, TRAY.topY - TRAY.t / 2, back + TRAY.len / 2, TRAY.w / 2, TRAY.t / 2, TRAY.len / 2)
        const pack = box(d.x, HAND_Y, back + TRAY.packAt, PACK.x / 2, PACK.y / 2, PACK.z / 2)
        for (const part of [plate, pack]) {
          for (const t of trays) expect(overlap(part, t), `${d.ward}${d.port} at ${i}/20`).toBe(false)
          for (const k of packs) expect(overlap(part, k), `${d.ward}${d.port} at ${i}/20`).toBe(false)
        }
      }
    }
  })

  it('the hand never touches the tray plate or its cradle while it pushes the pack on', () => {
    for (const d of DOCKS) {
      const plate = box(d.x, TRAY.topY - TRAY.t / 2, TRAY.stowedBack + TRAY.len / 2, TRAY.w / 2, TRAY.t / 2, TRAY.len / 2)
      const cradleTop = TRAY.topY - TRAY.t - 0.005
      const cradle = box(d.x, cradleTop - TRAY.cradle.t / 2, (TRAY.cradle.back + GLASS_OUT) / 2, TRAY.cradle.w / 2, TRAY.cradle.t / 2, (GLASS_OUT - TRAY.cradle.back) / 2)
      for (const reach of [0, MV.reachTray / 2, MV.reachTray]) {
        for (const part of handBoxes(d.x, CONFIG.pharmacy.dropHeight, reach, 0.5)) {
          expect(overlap(part, plate), `plate, reach ${reach}`).toBe(false)
          expect(overlap(part, cradle), `cradle, reach ${reach}`).toBe(false)
        }
      }
    }
  })

  it('the dock ports are on the contract positions and the faces point at their own ward', () => {
    expect(DOCKS).toHaveLength(4)
    for (const d of DOCKS) {
      expect(d.x).toBe(PHARMACY.docks[d.ward][d.port].x)
      expect(Math.sign(d.z)).toBe(FACE_SIGN[d.ward])
    }
  })
})
