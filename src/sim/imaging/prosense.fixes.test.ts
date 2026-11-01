/**
 * R5 wave 3 review fixes for the ProSense cases (the sim side): the script copy and steps (K4, K5, K8, K10, K17), the room log in step with the script (K7),
 * the lump the case treats reaching the picture (K9), the radiologist clear of the couch (K18), the sonographer at the console, passing syringes from beside the
 * radiologist (K17) and the patient in a gown while she lies on the couch (K19). The watch API fixes (K1-K3) are in watchProjection.test.ts, the picture's
 * (K4, K9-K15) in src/scene/imaging/images/cryoCase.test.ts.
 *
 * Second round (the checker's findings on the first): the sonographer reaches the console's screen (K17: 0.55 m, not 0.8) and still passes from beside the radiologist;
 * in the day the gown change is exactly the step `changeGown` (K19 timing); the ProSense patient has her own cubicle, so no MRI patient loses one (K19 resources);
 * she draws no random number (K19 rng); the drape unit's steps hold the survey picture still (the scope carried forward).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { IMAGING_STAFF } from '@/content/staff'
import { BODY, STAND_PELVIS } from '@/scene/actors/crowd/constants'
import { CONFIG } from '../config'
import { isWalkable } from '../nav/layout'
import { IMAGING } from '../places'
import { anchorSpot, compiledFor } from '../procedure'
import { newUsTargetCtx, usAnchorSpot, usTargetInto } from '../procedure/usPlaces'
import { Rng } from '../rng'
import { Simulation } from '../Simulation'
import type { ProcedureId } from '../types'
import { lumpMmOfExam } from './exam'
import { CubiclePool } from './sites'

const DT = CONFIG.sim.step
const IDS: ProcedureId[] = ['us-breastCancer', 'us-fibroadenoma']
const cs = (id: ProcedureId) => compiledFor(id)!
const stepOf = (id: ProcedureId, step: string) => cs(id).script.steps.find((s) => s.id === step)!

// ---------------------------------------------------------------------------------------------
// A full trace of one case: every tick's step, the people, the patient's outfit and seat, the ice, the log
// ---------------------------------------------------------------------------------------------

interface Tick {
  t: number
  /** The session's own step (meet, call, toCubicle, changing, toRoom, explain ...), and the script step the view shows. */
  sess: string
  step: string
  unit: string
  scope: string | null
  progress: number
  ice: number
  doc: { x: number; z: number } | null
  son: { x: number; z: number; heading: number }
  pat: { x: number; z: number; outfit: string; onCouch: boolean; moving: boolean } | null
}

interface Trace {
  protocol: string
  watch: boolean
  seed: number
  ticks: Tick[]
  /** The log lines with the sim time and the step the view was in when they were said. */
  lines: { t: number; step: string; text: string }[]
  lumpMm: number | undefined
  relocate: boolean
  sim: Simulation
}

function traceCase(seed: number, protocol: string, watch: boolean, opts: { startHour?: number; booked?: boolean; setup?: (sim: Simulation) => void } = {}): Trace {
  const sim = new Simulation(seed, { startHour: opts.startHour ?? 10, inFlight: false })
  const img = sim.imaging
  opts.setup?.(sim)
  if (opts.booked !== true) expect(watch ? img.startDemoScan('us', protocol, { watch: true }) : img.startDemoScan('us', protocol)).toBe(true)
  const sc = img.machines.us
  const view = sc.state.procedure
  const ticks: Tick[] = []
  const lines: Trace['lines'] = []
  let lastLog = -1
  let ran = false
  let finished = false
  let lumpMm: number | undefined
  let relocate = false
  for (let i = 0, n = Math.round((watch ? 1800 : 4800) / DT); i < n && !finished; i++) {
    sim.step(DT)
    for (const e of sim.log.since(lastLog)) {
      lastLog = e.id
      if (view.procedureId !== null) lines.push({ t: sim.t, step: view.stepId, text: e.text })
    }
    if (view.procedureId !== null) {
      ran = true
      const doc = img.radiologist
      const op = sc.operator!
      const bookingId = sc.session?.booking.patientId
      const person = img.outpatients.find((o) => o.booking.patientId === bookingId)
      const exam = sc.state.exam
      if (exam !== null && lumpMm === undefined) {
        lumpMm = lumpMmOfExam(exam)
        relocate = exam.sequences.length > 4
      }
      ticks.push({
        t: sim.t,
        sess: sc.session?.step ?? '-',
        step: view.stepId,
        unit: view.unit,
        scope: view.scope,
        progress: view.progress,
        ice: sc.state.detail,
        doc: doc !== null ? { x: doc.x, z: doc.z } : null,
        son: { x: op.x, z: op.z, heading: op.entity.heading },
        pat: person ? { x: person.x, z: person.z, outfit: String(person.entity.outfit), onCouch: person.seat === sc.sites.tableSeat, moving: !person.done } : null,
      })
    }
    if (ran && view.procedureId === null && sc.state.phase === 'idle' && sc.session === null) finished = true
  }
  expect(finished, `${protocol} seed ${seed}: the case ended`).toBe(true)
  return { protocol, watch, seed, ticks, lines, lumpMm, relocate, sim }
}

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z)

// ---------------------------------------------------------------------------------------------
// K4, K5, K8, K10, K17: the scripts
// ---------------------------------------------------------------------------------------------

