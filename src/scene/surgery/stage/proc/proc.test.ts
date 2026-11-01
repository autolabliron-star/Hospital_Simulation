/**
 * R5 wave 3 (agent J): the stage of the CT cryo suite and the ultrasound room (proc/*.ts): the prepped skin, the sterile sheet with its window and the skin marks, fitted to the
 * patient who lies there. Every converted avatar (LOD 0 skinned on the CPU exactly as the avatar vertex shader does, posed on the table by the crowd's rig: face down, on the side,
 * one arm up) lies under the stage the stage builds for it, at 0.94, 1 and 1.06 of its size:
 *
 *   - the sheet and the plate stand above every vertex of the body they cover, with a margin; the window shows the plate, a centimetre over the skin, and nothing else;
 *   - the window lies over the treated site (the kidney's on the flank, the back's, the breast's) and every needle's entry (the sim's) is a nick on the plate, on the skin;
 *   - the stage clears the CT's bore (the table goes into it with the patient on it): every vertex is inside the liner;
 *   - the drape unfolds from the shoulders toward the feet, comes off the same way, and the plate's tint spreads from the middle;
 *   - one mesh, the shared matte cloth, within the triangle budget; nothing is allocated in a frame; the mesh rides the patient's frame (the table's travel).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CT } from '@/scene/imaging/machines/ct'
import { P } from '@/scene/actors/crowd/constants'
import { AVATARS, TestPatient, POSE0, type ProcTableId } from '@/scene/actors/crowd/procTable.testkit'
import { HeightField } from '../stage.testkit'
import { BODIES, SCALES, exactTop, partTris, posedPatient, skinOf } from './proc.testkit'
import { STAGE_MATERIAL } from '../material'
import { CRYO_SUITE, IMAGING } from '@/sim/places'
import { cryoTargetInto, newCryoTargetCtx } from '@/sim/procedure'
import type { CryoTarget, PatientMarks, PatientPoseView } from '@/sim/types'
import { CT_AXIS_ABOVE_PAD, CT_LINER, ROOMS, newWindowSpec, siteOfNeedle, windowInto, windowOf, type RoomId } from './config'
import { FIELD, FIELD_NX, WIDE_BLUR, beginFit, cancelFit, fitField, heightAt, newSkinField, stepFit } from './field'
import { MAX_SITES } from './marks'
import { SITES_MIN_HALF_Z } from './window'
import { PROC_PART, newProcMemory, procTriangles, stepProcStage, type ProcIn, type ProcMemory, type ProcSkin } from './stage'


interface Case {
  name: string
  room: RoomId
  target: CryoTarget
  table: ProcTableId
  pose: Partial<PatientPoseView>
  /** Sample needles' plan entries (mm toward the robot, mm toward the head): the kidney's, the lung's and liver's, none for the couch. */
  needles: { x: number; dz: number }[]
}

const CASES: Case[] = [
  { name: 'kidney (on the side)', room: 'cryo', target: 'kidney', table: 'cryo', pose: { position: 'obliqueLeftUp', arms: 'aboveHead' }, needles: [{ x: 85, dz: -20 }, { x: 80, dz: 5 }, { x: 90, dz: 30 }] },
  { name: 'lung (face down)', room: 'cryo', target: 'lung', table: 'cryo', pose: { position: 'prone', arms: 'aboveHead' }, needles: [{ x: 40, dz: -10 }, { x: 55, dz: 25 }] },
  { name: 'liver (face down)', room: 'cryo', target: 'liver', table: 'cryo', pose: { position: 'prone', arms: 'aboveHead' }, needles: [{ x: 30, dz: 40 }, { x: 50, dz: 60 }, { x: 25, dz: 80 }, { x: 45, dz: 100 }] },
  { name: 'breast (couch)', room: 'us', target: 'kidney', table: 'us', pose: { position: 'supine', arms: 'oneUp', rollDeg: -8 }, needles: [] },
]

function inputFor(c: Case, skin: ProcSkin | null, view: Partial<PatientPoseView>, dt = 0): ProcIn {
  const sites = new Float64Array(MAX_SITES * 2)
  for (let i = 0; i < c.needles.length; i++) siteOfNeedle(c.target, { entry: { x: c.needles[i].x, y: -80 }, dz: c.needles[i].dz }, sites, i * 2)
  return { patient: { ...POSE0, ...c.pose, ...view }, skin, sites, nSites: c.needles.length, rootX: 0, rootY: 0, rootZ: 0, heading: 0, dt, target: c.target }
}

interface Metrics {
  sheet: number
  window: number
  windowGap: number
  uncovered: string[]
  at: string
  atWindow: string
}

