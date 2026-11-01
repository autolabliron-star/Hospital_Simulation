/**
 * R5: the procedure scripts (src/content/procedures/*.json) parse, are complete, keep to their machine's units and roles, read in UK English
 * without a graphic word, and keep the patient's pose consistent with the operation (no tube outside the anaesthetic, drapes on while it runs,
 * the table level again before closing). Every script that exists is checked; the scripts of later waves are simply absent until written.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CONFIG } from '@/sim/config'
import { ROOM_PHASES } from '@/sim/surgery/plan'
import type { ProcedureId } from '@/sim/types'
import { ENDOSCOPE_UI } from './endoscopeUi'
import {
  GRAPHIC_WORDS,
  OPTIONAL_UNITS,
  PROCEDURE_IDS,
  PROCEDURE_META,
  PROCEDURE_SCRIPTS,
  ProcedureScriptSchema,
  ROLES_BY_MACHINE,
  SLOTS_BY_UNIT,
  STEP_COUNT_RANGE,
  UNITS,
  US_WORDS,
  parseScript,
  scriptFor,
  type ProcedureScript,
} from './procedures'
import { DOCK_SPLIT, UNDOCK_SPLIT } from '@/sim/surgery/robot'
import { SURGERY_COPY } from './surgery'

const DIR = fileURLToPath(new URL('./procedures/', import.meta.url))
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.json'))
const SCRIPTS = Object.values(PROCEDURE_SCRIPTS) as ProcedureScript[]
const json = (id: string): any => JSON.parse(readFileSync(`${DIR}${id}.json`, 'utf8'))
/** Instruments the research document gives a procedure beyond surgery.json's own lists. */
const RESEARCH_EXTRA: Record<string, readonly string[]> = {
  hysterectomy: ['Fenestrated bipolar forceps'],
  prostatectomy: ['Monopolar curved scissors'],
}

/** The numbered sources of section 13 of the research document ("13. Sources" up to "14. Notes for the simulation"). */
const SOURCES: Set<number> = (() => {
  const text = readFileSync(fileURLToPath(new URL('../../docs/research/procedures.md', import.meta.url)), 'utf8')
  const from = text.indexOf('## 13. Sources')
  const to = text.indexOf('## 14.', from)
  if (from < 0 || to < 0) throw new Error('docs/research/procedures.md: section 13 not found')
  return new Set([...text.slice(from, to).matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1])))
})()

function strings(o: unknown, path = ''): [string, string][] {
  if (typeof o === 'string') return [[path, o]]
  if (Array.isArray(o)) return o.flatMap((v, i) => strings(v, `${path}[${i}]`))
  if (o && typeof o === 'object') return Object.entries(o).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k))
  return []
}