describe.each(IDS)('the script %s', (id) => {
  it('K10: the cold pack, the Sign Out and the walk out have their own, quiet picture (`standby`): the dressing\'s saline band does not come back three times', () => {
    const c = cs(id)
    const steps = c.script.steps
    const at = (s: string) => steps.findIndex((x) => x.id === s)
    for (const s of ['coldPack', 'signOut', 'walkOut']) {
      expect(steps[at(s)].scope, s).toBe('standby')
      expect(c.scopeAt[at(s)], s).toBe('standby')
    }
    // nothing after the dressing carries the dressing's scope forward
    for (let i = at('dressing') + 1; i < c.n; i++) expect(c.scopeAt[i], steps[i].id).not.toBe('dressing')
    expect(c.scopeAt[at('dressing')]).toBe('dressing')
  })

  it('scope carry-forward: the skin prep, the draping and the Time Out hold the survey\'s picture still (`hold`); the live survey marks do not run on through them, and no step carries a scope forward', () => {
    const c = cs(id)
    const steps = c.script.steps
    const at = (s: string) => steps.findIndex((x) => x.id === s)
    for (const s of ['prepSkin', 'drape', 'timeOut']) {
      expect(steps[at(s)].scope, s).toBe('hold')
      expect(c.scopeAt[at(s)], s).toBe('hold')
      expect(steps[at(s)].unit, s).toBe('drape')
    }
    expect(c.scopeAt[at('surveyMarks')]).toBe('survey')
    // the survey's scope is on the survey alone
    for (let i = 0; i < c.n; i++) if (steps[i].id !== 'surveyMarks') expect(c.scopeAt[i], steps[i].id).not.toBe('survey')
    // nothing before the survey names one (the picture is not live), and from the survey on every step names its own: none is carried forward
    for (const s of ['consoleCheck', 'patientArrives', 'changeGown', 'lieDown']) expect(c.scopeAt[at(s)], s).toBeNull()
    for (let i = at('surveyMarks'); i < c.n; i++) expect(steps[i].scope, steps[i].id).toBeDefined()
  })

  it('K17: every console line looks and works at the ProSense console\'s screen, and the wide steps and the programme use the new foci', () => {
    for (const s of cs(id).script.steps) {
      const r = s.roles.sonographer
      if (r?.do === 'runCryoConsole') {
        expect(r.look, `${s.id}: looks at the console's screen`).toBe('prosenseScreen')
        expect(r.work, `${s.id}: works at the console's screen`).toBe('prosenseScreen')
        expect(r.at, s.id).toBe('usConsole')
      }
    }
    expect(stepOf(id, 'programme').focus).toBe('prosenseConsole')
    expect(stepOf(id, 'consoleCheck').focus).toBe('prosenseConsole')
    for (const s of ['patientArrives', 'lieDown', 'timeOut', 'signOut', 'walkOut']) expect(stepOf(id, s).focus, s).toBe('usRoom')
    // the close steps stay close
    for (const s of ['localAnaesthetic', 'skinNick', 'probeIn', 'saline', 'dressing']) expect(stepOf(id, s).focus, s).toBe('breast')
  })

  it('K17: the sonographer works the console from an arm\'s length and passes the syringes from beside the radiologist: the console spot is 0.6 m or less from where her hands go, 0.75 m or less from the radiologist and never closer than 0.6 m', () => {
    const doctor = usAnchorSpot('usDoctor').at
    const console = usAnchorSpot('usConsole')
    const screen = usTargetInto('prosenseScreen', newUsTargetCtx(), { x: 0, y: 0, z: 0 })
    // (the cryo suite's console is worked from 0.55 m; from 0.8 m her hands could not reach it: the arm is 0.54 m and the chest leans a little)
    expect(dist(console.at, screen), 'the console spot to the touchscreen').toBeLessThanOrEqual(0.6)
    expect(dist(doctor, console.at), 'the pass').toBeLessThanOrEqual(0.75)
    expect(dist(doctor, console.at), 'the two people').toBeGreaterThanOrEqual(0.6)
    // the touchscreen is where the baked console has it: in front of its north face, within the screen's 0.4 m width of its centre line, at about hand height
    expect(Math.abs(screen.x - IMAGING.us.procedure!.prosense.at.x)).toBeLessThanOrEqual(0.2)
    expect(screen.y).toBeGreaterThan(0.9)
    expect(screen.y).toBeLessThan(1.3)
    // and she stands where she can: walkable with the margin of every anchor, clear of the baked console's body (x -33.69..-33.15, z 10.11..10.87)
    expect(isWalkable(console.at.x, console.at.z, 0.3)).toBe(true)
    expect(Math.hypot(Math.max(0, -33.15 - console.at.x, console.at.x - -33.15), Math.max(0, 10.11 - console.at.z, console.at.z - 10.87))).toBeGreaterThanOrEqual(0.3)
    // she faces the screen from it
    const want = Math.atan2(screen.x - console.at.x, screen.z - console.at.z)
    let off = Math.abs(console.heading - want) % (2 * Math.PI)
    if (off > Math.PI) off = 2 * Math.PI - off
    expect(off).toBeLessThan(0.15)
    for (const s of ['localAnaesthetic', 'saline']) {
      const line = stepOf(id, s).roles.sonographer!
      expect(line.do, s).toBe('passInstrument')
      expect(line.at, s).toBe('usConsole')
      expect(dist(usAnchorSpot(line.at as 'usConsole').at, doctor), `${s}: the pass`).toBeLessThanOrEqual(0.75)
    }
    // in every step the two people's spots keep 0.6 m between them
    for (const s of cs(id).script.steps) {
      const a = anchorSpot(s.roles.breastRadiologist!.at).at
      const b = anchorSpot(s.roles.sonographer!.at).at
      if (s.roles.breastRadiologist!.at === s.roles.sonographer!.at) throw new Error(`${s.id}: both at one spot`)
      expect(dist(a, b), `${s.id}: ${s.roles.breastRadiologist!.at} / ${s.roles.sonographer!.at}`).toBeGreaterThanOrEqual(0.6)
    }
  })

  it('K19: a step of the gown change sits between the patient arriving and lying down, in the unit `arrive`', () => {
    const steps = cs(id).script.steps
    const at = (s: string) => steps.findIndex((x) => x.id === s)
    expect(at('patientArrives')).toBeLessThan(at('changeGown'))
    expect(at('changeGown')).toBeLessThan(at('lieDown'))
    expect(steps[at('changeGown')].unit).toBe('arrive')
    expect(steps[at('changeGown')].caption).toMatch(/gown/)
    expect(steps[at('changeGown')].watchSeconds).toBeGreaterThanOrEqual(20)
  })
})