/** How a built stage clears a posed body: skin from its triangles (x, h, z), the sheet and plate from the stage. */
function clearance(mem: ProcMemory, tp: TestPatient, label: string): Metrics {
  const body = tp.skin()
  const cfg = ROOMS[mem.room]
  const sheet = partTris(mem, PROC_PART.sheet)
  const plate = partTris(mem, PROC_PART.plate)
  const cover = new HeightField(-1.3, 1.25, -0.7, 0.7, 0.01)
  cover.add(sheet, 'up')
  cover.add(plate, 'up')
  const w = mem.window
  let minSheet = Infinity
  let minWindow = Infinity
  let maxGap = 0
  const uncovered: string[] = []
  let at = ''
  let atWindow = ''
  for (let v = 0; v < body.count; v++) {
    const x = body.v[v * 3]
    const h = body.v[v * 3 + 1]
    const z = body.v[v * 3 + 2]
    if (z < cfg.sheetZ0 + 0.02 || z > cfg.sheetZ1 - 0.02) continue
    if (z > w.z0 && z < w.z1 && x > w.x0 && x < w.x1) {
      const top = exactTop(plate, z, x)
      if (top === -Infinity) continue
      if (top - h < minWindow) {
        minWindow = top - h
        atWindow = `${label} z ${z.toFixed(3)} x ${x.toFixed(3)} h ${h.toFixed(3)} part ${body.parts[v]} (window z ${w.z0.toFixed(2)}..${w.z1.toFixed(2)} x ${w.x0.toFixed(2)}..${w.x1.toFixed(2)})`
      }
      continue
    }
    const top = cover.at(z, x)
    if (top === -Infinity) {
      // beside the drape: only a vertex at the pad (the body's lowest contour, under the hang) may be there
      if (h > 0.03) uncovered.push(`${label} z ${z.toFixed(2)} x ${x.toFixed(2)} h ${h.toFixed(3)} part ${body.parts[v]}`)
      continue
    }
    if (top - h < minSheet) {
      minSheet = top - h
      at = `${label} z ${z.toFixed(2)} x ${x.toFixed(2)} h ${h.toFixed(3)} part ${body.parts[v]}`
    }
  }
  // the plate against the body's own skin over the window's middle: how far it stands over it
  const own = new HeightField(-1.3, 1.25, -0.7, 0.7, 0.01)
  const tri = new Float32Array(body.index.length * 3)
  for (let i = 0; i < body.index.length; i++) {
    tri[i * 3] = body.v[body.index[i] * 3]
    tri[i * 3 + 1] = body.v[body.index[i] * 3 + 1]
    tri[i * 3 + 2] = body.v[body.index[i] * 3 + 2]
  }
  own.add(tri)
  for (let z = w.z0 + 0.02; z <= w.z1 - 0.02; z += 0.02) {
    for (let x = w.x0 + 0.02; x <= w.x1 - 0.02; x += 0.02) {
      const s = own.at(z, x)
      if (s === -Infinity) continue
      const t = exactTop(plate, z, x)
      if (t === -Infinity) continue
      maxGap = Math.max(maxGap, t - s)
    }
  }
  return { sheet: minSheet, window: minWindow, windowGap: maxGap, uncovered, at, atWindow }
}

async function patientFor(who: (typeof AVATARS)[number] | 'procedural', c: Case, scale: number): Promise<TestPatient> {
  return posedPatient(who, c.table, c.pose, scale)
}

