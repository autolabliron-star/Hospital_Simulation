/**
 * W4: the lab catalogue (tubes, tests, panels) and the synthetic vitals baselines, validated with zod. Contract content, owned by the
 * orchestrator. Every number here is synthetic and for display: the sim never branches on a value (no clinical decisions); a "usual range"
 * only styles a value in the UI.
 */
import { z } from 'zod'
import raw from './lab.json'
import { parseOrThrow } from './parse'
import type { AnalyserKind, CapColour, TubeKind } from '@/sim/types'

const TUBE_KINDS = ['citrate', 'serum', 'heparin', 'EDTA', 'fluoride'] as const
const CAPS = ['lightBlue', 'gold', 'green', 'lavender', 'grey'] as const
const ANALYSERS = ['haematology', 'chemistry', 'immunoassay', 'coagulation'] as const

const TubeSchema = z.object({ cap: z.enum(CAPS), hex: z.string().regex(/^#[0-9a-f]{6}$/i), inversions: z.number().int().min(1), order: z.number().int().min(1), label: z.string().min(1) })
const AnalyteSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  unit: z.string(),
  low: z.number(),
  high: z.number(),
  mean: z.number(),
  sd: z.number().positive(),
  decimals: z.number().int().min(0).max(3),
})
const TestSchema = z.object({
  name: z.string().min(1),
  tube: z.enum(TUBE_KINDS),
  analyser: z.enum(ANALYSERS),
  analyticSeconds: z.number().positive(),
  analytes: z.array(AnalyteSchema).min(1),
})
/** A plausible-numbers check on one analyte: the usual range is ordered, the mean sits inside it, and a decimals count fits the range. */
const sanityOf = (a: z.infer<typeof AnalyteSchema>): string | null => {
  if (!(a.low < a.high)) return `${a.id}: low ${a.low} must be below high ${a.high}`
  if (!(a.low < a.mean && a.mean < a.high)) return `${a.id}: the mean ${a.mean} must lie between low ${a.low} and high ${a.high}`
  return null
}
const PanelSchema = z.object({ name: z.string().min(1), tests: z.array(z.string().min(1)).min(1) })
const Pair = z.tuple([z.number(), z.number()])
const LabSchema = z
  .object({
    tubes: z.record(z.enum(TUBE_KINDS), TubeSchema),
    tests: z.record(z.string(), TestSchema),
    panels: z.record(z.string(), PanelSchema),
    erPanels: z.record(z.string(), z.string()),
    outpatientPanels: z.array(z.object({ panel: z.string(), weight: z.number().positive() })).min(1),
    panelShifts: z.record(z.string(), z.record(z.string(), z.number())),
    vitalsBaselines: z
      .array(z.object({ maxAge: z.number(), sys: Pair, dia: Pair, pulse: Pair, spo2: Pair, tempC: Pair }))
      .min(1)
      .refine((list) => list.every((b, i) => i === 0 || b.maxAge > list[i - 1].maxAge), 'vitalsBaselines must be sorted by increasing maxAge'),
  })
  .superRefine((d, ctx) => {
    // clinical sanity: ordered ranges, the mean inside the range, the sd small against the range, and vitals that a person could have
    for (const [testId, t] of Object.entries(d.tests)) {
      for (const a of t.analytes) {
        const problem = sanityOf(a)
        if (problem) ctx.addIssue({ code: 'custom', message: `test ${testId}: ${problem}` })
        if (a.sd * 2 > a.high - a.low) ctx.addIssue({ code: 'custom', message: `test ${testId}: ${a.id} sd ${a.sd} is wider than half its usual range` })
      }
    }
    d.vitalsBaselines.forEach((b, i) => {
      if (b.spo2[0] > 100) ctx.addIssue({ code: 'custom', message: `vitalsBaselines[${i}]: SpO2 ${b.spo2[0]} is above 100 %` })
      if (b.spo2[0] + 2 * b.spo2[1] > 101) ctx.addIssue({ code: 'custom', message: `vitalsBaselines[${i}]: SpO2 mean plus two sd (${b.spo2[0] + 2 * b.spo2[1]}) is far above 100 %` })
      if (!(b.dia[0] < b.sys[0])) ctx.addIssue({ code: 'custom', message: `vitalsBaselines[${i}]: diastolic ${b.dia[0]} must be below systolic ${b.sys[0]}` })
    })
    for (const [id, p] of Object.entries(d.panels))
      for (const t of p.tests) if (!d.tests[t]) ctx.addIssue({ code: 'custom', message: `panel ${id} names unknown test ${t}` })
    for (const [reason, panel] of Object.entries(d.erPanels)) if (!d.panels[panel]) ctx.addIssue({ code: 'custom', message: `ER reason "${reason}" -> unknown panel ${panel}` })
    for (const o of d.outpatientPanels) if (!d.panels[o.panel]) ctx.addIssue({ code: 'custom', message: `outpatient panel ${o.panel} unknown` })
  })

export const LAB_CATALOGUE = parseOrThrow(LabSchema, raw, 'src/content/lab.json')
export type LabTestId = string
export type LabTest = z.infer<typeof TestSchema>
export type Analyte = z.infer<typeof AnalyteSchema>

export function testById(id: LabTestId): LabTest {
  const t = LAB_CATALOGUE.tests[id]
  if (!t) throw new Error(`Unknown lab test ${id}`)
  return t
}
export function panelTests(panel: string): string[] {
  const p = LAB_CATALOGUE.panels[panel]
  if (!p) throw new Error(`Unknown lab panel ${panel}`)
  return [...p.tests]
}
/** The panel an ER reason orders, or null when the reason gets no bloods. */
export function erPanelFor(reason: string): string | null {
  return LAB_CATALOGUE.erPanels[reason] ?? null
}
export function capOf(tube: TubeKind): CapColour {
  return LAB_CATALOGUE.tubes[tube].cap
}
export function analyserOf(test: LabTestId): AnalyserKind {
  return testById(test).analyser
}

/** One tube per kind the tests need, in the CLSI order of draw (citrate, serum, heparin, EDTA, fluoride), each with its tests. */
export function tubesFor(tests: readonly LabTestId[]): { tube: TubeKind; cap: CapColour; tests: LabTestId[] }[] {
  const byTube = new Map<TubeKind, LabTestId[]>()
  for (const t of tests) {
    const k = testById(t).tube
    const list = byTube.get(k)
    if (list) list.push(t)
    else byTube.set(k, [t])
  }
  return [...byTube.entries()]
    .sort((a, b) => LAB_CATALOGUE.tubes[a[0]].order - LAB_CATALOGUE.tubes[b[0]].order)
    .map(([tube, ts]) => ({ tube, cap: capOf(tube), tests: ts }))
}

/** The vitals baseline (means and sds) for an age. */
export function vitalsBaselineFor(age: number) {
  const list = LAB_CATALOGUE.vitalsBaselines
  return list.find((b) => age <= b.maxAge) ?? list[list.length - 1]
}
