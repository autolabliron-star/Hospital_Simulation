/**
 * R5 wave 3 (P6, the owner's ruling): after the dressing the gown goes back over.
 *
 * The prepped skin (the plate) and the dressings on it stay visible through the drapes coming off and the dressing step (the cryo suite's `removeDrapes` and `dressings`, the ProSense
 * `dressing`); from the next step of the script on (cryo `signOut`, ProSense `coldPack`, and everything after) nothing of the stage shows: no plate, no marks, no dressing, no sheet.
 * Before this the stage latched the position and arms and kept the plate on with the drape at 0 until the patient MOVED (the turn back, the arm lowered), so the sign-out and the cold
 * pack still showed the prepped skin and the dressings on the outside of the gown.
 *
 * The rule is `gownBackOver(procedureId, stepId)` (stage.ts), made from the compiled scripts; the layer asks it of the step the sim publishes and hands it to the stage as `ProcIn.gown`.
 *   - the table: false up to and including the dressing step, true from the next on, in all five scripts (and for no case, an unknown step, a script that never dresses the site);
 *   - the stage, on a real avatar, through EVERY step of the five scripts at its start, middle and end (`patientAt`, as the sim publishes the eased numbers): shown from the prep to the
 *     dressing step (the dressings are on the plate at every moment of it), and an EMPTY mesh from the next step on, the turn back included; a control stage that is not told about the
 *     gown shows the plate at the first step after the dressing (what it did), so the walk can tell;
 *   - the runtime: the same, on the crowd's own patient; nothing is skinned or fitted while the gown is over, and the stage comes back with a new case;
 *   - the layer hands the published step to the runtime for both rooms, and the rule allocates nothing.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cpuMesh, loadPeopleFromDisk } from '@/scene/actors/crowd/avatars.testkit'
import { buildBodyGeometries } from '@/scene/actors/crowd/geometry'
import { CrowdModel, type FrameInput } from '@/scene/actors/crowd/model'
import { AVATARS, POSE0, type ProcTableId } from '@/scene/actors/crowd/procTable.testkit'
import { setActiveCrowd } from '@/scene/actors/crowd/runtime'
import { skinSourceOfBody, skinSourceOfProcedural } from '@/scene/actors/crowd/skinSource'
import { measureLieFit } from '@/scene/actors/crowd/tablePatient'
import { levelView } from '@/scene/levels/levelView'
import { planCase } from '@/sim/cryoSuite/plan'
import { CRYO_SUITE } from '@/sim/places'
import { COMPILED_SCRIPTS, caseSteps, newCursor, patientAt } from '@/sim/procedure'
import { Rng } from '@/sim/rng'
import type { CryoTarget, Entity, PatientPoseView, ProcedureId } from '@/sim/types'
import { siteOfNeedle, type RoomId } from './config'
import { MAX_SITES } from './marks'
import { createProcRuntime, stageDt, stepProcRuntime, type NeedleEntry } from './runtime'
import { PROC_PART, gownBackOver, newProcMemory, stepProcStage, type ProcIn, type ProcMemory } from './stage'
import { posedPatient, skinOf } from './proc.testkit'

interface Script {
  id: ProcedureId
  table: ProcTableId
  room: RoomId
  target: CryoTarget
  /** The step that dresses the site (the last the stage shows) and the one after it (the first it does not). */
  dressing: string
  after: string
}
const SCRIPTS: readonly Script[] = [
  { id: 'cryo-kidney', table: 'cryo', room: 'cryo', target: 'kidney', dressing: 'dressings', after: 'signOut' },
  { id: 'cryo-lung', table: 'cryo', room: 'cryo', target: 'lung', dressing: 'dressings', after: 'signOut' },
  { id: 'cryo-liver', table: 'cryo', room: 'cryo', target: 'liver', dressing: 'dressings', after: 'signOut' },
  { id: 'us-breastCancer', table: 'us', room: 'us', target: 'kidney', dressing: 'dressing', after: 'coldPack' },
  { id: 'us-fibroadenoma', table: 'us', room: 'us', target: 'kidney', dressing: 'dressing', after: 'coldPack' },
]