describe('the sheet, the plate and the window on the real bodies', () => {
  for (const c of CASES) {
    describe(c.name, () => {
      it('every vertex of every avatar is under the sheet or the plate by 3 mm or more, at 0.94, 1 and 1.06; the window shows the plate over the skin and within 8 cm of it (the steep flank of a breast or of a body on its side is the most: the plate is a tent over what is narrower than its cell, and never under it)', async () => {
        const bad: string[] = []
        let worstGap = 0
        for (const a of BODIES) {
          for (const scale of SCALES) {
            const tp = await patientFor(a, c, scale)
            const mem = newProcMemory(c.room)
            stepProcStage(mem, inputFor(c, skinOf(tp), { prep: 1, drape: 1, marks: 'none' }))
            expect(mem.mesh.overflow, `${a.id} ${scale}`).toBe(false)
            const m = clearance(mem, tp, `${a.id} ${scale}`)
            if (m.sheet < 0.003) bad.push(`${m.at}: the sheet is only ${(m.sheet * 1000).toFixed(1)} mm over it`)
            if (m.window < 0.001) bad.push(`${m.atWindow}: the plate is ${(m.window * 1000).toFixed(1)} mm over the skin in the window`)
            worstGap = Math.max(worstGap, m.windowGap)
            if (m.windowGap > 0.08) bad.push(`${a.id} ${scale}: the plate stands ${(m.windowGap * 100).toFixed(1)} cm over the skin`)
            for (const u of m.uncovered.slice(0, 2)) bad.push(`uncovered: ${u}`)
          }
        }
        expect(bad.slice(0, 12)).toEqual([])
        expect(worstGap).toBeGreaterThan(0.004)
      }, 480000)

      it('the window is a hole in the sheet over the treated site: no sheet over it, the plate under it, and the window is where the needles go in', async () => {
        for (const a of [BODIES[0], BODIES[3], BODIES[8]]) {
          const tp = await patientFor(a, c, 1)
          const mem = newProcMemory(c.room)
          stepProcStage(mem, inputFor(c, skinOf(tp), { prep: 1, drape: 1, marks: 'none' }))
          const sheet = partTris(mem, PROC_PART.sheet)
          const plate = partTris(mem, PROC_PART.plate)
          const w = mem.window
          const spec = windowOf(c.room, (c.pose.position ?? 'supine') as PatientPoseView['position'])
          // the window's middle along the table is the needles' (the default's before there are any), to the sheet's 4 cm rows
          const want = new Float64Array(MAX_SITES * 2)
          for (let i = 0; i < c.needles.length; i++) siteOfNeedle(c.target, { entry: { x: c.needles[i].x, y: -80 }, dz: c.needles[i].dz }, want, i * 2)
          let zlo = Infinity
          let zhi = -Infinity
          for (let i = 0; i < c.needles.length; i++) {
            zlo = Math.min(zlo, want[i * 2])
            zhi = Math.max(zhi, want[i * 2])
          }
          const wantZ = c.needles.length > 0 ? (zlo + zhi) / 2 : spec.zc
          // (the window keeps its height and moves in where the sheet begins: the kidney lies 0.25 m from the pelvis, the sheet 0.42 m)
          expect(Math.abs((w.z0 + w.z1) / 2 - wantZ) < 0.07 || w.r0 === 1, a.id).toBe(true)
          // no sheet over its middle (and a plate under it)
          const zc = (w.z0 + w.z1) / 2
          const xc = (w.x0 + w.x1) / 2
          expect(exactTop(sheet, zc, xc), a.id).toBe(-Infinity)
          expect(exactTop(plate, zc, xc), a.id).toBeGreaterThan(0)
          // the sheet closes round it: just outside the window it is there
          expect(exactTop(sheet, zc, w.x1 + 0.02), a.id).toBeGreaterThan(-Infinity)
          expect(exactTop(sheet, w.z0 - 0.02, xc), a.id).toBeGreaterThan(-Infinity)
          // the window is wide enough for a procedure (a hand's breadth or more each way) and the plate covers it with a margin
          expect(w.x1 - w.x0, a.id).toBeGreaterThan(0.12)
          // (along the table: as tall as a procedure likes where the body holds the needles across it, no less than the least with needles to hold: 8 cm, a hand's breadth; the default before there are any)
          expect(w.z1 - w.z0, a.id).toBeGreaterThanOrEqual((c.needles.length > 0 ? 2 * SITES_MIN_HALF_Z : 0.2) - 1e-6)
          expect(exactTop(plate, w.z0 - 0.02, xc), a.id).toBeGreaterThan(0)
          // (the needles' entries are in the window, or their nicks are carried into it: window.test.ts, over 40 seeds a target)
        }
      }, 120000)

      it('the marks: the sticker and pen dots, the nicks (one per needle: the plan\'s entries, on the plate), the closed lines and the dressings; all on the plate within 6 mm of it, nothing red', async () => {
        const tp = await patientFor(BODIES[3], c, 1)
        const skin = skinOf(tp)
        const expected = c.room === 'us' ? 1 : c.needles.length
        const heights: Record<string, number> = {}
        for (const marks of ['marked', 'needles', 'closed', 'dressed'] as PatientMarks[]) {
          const mem = newProcMemory(c.room)
          stepProcStage(mem, inputFor(c, skin, { prep: 1, drape: 1, marks }))
          const a = mem.parts[PROC_PART.marks * 2]
          const b = mem.parts[PROC_PART.marks * 2 + 1]
          expect(b - a, marks).toBeGreaterThan(0)
          heights[marks] = (b - a) / 3
          const plate = partTris(mem, PROC_PART.plate)
          const mk = mem.mesh
          // every mark vertex is within 6 mm over the plate under it (the dressings stand a little higher), and never under it
          const seen = new Set<number>()
          for (let i = a; i < b; i++) seen.add(mk.idx[i])
          for (const vi of seen) {
            const x = mk.pos[vi * 3]
            const h = mk.pos[vi * 3 + 1]
            const z = mk.pos[vi * 3 + 2]
            const top = exactTop(plate, z, x)
            if (top === -Infinity) continue
            expect(h - top, `${marks} mark vertex at z ${z.toFixed(3)} x ${x.toFixed(3)}`).toBeGreaterThan(0.0005)
            expect(h - top, `${marks} mark vertex at z ${z.toFixed(3)} x ${x.toFixed(3)}`).toBeLessThan(0.006)
            // the colours of the marks are never red (the endoscope's blood tiers: red dominates green and blue)
            const r = mk.col[vi * 3]
            const g = mk.col[vi * 3 + 1]
            const bl = mk.col[vi * 3 + 2]
            expect(r > 1.6 * Math.max(g, bl) && r > 0.2, `${marks} colour ${r.toFixed(2)} ${g.toFixed(2)} ${bl.toFixed(2)}`).toBe(false)
          }
        }
        // the nicks: one per needle (a rectangle: 4 vertices, 2 triangles = 6 indices; the 'marked' state adds the sticker on the CT and the ring on the couch)
        expect(heights.needles, 'nicks').toBe(expected * 2)
        expect(heights.closed, 'closed').toBe(expected * 2)
        expect(heights.dressed, 'dressings').toBe(expected * 2)
      }, 120000)
    })
  }
})

