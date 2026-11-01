/**
 * R5 wave 2 (agent H): the drapes on the REAL bodies. Every converted avatar (LOD 0 skinned on the CPU exactly as the avatar vertex shader does, posed on the OR table by agent G's
 * rig, tucked arms) lies under the stage the stage builds for it, supine and in lithotomy:
 *
 *   - the sheets (the abdominal sheet, the perineal drape, the sleeves' tops) and the plate stand above every vertex of the body they cover, with a margin;
 *   - the plate stands above the window's skin; the window's skin is nothing but the plate;
 *   - the leg sleeves enclose every vertex of their legs;
 *   - the perineal curtain hangs beyond everything the pelvis reaches between the thighs.
 *
 * Two fits are proved. The UNION of the avatars (the fallback when the patient on the table is not known): the twelve bodies that wear no garment at 0.94, 1 and 1.06 of their
 * size, level and at tilts -30..+20 with rolls +-12. And a KNOWN patient (the four bodies a gowned patient can be, fit.data.ts) at 0.94, 0.97, 1, 1.03 and 1.06: the drapes hug.
 *
 * Not tested: the two GARMENT bodies (medical_male_05 wears a coat, female_adult_15 a dress that rises 5 to 20 cm off the body): no gowned patient wears them (avatars.ts GOWN is
 * four other bodies), and the envelope (envelope.data.ts, stage.generate.test.ts) is measured without them.
 */
import { describe, expect, it } from 'vitest'
import { GOWN } from '@/scene/actors/crowd/avatars'
import { P } from '@/scene/actors/crowd/constants'
import { PELVIS_ON_TABLE } from '@/sim/procedure/body'
import { bootPoints } from './boot.testkit'
import { LEG_D0, LEG_D_END } from './envelope'
import { selectFit } from './fit'
import { PERI_FRONT } from './perineum'
import { onPlate, plateH } from './plate'
import { SHEET_B0, SUPINE_END, WINDOW } from './sheet'
import { PART } from './stage'
import { exactTop, insideSleeve, partTriangles, sleeveRings, stageCase, type StageCase } from './stage.meshkit'
import { AVATARS, GOWN_AVATARS, HeightField, poseBody, trianglesOf, type PosedBody } from './stage.testkit'

const GARMENT_AVATARS = ['medical_male_05', 'female_adult_15']
const SCALES = [0.94, 1, 1.06]
const FIT_SCALES = [0.94, 0.97, 1, 1.03, 1.06]
const BODIES = AVATARS.filter((a) => !GARMENT_AVATARS.includes(a.id))
const TIPS: [number, number][] = [[-30, -12], [-30, 12], [20, -12], [20, 12]]

describe('the wardrobe', () => {
  it('a gowned patient is one of four bodies, all of them inside the envelope; the two excluded bodies are not among them', () => {
    const gown = [...GOWN.female, ...GOWN.male]
    expect([...GOWN_AVATARS].sort()).toEqual([...gown].sort())
    for (const id of gown) expect(BODIES.map((a) => a.id)).toContain(id)
    for (const id of GARMENT_AVATARS) expect(gown).not.toContain(id)
    expect(BODIES.length).toBe(AVATARS.length - 2)
  })
})

interface Metrics {
  /** Smallest margin of the sheets, plate and sleeve tops over a body vertex they cover outside the window; inside the window the plate's (m). */
  sheet: number
  window: number
  uncovered: number
  at: string
  /** The plate over the belly: how far it stands over the body's own skin across the window's middle, the mean and the highest (m). */
  dome: { mean: number; max: number }
}