const stepsOf = (id: ProcedureId): readonly { id: string }[] => COMPILED_SCRIPTS[id]!.script.steps

describe('P6: gownBackOver says which steps of a script have the gown back over the site', () => {
  for (const sc of SCRIPTS) {
    it(`${sc.id}: false up to and including "${sc.dressing}", true from "${sc.after}" on, to the last step`, () => {
      const steps = stepsOf(sc.id)
      const di = steps.findIndex((s) => s.id === sc.dressing)
      expect(di, `${sc.id} has a "${sc.dressing}" step`).toBeGreaterThan(0)
      expect(steps[di + 1].id, 'the step after the dressing').toBe(sc.after)
      // (the dressing is the first step whose pose has the site dressed: the rule is made from it)
      expect(COMPILED_SCRIPTS[sc.id]!.poseAfter[di].marks).toBe('dressed')
      expect(COMPILED_SCRIPTS[sc.id]!.poseAfter[di - 1].marks).not.toBe('dressed')
      const ids = new Set(steps.map((s) => s.id))
      expect(ids.size, 'step ids are unique in a script (the rule looks them up)').toBe(steps.length)
      let on = 0
      for (let i = 0; i < steps.length; i++) {
        const gown = gownBackOver(sc.id, steps[i].id)
        expect(gown, `${sc.id} step ${i} (${steps[i].id})`).toBe(i > di)
        if (gown) on++
      }
      // (the sign-out, the turn back, the wake and the wheels out are all after it: at least three steps)
      expect(on).toBeGreaterThanOrEqual(3)
      expect(steps.length - 1 - di).toBe(on)
    })
  }

  it('no case, a step the script does not have, and the steps of another script do not put the gown on', () => {
    expect(gownBackOver(null, 'signOut')).toBe(false)
    expect(gownBackOver('cryo-kidney', 'noSuchStep')).toBe(false)
    expect(gownBackOver('cryo-kidney', '')).toBe(false)
    // "coldPack" is a ProSense step: it means nothing in a cryo script
    expect(gownBackOver('cryo-kidney', 'coldPack')).toBe(false)
    expect(gownBackOver('us-breastCancer', 'signOut')).toBe(true)
    expect(gownBackOver('us-breastCancer', 'skinNick')).toBe(false)
  })
})

/** The needles of a planned case as stage sites (the patient frame). */
function sitesOfPlan(target: CryoTarget, seed: number, out: Float64Array): number {
  const plan = planCase(new Rng(seed), `s-${seed}`, 0, 0, false, target)
  let n = 0
  for (const nd of plan.needles) {
    if (n >= MAX_SITES) break
    siteOfNeedle(target, nd, out, n * 2)
    n++
  }
  return n
}

const triangles = (mem: ProcMemory, part: number): number => (mem.parts[part * 2 + 1] - mem.parts[part * 2]) / 3