describe('winding and the metric itself', () => {
  it('the sheet\'s top and the plate face up (their normals point up over the body), and the clearance metric fails a sheet lowered 5 cm (a negative control)', async () => {
    const c = CASES[1]
    const tp = await patientFor(BODIES[3], c, 1)
    const mem = newProcMemory('cryo')
    stepProcStage(mem, inputFor(c, skinOf(tp), { prep: 1, drape: 1, marks: 'none' }))
    // plate vertices: normals up
    const p0 = mem.plate.v0
    let up = 0
    const n = mem.plate.rows * mem.plate.cols
    for (let v = p0; v < p0 + n; v++) if (mem.mesh.nrm[v * 3 + 1] > 0.3) up++
    expect(up / n).toBeGreaterThan(0.95)
    // the sheet's top (the lattice columns over the body): most vertex normals up
    let top = 0
    let tops = 0
    const a = mem.parts[PROC_PART.sheet * 2]
    const b = mem.parts[PROC_PART.sheet * 2 + 1]
    const seen = new Set<number>()
    for (let i = a; i < b; i++) seen.add(mem.mesh.idx[i])
    for (const v of seen) {
      if (mem.mesh.pos[v * 3 + 1] > 0.1) {
        tops++
        if (mem.mesh.nrm[v * 3 + 1] > 0.2) top++
      }
    }
    expect(tops).toBeGreaterThan(100)
    expect(top / tops).toBeGreaterThan(0.9)
    // the metric: the real build clears, a lowered sheet does not
    const ok = clearance(mem, tp, 'ok')
    expect(ok.sheet).toBeGreaterThan(0.003)
    for (const v of seen) mem.mesh.pos[v * 3 + 1] -= 0.05
    const bad = clearance(mem, tp, 'lowered')
    expect(bad.sheet).toBeLessThan(0.003)
  })
})

describe('the CT bore: the sheet, the plate and the marks lie inside the gantry\'s liner, so the table goes in with the patient draped', () => {
  it('the CT constants are the gantry\'s own (CT.linerIn, CT.centreY above the table\'s pad)', () => {
    expect(CT_LINER).toBe(CT.linerIn)
    expect(CT_AXIS_ABOVE_PAD).toBeCloseTo(CT.centreY - CRYO_SUITE.ct.table.height, 9)
  })

  it('every vertex of the stage is within the liner\'s radius of the axis (kidney, lung, liver; every avatar and size), the drape unfolded in full', async () => {
    const bad: string[] = []
    let worst = 0
    for (const c of CASES.filter((q) => q.room === 'cryo')) {
      for (const a of BODIES) {
        for (const scale of SCALES) {
          const tp = await patientFor(a, c, scale)
          const mem = newProcMemory('cryo')
          stepProcStage(mem, inputFor(c, skinOf(tp), { prep: 1, drape: 1, marks: 'dressed' }))
          const m = mem.mesh
          let r = 0
          for (let v = 0; v < m.nv; v++) r = Math.max(r, Math.hypot(m.pos[v * 3], m.pos[v * 3 + 1] - CT_AXIS_ABOVE_PAD))
          worst = Math.max(worst, r)
          if (r > CT.linerIn) bad.push(`${c.name} ${a.id} ${scale}: ${r.toFixed(3)} from the axis`)
        }
      }
    }
    expect(bad).toEqual([])
    expect(worst).toBeGreaterThan(0.25)
  }, 480000)
})

describe('the unfolding and the tint', () => {
  it('the sheet unfolds from the shoulders toward the feet as `drape` goes 0 -> 1 (more rows, the leading edge moving), and comes off the same way; the plate tints from the middle', async () => {
    const c = CASES[1]
    const tp = await patientFor(BODIES[2], c, 1)
    const skin = skinOf(tp)
    const mem = newProcMemory('cryo')
    const tris: number[] = []
    const lead: number[] = []
    for (let k = 0; k <= 10; k++) {
      stepProcStage(mem, inputFor(c, skin, { prep: 1, drape: k / 10, marks: 'none' }, 1))
      tris.push(procTriangles(mem))
      const sheet = partTris(mem, PROC_PART.sheet)
      let far = -Infinity
      for (let i = 2; i < sheet.length; i += 3) far = Math.max(far, sheet[i])
      lead.push(far)
    }
    for (let k = 1; k <= 10; k++) {
      expect(tris[k], `drape ${k / 10}`).toBeGreaterThanOrEqual(tris[k - 1])
      expect(lead[k], `drape ${k / 10}`).toBeGreaterThanOrEqual(lead[k - 1] - 1e-6)
    }
    expect(lead[10]).toBeCloseTo(ROOMS.cryo.sheetZ1, 2)
    expect(lead[3]).toBeLessThan(lead[10] - 0.2)
    // off again: the sheet shrinks back to nothing
    for (let k = 10; k >= 0; k--) stepProcStage(mem, inputFor(c, skin, { prep: 1, drape: k / 10, marks: 'none' }, 1))
    expect(partTris(mem, PROC_PART.sheet).length).toBe(0)
    // the tint: prep 0.5 has the middle antiseptic and the rim still skin; prep 1 paints it all
    const a = newProcMemory('cryo')
    const colourAt = (prep: number): number[] => {
      stepProcStage(a, inputFor(c, skin, { prep, drape: 0, marks: 'none' }, 1))
      const v = a.plate.v0 + Math.floor(a.plate.rows / 2) * a.plate.cols + Math.floor(a.plate.cols / 2)
      const edge = a.plate.v0
      return [a.mesh.col[v * 3 + 2], a.mesh.col[edge * 3 + 2]]
    }
    const none = colourAt(0.01)
    const half = colourAt(0.5)
    const full = colourAt(1)
    // (antiseptic is less blue than skin: its blue channel is lower)
    expect(half[0]).toBeLessThan(none[0] - 0.02)
    expect(Math.abs(half[1] - none[1])).toBeLessThan(0.02)
    expect(full[1]).toBeLessThan(none[1] - 0.02)
  })

  it('nothing is drawn until the patient\'s skin is known; then the plate shows from the first mark and the sheet only from the prep\'s middle', async () => {
    const c = CASES[0]
    const mem = newProcMemory('cryo')
    stepProcStage(mem, inputFor(c, null, { prep: 1, drape: 1, marks: 'dressed' }))
    expect(mem.mesh.ni).toBe(0)
    const tp = await patientFor(BODIES[0], c, 1)
    const skin = skinOf(tp)
    const m2 = newProcMemory('cryo')
    stepProcStage(m2, inputFor(c, skin, { prep: 0, drape: 1, marks: 'marked' }))
    expect(m2.mesh.ni).toBeGreaterThan(0)
    expect(partTris(m2, PROC_PART.sheet).length).toBe(0)
    expect(partTris(m2, PROC_PART.plate).length).toBeGreaterThan(0)
    const m3 = newProcMemory('cryo')
    stepProcStage(m3, inputFor(c, skin, { prep: 0.2, drape: 1, marks: 'none' }))
    expect(partTris(m3, PROC_PART.sheet).length, 'the drape waits for the prep').toBe(0)
    const m4 = newProcMemory('cryo')
    stepProcStage(m4, inputFor(c, skin, { prep: 1, drape: 1, marks: 'none' }))
    expect(partTris(m4, PROC_PART.sheet).length).toBeGreaterThan(0)
  })
})