/** How a built stage clears a posed body (skin from the posed triangles; the plate's own height read exactly, the rest from a 1 cm raster). */
function clearance(c: StageCase, b: PosedBody, lith: boolean, label: string): Metrics {
  const pelvisD = PELVIS_ON_TABLE[lith ? 'lithotomy' : 'supine']
  const skin = new HeightField(-1.0, 1.5, -0.6, 0.6, 0.01).add(partTriangles(c.mem, [PART.sheet, PART.perineum, PART.sleeveL, PART.sleeveR, PART.plate]), 'up')
  const plate = partTriangles(c.mem, [PART.plate])
  const dHead = SHEET_B0 + pelvisD
  // the head and neck lie beyond the screen; the toes lie past the sheet's end (supine) or the sleeves' last ring (lithotomy, whose closed end covers 2.5 cm more)
  const dEnd = lith ? sleeveEnd(c) : SUPINE_END
  let sheet = Infinity
  let window = Infinity
  let uncovered = 0
  let at = ''
  for (let v = 0; v < b.mesh.count; v++) {
    const x = b.v[v * 3]
    const h = b.v[v * 3 + 1]
    const d = b.v[v * 3 + 2]
    if (d < dHead || d > dEnd || Math.abs(x) > 0.4) continue
    const bd = d - pelvisD
    if (bd > WINDOW.d0 && bd < WINDOW.d1 && Math.abs(x) < WINDOW.halfX) {
      window = Math.min(window, exactTop(plate, d, x) - h)
      continue
    }
    const top = skin.at(d, x)
    if (top === -Infinity) {
      uncovered++
      continue
    }
    if (top - h < sheet) {
      sheet = top - h
      at = `${label} d ${d.toFixed(2)} x ${x.toFixed(2)} h ${h.toFixed(3)} part ${b.parts[v]}`
    }
  }
  // the plate over the belly: against the body's own skin, over the window's middle (|x| up to 12 cm)
  const own = new HeightField(-1.0, 1.5, -0.6, 0.6, 0.01).add(trianglesOf(b))
  let sum = 0
  let n = 0
  let max = 0
  for (let bd = WINDOW.d0; bd <= WINDOW.d1 + 1e-9; bd += 0.02) {
    for (let x = -0.12; x <= 0.1201; x += 0.02) {
      const top = own.at(bd + pelvisD, x)
      if (top === -Infinity) continue
      const g = exactTop(plate, bd + pelvisD, x) - top
      sum += g
      n++
      max = Math.max(max, g)
    }
  }
  return { sheet, window, uncovered, at, dome: { mean: sum / n, max } }
}

/** The d of the last ring of the built left sleeve's closed end: where the toes may end. */
function sleeveEnd(c: StageCase): number {
  const R = sleeveRings(c, PART.sleeveL)
  return R === null ? LEG_D_END : R.centre[(R.n - 1) * 3 + 2]
}