describe('P6: the stage through every step of the five scripts: shown to the dressing, nothing from the next step on', () => {
  for (const sc of SCRIPTS) {
    it(`${sc.id}: the start, the middle and the end of every step (a real avatar, the sim's eased numbers)`, async () => {
      const compiled = COMPILED_SCRIPTS[sc.id]!
      const cs = caseSteps(compiled, 'watch', null, 2)
      const steps = compiled.script.steps
      const di = steps.findIndex((s) => s.id === sc.dressing)
      const cursor = newCursor()
      const view: PatientPoseView = { ...POSE0 }
      const sites = new Float64Array(MAX_SITES * 2)
      const nSites = sc.room === 'cryo' ? sitesOfPlan(sc.target, 11, sites) : 0
      const skins = new Map<string, ReturnType<typeof skinOf>>()
      const bodyFor = async (p: PatientPoseView): Promise<ReturnType<typeof skinOf>> => {
        const key = `${p.position}/${p.arms}/${p.rollDeg}`
        let s = skins.get(key)
        if (!s) {
          const tp = await posedPatient(AVATARS[3], sc.table, { position: p.position, arms: p.arms, rollDeg: p.rollDeg })
          s = skinOf(tp, skins.size + 1)
          skins.set(key, s)
        }
        return s
      }
      const inputOf = (skin: ReturnType<typeof skinOf>, gown: boolean | undefined): ProcIn => ({
        patient: view,
        skin,
        sites,
        nSites,
        rootX: 0,
        rootY: 0,
        rootZ: 0,
        heading: 0,
        dt: 1,
        target: sc.target,
        gown,
      })
      const mem = newProcMemory(sc.room)
      // the control: the same walk with no word of the gown (the stage as it was)
      const old = newProcMemory(sc.room)
      let shown = 0
      let gone = 0
      let movedGone = 0
      let dressedShown = 0
      let drapesOffShown = 0
      let oldShownAfter = 0
      let prepPosition = ''
      for (let i = 0; i < compiled.n; i++) {
        for (const progress of [0, 0.5, 1]) {
          cursor.index = i
          cursor.progress = progress
          patientAt(cs, cursor, view)
          const gown = gownBackOver(sc.id, steps[i].id)
          const skin = await bodyFor(view)
          stepProcStage(mem, inputOf(skin, gown))
          stepProcStage(old, inputOf(skin, undefined))
          const label = `${sc.id} step ${i} (${steps[i].id}) at ${progress}: ${view.position}/${view.arms} prep ${view.prep.toFixed(2)} drape ${view.drape.toFixed(2)} marks ${view.marks}`
          const prepOn = view.prep > 0.004 || view.marks !== 'none'
          if (prepOn && prepPosition === '') prepPosition = `${view.position}/${view.arms}`
          if (gown) {
            // the gown is back over: nothing of the stage, whatever the pose says (the prep, the marks and the dressing are all still in the view)
            expect(mem.mesh.ni, label).toBe(0)
            for (const part of [PROC_PART.sheet, PROC_PART.plate, PROC_PART.marks, PROC_PART.skirt]) expect(triangles(mem, part), `${label}: part ${part}`).toBe(0)
            expect(mem.gown, label).toBe(true)
            expect(mem.wants, label).toBe(false)
            expect(mem.plateOn, label).toBe(false)
            expect(mem.drape, label).toBe(0)
            expect(mem.latched, label).toBe(false)
            expect(mem.field.busy, label).toBe(false)
            gone++
            if (`${view.position}/${view.arms}` !== prepPosition) movedGone++
            if (i === di + 1 && old.mesh.ni > 0 && triangles(old, PROC_PART.plate) > 0) oldShownAfter++
          } else if (prepOn) {
            // from the prep to the dressing: the plate, and the marks on it
            expect(mem.gown, label).toBe(false)
            expect(triangles(mem, PROC_PART.plate), label).toBeGreaterThan(0)
            shown++
            if (view.marks === 'dressed') {
              // the dressings are on the plate at every moment of the dressing step (and, in the cryo scripts, through the drapes coming off just before it)
              expect(i, label).toBe(di)
              expect(triangles(mem, PROC_PART.marks), `${label}: the dressings`).toBeGreaterThan(0)
              dressedShown++
            }
            if (steps[i].id === 'removeDrapes') {
              expect(triangles(mem, PROC_PART.plate), `${label}: the prepped skin stays while the drapes come off`).toBeGreaterThan(0)
              drapesOffShown++
            }
          } else {
            expect(mem.mesh.ni, label).toBe(0)
          }
        }
      }
      // the controls: the walk has steps shown and steps gone, the dressing step was seen with its dressings at its start, middle and end, and the turn back is among the gone steps
      expect(shown).toBeGreaterThan(10)
      expect(gone).toBe(3 * (compiled.n - 1 - di))
      expect(dressedShown, 'every moment of the dressing step').toBe(3)
      expect(movedGone, 'the turn back (or the arm lowered) happens with the gown over').toBeGreaterThan(0)
      if (sc.room === 'cryo') expect(drapesOffShown, 'the drapes come off with the plate on').toBe(3)
      // (the stage that was not told shows the plate at the first step after the dressing: the walk can tell the rule from its absence)
      expect(oldShownAfter, 'without the rule the sign-out still shows the prepped skin').toBeGreaterThan(0)
      // the case is over (the view is cleared): empty, and the gown does not matter any more
      Object.assign(view, POSE0)
      stepProcStage(mem, inputOf(await bodyFor(POSE0), false))
      expect(mem.mesh.ni).toBe(0)
      expect(mem.latched).toBe(false)
    }, 600000)
  }
})