describe('the budget and the shared cloth', () => {
  it('the biggest stage (the CT with four needles dressed, in full) is one mesh of a few thousand triangles and fits the buffers; the couch\'s too', async () => {
    let worst = 0
    for (const c of CASES) {
      const tp = await patientFor(BODIES[1], c, 1.06)
      const mem = newProcMemory(c.room)
      stepProcStage(mem, inputFor(c, skinOf(tp), { prep: 1, drape: 1, marks: 'dressed' }))
      expect(mem.mesh.overflow, c.name).toBe(false)
      expect(mem.mesh.nv, c.name).toBeLessThan(9000)
      expect(procTriangles(mem), c.name).toBeLessThan(7000)
      worst = Math.max(worst, procTriangles(mem))
    }
    expect(worst).toBeGreaterThan(1500)
  })

  it('the stage\'s material is the wave-2 stage cloth (one shader program with the palette\'s), a matte one', () => {
    expect(STAGE_MATERIAL.roughness).toBeCloseTo(0.9, 9)
    expect(STAGE_MATERIAL.metalness).toBe(0)
    expect(STAGE_MATERIAL.vertexColors).toBe(true)
  })

  it('the same skin and the same view give the same buffers, bit for bit', async () => {
    const c = CASES[0]
    const tp = await patientFor(BODIES[4], c, 1)
    const skin = skinOf(tp)
    const a = newProcMemory('cryo')
    const b = newProcMemory('cryo')
    for (const m of [a, b]) stepProcStage(m, inputFor(c, skin, { prep: 1, drape: 0.7, marks: 'needles' }))
    expect(a.mesh.ni).toBe(b.mesh.ni)
    expect(Array.from(a.mesh.pos.subarray(0, a.mesh.nv * 3))).toEqual(Array.from(b.mesh.pos.subarray(0, b.mesh.nv * 3)))
    expect(Array.from(a.mesh.idx.subarray(0, a.mesh.ni))).toEqual(Array.from(b.mesh.idx.subarray(0, b.mesh.ni)))
  })

  it('the mesh rides the patient\'s frame: the matrix is the heading about y then the root (the table\'s travel into the bore is the root moving)', () => {
    const mem = newProcMemory('cryo')
    const c = CASES[1]
    const inp = { ...inputFor(c, null, {}), rootX: 5, rootY: 0.8, rootZ: 17.4, heading: Math.PI / 2 }
    stepProcStage(mem, inp)
    const O = mem.matrix
    // a point one metre toward the feet (patient z) is one metre east at heading +pi/2; one metre across (patient x) is one metre north (-z in the room)
    const toRoom = (x: number, y: number, z: number): [number, number, number] => [O[0] * x + O[4] * y + O[8] * z + O[12], O[1] * x + O[5] * y + O[9] * z + O[13], O[2] * x + O[6] * y + O[10] * z + O[14]]
    const feet = toRoom(0, 0, 1)
    expect(feet[0]).toBeCloseTo(6, 9)
    expect(feet[2]).toBeCloseTo(17.4, 9)
    const left = toRoom(1, 0, 0)
    expect(left[0]).toBeCloseTo(5, 9)
    expect(left[2]).toBeCloseTo(16.4, 9)
    expect(toRoom(0, 0.3, 0)[1]).toBeCloseTo(1.1, 9)
  })
})

