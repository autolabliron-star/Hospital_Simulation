import { describe, expect, it } from 'vitest'
import { LAB_CATALOGUE } from '@/content/lab'
import { LAB_MODULE_IDS, LAB_UI } from '@/content/labUi'
import { newLabState } from '@/sim/lab'
import { labTrackPointInto } from '@/sim/labTrack'
import { SampleBook } from '@/sim/samples'
import type { LabOrder, LabState, Sample, SampleStage, TubeKind } from '@/sim/types'
import { centrifuge } from '@/scene/lab/labDims'
import { BOARD, labView, MAX_RESULT_ROWS, MAX_SAMPLE_ROWS, toBoardX, toBoardY, trackPath, testsText, type LabSource } from './labView'

function fakeSource() {
  const state: LabState = newLabState()
  const book = new SampleBook()
  const orders = new Map<string, LabOrder>()
  let n = 0
  const src: LabSource & { put: (slot: number, o: Partial<Pick<Sample, 'stage' | 'priority' | 'qc'>> & { tube?: TubeKind; where?: Partial<Sample['where']>; at?: Partial<Record<SampleStage, number>>; tests?: string[]; name?: string }) => Sample; order: (o: Partial<LabOrder> & { id: string }) => LabOrder } = {
    state,
    samples: book,
    orderById: (id) => orders.get(id),
    put(slot, o) {
      const tube = o.tube ?? 'serum'
      const orderId = `L${++n}`
      const s = book.create({ orderId, patientId: `p${n}`, tube, cap: LAB_CATALOGUE.tubes[tube].cap, tests: o.tests ?? ['bmp'], priority: o.priority ?? 'routine' }, 0)
      s.stage = o.stage ?? 'onTrack'
      s.stageAt = { ...s.stageAt, ...(o.at ?? {}) }
      s.where = { line: 'track', s: 0, sDraw: 1, module: null, source: -1, ...(o.where ?? {}) }
      s.slot = slot
      state.slots[slot] = s.id
      orders.set(orderId, { id: orderId, patientId: s.patientId, patientName: o.name ?? `Patient ${n}`, source: 'er', panel: 'er-fever', tests: s.tests, priority: s.priority, sampleIds: [s.id], ticket: null, drawnBy: 'robot', orderedAt: 0, drawnAt: 0, receivedAt: null, completeAt: null, results: [] })
      return s
    },
    order(o) {
      const full: LabOrder = { patientId: 'x', patientName: 'Name', source: 'er', panel: 'er-fever', tests: ['bmp'], priority: 'routine', sampleIds: [], ticket: null, drawnBy: 'robot', orderedAt: 0, drawnAt: 0, receivedAt: null, completeAt: null, results: [], ...o }
      orders.set(full.id, full)
      return full
    },
  }
  return src
}