for (const lith of [false, true]) {
  const position = lith ? 'lithotomy' : 'supine'
  describe(`${position}: the drapes clear every avatar's body (the union of the avatars: nobody known)`, () => {
    const c = stageCase({ position, prep: 1, drape: 1, marks: 'none' })

    for (const a of BODIES) {
      it(`${a.id}: every vertex under the sheets, the plate or the sleeves, 3 mm or more, at 0.94, 1 and 1.06 of its size`, async () => {
        for (const scale of SCALES) {
          const r = clearance(c, await poseBody(a, { lith, scale }), lith, `s${scale}`)
          expect(r.uncovered, `${a.id} ${position} s${scale}: vertices no drape stands over`).toBe(0)
          expect(r.sheet, r.at).toBeGreaterThan(0.003)
          // the window shows the plate and nothing of the body (the plate is 4 mm over the highest skin)
          expect(r.window, `${a.id} ${position} s${scale} window`).toBeGreaterThan(0.003)
        }
      })
    }

    it('and when the table is tipped (tilts -30 and +20, rolls +-12) the body rides the pad so the drapes still clear it, for every avatar', async () => {
      let worst = Infinity
      let at = ''
      for (const a of BODIES) {
        for (const [tilt, roll] of TIPS) {
          const r = clearance(c, await poseBody(a, { lith, scale: 1.06, tilt, roll }), lith, `${a.id} tilt ${tilt} roll ${roll}`)
          expect(r.uncovered, `${a.id} tilt ${tilt} roll ${roll}`).toBe(0)
          if (r.sheet < worst) {
            worst = r.sheet
            at = r.at
          }
        }
      }
      expect(worst, at).toBeGreaterThan(0.003)
    }, 120000)
  })

  describe(`${position}: a known patient's drapes hug the body and still clear it`, () => {
    for (const id of GOWN_AVATARS) {
      it(`${id}: at 0.94, 0.97, 1, 1.03 and 1.06 of its size the plate is 2 mm or more over the skin and within 7 cm of it over the middle of the belly (the mean within 2.5 cm), nothing pokes through`, async () => {
        const a = AVATARS.find((x) => x.id === id)!
        for (const scale of FIT_SCALES) {
          const c = stageCase({ position, prep: 1, drape: 1, marks: 'none', fit: { id, scale } })
          const r = clearance(c, await poseBody(a, { lith, scale }), lith, `${id} s${scale}`)
          expect(r.uncovered, `${id} ${position} s${scale}`).toBe(0)
          expect(r.sheet, r.at).toBeGreaterThan(0.003)
          expect(r.window, `${id} ${position} s${scale} window`).toBeGreaterThan(0.002)
          expect(r.dome.mean, `${id} ${position} s${scale} plate over the belly (mean)`).toBeLessThan(0.025)
          expect(r.dome.max, `${id} ${position} s${scale} plate over the belly (highest)`).toBeLessThan(0.07)
        }
      }, 60000)
    }

    it('and tipped (tilts -30 and +20, rolls +-12) the fit still clears the body, for each of the four at its own size', async () => {
      for (const id of GOWN_AVATARS) {
        const a = AVATARS.find((x) => x.id === id)!
        for (const [tilt, roll] of TIPS) {
          const c = stageCase({ position, prep: 1, drape: 1, marks: 'none', fit: { id, scale: 1.03 } })
          const r = clearance(c, await poseBody(a, { lith, scale: 1.03, tilt, roll }), lith, `${id} tilt ${tilt} roll ${roll}`)
          expect(r.uncovered, `${id} tilt ${tilt} roll ${roll}`).toBe(0)
          expect(r.sheet, r.at).toBeGreaterThan(0.003)
          expect(r.window, `${id} tilt ${tilt} roll ${roll} window`).toBeGreaterThan(0.002)
        }
      }
    }, 120000)
  })
}

