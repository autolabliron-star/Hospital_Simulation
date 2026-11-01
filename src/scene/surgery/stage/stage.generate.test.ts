/**
 * Regenerates `envelope.data.ts` and `fit.data.ts` from the real avatars (skipped unless STAGE_GEN=1):
 *
 *   STAGE_GEN=1 /private/tmp/claude-501/hospital-vitest.sh src/scene/surgery/stage/stage.generate.test.ts
 *
 * Every real avatar lies on the table as agent G's rig poses it, supine and in lithotomy, at 0.94, 1 and 1.06 of its size (tablePatient.ts). From those bodies:
 *
 *   envelope.data.ts   the UNION over the twelve avatars that wear no garment (a coat, a dress: nobody on the table wears them), the fallback for a patient who is not known:
 *     - the BODY ENVELOPE: the highest skin over each (d, x) of the table within a whole cell either way of every sample (so the bilinear sheet between samples cannot dip
 *       under the body), made monotone toward the middle (a sheet laid over the body cannot dip between a tall flank and the centre), in millimetres, in the body's own
 *       frame (d measured from the pelvis centre, so lithotomy's 0.3 m slide drops out);
 *     - the LEG RINGS: along each lithotomy leg, at stations along d, the middle of the union of every avatar's leg and the stirrup's boot, and sixteen radii around it;
 *     - where the body ends toward the feet between the thighs (the perineal curtain's plane).
 *   fit.data.ts        the same, for each of the four bodies a gowned patient can be (avatars.ts GOWN) at each of the three sizes ON ITS OWN: the patient on the table is
 *     known (the crowd's registry), so its drapes can hug it. Per body and size: the coarse envelope and the leg rings as above, and a FINE plate table (2 cm by 1 cm) of its skin
 *     over the window. The runtime blends the two sizes either side of the patient's own.
 *
 * A change in the avatars or in the pose (the people's skeleton, tablePatient.ts) changes these numbers: regenerate, and stage.clearance.test.ts proves the result.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'vitest'
import { GOWN } from '@/scene/actors/crowd/avatars'
import { P } from '@/scene/actors/crowd/constants'
import { bootPoints } from './boot.testkit'
import { ringFrameInto } from './legFrame'
import { AVATARS, HeightField, poseBody, trianglesOf, type PosedBody } from './stage.testkit'

const GARMENT_AVATARS = ['medical_male_05', 'female_adult_15']
const SCALES = [0.94, 1, 1.06]
const ROW0 = -0.55
const ROW_STEP = 0.05
const COL_STEP = 0.04
const COLS = 12
const LEG_D0 = 0.45
const LEG_STEP = 0.05
const LEG_N = 17
const BINS = 16
// the fine plate table: body-frame d from PLATE_D0 in PLATE_STEP, across from 0 in PLATE_STEP; each node the highest skin within PLATE_BLUR of it
const PLATE_D0 = -0.31
const PLATE_DSTEP = 0.02
const PLATE_XSTEP = 0.01
const PLATE_ROWS = 20
const PLATE_COLS = 23
// the blur is a little more than half a step, so the bilinear plate between nodes never dips under the skin
const PLATE_DBLUR = 0.012
const PLATE_XBLUR = 0.007

const r2 = (v: number): number => Math.round(v * 100) / 100

function envelope(f: HeightField, pelvisD: number, rows: number): number[][] {
  const m: number[][] = []
  for (let i = 0; i < rows; i++) {
    const d = ROW0 + i * ROW_STEP
    const row: number[] = []
    for (let j = 0; j < COLS; j++) {
      const x = j * COL_STEP
      let best = -Infinity
      for (let dd = d - ROW_STEP; dd <= d + ROW_STEP + 1e-6; dd += 0.01) {
        for (let xx = x - COL_STEP; xx <= x + COL_STEP + 1e-6; xx += 0.01) best = Math.max(best, f.at(dd + pelvisD, xx), f.at(dd + pelvisD, -xx))
      }
      row.push(best === -Infinity ? 0 : best)
    }
    // monotone toward the middle
    let run = 0
    for (let j = COLS - 1; j >= 0; j--) {
      run = Math.max(run, row[j])
      row[j] = Math.round(run * 1000)
    }
    m.push(row)
  }
  return m
}

/**
 * The fine plate table: rows x cols of the highest skin near each node (mm). Made monotone toward the middle like the coarse envelope (the gap between the torso's flank and the
 * arm, which no top-down skin covers, is bridged at the arm's height), computed out to |x| 0.44 so the table's last columns know about the arms.
 */