describe('the lab panel view', () => {
  it('says "Simulated" and shows four numbers, an empty board with every module idle, and no rows', () => {
    const src = fakeSource()
    const v = labView(src, 1000)
    expect(v.simulated).toMatch(/^Simulated/)
    expect(v.kpis.map((k) => k.id)).toEqual(['samplesToday', 'onTrack', 'turnaround', 'sends'])
    expect(v.kpis.map((k) => k.value)).toEqual(['0', '0', '–', '0'])
    expect(v.kpis.map((k) => k.label)).toEqual([LAB_UI.kpi.samplesToday, LAB_UI.kpi.onTrack, LAB_UI.kpi.turnaround, LAB_UI.kpi.sends])
    expect(v.track.pucks).toEqual([])
    expect(v.track.empty).toBe(true)
    expect(v.track.modules.map((m) => m.id).sort()).toEqual([...LAB_MODULE_IDS].sort())
    for (const m of v.track.modules) expect(m.status, m.id).toBe('idle')
    expect(v.samples).toEqual([])
    expect(v.results).toEqual([])
    expect(v.moreSamples).toBe(0)
  })

  it('reads the numbers from the sim', () => {
    const src = fakeSource()
    src.state.kpis = { samplesToday: 42, onTrack: 7, medianTatMin: 23.4, autoVerifiedPct: 85 }
    src.state.pneumatic.sentToday = 12
    const v = labView(src, 0)
    expect(v.kpis.map((k) => k.value)).toEqual(['42', '7', '23 min', '12'])
  })

  it('puts every tube on the track board where the sim has it, in its cap colour, and rings a STAT one', () => {
    const src = fakeSource()
    src.put(0, { tube: 'EDTA', where: { line: 'track', sDraw: 3.3 }, priority: 'stat' })
    src.put(1, { tube: 'serum', where: { line: 'track', sDraw: 9 } })
    const v = labView(src, 0)
    expect(v.track.pucks.length).toBe(2)
    const p0 = labTrackPointInto(3.3, { x: 0, z: 0 })
    expect(v.track.pucks[0].x).toBeCloseTo(toBoardX(p0.x), 1)
    expect(v.track.pucks[0].y).toBeCloseTo(toBoardY(p0.z), 1)
    expect(v.track.pucks[0].color).toBe(LAB_CATALOGUE.tubes.EDTA.hex)
    expect(v.track.pucks[0].stat).toBe(true)
    expect(v.track.pucks[1].color).toBe(LAB_CATALOGUE.tubes.serum.hex)
    expect(v.track.pucks[1].stat).toBe(false)
    expect(v.track.empty).toBe(false)
  })

  it('a recapped tube is drawn with a white cap', () => {
    const src = fakeSource()
    src.put(0, { tube: 'serum', stage: 'recap', where: { line: 'module', module: 'recap' } })
    expect(labView(src, 0).track.pucks[0].color).toBe('#f2f4f4')
  })

  it('shows a tube in a centrifuge on the rotor, and the centrifuge busy with its speed; a queue makes an analyser wait; a probe makes it work', () => {
    const src = fakeSource()
    src.put(0, { stage: 'centrifuge', where: { line: 'module', module: 'cfg1' } })
    src.state.centrifuges[1].phase = 'spinning'
    src.state.centrifuges[1].rpm01 = 0.8
    src.state.analysers.chemistry.queue = 3
    src.state.analysers.immunoassay.aspirating = 'S9'
    const v = labView(src, 0)
    const r = centrifuge(1).rotor
    expect(v.track.pucks[0].x).toBeCloseTo(toBoardX(r.x), 1)
    expect(v.track.pucks[0].y).toBeCloseTo(toBoardY(r.z), 1)
    const m = (id: string) => v.track.modules.find((b) => b.id === id)!
    expect(m('cfg1').status).toBe('busy')
    expect(m('cfg1').note).toBe('Spinning 80%')
    expect(m('cfg0').status).toBe('idle')
    expect(m('chem').status).toBe('waiting')
    expect(m('chem').note).toBe('3 waiting')
    expect(m('immuno').status).toBe('busy')
  })

  it('shows a tube in the pipe as a marker and a row, not a dot', () => {
    const src = fakeSource()
    src.put(0, { stage: 'inTube', where: { line: 'pneumatic', source: 1, sDraw: 4 } })
    src.state.pneumatic.inFlight = 'S1'
    const v = labView(src, 0)
    expect(v.track.flying).toBe(true)
    expect(v.track.pucks).toEqual([])
    expect(v.samples[0].stage).toBe(LAB_UI.stage.inTube)
    expect(v.samples[0].since).toBe(LAB_UI.units.inTube)
    expect(v.track.modules.find((b) => b.id === 'receive')!.status).toBe('busy')
  })

  it('lists the tubes in the lab oldest first with their tests, patient, stage and time since they arrived, capped at eight', () => {
    const src = fakeSource()
    for (let i = 0; i < 11; i++) src.put(i, { stage: i === 0 ? 'analysing' : 'onTrack', tests: i === 0 ? ['cbc', 'crp', 'bmp'] : ['cbc'], tube: i === 0 ? 'EDTA' : 'serum', at: { inTube: 100 + i, received: 110 + i }, name: `Pat ${i}` })
    const v = labView(src, 110 + 3 * 60)
    expect(v.samples.length).toBe(MAX_SAMPLE_ROWS)
    expect(v.moreSamples).toBe(3)
    expect(v.samples[0].detail).toContain('Pat 0')
    expect(v.samples[0].title).toBe('Full blood count, C-reactive protein +1')
    expect(v.samples[0].stage).toBe(LAB_UI.stage.analysing)
    expect(v.samples[0].cap).toBe(LAB_CATALOGUE.tubes.EDTA.hex)
    expect(v.samples[0].since).toBe('3 min')
    expect(v.samples[1].since).toBe('3 min')
  })

  it('leaves out tubes that are not in the lab (still on the prep tray, or archived with no slot)', () => {
    const src = fakeSource()
    src.put(0, { stage: 'labelled', where: { line: 'tray' } })
    const a = src.put(1, { stage: 'archived', where: { line: 'none' } })
    a.slot = -1
    src.state.slots[1] = null
    expect(labView(src, 0).samples).toEqual([])
  })

  it('shows the last three results, newest first, with the patient, the panel and the draw-to-result time', () => {
    const src = fakeSource()
    for (let i = 0; i < 5; i++) {
      const s = src.put(i, { stage: 'archived', where: { line: 'none' } })
      src.state.slots[i] = null
      s.slot = -1
      const o = src.orderById(s.orderId)!
      o.completeAt = 1000 + i * 100
      o.drawnAt = 1000 + i * 100 - 25 * 60
      o.patientName = `Done ${i}`
    }
    const v = labView(src, 5000)
    expect(v.results.length).toBe(MAX_RESULT_ROWS)
    expect(v.results.map((r) => r.name)).toEqual(['Done 4', 'Done 3', 'Done 2'])
    expect(v.results[0].detail).toContain(LAB_CATALOGUE.panels['er-fever'].name)
    expect(v.results[0].detail).toContain('25 min')
  })

  it('draws on a 360 px board: the track path and every module box are inside it', () => {
    const v = labView(fakeSource(), 0)
    expect(trackPath().startsWith('M ')).toBe(true)
    for (const m of v.track.modules) {
      expect(m.x, m.id).toBeGreaterThanOrEqual(0)
      expect(m.y, m.id).toBeGreaterThanOrEqual(0)
      expect(m.x + m.w, m.id).toBeLessThanOrEqual(BOARD.w)
      expect(m.y + m.h, m.id).toBeLessThanOrEqual(BOARD.h)
    }
    // every number of the path is on the board too
    for (const num of trackPath().match(/-?\d+(\.\d+)?/g)!.map(Number)) expect(num).toBeLessThanOrEqual(BOARD.w)
  })

  it('names tests: one or two in full, more as "+n"', () => {
    expect(testsText(['cbc'])).toBe('Full blood count')
    expect(testsText(['cbc', 'crp'])).toBe('Full blood count, C-reactive protein')
    expect(testsText(['cbc', 'crp', 'bmp', 'glucose'])).toContain('+2')
    expect(testsText(['nope'])).toBe('nope')
  })
})