describe('K17: the sonographer\'s hands reach the touchscreen from the console spot', () => {
  // The crowd's body (constants.ts BODY): shoulders 0.19 m either side of the centre and STAND_PELVIS + waist + 0.365 m above the floor, an arm of
  // 0.29 + 0.25 m, and the keyboard pose (`aKeyboard`) puts each hand 0.1 m to its own side of the work point and 0.03 m toward her. She faces the point.
  const SHOULDER_Y = STAND_PELVIS + BODY.waist + BODY.shoulderUp
  const ARM = BODY.upperArm + BODY.forearm
  /** How far short of the work point a hand is left (m): the arm straight, and the chest leaning in a little (0.02 m: the pose's lean for a reach this size). */
  const shortfall = (from: { x: number; z: number }, to: { x: number; y: number; z: number }): number => {
    const d = Math.hypot(to.x - from.x, to.z - from.z)
    const reach = Math.hypot(BODY.shoulderHalf - 0.1, to.y + 0.02 - SHOULDER_Y, d - 0.03)
    return Math.max(0, reach - ARM - 0.02)
  }

  it('they are within 5 cm of the point (from the first round\'s spot, 0.8 m away, the arm was left more than 20 cm short)', () => {
    const screen = usTargetInto('prosenseScreen', newUsTargetCtx(), { x: 0, y: 0, z: 0 })
    const now = usAnchorSpot('usConsole').at
    expect(shortfall(now, screen), 'the console spot now').toBeLessThanOrEqual(0.05)
    // the same measure on the old spot and the old point (-33.45, 1.1, 10.12): the clamped hand it was
    expect(shortfall({ x: -32.95, z: 9.5 }, { x: -33.45, y: 1.1, z: 10.12 }), 'the spot of the first round').toBeGreaterThan(0.2)
  })
})

describe('the fibroadenoma script', () => {
  const id: ProcedureId = 'us-fibroadenoma'
  const steps = cs(id).script.steps
  const at = (s: string) => steps.findIndex((x) => x.id === s)

  it('K4: the lump check does not say the lump is inside the ice ball: its words are right for both cases', () => {
    const s = stepOf(id, 'lumpCheck')
    expect(s.caption).toBe('Ice ball checked against the lump')
    expect(s.why).toMatch(/if part is outside, the probe is moved and frozen again/)
    expect(s.event).toBe('The ice ball is checked against the lump on the ultrasound.')
    const text = JSON.stringify(steps)
    expect(text).not.toMatch(/lump is inside it|whole lump is inside the ice ball on the ultrasound/)
    // (the picture's label says which it is, from the case: src/scene/imaging/images/cryoCase.test.ts)
  })

  it('K5: a thaw before the probe is moved, and one before it is drawn out: freeze, thaw, then move or withdraw', () => {
    expect(steps[at('thawMove')].unit).toBe('relocate')
    expect(steps[at('thawMove')].scope).toBe('thawFree')
    expect(at('freeze2')).toBeLessThan(at('thawMove'))
    expect(at('thawMove')).toBe(at('relocate') - 1)
    expect(steps[at('thawFree')].unit).toBe('cleanup')
    expect(steps[at('thawFree')].scope).toBe('thawFree')
    expect(at('freeze3')).toBeLessThan(at('thawFree'))
    expect(at('thawFree')).toBe(at('probeOut') - 1)
    // the watch total stays 600-900 s with and without the probe move
    const plain = steps.filter((x) => x.unit !== 'relocate' && x.unit !== 'freeze3')
    for (const list of [steps, plain]) {
      const total = list.reduce((t, x) => t + x.watchSeconds, 0)
      expect(total).toBeGreaterThanOrEqual(600)
      expect(total).toBeLessThanOrEqual(900)
    }
    // the case without the move: the second freeze goes straight to the thaw and the probe out
    expect(plain.map((x) => x.id).slice(plain.findIndex((x) => x.id === 'freeze2'), plain.findIndex((x) => x.id === 'probeOut') + 1)).toEqual(['freeze2', 'thawFree', 'probeOut'])
    // the probe out says what comes before it
    expect(stepOf(id, 'probeOut').why).toMatch(/after the thaw/)
  })

  it('K8: the walk out is the fibroadenoma series\' same-day discharge, not the cancer trial\'s two days', () => {
    const w = stepOf(id, 'walkOut')
    expect(w.why).toBe('The patient goes home the same day and may return to normal activity.')
    expect(w.why).not.toMatch(/two days|about 2 days/)
    // the breast cancer keeps ICE3's recovery figure
    expect(stepOf('us-breastCancer', 'walkOut').why).toMatch(/within about two days/)
  })
})

// ---------------------------------------------------------------------------------------------
// K5: the sim's ice ball melts through both thaws (the picture follows it)
// ---------------------------------------------------------------------------------------------