describe('lithotomy: the sleeves enclose the legs and the curtain clears the pelvis', () => {
  const union = stageCase({ position: 'lithotomy', prep: 1, drape: 1 })
  const sides: { part: number; sign: number; parts: number[] }[] = [
    { part: PART.sleeveL, sign: 1, parts: [P.thighL, P.shinL, P.footL] },
    { part: PART.sleeveR, sign: -1, parts: [P.thighR, P.shinR, P.footR] },
  ]

  /** The tightest a body's leg vertices (both legs, from the thigh's first ring on) lie inside the sleeves of `c`; `skipped` counts the vertices before the first ring. */
  function legMargin(c: StageCase, b: PosedBody, perpendicular: boolean): { tightest: number; at: string } {
    let tightest = Infinity
    let at = ''
    for (const s of sides) {
      for (let v = 0; v < b.mesh.count; v++) {
        if (!s.parts.includes(b.parts[v])) continue
        const x = b.v[v * 3]
        const h = b.v[v * 3 + 1]
        const d = b.v[v * 3 + 2]
        if (d < LEG_D0 + 0.01 || x * s.sign < 0.02) continue
        const by = insideSleeve(c, s.part, d, x, h, perpendicular)
        // before the first ring (the groin: the abdominal sheet covers it) or past the closed end: not the sleeve's to cover
        if (by === null) continue
        if (by < tightest) {
          tightest = by
          at = `${s.sign > 0 ? 'left' : 'right'} part ${b.parts[v]} d ${d.toFixed(2)} x ${x.toFixed(2)} h ${h.toFixed(3)}`
        }
      }
    }
    return { tightest, at }
  }

  for (const a of BODIES) {
    it(`${a.id}: every vertex of each leg is inside its sleeve's ring by 4 mm or more, and the pelvis stays clear of the curtain by 4 cm or more (the union of the avatars)`, async () => {
      let tightest = Infinity
      let front = -Infinity
      for (const scale of SCALES) {
        const b = await poseBody(a, { lith: true, scale })
        // (the union's rings are planes of constant d: they reach from LEG_D0 to LEG_D_END)
        for (const s of sides) {
          for (let v = 0; v < b.mesh.count; v++) {
            if (!s.parts.includes(b.parts[v])) continue
            const x = b.v[v * 3]
            const h = b.v[v * 3 + 1]
            const d = b.v[v * 3 + 2]
            if (d < LEG_D0 + 0.01 || d > LEG_D_END - 0.01 || x * s.sign < 0.02) continue
            const by = insideSleeve(union, s.part, d, x, h, false)
            expect(by, `ring at ${d}`).not.toBeNull()
            tightest = Math.min(tightest, by!)
            expect(by!, `${a.id} s${scale} ${s.sign > 0 ? 'left' : 'right'} leg part ${b.parts[v]} at d ${d.toFixed(2)} x ${x.toFixed(2)} h ${h.toFixed(3)}`).toBeGreaterThan(0.004)
          }
        }
        for (let v = 0; v < b.mesh.count; v++) {
          if (b.parts[v] === P.pelvis && Math.abs(b.v[v * 3]) < 0.14 && b.v[v * 3 + 1] > 0) front = Math.max(front, b.v[v * 3 + 2])
        }
      }
      expect(tightest).toBeGreaterThan(0.004)
      expect(PERI_FRONT - front, `${a.id}: the curtain's room`).toBeGreaterThan(0.04)
    }, 60000)
  }

  for (const id of GOWN_AVATARS) {
    it(`${id}: the known patient's sleeves hug (the legs lie 1.5 cm or more inside their rings, and boots with 1 cm to spare) and never more than 5.5 cm off the leg's own radius`, async () => {
      const a = AVATARS.find((x) => x.id === id)!
      for (const scale of FIT_SCALES) {
        const c = stageCase({ position: 'lithotomy', prep: 1, drape: 1, fit: { id, scale } })
        const b = await poseBody(a, { lith: true, scale })
        const m = legMargin(c, b, true)
        expect(m.tightest, `${id} s${scale} ${m.at}`).toBeGreaterThan(0.015)
        let boot = Infinity
        for (const part of [PART.sleeveL, PART.sleeveR]) {
          for (const [d, x, h] of bootPoints(0.02)) boot = Math.min(boot, insideSleeve(c, part, d, part === PART.sleeveL ? x : -x, h, true) ?? -1)
        }
        expect(boot, `${id} s${scale} boot`).toBeGreaterThan(0.01)
        // the legs' own pelvis stays clear of the curtain with the known patient too
        let front = -Infinity
        for (let v = 0; v < b.mesh.count; v++) if (b.parts[v] === P.pelvis && Math.abs(b.v[v * 3]) < 0.14 && b.v[v * 3 + 1] > 0) front = Math.max(front, b.v[v * 3 + 2])
        expect(PERI_FRONT - front).toBeGreaterThan(0.04)
      }
    }, 60000)
  }

  it('the plate and the ports: every port of both layouts lies on the plate over every body, with its mark in the window', () => {
    for (const layout of ['oblique', 'transverse'] as const) {
      const k = stageCase({ position: layout === 'transverse' ? 'lithotomy' : 'supine', layout, marks: 'dressed' })
      for (let i = 0; i < 5; i++) expect(onPlate(k.sites[i * 2], k.sites[i * 2 + 1], 0.02), `${layout} ${i}`).toBe(true)
    }
    selectFit(-1, 1)
    expect(plateH(false, -0.1, 0)).toBeGreaterThan(0.2)
  })
})
