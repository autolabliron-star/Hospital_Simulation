/**
 * W4: every tube of blood, by id, from labelling to the fridge archive. Shared by the draw centre (src/sim/blood: creates and labels them,
 * marks them drawn) and the lab (src/sim/lab: moves them through the pneumatic tube, the track and the modules). Contract glue, owned by the
 * orchestrator. Stages only move forward.
 */
import type { CapColour, LabPriority, Sample, SampleStage, TubeKind } from './types'

export const SAMPLE_STAGES: readonly SampleStage[] = ['ordered', 'labelled', 'drawn', 'inTube', 'received', 'onTrack', 'centrifuge', 'decap', 'analysing', 'recap', 'archived']
const RANK = new Map<SampleStage, number>(SAMPLE_STAGES.map((s, i) => [s, i]))

export interface NewSample {
  orderId: string
  patientId: string
  tube: TubeKind
  cap: CapColour
  tests: string[]
  priority: LabPriority
}

export class SampleBook {
  readonly samples = new Map<string, Sample>()
  private seq = 0

  create(input: NewSample, t: number): Sample {
    const id = `S${String(++this.seq).padStart(5, '0')}`
    const s: Sample = {
      id,
      orderId: input.orderId,
      patientId: input.patientId,
      tube: input.tube,
      cap: input.cap,
      tests: [...input.tests],
      priority: input.priority,
      stage: 'ordered',
      stageAt: { ordered: t },
      where: { line: 'none', s: 0, sDraw: 0, module: null, source: -1 },
      qc: 'ok',
      slot: -1,
      archiveSlot: -1,
    }
    this.samples.set(id, s)
    return s
  }

  get(id: string): Sample | undefined {
    return this.samples.get(id)
  }

  /** Move a sample to `stage` (the same stage again is a no-op; going backwards throws). */
  advance(id: string, stage: SampleStage, t: number): Sample {
    const s = this.samples.get(id)
    if (!s) throw new Error(`Unknown sample ${id}`)
    const from = RANK.get(s.stage)!
    const to = RANK.get(stage)!
    if (to < from) throw new Error(`Sample ${id} cannot go back from ${s.stage} to ${stage}`)
    if (to === from) return s
    s.stage = stage
    s.stageAt[stage] = t
    return s
  }

  byOrder(orderId: string): Sample[] {
    const out: Sample[] = []
    for (const s of this.samples.values()) if (s.orderId === orderId) out.push(s)
    return out
  }

  counts(): Record<SampleStage, number> {
    const c = Object.fromEntries(SAMPLE_STAGES.map((s) => [s, 0])) as Record<SampleStage, number>
    for (const s of this.samples.values()) c[s.stage]++
    return c
  }
}