describe('the procedure scripts: loading', () => {
  it('has the first script (the gallbladder removal), each file named by its id', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(1)
    for (const f of FILES) {
      const id = f.replace(/\.json$/, '') as ProcedureId
      expect(PROCEDURE_IDS, f).toContain(id)
      expect(scriptFor(id)?.id, f).toBe(id)
    }
    expect(scriptFor('or-cholecystectomy')).toBeDefined()
    expect(SOURCES.size).toBeGreaterThanOrEqual(41)
  })

  it('tolerates the scripts that are not written yet', () => {
    for (const id of PROCEDURE_IDS) {
      const script = scriptFor(id)
      if (script === undefined) expect(PROCEDURE_SCRIPTS[id]).toBeUndefined()
    }
  })

  it('agrees with the plan about the da Vinci units, and the robot about its slots', () => {
    expect(UNITS.daVinci).toEqual([...ROOM_PHASES])
    expect(SLOTS_BY_UNIT.daVinci.docking).toHaveLength(DOCK_SPLIT.length)
    expect(SLOTS_BY_UNIT.daVinci.undocking).toHaveLength(UNDOCK_SPLIT.length)
  })

  it('rejects a script with a bad field, naming it', () => {
    const base = json('or-cholecystectomy')
    expect(() => parseScript({ ...base, machine: 'cryoCt' }, 'x')).toThrow(/runs on daVinci/)
    const noSlot = structuredClone(base)
    delete noSlot.steps.find((s: any) => s.id === 'driveCart').slot
    expect(() => parseScript(noSlot, 'x')).toThrow(/names its slot/)
    const outOfOrder = structuredClone(base)
    outOfOrder.steps.reverse()
    expect(() => parseScript(outOfOrder, 'x')).toThrow(/out of order|checklist/)
    const gory = structuredClone(base)
    gory.steps[0].why = 'There is blood everywhere.'
    expect(() => parseScript(gory, 'x')).toThrow(/non-graphic/)
    const us = structuredClone(base)
    us.steps[0].caption = 'Into the OR'
    expect(() => parseScript(us, 'x')).toThrow(/UK vocabulary/)
    const badRole = structuredClone(base)
    badRole.steps[0].roles.ir = { do: 'idle', at: 'scrub' }
    expect(() => parseScript(badRole, 'x')).toThrow(/not a role of daVinci/)
    const unknownKey = structuredClone(base)
    unknownKey.steps[0].extra = 1
    expect(ProcedureScriptSchema.safeParse(unknownKey).success).toBe(false)
    const url = structuredClone(base)
    url.refs = ['https://example.org/paper']
    expect(() => parseScript(url, 'x')).toThrow(/procedures:5/)
    const noLook = structuredClone(base)
    noLook.robotArms[2] = 'Plasma wand'
    expect(() => parseScript(noLook, 'x')).toThrow(/no endoscope look/)
  })
})