// ---------------------------------------------------------------------------------------------
// The runtime on the crowd's own patient
// ---------------------------------------------------------------------------------------------

const CRYO = CRYO_SUITE.ct.table
const REST: PatientPoseView = { position: 'supine', headTiltDeg: 0, rollDeg: 0, arms: 'out', airway: 'none', awareness: 'asleep', prep: 0, drape: 0, marks: 'none', catheter: false, manipulator: false }
const NEEDLES: NeedleEntry[] = [
  { entry: { x: 40, y: -80 }, dz: -10 },
  { entry: { x: 55, y: -70 }, dz: 25 },
]
function ent(o: Partial<Entity> & { id: string }): Entity {
  return { role: 'patient', outfit: 'gown', name: o.id, position: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0, anim: 'lie', emote: 'none', mood: 'neutral', tier: 'near', variant: 3, ...o } as Entity
}
function frame(entities: Map<string, Entity>, t: number): FrameInput {
  return { dt: 1 / 60, time: t, camX: CRYO.out.x - 150, camY: 6.2, camZ: CRYO.out.z + 2, entities, followId: null, selectedId: null, hoverId: null, driven: null }
}

describe('P6: the runtime on the crowd\'s patient', () => {
  let people: Awaited<ReturnType<typeof loadPeopleFromDisk>>
  const shownBefore = { shown: levelView.shown, overview: levelView.overview }
  beforeAll(async () => {
    people = await loadPeopleFromDisk()
  })
  afterEach(() => {
    setActiveCrowd(null)
    levelView.shown = shownBefore.shown
    levelView.overview = shownBefore.overview
  })

  it('the stage is drawn while the gown is off; the frame the script passes the dressing it is hidden and empty and nothing is skinned or fitted; it is drawn again for a new case', () => {
    levelView.shown = 2
    levelView.overview = false
    const m = new CrowdModel()
    m.proceduralSkin = skinSourceOfProcedural(buildBodyGeometries().high)
    m.setAvatars(
      people.avatars.map((a) => a.entry),
      [],
      [],
      [],
      people.avatars.map((a) => {
        const c = cpuMesh(a.lods[0])
        return measureLieFit(c.pos, c.joints, c.weights, c.count, a.entry.bindInverse)
      }),
      people.avatars.map((a) => skinSourceOfBody(a.lods[0])),
    )
    setActiveCrowd(m)
    const entityView: PatientPoseView = { ...REST, position: 'prone', arms: 'aboveHead' }
    const view: PatientPoseView = { ...REST, position: 'prone', arms: 'aboveHead', prep: 1, drape: 0, marks: 'dressed' }
    const e = ent({ id: 'pat', seated: { seatId: 'scanTable:cryo', pose: 'lie' }, position: { x: CRYO.out.x, y: 0, z: CRYO.out.z }, heading: CRYO.heading, patientPose: entityView })
    const es = new Map([['pat', e]])
    for (let i = 0; i < 300; i++) m.update(frame(es, i / 60))
    const rt = createProcRuntime('cryo')
    let t = 5
    const run = (frames: number, gown: boolean): void => {
      for (let i = 0; i < frames; i++) {
        m.update(frame(es, t))
        t += 1 / 60
        stepProcRuntime(rt, view, NEEDLES, stageDt(1 / 60), 'liver', gown)
      }
    }
    // the dressing step: the plate and the dressings are drawn
    run(90, false)
    expect(rt.mesh.visible).toBe(true)
    expect(rt.mem.mesh.ni).toBeGreaterThan(0)
    expect(triangles(rt.mem, PROC_PART.plate)).toBeGreaterThan(0)
    expect(triangles(rt.mem, PROC_PART.marks), 'the dressings').toBeGreaterThan(0)
    const skinnings = rt.skinnings
    const begun = rt.mem.fitsBegun
    expect(skinnings).toBeGreaterThan(0)
    // the next step: the gown is back over, the view still says prep 1 and marks dressed
    run(1, true)
    expect(rt.mesh.visible).toBe(false)
    expect(rt.mem.mesh.ni).toBe(0)
    expect(rt.mem.wants).toBe(false)
    expect(rt.mem.field.busy).toBe(false)
    expect(rt.geometry.drawRange.count).toBe(0)
    run(120, true)
    expect(rt.mesh.visible).toBe(false)
    expect(rt.mem.mesh.ni).toBe(0)
    expect(rt.skinnings, 'nothing is skinned while the gown is over').toBe(skinnings)
    expect(rt.mem.fitsBegun, 'nothing is fitted while the gown is over').toBe(begun)
    // she turns back with the gown over: still nothing (and still nothing skinned)
    view.position = 'supine'
    view.arms = 'out'
    entityView.position = 'supine'
    entityView.arms = 'out'
    run(120, true)
    expect(rt.mesh.visible).toBe(false)
    expect(rt.mem.mesh.ni).toBe(0)
    expect(rt.skinnings).toBe(skinnings)
    // a new case: the gown is off again and the stage is drawn for the new prep
    view.position = 'prone'
    view.arms = 'aboveHead'
    entityView.position = 'prone'
    entityView.arms = 'aboveHead'
    view.marks = 'marked'
    view.prep = 1
    run(240, false)
    expect(rt.mesh.visible).toBe(true)
    expect(rt.mem.mesh.ni).toBeGreaterThan(0)
    expect(rt.skinnings).toBeGreaterThan(skinnings)
  }, 120000)
})