describe('the field', () => {
  it('rasterises a body\'s triangles into the highest surface per cell, blurs it for the sheet and the plate, and reads it bilinearly (the pad where nothing is)', () => {
    const f = newSkinField()
    // a flat 20 cm square at 10 cm, one triangle pair
    const v = new Float32Array([-0.1, 0.1, 0, 0.1, 0.1, 0, -0.1, 0.1, 0.2, 0.1, 0.1, 0.2])
    fitField(f, v, [0, 1, 2, 1, 3, 2], 2)
    expect(heightAt(f.h, 0.1, 0)).toBeCloseTo(0.1, 5)
    expect(heightAt(f.h, 0.5, 0)).toBe(0)
    expect(heightAt(f.h, 0.1, 0.3)).toBe(0)
    // the wide blur reaches 5 rows past the edge (5 cm: the sheet's rows are 4 cm apart); the field itself does not
    expect(heightAt(f.wide, 0.2 + 5 * FIELD.cell - 0.002, 0)).toBeGreaterThan(0.05)
    expect(heightAt(f.wide, 0.2 + 6 * FIELD.cell + 0.01, 0)).toBeLessThan(0.01)
    expect(heightAt(f.h, 0.2 + FIELD.cell, 0)).toBeLessThan(0.01)
    expect(f.fits).toBe(1)
  })
})

describe('the field fit as a job over frames (P1)', () => {
  const CASES_FIELD: { label: string; table: ProcTableId; room: RoomId; pose: Partial<PatientPoseView> }[] = [
    { label: 'the CT table, face down', table: 'cryo', room: 'cryo', pose: { position: 'prone', arms: 'aboveHead' } },
    { label: 'the CT table, on the side', table: 'cryo', room: 'cryo', pose: { position: 'obliqueLeftUp', arms: 'aboveHead' } },
    { label: 'the couch, one arm up', table: 'us', room: 'us', pose: { position: 'supine', arms: 'oneUp', rollDeg: -8 } },
  ]

  it('fitting only the rows the stage reads gives the very same grids over them as fitting the whole field, in much less work (the cryo span 0.52 of it, the couch 0.45)', async () => {
    for (const c of CASES_FIELD) {
      for (const who of [BODIES[0], BODIES[3], BODIES[8]]) {
        const tp = await posedPatient(who, c.table, c.pose)
        const b = tp.skin()
        const tris = Math.floor(b.index.length / 3)
        const cfg = ROOMS[c.room]
        const whole = newSkinField()
        fitField(whole, b.v, b.index, tris)
        const part = newSkinField()
        fitField(part, b.v, b.index, tris, cfg.sheetZ0, cfg.sheetZ1)
        // (the rows of the fit: `h` over all of them, `wide` over those a blur's radius inside them)
        let hDiff = 0
        for (let i = part.i0; i <= part.i1; i++) for (let j = 0; j < FIELD_NX; j++) hDiff = Math.max(hDiff, Math.abs(part.h[i * FIELD_NX + j] - whole.h[i * FIELD_NX + j]))
        let wDiff = 0
        for (let i = part.i0 + WIDE_BLUR.rz; i <= part.i1 - WIDE_BLUR.rz; i++) for (let j = 0; j < FIELD_NX; j++) wDiff = Math.max(wDiff, Math.abs(part.wide[i * FIELD_NX + j] - whole.wide[i * FIELD_NX + j]))
        expect(hDiff, `${c.label} ${who.id}`).toBe(0)
        expect(wDiff, `${c.label} ${who.id}`).toBe(0)
        // the rows the stage reads are inside the valid ones: the sheet's span, and the blur's reach round the window
        const zRow = (z: number): number => Math.floor((z - FIELD.z0) / FIELD.cell)
        expect(part.i0 + WIDE_BLUR.rz, c.label).toBeLessThanOrEqual(zRow(cfg.sheetZ0) - 2)
        expect(part.i1 - WIDE_BLUR.rz, c.label).toBeGreaterThanOrEqual(zRow(cfg.sheetZ1) + 2)
        expect(part.work, `${c.label} ${who.id}: work ${part.work} of ${whole.work}`).toBeLessThan(0.8 * whole.work)
      }
    }
  })

  it('a sliced fit is the same fit, bit for bit, whatever the budget; the grids the stage reads do not change until the fit is whole, and then they swap; a slice is within its budget (and a triangle) ', async () => {
    const c = CASES_FIELD[0]
    const tp = await posedPatient(BODIES[3], c.table, c.pose)
    const b = tp.skin()
    const tris = Math.floor(b.index.length / 3)
    const cfg = ROOMS[c.room]
    const ref = newSkinField()
    fitField(ref, b.v, b.index, tris, cfg.sheetZ0, cfg.sheetZ1)
    for (const budget of [1, 5_000, 80_000, 300_000]) {
      const f = newSkinField()
      // a first whole fit of ANOTHER body: the stage reads it while this one is under way
      const other = (await posedPatient(BODIES[3], c.table, { position: 'supine', arms: 'out' })).skin()
      fitField(f, other.v, other.index, Math.floor(other.index.length / 3), cfg.sheetZ0, cfg.sheetZ1)
      const before = Float32Array.from(f.h)
      const beforeWide = Float32Array.from(f.wide)
      beginFit(f, b.v, b.index, tris, cfg.sheetZ0, cfg.sheetZ1)
      let slices = 0
      let worst = 0
      let done = false
      while (!done) {
        done = stepFit(f, budget)
        slices++
        worst = Math.max(worst, f.slice)
        if (!done) {
          // the reader's grids are exactly what they were
          expect(f.busy).toBe(true)
          expect(f.h === before || f.h.every((v, k) => v === before[k]), `budget ${budget}: h changed under the reader`).toBe(true)
          expect(f.wide.every((v, k) => v === beforeWide[k]), `budget ${budget}: wide changed under the reader`).toBe(true)
        }
        expect(slices).toBeLessThan(2_000_000)
      }
      expect(f.fits).toBe(2)
      expect(f.busy).toBe(false)
      let diff = 0
      for (let k = 0; k < ref.h.length; k++) diff = Math.max(diff, Math.abs(f.h[k] - ref.h[k]))
      for (let i = f.i0 + WIDE_BLUR.rz; i <= f.i1 - WIDE_BLUR.rz; i++) for (let j = 0; j < FIELD_NX; j++) diff = Math.max(diff, Math.abs(f.wide[i * FIELD_NX + j] - ref.wide[i * FIELD_NX + j]))
      expect(diff, `budget ${budget}`).toBe(0)
      // (a slice stops at the first triangle or row past the budget: one of them over)
      expect(worst, `budget ${budget}`).toBeLessThanOrEqual(budget + 3_000)
      if (budget >= 5_000) expect(slices, `budget ${budget}`).toBeGreaterThan(Math.floor(ref.work / (budget + 3_000)) - 1)
      if (budget === 80_000) expect(slices, 'about five frames at the runtime\'s budget').toBeLessThanOrEqual(8)
    }
  })

  it('a fit can be dropped part way: the reader keeps the last whole fit, and the next begins afresh', async () => {
    const c = CASES_FIELD[2]
    const tp = await posedPatient(BODIES[2], c.table, c.pose)
    const b = tp.skin()
    const tris = Math.floor(b.index.length / 3)
    const f = newSkinField()
    fitField(f, b.v, b.index, tris, ROOMS.us.sheetZ0, ROOMS.us.sheetZ1)
    const kept = Float32Array.from(f.h)
    beginFit(f, b.v, b.index, tris, ROOMS.us.sheetZ0, ROOMS.us.sheetZ1)
    stepFit(f, 20_000)
    cancelFit(f)
    expect(f.busy).toBe(false)
    expect(stepFit(f, Infinity)).toBe(false)
    expect(f.h.every((v, k) => v === kept[k])).toBe(true)
    expect(f.fits).toBe(1)
    fitField(f, b.v, b.index, tris, ROOMS.us.sheetZ0, ROOMS.us.sheetZ1)
    expect(f.fits).toBe(2)
    expect(f.h.every((v, k) => v === kept[k])).toBe(true)
  })
})