describe('K5, K14, K15 (the sim): the ice ball melts in the thaw before the probe is moved and before it is drawn out', () => {
  it('the fibroadenoma that needs the probe moved: ice 0.86 after freeze 2, melting through the first thaw, gone for the move, 1 after freeze 3, melting through the second', { timeout: 300_000 }, () => {
    const tr = traceCase(5, 'us-cryo-fibroadenoma', true)
    expect(tr.relocate).toBe(true)
    const by = (step: string) => tr.ticks.filter((x) => x.step === step)
    const last = (step: string) => by(step).at(-1)!
    expect(last('freeze2').ice).toBeCloseTo(CONFIG.imaging.cryo.firstFreezeSize, 2)
    // the thaw before the move: the old ice melts away over its own step, monotonically
    const thawMove = by('thawMove')
    expect(thawMove.length).toBeGreaterThan(60)
    expect(thawMove[0].ice).toBeGreaterThan(0.8)
    for (let i = 1; i < thawMove.length; i++) expect(thawMove[i].ice, `thawMove ${i}`).toBeLessThanOrEqual(thawMove[i - 1].ice + 1e-9)
    expect(thawMove.at(-1)!.ice).toBeLessThan(0.02)
    // ... and it is gone, and stays gone, for the move itself
    for (const x of by('relocate')) expect(x.ice, 'ice during the move').toBeLessThan(0.02)
    // the third freeze grows to full size from nothing, no jump at either end
    expect(by('freeze3')[0].ice).toBeLessThan(0.05)
    expect(last('freeze3').ice).toBeCloseTo(1, 2)
    // the thaw before the probe is drawn out: from full size, melting to nothing; gone for the probe out, the dressing and the rest
    const thawFree = by('thawFree')
    expect(thawFree[0].ice).toBeGreaterThan(0.95)
    for (let i = 1; i < thawFree.length; i++) expect(thawFree[i].ice, `thawFree ${i}`).toBeLessThanOrEqual(thawFree[i - 1].ice + 1e-9)
    expect(thawFree.at(-1)!.ice).toBeLessThan(0.02)
    for (const step of ['probeOut', 'dressing', 'coldPack', 'signOut', 'walkOut']) for (const x of by(step)) expect(x.ice, step).toBeLessThan(0.02)
    // no frame-to-frame jump anywhere in the case: the picture never sees the ice vanish in one frame
    for (let i = 1; i < tr.ticks.length; i++) expect(Math.abs(tr.ticks[i].ice - tr.ticks[i - 1].ice), `tick ${i} (${tr.ticks[i].step})`).toBeLessThan(0.02)
  })

  it('the fibroadenoma one ice ball covers (no move) and the cancer: the second freeze goes to the thaw and the probe out, the ice melting through it', { timeout: 300_000 }, () => {
    const tr = traceCase(3, 'us-cryo-breast', true)
    const thaw = tr.ticks.filter((x) => x.step === 'thawFree')
    expect(thaw.length).toBeGreaterThan(60)
    expect(thaw[0].ice).toBeGreaterThan(0.95)
    expect(thaw.at(-1)!.ice).toBeLessThan(0.02)
    for (let i = 1; i < tr.ticks.length; i++) expect(Math.abs(tr.ticks[i].ice - tr.ticks[i - 1].ice), `tick ${i} (${tr.ticks[i].step})`).toBeLessThan(0.02)
  })
})

// ---------------------------------------------------------------------------------------------
// K7: the room log says each line when its script step begins
// ---------------------------------------------------------------------------------------------