function plateTable(f: HeightField, pelvisD: number): number[][] {
  const FAR = 45
  const m: number[][] = []
  for (let i = 0; i < PLATE_ROWS; i++) {
    const d = PLATE_D0 + i * PLATE_DSTEP
    const row: number[] = []
    for (let j = 0; j < FAR; j++) {
      const x = j * PLATE_XSTEP
      let best = -Infinity
      for (let dd = d - PLATE_DBLUR; dd <= d + PLATE_DBLUR + 1e-6; dd += 0.004) {
        for (let xx = x - PLATE_XBLUR; xx <= x + PLATE_XBLUR + 1e-6; xx += 0.0035) best = Math.max(best, f.at(dd + pelvisD, xx), f.at(dd + pelvisD, -xx))
      }
      row.push(best === -Infinity ? 0 : best)
    }
    let run = 0
    for (let j = FAR - 1; j >= 0; j--) {
      run = Math.max(run, row[j])
      row[j] = run
    }
    m.push(row.slice(0, PLATE_COLS).map((v) => Math.round(v * 1000)))
  }
  return m
}

interface Pt {
  d: number
  x: number
  h: number
}

/** Rings along a leg: per station the middle (|x|, h) and BINS radii around it from the points of the leg (and the boot) near it. mm; rows [cx, ch, r0..r15]. */
function legRings(legs: Pt[]): number[][] {
  const st: { d: number; cx: number; ch: number; ring: number[] }[] = []
  for (let k = 0; k < LEG_N; k++) {
    const d = LEG_D0 + k * LEG_STEP
    const slab = legs.filter((p) => Math.abs(p.d - d) <= 0.03 && p.x > 0.04)
    let x0 = 9
    let x1 = -9
    let h0 = 9
    let h1 = -9
    for (const p of slab) {
      x0 = Math.min(x0, p.x)
      x1 = Math.max(x1, p.x)
      h0 = Math.min(h0, p.h)
      h1 = Math.max(h1, p.h)
    }
    st.push({ d, cx: (x0 + x1) / 2, ch: (h0 + h1) / 2, ring: new Array<number>(BINS).fill(0) })
  }
  // smooth the middle line (three taps), then the radii around it
  const cxs = st.map((s, k) => (st[Math.max(0, k - 1)].cx + s.cx + st[Math.min(LEG_N - 1, k + 1)].cx) / 3)
  const chs = st.map((s, k) => (st[Math.max(0, k - 1)].ch + s.ch + st[Math.min(LEG_N - 1, k + 1)].ch) / 3)
  for (let k = 0; k < LEG_N; k++) {
    st[k].cx = cxs[k]
    st[k].ch = chs[k]
  }
  const half = Math.cos(Math.PI / BINS)
  for (const p of legs) {
    const k = Math.round((p.d - LEG_D0) / LEG_STEP)
    for (let kk = Math.max(0, k - 1); kk <= Math.min(LEG_N - 1, k + 1); kk++) {
      const s = st[kk]
      if (Math.abs(p.d - s.d) > 0.03) continue
      const dx = p.x - s.cx
      const dh = p.h - s.ch
      const rho = Math.hypot(dx, dh)
      const ang = ((Math.atan2(dh, dx) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
      const f = ang / ((2 * Math.PI) / BINS)
      const b0 = Math.floor(f) % BINS
      const b1 = (b0 + 1) % BINS
      s.ring[b0] = Math.max(s.ring[b0], rho / half)
      s.ring[b1] = Math.max(s.ring[b1], rho / half)
    }
  }
  // neighbours (stations and bins) lend their radius so the ring never pinches; a bin nobody reached takes the mean of its neighbours
  const ring2 = st.map((s, k) => s.ring.map((r, b) => Math.max(r, st[Math.max(0, k - 1)].ring[b], st[Math.min(LEG_N - 1, k + 1)].ring[b])))
  for (const r of ring2) for (let b = 0; b < BINS; b++) if (r[b] < 0.06) r[b] = Math.max(0.06, (r[(b + BINS - 1) % BINS] + r[(b + 1) % BINS]) / 2)
  return st.map((s, k) => [Math.round(s.cx * 1000), Math.round(s.ch * 1000), ...ring2[k].map((r) => Math.round(r * 1000))])
}

/** Both legs' vertices (the right mirrored onto the left: |x|), or the left leg's alone. */
function legPoints(b: PosedBody, both = false): Pt[] {
  const out: Pt[] = []
  for (let v = 0; v < b.mesh.count; v++) {
    const part = b.parts[v]
    if (part === P.thighL || part === P.shinL || part === P.footL || (both && (part === P.thighR || part === P.shinR || part === P.footR))) out.push({ d: b.v[v * 3 + 2], x: Math.abs(b.v[v * 3]), h: b.v[v * 3 + 1] })
  }
  return out
}

/**
 * Rings PERPENDICULAR to the leg for one body. The axis is the skeleton: from a little below the hip joint to the knee, the ankle and on along the shin to past the boot's heel
 * board; both legs' joints are averaged (the right mirrored). Stations are spread evenly along it (LEG_N of them); each point of either leg's skin, and of the boot, goes to the
 * stations nearest its place along the axis (the two either side and the next one out each way), where its offset from the axis in that station's ring frame (legFrame.ts, from the neighbouring stations' directions as the
 * runtime takes them) is binned by angle: the radii (mm). Rows [d, x, h, r0..r15] of the station's middle and its radii.
 */
function legRingsAxis(b: PosedBody, pts: Pt[], boot: Pt[]): number[][] {
  const J = (part: number): [number, number, number] => [b.joints[part * 3 + 2], b.joints[part * 3], b.joints[part * 3 + 1]] // d, x, h
  const mean = (l: number, r: number): [number, number, number] => {
    const a = J(l)
    const c = J(r)
    return [(a[0] + c[0]) / 2, (a[1] + Math.abs(c[1])) / 2, (a[2] + c[2]) / 2]
  }
  const hip = mean(P.thighL, P.thighR)
  const knee = mean(P.shinL, P.shinR)
  const ankle = mean(P.footL, P.footR)
  const unit = (a: number[], c: number[]): [number, number, number] => {
    const v: [number, number, number] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const l = Math.hypot(...v)
    return [v[0] / l, v[1] / l, v[2] / l]
  }
  const tHip = unit(hip, knee)
  const tShin = unit(knee, ankle)
  const bootEndD = Math.max(...boot.map((p) => p.d)) + 0.04
  const start: number[] = [hip[0] + tHip[0] * 0.06, hip[1] + tHip[1] * 0.06, hip[2] + tHip[2] * 0.06]
  const reach = Math.max(0.1, (bootEndD - ankle[0]) / tShin[0])
  const end: number[] = [ankle[0] + tShin[0] * reach, ankle[1] + tShin[1] * reach, ankle[2] + tShin[2] * reach]
  const pts3 = [start, knee as number[], ankle as number[], end]
  const segLen = [0, 1, 2].map((i) => Math.hypot(pts3[i + 1][0] - pts3[i][0], pts3[i + 1][1] - pts3[i][1], pts3[i + 1][2] - pts3[i][2]))
  const total = segLen[0] + segLen[1] + segLen[2]
  const at = (s: number): number[] => {
    let rest = Math.max(0, Math.min(total, s))
    for (let i = 0; i < 3; i++) {
      if (rest <= segLen[i] || i === 2) {
        const t = Math.min(1, rest / segLen[i])
        return [0, 1, 2].map((q) => pts3[i][q] + (pts3[i + 1][q] - pts3[i][q]) * t)
      }
      rest -= segLen[i]
    }
    return end
  }
  const step = total / (LEG_N - 1)
  // stations: d, x, h
  const C = Array.from({ length: LEG_N }, (_, k) => at(k * step))
  const fr = new Float64Array(6)
  const frames = C.map((_, k) => {
    const a = C[Math.max(0, k - 1)]
    const c = C[Math.min(LEG_N - 1, k + 1)]
    const t = unit(a, c) // d, x, h
    const out = { t: [t[1], t[2], t[0]] as [number, number, number], u: [0, 0, 0], v: [0, 0, 0] }
    ringFrameInto(out.t[0], out.t[1], out.t[2], fr)
    out.u = [fr[0], fr[1], fr[2]]
    out.v = [fr[3], fr[4], fr[5]]
    return out
  })
  // where along the axis a point is, and how far from it: the nearest of the three segments
  const place = (p: Pt): { s: number; off: number } => {
    let best = { s: 0, off: 9 }
    let acc = 0
    for (let i = 0; i < 3; i++) {
      const a = pts3[i]
      const e = [pts3[i + 1][0] - a[0], pts3[i + 1][1] - a[1], pts3[i + 1][2] - a[2]]
      const q = [p.d - a[0], p.x - a[1], p.h - a[2]]
      const t = (q[0] * e[0] + q[1] * e[1] + q[2] * e[2]) / (segLen[i] * segLen[i])
      const tc = Math.max(0, Math.min(1, t))
      const off = Math.hypot(q[0] - e[0] * tc, q[1] - e[1] * tc, q[2] - e[2] * tc)
      if (off < best.off) best = { s: acc + tc * segLen[i], off }
      // a point before the start or past the end by more than 6 cm is not the sleeve's
      if (i === 0 && t < -0.06 / segLen[0]) best.off = Math.max(best.off, 9)
      acc += segLen[i]
    }
    return best
  }
  const half = Math.cos(Math.PI / BINS)
  const rings = Array.from({ length: LEG_N }, () => new Array<number>(BINS).fill(0))
  for (const p of pts) {
    const pl = place(p)
    if (pl.off > 0.4) continue
    const k0 = Math.min(LEG_N - 2, Math.floor(pl.s / step))
    // the two stations either side, and the next one out each way (the ring planes tilt, so the sleeve between two stations can be bracketed by others)
    for (const k of [k0 - 1, k0, k0 + 1, k0 + 2]) {
      if (k < 0 || k >= LEG_N) continue
      const q = [p.x - C[k][1], p.h - C[k][2], p.d - C[k][0]] // x, h, d
      if (Math.abs(q[0] * frames[k].t[0] + q[1] * frames[k].t[1] + q[2] * frames[k].t[2]) > 0.09) continue
      const a = q[0] * frames[k].u[0] + q[1] * frames[k].u[1] + q[2] * frames[k].u[2]
      const c = q[0] * frames[k].v[0] + q[1] * frames[k].v[1] + q[2] * frames[k].v[2]
      const rho = Math.hypot(a, c)
      const ang = ((Math.atan2(c, a) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
      const f = ang / ((2 * Math.PI) / BINS)
      const b0 = Math.floor(f) % BINS
      const b1 = (b0 + 1) % BINS
      rings[k][b0] = Math.max(rings[k][b0], rho / half)
      rings[k][b1] = Math.max(rings[k][b1], rho / half)
    }
  }
  // neighbours lend their radius (no pinching); an empty bin takes the mean of its neighbours
  const r2d = rings.map((r, k) => r.map((v, bb) => Math.max(v, rings[Math.max(0, k - 1)][bb], rings[Math.min(LEG_N - 1, k + 1)][bb])))
  for (const r of r2d) for (let bb = 0; bb < BINS; bb++) if (r[bb] < 0.05) r[bb] = Math.max(0.05, (r[(bb + BINS - 1) % BINS] + r[(bb + 1) % BINS]) / 2)
  return r2d.map((r, k) => [Math.round(C[k][0] * 1000), Math.round(C[k][1] * 1000), Math.round(C[k][2] * 1000), ...r.map((v) => Math.round(v * 1000))])
}

const fmt = (t: number[][], indent = '  '): string => t.map((r) => `${indent}[${r.map((v) => String(v).padStart(3)).join(', ')}],`).join('\n')
const flat = (t: number[][]): string => '[\n' + t.map((r) => '    ' + r.join(', ') + ',').join('\n') + '\n  ]'

describe.skipIf(!process.env.STAGE_GEN)('generate the stage envelope', () => {
  it('writes envelope.data.ts and fit.data.ts', async () => {
    const supine = new HeightField(-1.2, 1.5, -0.6, 0.6, 0.01)
    const lith = new HeightField(-1.2, 1.5, -0.6, 0.6, 0.01)
    const legs: Pt[] = []
    let frontD = -9
    for (const a of AVATARS) {
      if (GARMENT_AVATARS.includes(a.id)) continue
      for (const scale of SCALES) {
        supine.add(trianglesOf(await poseBody(a, { lith: false, scale })))
        const b = await poseBody(a, { lith: true, scale })
        lith.add(trianglesOf(b))
        legs.push(...legPoints(b))
        for (let v = 0; v < b.mesh.count; v++) {
          const x = b.v[v * 3]
          const h = b.v[v * 3 + 1]
          const d = b.v[v * 3 + 2]
          if (b.parts[v] === P.pelvis && Math.abs(x) < 0.14 && h > 0) frontD = Math.max(frontD, d)
        }
      }
    }
    // the stirrup's boot is as much to cover as the leg (it does not change with the avatar)
    const boot: Pt[] = bootPoints(0.01).map(([d, x, h]) => ({ d, x, h }))
    legs.push(...boot)
    const sup = envelope(supine, 0, 34)
    const lit = envelope(lith, 0.3, 24)
    const legRows = legRings(legs)
    const src = `// GENERATED by stage.generate.test.ts (STAGE_GEN=1): the body envelope the drapes are shaped over, measured on the real avatars lying on the table (see that file). Millimetres.
// This is the UNION over every avatar that wears no garment: the fallback when the patient on the table is not known (fit.data.ts is the patient's own). Do not edit by hand.

/** Rows: d from the pelvis centre, from ENV_ROW0 in steps of ENV_ROW_STEP; columns: |x| from 0 in steps of ENV_COL_STEP. */
export const ENV_ROW0 = ${ROW0}
export const ENV_ROW_STEP = ${ROW_STEP}
export const ENV_COL_STEP = ${COL_STEP}

/** Supine: the highest skin over (d, |x|), made monotone toward the middle. */
export const SUPINE_ENV: readonly (readonly number[])[] = [
${fmt(sup)}
]

/** Lithotomy, in the body's own frame (the pelvis slid 0.3 m toward the feet is taken off): the torso and the groin. */
export const LITH_ENV: readonly (readonly number[])[] = [
${fmt(lit)}
]

/** Lithotomy leg rings: stations from LEG_D0 (table frame d) in steps of LEG_STEP; per station the middle (|x|, h) and ${BINS} radii around it, every 360/${BINS} degrees from +x (across, outward) turning toward +h (up). */
export const LEG_D0 = ${LEG_D0}
export const LEG_STEP = ${LEG_STEP}
export const LEG_BINS = ${BINS}
export const LEG_RINGS: readonly (readonly number[])[] = [
${fmt(legRows)}
]

/** The furthest toward the feet the pelvis reaches between the thighs (table frame d, lithotomy): the perineal curtain hangs beyond it. */
export const FRONT_D = ${r2(frontD * 100) / 100}
`
    writeFileSync(join(process.cwd(), 'src/scene/surgery/stage/envelope.data.ts'), src)

    // the four bodies a gowned patient can be, each at each size on its own
    const ids = [...GOWN.female, ...GOWN.male]
    const sections: string[] = []
    const kinds: Record<string, string[]> = { supine: [], lith: [], plateS: [], plateL: [], legs: [] }
    for (const id of ids) {
      const a = AVATARS.find((x) => x.id === id)!
      for (const scale of SCALES) {
        const bs = await poseBody(a, { lith: false, scale })
        const bl = await poseBody(a, { lith: true, scale })
        const fs = new HeightField(-1.2, 1.5, -0.6, 0.6, 0.01).add(trianglesOf(bs))
        const fl = new HeightField(-1.2, 1.5, -0.6, 0.6, 0.01).add(trianglesOf(bl))
        kinds.supine.push(flat(envelope(fs, 0, 34)))
        kinds.lith.push(flat(envelope(fl, 0.3, 24)))
        kinds.plateS.push(flat(plateTable(fs, 0)))
        kinds.plateL.push(flat(plateTable(fl, 0.3)))
        kinds.legs.push(flat(legRingsAxis(bl, [...legPoints(bl, true), ...boot], boot)))
      }
    }
    const arr = (name: string, doc: string, items: string[]): string => `/** ${doc} */\nexport const ${name}: readonly (readonly number[])[] = [\n  ${items.join(',\n  ')},\n]\n`
    sections.push(
      `// GENERATED by stage.generate.test.ts (STAGE_GEN=1): the drapes' fit to each body a gowned patient can be, at each size, measured on the real avatar lying on the table. Millimetres.
// Entry [avatar * FIT_SCALES.length + size] of each table. Do not edit by hand.

/** The bodies (avatars.ts GOWN) and the sizes (the person's \`look.scale\`) measured; sizes between are blended. */
export const FIT_IDS: readonly string[] = ${JSON.stringify(ids)}
export const FIT_SCALES: readonly number[] = ${JSON.stringify(SCALES)}

/** The coarse envelope (rows ${ROW0} in ${ROW_STEP} steps, ${COLS} columns in ${COL_STEP} steps, flat row-major), as envelope.data.ts but for this body alone. Supine and lithotomy (24 rows). */
${arr('FIT_SUPINE', 'supine, 34 rows', kinds.supine)}
${arr('FIT_LITH', 'lithotomy, 24 rows', kinds.lith)}
/** The fine plate table: body-frame d from ${PLATE_D0} in ${PLATE_DSTEP} steps (${PLATE_ROWS} rows), |x| from 0 in ${PLATE_XSTEP} steps (${PLATE_COLS} columns), flat row-major: this body's own skin. */
export const FIT_PLATE_ROW0 = ${PLATE_D0}
export const FIT_PLATE_DSTEP = ${PLATE_DSTEP}
export const FIT_PLATE_XSTEP = ${PLATE_XSTEP}
export const FIT_PLATE_ROWS = ${PLATE_ROWS}
export const FIT_PLATE_COLS = ${PLATE_COLS}
${arr('FIT_PLATE_SUPINE', 'supine', kinds.plateS)}
${arr('FIT_PLATE_LITH', 'lithotomy', kinds.plateL)}
/** Leg rings, the same stations as envelope.data.ts LEG_RINGS but in planes perpendicular to the leg (legFrame.ts), this body's own legs (both, mirrored) and the boot: per station the middle's d, |x| and h, then ${BINS} radii (${3 + BINS} numbers). */
${arr('FIT_LEGS', 'lithotomy leg rings', kinds.legs)}
`,
    )
    writeFileSync(join(process.cwd(), 'src/scene/surgery/stage/fit.data.ts'), sections.join('\n'))
  }, 900000)
})