describe('P10: the per-frame window lookups allocate nothing', () => {
  it('the frame path asks windowInto (into the stage\'s own spec), not windowOf (a new object each call); the allocation scan below covers windowInto and its sim lookups', () => {
    for (const file of ['stage.ts', 'runtime.ts']) {
      const src = readFileSync(join(process.cwd(), 'src/scene/surgery/stage/proc', file), 'utf8')
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      expect(code, file).not.toMatch(/\bwindowOf\(/)
    }
    const stage = readFileSync(join(process.cwd(), 'src/scene/surgery/stage/proc/stage.ts'), 'utf8')
    expect(stage).toContain('windowInto(mem.room')
    // and the two give the same window
    for (const target of ['kidney', 'lung', 'liver'] as const) {
      for (const room of ['cryo', 'us'] as const) {
        const a = windowOf(room, 'prone', target)
        const b = newWindowSpec()
        windowInto(room, 'prone', target, b)
        expect(b).toEqual(a)
      }
    }
  })
})

describe('the room configuration', () => {
  it('the window waits where the sim has the target field (read through its public functions, the table out as the frame): 0.25 m toward the head and north for the kidney, the breast the couch\'s own', () => {
    for (const target of ['kidney', 'lung', 'liver'] as const) {
      const ctx = newCryoTargetCtx()
      ctx.target = target
      const P3 = { x: 0, y: 0, z: 0 }
      cryoTargetInto('ctField', ctx, P3)
      const T = CRYO_SUITE.ct.table
      const w = windowOf('cryo', target === 'kidney' ? 'obliqueLeftUp' : 'prone', target)
      // the patient frame: z toward the feet is the room's +x (heading +pi/2), x across is the room's -z (north +)
      expect(w.zc, target).toBeCloseTo(P3.x - T.out.x, 9)
      expect(w.xc, target).toBeCloseTo(T.out.z - P3.z, 9)
      expect(w.zc, target).toBeLessThan(-0.15)
    }
    const b = IMAGING.us.procedure!.breast
    const w = windowOf('us', 'supine')
    expect(w.zc).toBeCloseTo(-b.toHead, 9)
    expect(w.xc).toBeCloseTo(b.across, 9)
    // a needle's entry is the sim's `needleEntry`: the plan's x toward the robot is +x of the patient frame, dz toward the head is -z
    const ctx = newCryoTargetCtx()
    const needle = { entry: { x: 85, y: -20 }, tip: { x: 0, y: 0 }, dz: 20 }
    ctx.needles = [needle as never]
    ctx.needle = 0
    const P3 = { x: 0, y: 0, z: 0 }
    cryoTargetInto('needleEntry', ctx, P3)
    const s = new Float64Array(2)
    siteOfNeedle('kidney', needle as never, s, 0)
    expect(s[0]).toBeCloseTo(P3.x - CRYO_SUITE.ct.table.out.x, 9)
    expect(s[1]).toBeCloseTo(CRYO_SUITE.ct.table.out.z - P3.z, 9)
  })

  it('the room\'s sheet spans the shoulders to the feet (CT) and to the hips (couch), the P parts it lies over are the torso and legs', () => {
    expect(ROOMS.cryo.sheetZ0).toBeLessThan(-0.3)
    expect(ROOMS.cryo.sheetZ1).toBeGreaterThan(0.9)
    expect(ROOMS.us.sheetZ1).toBeLessThan(0.6)
    expect(P.pelvis).toBe(0)
  })
})

// ---------------------------------------------------------------------------------------------
// nothing is allocated in a frame
// ---------------------------------------------------------------------------------------------

describe('the per-frame paths of the procedure stage allocate nothing', () => {
  const FLAGGED: [RegExp, string][] = [
    [/\bnew\s+[A-Za-z]/, 'new'],
    [/(^|[=(,:?&|]|\breturn)\s*\[/m, 'array literal'],
    [/(^|[=(,?&|]|\breturn)\s*\{\s*[a-zA-Z_]+\s*:/m, 'object literal'],
    [/\.\.\./, 'spread'],
    [/=>/, 'closure'],
    [/\.(map|filter|reduce|slice|concat)\(/, 'array method'],
    [/\bfunction\b/, 'inner function'],
  ]
  const code = (src: string): string =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/\/\/.*$/gm, '')
      .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (m) => m.replace(/[^\n]/g, ' '))
  function bodyOf(src: string, name: string): string {
    const m = new RegExp(`function\\s+${name}\\s*[(<]`).exec(src)
    if (!m) throw new Error(`no function ${name}`)
    let i = m.index + m[0].length
    let depth = 1
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '(') depth++
      else if (src[i] === ')') depth--
    }
    const open = src.indexOf('{', i)
    let braces = 0
    let end = open
    for (; end < src.length; end++) {
      if (src[end] === '{') braces++
      else if (src[end] === '}' && --braces === 0) break
    }
    return src.slice(open, end + 1)
  }
  const PATHS: Record<string, string[]> = {
    'src/scene/surgery/stage/proc/field.ts': ['rowOf', 'beginFit', 'cancelFit', 'stepFit', 'raster', 'edge', 'splat', 'blurRowX', 'blurRowZ', 'fitField', 'maxAt', 'heightAt'],
    'src/scene/surgery/stage/proc/mesh.ts': ['addV'],
    'src/scene/surgery/stage/proc/window.ts': ['bodyEdge', 'layoutRows', 'trimToBody', 'bodyThere', 'placeWindow'],
    'src/scene/surgery/stage/proc/sheet.ts': ['hangBottom', 'fillProfile', 'rowZ', 'wall', 'buildSkirt', 'buildSheet'],
    'src/scene/surgery/stage/proc/plate.ts': ['plateHeight', 'buildPlate', 'plateSurface', 'paintPlate'],
    'src/scene/surgery/stage/proc/marks.ts': ['disc', 'rect', 'ring', 'onPlate', 'inside', 'buildMarks'],
    'src/scene/surgery/stage/proc/stage.ts': ['setPart', 'sitesKey', 'updateWants', 'build', 'buildDue', 'stepProcStage', 'procTriangles'],
    'src/scene/surgery/stage/proc/runtime.ts': ['stageDt', 'poseKeyInto', 'keyDelta', 'setRange', 'stepProcRuntime', 'findPatient'],
    'src/scene/actors/crowd/skinSource.ts': ['skinInto'],
    'src/scene/surgery/stage/proc/config.ts': ['toPatientInto', 'fieldSiteInto', 'siteOfNeedle', 'windowInto'],
  }
  for (const [file, names] of Object.entries(PATHS)) {
    it(`${file.split('/').pop()}: ${names.join(', ')}`, () => {
      const src = code(readFileSync(join(process.cwd(), file), 'utf8'))
      const offenders: string[] = []
      for (const name of names) {
        const body = bodyOf(src, name)
        expect(body.length, `${name}: the scan found its body`).toBeGreaterThan(10)
        body.split('\n').forEach((line, i) => {
          for (const [re, what] of FLAGGED) if (re.test(line)) offenders.push(`${name}+${i}: ${what}: ${line.trim()}`)
        })
      }
      expect(offenders).toEqual([])
    })
  }

  it('the layer\'s frame callback has no allocation either (the same scan as the theatre\'s stage layer)', () => {
    const src = code(readFileSync(join(process.cwd(), 'src/scene/surgery/stage/proc/ProcStageLayer.tsx'), 'utf8'))
    const i = src.indexOf('useFrame(')
    expect(i).toBeGreaterThan(-1)
    const body = src.slice(i, src.indexOf('return <primitive'))
    for (const line of body.split('\n')) {
      for (const [re, what] of FLAGGED) {
        // (the callback itself is an arrow function: the one closure the hook takes)
        if (what === 'closure' && /useFrame\(|\(_, dt\) =>/.test(line)) continue
        expect(re.test(line), `${what}: ${line.trim()}`).toBe(false)
      }
    }
  })
})