describe.each([
  ['us-cryo-breast', true],
  ['us-cryo-fibroadenoma', true],
  ['us-cryo-fibroadenoma', false],
] as const)('K7: the room log of %s (watch %s) is in step with the script', (protocol, watch) => {
  let tr!: Trace
  beforeAll(() => {
    tr = traceCase(watch ? 5 : 4, protocol, watch)
  }, 300_000)
  const first = (re: RegExp) => tr.lines.find((l) => re.test(l.text))
  const stepIndexOf = (step: string) => compiledFor(protocol === 'us-cryo-breast' ? 'us-breastCancer' : 'us-fibroadenoma')!.script.steps.findIndex((s) => s.id === step)

  it('"guiding the cryoprobe in" is said when the probe goes in, not during the numbing', () => {
    const guide = first(/guiding the cryoprobe into the (tumour|lump) under ultrasound/)
    expect(guide, tr.lines.map((l) => l.text).join('\n')).toBeDefined()
    expect(guide!.step).toBe('probeIn')
    const numbed = first(/numbed with local anaesthetic/)!
    expect(numbed.step).toBe('localAnaesthetic')
    expect(guide!.t).toBeGreaterThan(numbed.t)
    expect(tr.lines.filter((l) => /guiding the cryoprobe/.test(l.text))).toHaveLength(1)
    expect(guide!.text).toContain(protocol === 'us-cryo-breast' ? 'tumour' : 'lump')
  })

  it('"the probe is out" is said at the walk out, not at the end of the last freeze while the script is still thawing', () => {
    const out = tr.lines.filter((l) => /the probe is out/.test(l.text))
    expect(out).toHaveLength(1)
    expect(out[0].step).toBe('walkOut')
    expect(out[0].text).toMatch(/^The cryoablation for .+ is finished/)
    // the end of the last freeze says only that the freezing is over (the thaw, the probe out and the dressing are still to come)
    const done = first(/The last freeze for .+ is over: the images are sent\./)!
    expect(done).toBeDefined()
    expect(['thawFree']).toContain(done.step)
    expect(done.t).toBeLessThan(out[0].t)
    expect(tr.lines.filter((l) => /the probe is out/.test(l.text) && stepIndexOf(l.step) < stepIndexOf('walkOut'))).toEqual([])
  })

  it('the thaw, the probe out and the lines of the freezes come with their own steps', () => {
    const thaw = tr.lines.filter((l) => /waiting for the ice to melt so the probe comes free/.test(l.text))
    expect(thaw).toHaveLength(1)
    expect(thaw[0].step).toBe('thawFree')
    const probeOut = first(/is drawing the cryoprobe out/)!
    expect(probeOut.step).toBe('probeOut')
    const freezes = tr.lines.filter((l) => /liquid nitrogen is flowing/.test(l.text))
    expect(freezes.length).toBe(protocol === 'us-cryo-breast' ? 2 : tr.relocate ? 3 : 2)
    for (const f of freezes) expect(f.step, f.text).toMatch(/^freeze[123]$/)
    // a probe moved to a second spot is said when the move begins (the script's event), after the thaw before it
    if (protocol === 'us-cryo-fibroadenoma' && tr.relocate) {
      const move = first(/moved to a second spot/)!
      expect(move.step).toBe('relocate')
      expect(first(/waiting for the ice to melt so the probe can be moved/)!.step).toBe('thawMove')
      expect(move.t).toBeGreaterThan(first(/waiting for the ice to melt so the probe can be moved/)!.t)
    } else expect(first(/moved to a second spot/)).toBeUndefined()
    // and the lump check says neither that the lump is inside nor that it is outside (the picture shows which)
    if (protocol === 'us-cryo-fibroadenoma') {
      const check = first(/checked against the lump/)!
      expect(check.step).toBe('lumpCheck')
      expect(check.text).not.toMatch(/inside the ice ball/)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// K9: the case's lump reaches the exam (and so the picture)
// ---------------------------------------------------------------------------------------------

describe('K9: the exam publishes the lump the case treats', () => {
  it('a fibroadenoma demo carries its drawn lump (10-38 mm, the same as the case that picked its programme and its probe move); the watch case 34 mm; the cancer 12 mm', { timeout: 600_000 }, () => {
    const seen = new Set<number>()
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const sim = new Simulation(seed, { startHour: 10, inFlight: false })
      expect(sim.imaging.startDemoScan('us', 'us-cryo-fibroadenoma')).toBe(true)
      const b = sim.imaging.bookings.find((x) => x.kind === 'demo')!
      for (let i = 0; i < Math.round(5 / DT); i++) sim.step(DT)
      const exam = sim.imaging.machines.us.state.exam!
      expect(exam.protocol).toMatch(/fibroadenoma/)
      expect(lumpMmOfExam(exam)).toBe(b.cryo!.lumpMm)
      expect(lumpMmOfExam(exam)!).toBeGreaterThanOrEqual(CONFIG.imaging.cryo.fibroadenoma.lumpMm[0])
      expect(lumpMmOfExam(exam)!).toBeLessThanOrEqual(CONFIG.imaging.cryo.fibroadenoma.lumpMm[1])
      // the probe move and the programme come from the same lump
      expect(exam.sequences.length > 4).toBe(b.cryo!.lumpMm > CONFIG.imaging.cryo.fibroadenoma.relocateOverMm)
      seen.add(b.cryo!.lumpMm)
    }
    expect(seen.size).toBeGreaterThan(2)
    const w = new Simulation(2, { startHour: 10, inFlight: false })
    w.imaging.startWatch('us-cryo-fibroadenoma')
    for (let i = 0; i < Math.round(3 / DT); i++) w.step(DT)
    expect(lumpMmOfExam(w.imaging.machines.us.state.exam!)).toBe(CONFIG.imaging.cryo.fibroadenoma.relocateOverMm + 4)
    const c = new Simulation(2, { startHour: 10, inFlight: false })
    c.imaging.startDemoScan('us', 'us-cryo-breast')
    for (let i = 0; i < Math.round(3 / DT); i++) c.step(DT)
    expect(lumpMmOfExam(c.imaging.machines.us.state.exam!)).toBe(12)
    // a scan has none
    const scan = new Simulation(2, { startHour: 10, inFlight: false })
    scan.imaging.startDemoScan('us')
    for (let i = 0; i < Math.round(3 / DT); i++) scan.step(DT)
    expect(lumpMmOfExam(scan.imaging.machines.us.state.exam!)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------------------------
// K17, K18, K19: the people over whole cases
// ---------------------------------------------------------------------------------------------

describe.each([
  ['us-cryo-fibroadenoma', true, 5],
  ['us-cryo-breast', true, 8],
  ['us-cryo-fibroadenoma', false, 4],
  ['us-cryo-breast', false, 6],
] as const)('the people in %s (watch %s, seed %i)', (protocol, watch, seed) => {
  let tr!: Trace
  beforeAll(() => {
    tr = traceCase(seed, protocol, watch)
  }, 600_000)
  const label = `${protocol} ${watch ? 'watch' : 'day'} seed ${seed}`
  const US = IMAGING.us

  it('K18: the radiologist keeps 0.6 m from the patient while she climbs on and off the couch, and the getting-on point is clear of her stool', () => {
    const approach = US.table.out
    void approach
    let minTransfer = Infinity
    let transferTicks = 0
    for (const x of tr.ticks) {
      if (x.pat === null || x.doc === null) continue
      // the transfer: the patient is within 2 m of the couch and not lying on it (getting on, or off)
      const near = dist(x.pat, { x: US.table.in.x, z: US.table.in.z }) < 2.2
      if (near && !x.pat.onCouch) {
        transferTicks++
        minTransfer = Math.min(minTransfer, dist(x.doc, x.pat))
      }
    }
    expect(transferTicks, `${label}: the transfers were seen`).toBeGreaterThan(30)
    expect(minTransfer, `${label}: the closest the radiologist was to the patient climbing on or off`).toBeGreaterThanOrEqual(0.6)
    // and the spot itself: the stool is clear of the getting-on point (it was 0.46 m from it)
    const sc = tr.sim.imaging.machines.us.sites.tableSeat
    expect(dist(usAnchorSpot('usDoctor').at, sc.approach)).toBeGreaterThanOrEqual(0.65)
  })

  it('K17: the sonographer never stands closer than 0.5 m to the radiologist while both work, and faces the console while she runs it', () => {
    let minApart = Infinity
    let facing = 0
    let checked = 0
    let farthest = 0
    let ticksAtScreen = 0
    const screen = usTargetInto('prosenseScreen', newUsTargetCtx(), { x: 0, y: 0, z: 0 })
    const consoleAt = US.procedure!.console.at
    for (const x of tr.ticks) {
      if (x.doc !== null && x.unit !== 'arrive' && x.unit !== 'cleanup') minApart = Math.min(minApart, dist(x.doc, x.son))
      // running the console: standing at her console spot (within 0.5 m) she faces the screen to within 50 degrees
      const runs = ['programme', 'freeze1', 'thaw', 'freeze2', 'freeze3', 'probeIn', 'relocate', 'thawFree', 'thawMove'].includes(x.step) && x.progress > 0.4
      if (runs && dist(x.son, consoleAt) < 0.5) {
        checked++
        // (her hands work the touchscreen: she is an arm's length from it, 0.55 m, not 0.8 m)
        farthest = Math.max(farthest, dist(x.son, screen))
        if (dist(x.son, screen) <= 0.7) ticksAtScreen++
        const want = Math.atan2(screen.x - x.son.x, screen.z - x.son.z)
        let d = Math.abs(x.son.heading - want) % (2 * Math.PI)
        if (d > Math.PI) d = 2 * Math.PI - d
        if (d < 0.9) facing++
      }
    }
    expect(minApart, `${label}: the closest the two people got while they worked`).toBeGreaterThanOrEqual(0.5)
    expect(checked, `${label}: the sonographer was seen at the console`).toBeGreaterThan(200)
    expect(facing / checked, `${label}: facing the console`).toBeGreaterThan(0.95)
    expect(farthest, `${label}: the farthest she was from the touchscreen while she ran the console`).toBeLessThanOrEqual(0.7)
    expect(ticksAtScreen, label).toBe(checked)
  })

  it('K19: the patient changes into a gown before lying down (in a cubicle) and is in her own clothes again after; she never lies on the couch in everyday clothes', () => {
    const outfits: string[] = []
    let onCouchEveryday = 0
    let onCouch = 0
    for (const x of tr.ticks) {
      if (x.pat === null) continue
      if (outfits.at(-1) !== x.pat.outfit) outfits.push(x.pat.outfit)
      if (x.pat.onCouch) {
        onCouch++
        if (x.pat.outfit !== 'gown') onCouchEveryday++
      }
    }
    expect(outfits.slice(0, 2), label).toEqual(['everyday', 'gown'])
    expect(onCouch).toBeGreaterThan(60)
    expect(onCouchEveryday, `${label}: ticks on the couch in everyday clothes`).toBe(0)
    // she changed in a cubicle: while the session was in its `changing` step she stood at one of the changing cubicles
    const cubicles = tr.sim.imaging.sites.cubicles
    const gownAt = tr.ticks.find((x) => x.pat !== null && x.pat.outfit === 'gown')!
    const nearCubicle = cubicles.some((c) => dist(gownAt.pat!, c.at) < 0.8)
    expect(nearCubicle, `${label}: the gown went on in a cubicle (${gownAt.pat!.x.toFixed(1)}, ${gownAt.pat!.z.toFixed(1)})`).toBe(true)
  })

  it('K19: the step `changeGown` is exactly her time in the cubicle, in the day as in a watch case: patientArrives until she starts changing, lieDown from the moment she is done', () => {
    const changing = tr.ticks.filter((x) => x.sess === 'changing')
    expect(changing.length, `${label}: the ticks she was changing`).toBeGreaterThan(Math.round((0.9 * CONFIG.imaging.cryo.changeSeconds) / DT))
    const from = changing[0].t
    const to = changing.at(-1)!.t
    const gown = tr.ticks.filter((x) => x.step === 'changeGown')
    expect(Math.abs(gown[0].t - from), `${label}: the step begins as she starts changing (it was 18 s early in the day)`).toBeLessThanOrEqual(0.25)
    expect(Math.abs(gown.at(-1)!.t - to), `${label}: and ends as she is done changing`).toBeLessThanOrEqual(0.25)
    const wrong: string[] = []
    for (const x of tr.ticks) {
      const inside = x.t > from + 0.25 && x.t < to - 0.25
      // inside her time in the cubicle: the gown step, and nothing else
      if (inside && x.step !== 'changeGown') wrong.push(`${x.t.toFixed(1)} ${x.sess} shows ${x.step}`)
      // before it (the call, the stand, the walk to the cubicle): she arrives; after it (the walk back, getting on the couch): she lies down
      if (['meet', 'call', 'standUp', 'toCubicle'].includes(x.sess) && x.t < from - 0.25 && x.step !== 'patientArrives') wrong.push(`${x.t.toFixed(1)} ${x.sess} shows ${x.step}`)
      if (x.sess === 'toRoom' && x.t > to + 0.25 && x.step !== 'lieDown') wrong.push(`${x.t.toFixed(1)} ${x.sess} shows ${x.step}`)
      // (she is on the couch only once her gown is on, and only in the step `lieDown` or after it)
      if (x.pat !== null && x.pat.onCouch && x.step === 'changeGown' && x.t > from + 0.25 && x.t < to - 0.25) wrong.push(`${x.t.toFixed(1)} on the couch while changing`)
    }
    expect(wrong.slice(0, 5), label).toEqual([])
    // she walks back and lies down inside lieDown, not inside the gown step
    const onCouchAt = tr.ticks.find((x) => x.pat !== null && x.pat.onCouch)!
    expect(onCouchAt.step, `${label}: the step she gets on the couch in`).toBe('lieDown')
    expect(onCouchAt.t).toBeGreaterThanOrEqual(to)
  })

  it('K19: after the case she changes back in a cubicle and walks out in her own clothes', { timeout: 300_000 }, () => {
    const sim = tr.sim
    const person = sim.imaging.outpatients.find((o) => o.id.startsWith('demo'))
    // (she is still in the simulation or already gone: follow her to the exit)
    for (let i = 0, n = Math.round(240 / DT); i < n && sim.imaging.outpatients.some((o) => o.id.startsWith('demo')); i++) sim.step(DT)
    expect(sim.imaging.outpatients.some((o) => o.id.startsWith('demo'))).toBe(false)
    if (person !== undefined) expect(person.entity.outfit).toBe('everyday')
    expect(sim.imaging.stuckFixes, sim.imaging.stuckLog.join('; ')).toBe(0)
    // she holds no cubicle any more (the day's MRI patients may hold theirs)
    for (let i = 0; i < sim.imaging.cubicles.cubicles.length; i++) expect(sim.imaging.cubicles.holder(i) ?? '', `cubicle ${i}`).not.toMatch(/^demo/)
  })
})

describe('K19 for the booked cryoablation (op-19) and its determinism', () => {
  it('the booked patient is in a gown on the couch too, and the whole case is the same on a replay', { timeout: 600_000 }, () => {
    const run = () => {
      const sim = new Simulation(7, { startHour: 9.75, inFlight: false })
      const view = sim.imaging.machines.us.state.procedure
      let ran = false
      const outfits: string[] = []
      let everydayOnCouch = 0
      let gownTime = -1
      for (let i = 0, n = Math.round(3600 / DT); i < n; i++) {
        sim.step(DT)
        if (view.procedureId !== null) {
          ran = true
          const sc = sim.imaging.machines.us
          const p = sim.imaging.outpatients.find((o) => o.booking.patientId === sc.session?.booking.patientId)
          if (p) {
            const o = String(p.entity.outfit)
            if (outfits.at(-1) !== o) {
              outfits.push(o)
              if (o === 'gown') gownTime = sim.t
            }
            if (p.seat === sc.sites.tableSeat && o !== 'gown') everydayOnCouch++
          }
        }
        if (ran && view.procedureId === null && sim.imaging.machines.us.session === null) break
      }
      expect(sim.imaging.stuckFixes, sim.imaging.stuckLog.join('; ')).toBe(0)
      return { outfits, everydayOnCouch, gownTime, t: sim.t }
    }
    const a = run()
    const b = run()
    expect(a.outfits.slice(0, 2)).toEqual(['everyday', 'gown'])
    expect(a.everydayOnCouch).toBe(0)
    expect(a).toEqual(b)
  })

  it('no random number is drawn for the gown change: the scanner has no Rng, and the plan\'s gown time is a constant', () => {
    const src = readFileSync(join(process.cwd(), 'src/sim/imaging/scanner.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(src).not.toMatch(/\bRng\b|Math\.random|\.float\(|\.between\(|\.chance\(|\.range\(|\.int\(|\.pick\(/)
    expect(CONFIG.imaging.cryo.changeSeconds).toBeGreaterThan(0)
    expect(IMAGING_STAFF).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------------------------
// K19 (second round): the cubicle, the random numbers
// ---------------------------------------------------------------------------------------------

describe('K19 resources: the ProSense patient has the last changing cubicle to herself, so no MRI patient loses one', () => {
  const cubicles = [0, 1, 2].map((i) => ({ seat: null, at: { x: i, z: 0 }, approach: { x: i, z: 1 }, heading: 0 }))

  it('the pool: MRI patients take the first two (a third gets none while the last is free), the ProSense patient only the last', () => {
    const pool = new CubiclePool(cubicles, 1)
    expect(pool.claim('mri-a')).toBe(cubicles[0])
    expect(pool.claim('mri-b')).toBe(cubicles[1])
    expect(pool.claim('mri-c'), 'an MRI patient never takes hers').toBeNull()
    expect(pool.claim('pro-1', true)).toBe(cubicles[2])
    expect(pool.claim('pro-1', true), 'asking again gives the one she holds').toBe(cubicles[2])
    expect(pool.claim('pro-2', true), 'a second ProSense patient (the case before is still changing back) waits').toBeNull()
    expect(pool.busy).toBe(3)
    pool.release('pro-1')
    expect(pool.claim('pro-2', true)).toBe(cubicles[2])
    // a ProSense patient never takes an MRI patient's, even with the last one in use
    pool.release('mri-a')
    expect(pool.claim('pro-3', true)).toBeNull()
    expect(pool.claim('mri-d')).toBe(cubicles[0])
  })

  it('a pool with none reserved is the old pool: the first free cubicle for everybody', () => {
    const pool = new CubiclePool(cubicles)
    expect(pool.claim('a')).toBe(cubicles[0])
    expect(pool.claim('b', true)).toBe(cubicles[1])
    expect(pool.claim('c')).toBe(cubicles[2])
    expect(pool.claim('d')).toBeNull()
  })

  it('the department\'s pool reserves the last of the three draw-centre cubicles', () => {
    const sim = new Simulation(7, { startHour: 10, inFlight: false })
    const pool = sim.imaging.cubicles
    expect(pool.cubicles).toHaveLength(3)
    expect(pool.claim('x-1')).toBe(pool.cubicles[0])
    expect(pool.claim('x-2')).toBe(pool.cubicles[1])
    expect(pool.claim('x-3')).toBeNull()
    expect(pool.claim('x-4', true)).toBe(pool.cubicles[2])
  })

  it('with a ProSense case begun while an MRI patient is changing (and the day\'s other MRI patients), the ProSense patient only ever holds the last cubicle and every MRI patient one of the first two', { timeout: 900_000 }, () => {
    let overlapped = 0
    for (const seed of [7, 12, 21]) {
      const sim = new Simulation(seed, { startHour: 9.9, inFlight: false })
      const img = sim.imaging
      // an MRI outpatient is in the first cubicle: the case begins now, and its patient needs hers half a minute later
      let mriChanging = false
      for (let i = 0, n = Math.round(1800 / DT); i < n && !mriChanging; i++) {
        sim.step(DT)
        mriChanging = img.machines.mri.session?.step === 'changing'
      }
      expect(mriChanging, `seed ${seed}: an MRI patient was changing`).toBe(true)
      expect(img.startDemoScan('us', 'us-cryo-breast')).toBe(true)
      const n = img.cubicles.cubicles.length
      const wrong: string[] = []
      let prosenseTicks = 0
      let mriTicks = 0
      for (let i = 0, k = Math.round(1800 / DT); i < k; i++) {
        sim.step(DT)
        let pro = false
        let mri = false
        for (let c = 0; c < n; c++) {
          const id = img.cubicles.holder(c)
          if (id === null) continue
          const who = img.outpatients.find((o) => o.id === id)
          if (who === undefined) continue
          if (who.booking.cryo !== undefined) {
            pro = true
            prosenseTicks++
            if (c !== n - 1) wrong.push(`${sim.t.toFixed(0)}: ProSense patient in cubicle ${c}`)
          } else {
            mri = true
            mriTicks++
            if (c >= n - 1) wrong.push(`${sim.t.toFixed(0)}: MRI patient ${id} in cubicle ${c}`)
          }
        }
        if (pro && mri) overlapped++
      }
      expect(wrong.slice(0, 5), `seed ${seed}`).toEqual([])
      expect(prosenseTicks, `seed ${seed}: she changed in the cubicle`).toBeGreaterThan(Math.round(25 / DT))
      expect(mriTicks, `seed ${seed}: MRI patients changed too`).toBeGreaterThan(Math.round(25 / DT))
      expect(img.stuckFixes, img.stuckLog.join('; ')).toBe(0)
    }
    expect(overlapped, 'the ProSense patient and an MRI patient were in their cubicles together').toBeGreaterThan(0)
  })

  it('when the reserved cubicle is in use (the case before hers still changing back) she puts the gown on where she stands: the case goes on, a gown on the couch, nobody stuck', { timeout: 600_000 }, () => {
    const tr = traceCase(4, 'us-cryo-fibroadenoma', false, {
      setup: (sim) => {
        expect(sim.imaging.cubicles.claim('blocker', true)).not.toBeNull()
      },
    })
    expect(tr.sim.imaging.stuckFixes, tr.sim.imaging.stuckLog.join('; ')).toBe(0)
    const onCouch = tr.ticks.filter((x) => x.pat !== null && x.pat.onCouch)
    expect(onCouch.length).toBeGreaterThan(60)
    expect(onCouch.filter((x) => x.pat!.outfit !== 'gown')).toEqual([])
    // no cubicle, no `changing` step, and the day's steps still play in order from there (the gown step has no time of its own)
    expect(tr.ticks.some((x) => x.sess === 'changing')).toBe(false)
    const seen: string[] = []
    for (const x of tr.ticks) if (seen.at(-1) !== x.step) seen.push(x.step)
    expect(seen.slice(0, 4)).toEqual(['consoleCheck', 'patientArrives', 'lieDown', 'surveyMarks'])
    expect(new Set(seen).size).toBe(seen.length)
  })
})

describe('K19 rng: the ProSense patient draws no random number once she is in the room', () => {
  const methodsOf = (rng: Rng): string[] => Object.getOwnPropertyNames(Object.getPrototypeOf(rng)).filter((m) => m !== 'constructor' && m !== 'fork' && typeof (rng as unknown as Record<string, unknown>)[m] === 'function')

  /** Step until `find` returns a person, spy on every draw of her own stream, run until she has left (or `limitS`): the number of draws seen. */
  function draws(sim: Simulation, find: () => ReturnType<Simulation['imaging']['outpatients']['find']>, limitS: number, waitS = 60): number {
    let person = find()
    for (let i = 0, n = Math.round(waitS / DT); i < n && person === undefined; i++) {
      sim.step(DT)
      person = find()
    }
    expect(person, 'the patient appeared').toBeDefined()
    const rng = (person as unknown as { orng: Rng }).orng
    const spies = methodsOf(rng).map((m) => vi.spyOn(rng as unknown as Record<string, (...a: unknown[]) => unknown>, m))
    expect(spies.length).toBeGreaterThan(5)
    try {
      for (let i = 0, n = Math.round(limitS / DT); i < n && sim.imaging.outpatients.includes(person!); i++) sim.step(DT)
      expect(sim.imaging.outpatients.includes(person!), 'she went home').toBe(false)
      return spies.reduce((t, sp) => t + sp.mock.calls.length, 0)
    } finally {
      spies.forEach((sp) => sp.mockRestore())
    }
  }

  it('a demo ProSense patient: no draw from the gown change to the way home (changing back is a fixed time)', { timeout: 900_000 }, () => {
    const sim = new Simulation(7, { startHour: 10, inFlight: false })
    expect(sim.imaging.startDemoScan('us', 'us-cryo-breast')).toBe(true)
    expect(draws(sim, () => sim.imaging.outpatients.find((o) => o.id.startsWith('demo') && o.booking.cryo !== undefined), 5400)).toBe(0)
    expect(CONFIG.imaging.cryo.changeBackSeconds).toBeGreaterThanOrEqual(CONFIG.imaging.changeBackSeconds[0])
    expect(CONFIG.imaging.cryo.changeBackSeconds).toBeLessThanOrEqual(CONFIG.imaging.changeBackSeconds[1])
  })

  it('the booked patient (op-19), once she is on the scanner: no draw either', { timeout: 900_000 }, () => {
    const sim = new Simulation(7, { startHour: 9.75, inFlight: false })
    const img = sim.imaging
    // (she checks in at a kiosk or the desk first, which does draw: the spy starts when the ultrasound takes her)
    const find = () => {
      const p = img.outpatients.find((o) => o.id === 'op-19')
      return p !== undefined && p.booking.state === 'active' ? p : undefined
    }
    expect(draws(sim, find, 5400, 2400)).toBe(0)
  })

  it('the spy sees a draw when there is one: an MRI patient changing back draws her time', { timeout: 900_000 }, () => {
    const sim = new Simulation(7, { startHour: 10, inFlight: false })
    expect(sim.imaging.startDemoScan('mri')).toBe(true)
    expect(draws(sim, () => sim.imaging.outpatients.find((o) => o.id.startsWith('demo')), 7200)).toBeGreaterThan(0)
  })
})