// ---------------------------------------------------------------------------------------------
// The layer, and the allocations
// ---------------------------------------------------------------------------------------------

describe('P6: the layer hands each room\'s published step to the runtime, and the rule allocates nothing', () => {
  const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8')
  it('ProcStageLayer asks gownBackOver of the cryo suite\'s step and of the ultrasound room\'s', () => {
    const src = read('src/scene/surgery/stage/proc/ProcStageLayer.tsx')
    expect(src).toMatch(/import \{ gownBackOver \} from '\.\/stage'/)
    expect(src).toMatch(/s\.target,\s*gownBackOver\(s\.procedure\.procedureId,\s*s\.procedure\.stepId\)\)/)
    expect(src).toMatch(/'kidney',\s*gownBackOver\(pv\.procedureId,\s*pv\.stepId\)\)/)
  })

  it('gownBackOver and the stage\'s updateWants have no allocation (no new, array or object literal, spread, closure, array method)', () => {
    const FLAGGED: [RegExp, string][] = [
      [/\bnew\s+[A-Za-z]/, 'new'],
      [/(^|[=(,:?&|]|\breturn)\s*\[/m, 'array literal'],
      [/(^|[=(,?&|]|\breturn)\s*\{\s*[a-zA-Z_]+\s*:/m, 'object literal'],
      [/\.\.\./, 'spread'],
      [/=>/, 'closure'],
      [/\.(map|filter|reduce|slice|concat|findIndex)\(/, 'array method'],
      [/\bfunction\b/, 'inner function'],
    ]
    const code = (src: string): string =>
      src
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/\/\/.*$/gm, '')
        .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (m) => m.replace(/[^\n]/g, ' '))
    const bodyOf = (src: string, name: string): string => {
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
    const src = code(read('src/scene/surgery/stage/proc/stage.ts'))
    const offenders: string[] = []
    for (const name of ['gownBackOver', 'updateWants']) {
      const body = bodyOf(src, name)
      expect(body.length, `${name}: the scan found its body`).toBeGreaterThan(30)
      body.split('\n').forEach((line, i) => {
        for (const [re, what] of FLAGGED) if (re.test(line)) offenders.push(`${name}+${i}: ${what}: ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
    // and the table is built once, at load, not in the function
    expect(bodyOf(src, 'gownBackOver')).not.toMatch(/COMPILED_SCRIPTS|Object\.entries/)
  })
})