describe.each(SCRIPTS.map((s) => [s.id, s] as const))('script %s', (_id, script) => {
  const meta = PROCEDURE_META[script.id]
  const steps = script.steps

  it('has 20-40 steps whose id, caption and why are short and distinct', () => {
    expect(steps.length).toBeGreaterThanOrEqual(STEP_COUNT_RANGE[0])
    expect(steps.length).toBeLessThanOrEqual(STEP_COUNT_RANGE[1])
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length)
    for (const s of steps) {
      expect(s.caption.length, s.id).toBeLessThanOrEqual(60)
      expect(s.why.length, s.id).toBeLessThanOrEqual(160)
    }
    expect(script.machine).toBe(meta.machine)
    expect(script.key).toBe(meta.key)
  })

  it('goes through every unit of its machine, in order', () => {
    const order = UNITS[script.machine]
    let last = -1
    for (const s of steps) {
      const u = order.indexOf(s.unit)
      expect(u, s.id).toBeGreaterThanOrEqual(last)
      last = u
    }
    for (const unit of order) {
      if (OPTIONAL_UNITS[script.machine].includes(unit)) continue
      expect(steps.some((s) => s.unit === unit), unit).toBe(true)
    }
  })

  it('lays the docking and undocking steps into the robot\'s slots, in order, every slot covered', () => {
    if (script.machine !== 'daVinci') return
    for (const [unit, slots] of Object.entries(SLOTS_BY_UNIT.daVinci)) {
      const inUnit = steps.filter((s) => s.unit === unit)
      const idx = inUnit.map((s) => slots.indexOf(s.slot ?? ''))
      expect(idx.every((i) => i >= 0), unit).toBe(true)
      expect([...idx].sort((a, b) => a - b), unit).toEqual(idx)
      expect(new Set(idx).size, unit).toBe(slots.length)
    }
    for (const s of steps.filter((s) => s.unit !== 'docking' && s.unit !== 'undocking')) expect(s.slot, s.id).toBeUndefined()
  })

  it('has watch times that add up to a watchable case, no step under the minimum', () => {
    const total = steps.reduce((a, s) => a + s.watchSeconds, 0)
    expect(total).toBeGreaterThanOrEqual(600)
    expect(total).toBeLessThanOrEqual(900)
    expect(total).toBeGreaterThanOrEqual(CONFIG.procedure.watchTotalSeconds[0])
    for (const s of steps) {
      expect(s.watchSeconds, s.id).toBeGreaterThanOrEqual(8)
      expect(s.watchSeconds, s.id).toBeGreaterThanOrEqual(CONFIG.procedure.minWatchStepSeconds)
    }
  })

  it('keeps the slot shares of the watch time near the robot\'s own fractions', () => {
    if (script.machine !== 'daVinci') return
    const share = (unit: 'docking' | 'undocking', split: readonly number[]) => {
      const slots = SLOTS_BY_UNIT.daVinci[unit]
      const inUnit = steps.filter((s) => s.unit === unit)
      const total = inUnit.reduce((a, s) => a + s.watchSeconds, 0)
      slots.forEach((slot, i) => {
        const w = inUnit.filter((s) => s.slot === slot).reduce((a, s) => a + s.watchSeconds, 0)
        expect(Math.abs(w / total - split[i]), `${unit}/${slot}`).toBeLessThan(0.03)
      })
    }
    share('docking', DOCK_SPLIT)
    share('undocking', UNDOCK_SPLIT)
  })

  it('has real-minute bands that are ordered', () => {
    for (const s of steps) {
      expect(s.realMinutes[0], s.id).toBeLessThanOrEqual(s.realMinutes[1])
      expect(s.realMinutes[0], s.id).toBeGreaterThan(0)
    }
  })

  it('uses only the roles of its machine and fills every role somewhere', () => {
    const roles = ROLES_BY_MACHINE[script.machine]
    for (const s of steps) for (const r of Object.keys(s.roles)) expect(roles, `${s.id}.${r}`).toContain(r)
    for (const r of roles) expect(steps.some((s) => s.roles[r] !== undefined), r).toBe(true)
  })

  it('has 3-6 event lines, each a full sentence', () => {
    const events = steps.filter((s) => s.event !== undefined)
    expect(events.length).toBeGreaterThanOrEqual(3)
    expect(events.length).toBeLessThanOrEqual(6)
    for (const s of events) expect(s.event!.endsWith('.'), s.id).toBe(true)
  })

  it('cites its sources by number ("procedures:5" for source [5]): each one is in section 13 of the research document', () => {
    expect(script.refs.length).toBeGreaterThanOrEqual(1)
    expect(new Set(script.refs).size).toBe(script.refs.length)
    for (const r of script.refs) {
      expect(r).toMatch(/^procedures:[1-9]\d*$/)
      expect(SOURCES.has(Number(r.split(':')[1])), `${r} is not in section 13 of docs/research/procedures.md`).toBe(true)
    }
  })

  it('puts the three WHO pauses where the research document puts them: Sign In before the anaesthetic, Time Out after the drapes and before the first nick, Sign Out after the console and before the patient wakes', () => {
    if (script.machine !== 'daVinci') return
    const idx = (id: string) => steps.findIndex((s) => s.id === id)
    const has = (s: (typeof steps)[number], actions: string[]) => Object.values(s.roles).some((r) => r !== undefined && actions.includes(r.do))
    const marked = steps.filter((s) => s.checklist !== undefined)
    expect(marked.map((s) => s.checklist)).toEqual(['signIn', 'timeOut', 'signOut'])
    const [signIn, timeOut, signOut] = marked.map((s) => steps.indexOf(s))
    const asleep = steps.findIndex((s) => s.patient?.awareness === 'asleep')
    const draped = steps.findIndex((s) => s.patient?.drape === 1)
    const firstCut = steps.findIndex((s) => has(s, ['skinNick', 'insertTrocar']))
    const lastConsole = steps.map((s) => s.unit).lastIndexOf('console')
    const wakes = steps.findIndex((s) => has(s, ['extubate']))
    expect(steps[signIn].unit).toBe('induction')
    expect(signIn).toBeLessThan(asleep)
    expect(steps[signIn].roles.circulator?.do).toBe('checklist')
    expect(timeOut).toBeGreaterThan(draped)
    expect(timeOut).toBeLessThan(firstCut)
    expect(steps[timeOut].event).toBeDefined()
    expect(signOut).toBeGreaterThan(lastConsole)
    expect(signOut).toBeLessThan(wakes)
    expect(has(steps[signOut], ['countItems'])).toBe(true)
    expect(steps[signOut].roles.scrub?.do).toBe('countItems')
    expect(idx('signOut')).toBe(signOut)
  })

  it('has the cart dock from the patient\'s right (west) and the bedside assistant on the patient\'s left (east) from the ports to the end', () => {
    if (script.machine !== 'daVinci') return
    const WEST = ['tableWest', 'tableWestHead']
    const dockedFrom = steps.findIndex((s) => s.slot === 'driving')
    const undocked = steps.findIndex((s) => s.slot === 'returning')
    // the west side of the table is free while the cart is docked
    steps.forEach((s, i) => {
      if (i <= dockedFrom || i >= undocked) return
      for (const [role, line] of Object.entries(s.roles)) expect(WEST, `${s.id} ${role}`).not.toContain(line!.at)
    })
    // the assistant works from the east side from the ports on, except to steer the cart (behind it, in the west); the one other place is the
    // hysterectomy's table foot, between the legs, where the manipulator is worked and the uterus comes out (research section 4)
    const ports = steps.findIndex((s) => s.unit === 'ports')
    for (const s of steps.slice(ports)) {
      const line = s.roles.assistant
      if (line === undefined) continue
      if (s.slot === 'deploying' || s.slot === 'driving' || s.slot === 'returning') expect(['drive', 'driveEnd'], s.id).toContain(line.at)
      else if (script.key === 'hysterectomy' && (line.do === 'fitManipulator' || line.do === 'removeSpecimen')) expect(line.at, s.id).toBe('tableFoot')
      else expect(['assistant'], s.id).toContain(line.at)
    }
    // the scrub nurse stays on the patient's left, at the foot end beside the back table
    for (const s of steps) {
      const at = s.roles.scrub?.at
      if (at !== undefined) expect(['scrub', 'scrubBackTable'], s.id).toContain(at)
    }
    // the surgeon goes to the console in the docking unit and stays until undocking
    const toConsole = steps.findIndex((s) => s.roles.surgeon?.at === 'surgeonConsole')
    expect(steps[toConsole].unit).toBe('docking')
    for (const s of steps.filter((x) => x.unit === 'console')) expect(s.roles.surgeon?.at, s.id).toBe('surgeonConsole')
    expect(steps[undocked].roles.surgeon?.at).not.toBe('surgeonConsole')
  })

  it('does the clips the way the research document does: the bedside assistant applies them through the assistant port, the scrub nurse loads them, the surgeon holds the structure at the console', () => {
    if (script.machine !== 'daVinci') return
    const clips = steps.find((s) => s.roles.assistant?.do === 'clipLap')
    // (the gallbladder's duct and artery, the prostate's side supports; the hysterectomy seals its vessels with the robot's own sealer)
    expect(clips !== undefined, script.id).toBe(script.key !== 'hysterectomy')
    if (clips === undefined) return
    expect(clips.roles.assistant).toMatchObject({ at: 'assistant', work: 'assistantPort', right: 'lapClipApplier' })
    expect(clips.roles.scrub?.do).toBe('passInstrument')
    expect(clips.roles.surgeon).toMatchObject({ do: 'operateConsole', at: 'surgeonConsole' })
    expect(clips.arms).toBeUndefined()
  })

  it('has the endoscope on arm 2, a look for every instrument, and only instruments the procedure\'s own copy names', () => {
    if (script.machine !== 'daVinci') return
    expect(script.robotArms![1]).toBe('Endoscope 30°')
    const named = new Set<string>(script.robotArms)
    for (const s of steps) for (const name of Object.values(s.arms ?? {})) named.add(name)
    const copy = SURGERY_COPY.procedures[script.key as 'cholecystectomy']
    // surgery.json (R2) names three instruments and two or three exchanges per procedure and feeds the day plan's hash; the scripts follow the research
    // document's arm lists (section 2, 4 and 5), which also use the fenestrated bipolar (hysterectomy) and the monopolar scissors (prostatectomy)
    const known = new Set<string>([...copy.instruments, ...copy.exchanges, ...(RESEARCH_EXTRA[script.key] ?? [])])
    for (const name of named) {
      expect(ENDOSCOPE_UI.instruments[name], `${name} has no endoscope look`).toBeDefined()
      expect(known.has(name), `${name} is not in surgery.json for ${script.key}`).toBe(true)
    }
    for (const s of steps) {
      if (s.arms === undefined) continue
      expect(s.unit, s.id).toBe('console')
      for (const name of Object.values(s.arms)) expect(ENDOSCOPE_UI.instruments[name].look, s.id).not.toBe('endoscope')
    }
  })

  it('keeps the table pose true to the operation', () => {
    let tilt = script.start.headTiltDeg
    let roll = script.start.rollDeg
    let drape = script.start.drape
    let airway = script.start.airway
    const tubeIn: boolean[] = []
    const poseAfter = steps.map((s) => {
      const p = s.patient ?? {}
      tilt = p.headTiltDeg ?? tilt
      roll = p.rollDeg ?? roll
      drape = p.drape ?? drape
      airway = p.airway ?? airway
      tubeIn.push(airway === 'tube')
      return { tilt, roll, drape, airway }
    })
    // the table is level again by the end of the first closing step, and stays level
    const closing = steps.findIndex((s) => s.unit === 'closing')
    if (closing >= 0) {
      for (let i = closing; i < steps.length; i++) {
        expect(poseAfter[i].tilt, `${steps[i].id} tilt`).toBe(0)
        expect(poseAfter[i].roll, `${steps[i].id} roll`).toBe(0)
      }
    }
    // a breathing tube only between the step that places it and the step that takes it out
    if (script.anaesthesia === 'general') {
      const placed = steps.findIndex((s) => Object.values(s.roles).some((r) => r?.do === 'intubate'))
      const removed = steps.findIndex((s) => Object.values(s.roles).some((r) => r?.do === 'extubate'))
      expect(placed).toBeGreaterThanOrEqual(0)
      expect(removed).toBeGreaterThan(placed)
      steps.forEach((s, i) => expect(tubeIn[i], `${s.id}: a tube only from the intubation to the extubation step`).toBe(i >= placed && i <= removed))
    } else expect(tubeIn.every((t) => !t)).toBe(true)
    // the drapes are fully on from the end of draping to the end of closing
    const draped = steps.findIndex((s) => s.patient?.drape === 1)
    const off = steps.findIndex((s, i) => i > draped && s.patient?.drape === 0)
    expect(draped).toBeGreaterThanOrEqual(0)
    expect(off).toBeGreaterThan(draped)
    for (let i = draped; i < off; i++) expect(poseAfter[i].drape, steps[i].id).toBe(1)
    const ports = steps.findIndex((s) => s.unit === 'ports')
    if (ports >= 0) expect(ports).toBeGreaterThan(draped)
    if (closing >= 0) expect(off).toBeGreaterThan(closing)
    // never an anaesthetised patient who is not breathing through something
    steps.forEach((s, i) => {
      if (s.patient?.awareness === 'asleep') expect(poseAfter[i].airway, s.id).not.toBe('none')
    })
  })

  it('is non-graphic and in UK English, in the file as written', () => {
    for (const [path, text] of strings(json(script.id))) {
      if (path.startsWith('id') || path.startsWith('machine') || path.startsWith('key')) continue
      expect(GRAPHIC_WORDS.test(text), `${path}: ${text}`).toBe(false)
      expect(US_WORDS.test(text), `${path}: ${text}`).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// R5 wave 2: the two pelvic operations (docs/research/procedures.md sections 4 and 5)
// ---------------------------------------------------------------------------------------------

describe('the pelvic scripts', () => {
  const hyst = scriptFor('or-hysterectomy')!
  const prost = scriptFor('or-prostatectomy')!
  const at = (script: ProcedureScript, id: string) => {
    const i = script.steps.findIndex((s) => s.id === id)
    expect(i, `${script.id} has a step "${id}"`).toBeGreaterThanOrEqual(0)
    return i
  }
  /** The pose after each step (the deltas folded). */
  const poses = (script: ProcedureScript) => {
    let cur = { ...script.start }
    return script.steps.map((s) => (cur = { ...cur, ...(s.patient ?? {}) }))
  }
  const doing = (script: ProcedureScript, action: string, role?: string) =>
    script.steps.filter((s) => Object.entries(s.roles).some(([r, l]) => l?.do === action && (role === undefined || r === role)))

  it('are both written, with 33-37 steps each and a watch of 600-900 s', () => {
    expect(hyst).toBeDefined()
    expect(prost).toBeDefined()
    for (const s of [hyst, prost]) {
      expect(s.steps.length).toBeGreaterThanOrEqual(33)
      expect(s.steps.length).toBeLessThanOrEqual(37)
      const total = s.steps.reduce((a, x) => a + x.watchSeconds, 0)
      expect(total).toBeGreaterThanOrEqual(600)
      expect(total).toBeLessThanOrEqual(900)
    }
    // the hysterectomy's watch time is the research document's own table
    expect(hyst.steps.reduce((a, x) => a + x.watchSeconds, 0)).toBe(676)
  })

  it('lays the patient in lithotomy with the arms tucked before the cart drives in, and takes the legs down at the end', () => {
    for (const s of [hyst, prost]) {
      const p = poses(s)
      const drive = s.steps.findIndex((x) => x.slot === 'driving')
      const wake = s.steps.findIndex((x) => Object.values(x.roles).some((l) => l?.do === 'extubate'))
      expect(s.start.position).toBe('supine')
      expect(s.start.arms).toBe('out')
      expect(p[drive].position, s.id).toBe('lithotomy')
      expect(p[drive].arms, s.id).toBe('tucked')
      expect(p[wake - 1].position, s.id).toBe('lithotomy')
      expect(p[wake].position, s.id).toBe('supine')
      // the legs go up in a positioning step, before the skin is cleaned
      const up = s.steps.findIndex((x) => x.patient?.position === 'lithotomy')
      expect(s.steps[up].unit, s.id).toBe('positioning')
      expect(up, s.id).toBeLessThan(s.steps.findIndex((x) => x.patient?.drape === 1))
      expect(Object.values(s.steps[up].roles).some((l) => l?.do === 'legsInStirrups' || l?.do === 'tuckArms'), s.id).toBe(true)
    }
  })

  it('tips the table head down before the cart drives in (about -25 degrees, -22 for the prostate) and brings it back once the cart has gone', () => {
    for (const [s, tilt] of [[hyst, -25], [prost, -22]] as const) {
      const p = poses(s)
      const tipStep = s.steps.findIndex((x) => x.patient?.headTiltDeg !== undefined && x.patient.headTiltDeg < 0)
      const drive = s.steps.findIndex((x) => x.slot === 'driving')
      const away = s.steps.findIndex((x) => x.slot === 'returning')
      expect(s.steps[tipStep].unit, s.id).toBe('ports')
      expect(tipStep, s.id).toBeLessThan(drive)
      expect(s.steps[tipStep].patient!.headTiltDeg, s.id).toBe(tilt)
      expect(s.steps[tipStep].roles.circulator, s.id).toMatchObject({ do: 'tiltTable', right: 'tableRemote' })
      // head down all through the docked console
      for (let i = tipStep; i < away; i++) expect(p[i].headTiltDeg, `${s.id} ${s.steps[i].id}`).toBe(tilt)
      expect(s.steps[away].patient!.headTiltDeg, s.id).toBe(0)
      expect(p[away].headTiltDeg, s.id).toBe(0)
      expect(p[away].rollDeg, s.id).toBe(0)
    }
  })

  it('puts the catheter in for both (it stays in), and the uterine manipulator in for the hysterectomy only, out with the uterus', () => {
    const hp = poses(hyst)
    const pp = poses(prost)
    expect(hp[at(hyst, 'fitCatheter') - 1].catheter).toBe(false)
    expect(hp[at(hyst, 'fitCatheter')].catheter).toBe(true)
    expect(hp[at(hyst, 'fitManipulator')].manipulator).toBe(true)
    expect(hp[at(hyst, 'deliverUterus') - 1].manipulator).toBe(true)
    expect(hp[at(hyst, 'deliverUterus')].manipulator).toBe(false)
    expect(hp[hp.length - 1].catheter).toBe(true)
    expect(pp[at(prost, 'fitCatheter') - 1].catheter).toBe(false)
    expect(pp[at(prost, 'fitCatheter')].catheter).toBe(true)
    expect(pp.every((p) => !p.manipulator)).toBe(true)
    expect(pp[pp.length - 1].catheter).toBe(true)
    // the skin is cleaned and draped before either goes in
    expect(at(hyst, 'prepAndDrape')).toBeLessThan(at(hyst, 'fitCatheter'))
    expect(at(prost, 'prepAndDrape')).toBeLessThan(at(prost, 'fitCatheter'))
  })

  it('has the bedside assistant between the legs for the catheter, the manipulator and the uterus coming out, and at the patient\'s left for the rest of the console', () => {
    for (const id of ['fitCatheter', 'fitManipulator', 'deliverUterus']) {
      const line = hyst.steps[at(hyst, id)].roles.assistant!
      expect(line.at, id).toBe('tableFoot')
      expect(line.do, id).toBe({ fitCatheter: 'fitCatheter', fitManipulator: 'fitManipulator', deliverUterus: 'removeSpecimen' }[id])
    }
    for (const s of hyst.steps.filter((x) => x.unit === 'console')) {
      const line = s.roles.assistant!
      if (line.do === 'fitManipulator' || line.do === 'removeSpecimen') expect(line.at, s.id).toBe('tableFoot')
      else expect(line.at, s.id).toBe('assistant')
    }
    // (the prostatectomy's BA works the catheter at the foot and the console from the left)
    expect(prost.steps[at(prost, 'fitCatheter')].roles.assistant).toMatchObject({ do: 'fitCatheter', at: 'tableFoot', right: 'catheter' })
    for (const s of prost.steps.filter((x) => x.unit === 'console')) expect(s.roles.assistant!.at, s.id).toBe('assistant')
  })

  it('uses the actions the research document calls for: stirrups, the catheter, the manipulator, the uterus out, the clips on the side supports, the saline for the leak test, the table', () => {
    expect(doing(hyst, 'legsInStirrups').map((s) => s.id)).toContain('legsInStirrups')
    expect(doing(hyst, 'removeSpecimen', 'assistant').map((s) => s.id)).toEqual(['deliverUterus'])
    expect(doing(hyst, 'tiltTable', 'circulator')).toHaveLength(1)
    // (the legs go up in the positioning step and come down as the patient wakes)
    expect(doing(prost, 'legsInStirrups', 'assistant').map((s) => s.id)).toEqual(['positionPatient', 'wakeUp'])
    expect(doing(prost, 'clipLap', 'assistant').map((s) => s.id)).toEqual(['pedicles'])
    expect(prost.steps[at(prost, 'pedicles')].roles.assistant).toMatchObject({ at: 'assistant', work: 'assistantPort', right: 'lapClipApplier' })
    expect(prost.steps[at(prost, 'leakTest')].roles.assistant).toMatchObject({ do: 'injectSaline', right: 'salineSyringe' })
    expect(doing(prost, 'tiltTable', 'circulator')).toHaveLength(1)
    // the catheter, the manipulator and the specimen are handed over by the scrub nurse
    expect(hyst.steps[at(hyst, 'fitManipulator')].roles.scrub).toMatchObject({ do: 'passInstrument', right: 'manipulator' })
    expect(hyst.steps[at(hyst, 'deliverUterus')].roles.scrub).toMatchObject({ do: 'receiveInstrument', right: 'specimenPot' })
  })

  it('gives the arms the instruments the research document gives them: the endoscope on arm 2, the sealer for the uterine vessels, needle drivers for the stitching', () => {
    expect(hyst.robotArms).toEqual(['Fenestrated bipolar forceps', 'Endoscope 30°', 'Monopolar curved scissors', 'Cadiere forceps'])
    expect(prost.robotArms).toEqual(['Fenestrated bipolar forceps', 'Endoscope 30°', 'Monopolar curved scissors', 'Prograsp forceps'])
    const arms = (s: ProcedureScript, id: string) => s.steps[at(s, id)].arms
    expect(arms(hyst, 'uterineVessels')).toEqual({ 0: 'Vessel sealing forceps' })
    expect(arms(hyst, 'needleDrivers')).toEqual({ 0: 'Large needle driver' })
    expect(arms(hyst, 'cuffClosure')).toEqual({ 2: 'Large needle driver' })
    expect(arms(prost, 'dorsalVein')).toEqual({ 0: 'Large needle driver', 2: 'Large needle driver' })
    expect(arms(prost, 'bladderNeck')).toEqual({ 0: 'Fenestrated bipolar forceps', 2: 'Monopolar curved scissors' })
    expect(arms(prost, 'posteriorRepair')).toEqual({ 0: 'Large needle driver', 2: 'Large needle driver' })
    // an exchange is made by the bedside assistant, with the scrub nurse passing the new instrument: in the step it lands in, or (it begins half an exchange
    // before the step does) in the step before, which the second of two swaps in a row (the needle drivers) belongs to
    for (const s of [hyst, prost]) {
      s.steps.forEach((step, i) => {
        if (step.arms === undefined) return
        const swapping = (j: number) => s.steps[j].roles.assistant?.do === 'exchangeInstrument' && s.steps[j].roles.scrub?.do === 'passInstrument'
        expect(swapping(i) || swapping(i - 1), `${s.id} ${step.id}`).toBe(true)
      })
    }
  })

  it('carries the endoscope stage of each console step (survey, then one per step), the keys the research lists', () => {
    const scopes = (s: ProcedureScript) => s.steps.filter((x) => x.scope !== undefined).map((x) => x.scope)
    expect(scopes(hyst)).toEqual(['survey', 'survey', 'survey', 'survey', 'survey', 'roundLigament', 'bladderFlap', 'uterineVessels', 'colpotomy', 'delivery', 'needleDrivers', 'cuffClosure', 'finalCheck'])
    const keys = [...new Set(scopes(prost))]
    expect(keys).toEqual(['survey', 'retzius', 'endopelvic', 'dorsalVein', 'bladderNeck', 'seminalVesicles', 'posteriorPlane', 'pedicles', 'apex', 'bagging', 'posteriorRepair', 'anastomosis', 'leakTest', 'finalCheck'])
    // every console step has a stage of its own (so a step's progress is its stage's)
    for (const s of [hyst, prost]) for (const step of s.steps.filter((x) => x.unit === 'console')) expect(step.scope, `${s.id} ${step.id}`).toBeDefined()
  })

  it('says the research document\'s sentences: the hysterectomy is delivered by the vagina and the stitches close its top; the prostatectomy joins bladder to urethra', () => {
    expect(hyst.steps[at(hyst, 'deliverUterus')].event).toMatch(/vagina/)
    expect(hyst.steps[at(hyst, 'cuffClosure')].event).toMatch(/closed/)
    expect(prost.steps[at(prost, 'pedicles')].event).toMatch(/nerves/)
    expect(prost.steps[at(prost, 'anastomosis')].event).toMatch(/joined/)
    for (const s of [hyst, prost]) expect(s.refs.every((r) => r.startsWith('procedures:'))).toBe(true)
    expect(hyst.refs).toEqual(expect.arrayContaining(['procedures:10', 'procedures:12', 'procedures:14']))
    expect(prost.refs).toEqual(expect.arrayContaining(['procedures:14', 'procedures:15', 'procedures:16']))
  })
})
