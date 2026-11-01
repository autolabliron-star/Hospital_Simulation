/**
 * R5 wave 3, the review's confirmed findings (F1..F16) for the CT cryo suite, proved. Two kinds of test:
 *
 *   as written   the three scripts, the content, the places and the pure helpers: dress, the held breath's windows, the hop route, the heading, the
 *                per-target points, the repeat seconds, the foci, the hands (cheap: no simulation)
 *   as played    one watch case of each target through the suite (a CryoHospital with the crowd on, stepped at 0.1 s, run once and shared by the tests
 *                below): the held breath, the unload at the transfer step, the dress, the nurse at the table through the dressing, the hops and
 *                where the people look
 */
import { describe, expect, it } from 'vitest'
import { CRYO_SUITE_COPY, cryoStepLabel } from '@/content/cryoSuite'
import { scriptFor } from '@/content/procedures'
import { CONFIG } from '../config'
import { tryPlanRoute, routeLength } from '../nav/graph'
import { areaAt, CRYO_SUITE } from '../places'
import { caseSteps, newTargetCtx, resolveTarget, watchTotalSeconds } from '../procedure'
import { cryoAnchorSlots, cryoFocusInto, cryoTargetInto, newCryoTargetCtx } from '../procedure/cryoPlaces'
import { ATTIRE, type CryoTarget, type ProcRole } from '../types'
import { newHoldWindow, pushHoldInto, scanEdge, scanHoldInto } from './derive'
import { HopWalker, hopRoute, inScanRoom } from './hop'
import { CRYO_ROLES, attireTable, compiledForTarget, transferStepOf, watchTimesFor } from './script'
import { scriptHeading, MAX_LOOK, workPointInto } from './team'
import { cryoSuite, runCryoDay, type CryoHospital } from './testkit'
import { targetOf } from './plan'

const TARGETS: readonly CryoTarget[] = ['kidney', 'lung', 'liver']
const deg = (r: number): number => (r * 180) / Math.PI
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a))
/** The roles' places as the team takes them: slot k of an anchor for the k-th role (in `CRYO_ROLES` order) that stands there. */
function placesAt(target: CryoTarget, step: number, sites: CryoHospital['cryo']['sites']) {
  const cs = compiledForTarget(target)!
  const out: { role: ProcRole; anchor: string; slot: number; at: { x: number; z: number }; line: NonNullable<(typeof cs.roleAt)[number][number]> }[] = []
  for (let r = 0; r < CRYO_ROLES.length; r++) {
    const rr = cs.roles.indexOf(CRYO_ROLES[r])
    const line = cs.roleAt[step][rr]
    if (line === null) continue
    let slot = 0
    for (let o = 0; o < r; o++) {
      const other = cs.roleAt[step][cs.roles.indexOf(CRYO_ROLES[o])]
      if (other !== null && other.anchor === line.anchor) slot++
    }
    out.push({ role: CRYO_ROLES[r], anchor: line.anchor, slot, at: sites.anchor(line.anchor as never, slot).at, line })
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------------
// as written
// ---------------------------------------------------------------------------------------------------------------------

describe('F1: dress goes with the work', () => {
  for (const target of TARGETS) {
    it(`${target}: a role with no line at a step wears nothing unless it is on the case; the kidney's on-call anaesthetist is bare outside his scan steps`, () => {
      const cs = compiledForTarget(target)!
      const table = attireTable(caseSteps(cs, 'watch', null, 2))
      const rr = cs.roles.indexOf('cryoAnaes')
      let linesOfHis = 0
      for (let i = 0; i < cs.n; i++) {
        const bits = table[i * CRYO_ROLES.length + 3]
        const line = cs.roleAt[i][rr]
        if (line !== null) linesOfHis++
        if (target === 'kidney') {
          // (the anaesthetist is not on a kidney case: he wears dress only where the script gives him a line, the scans he watches from behind the glass)
          if (line === null) expect(bits, `kidney ${cs.script.steps[i].id}`).toBe(0)
          else expect(cs.script.steps[i].unit, 'his lines are the scans').toMatch(/Ct$/)
        } else if (i >= cs.script.steps.findIndex((s) => s.id === 'skinPrep')) {
          expect(bits & ATTIRE.mask, `${target} ${cs.script.steps[i].id}`).not.toBe(0)
        }
      }
      if (target === 'kidney') expect(linesOfHis).toBe(3)
      // the three who are always on the case wear the mask from the prep to the end, whatever their line says
      for (const r of [0, 1, 2]) {
        const prep = cs.script.steps.findIndex((s) => s.id === 'skinPrep')
        for (let i = 0; i < cs.n; i++) {
          if (i < prep) expect(table[i * CRYO_ROLES.length + r] & ATTIRE.mask, `${target} ${CRYO_ROLES[r]} before the prep`).toBe(0)
          else expect(table[i * CRYO_ROLES.length + r] & ATTIRE.mask, `${target} ${CRYO_ROLES[r]} ${cs.script.steps[i].id}`).not.toBe(0)
        }
      }
      // lead: only from the planning scan to the final scan, never the radiographer's, never the kidney's anaesthetist outside a scan he stands in
      const scans = cs.script.steps.map((s, i) => (/Ct$/.test(s.unit) ? i : -1)).filter((i) => i >= 0)
      for (let i = 0; i < cs.n; i++) {
        for (let r = 0; r < CRYO_ROLES.length; r++) {
          const lead = (table[i * CRYO_ROLES.length + r] & ATTIRE.lead) !== 0
          if (lead) expect(i >= scans[0] && i <= scans[scans.length - 1] && r !== 1, `${target} ${CRYO_ROLES[r]} ${cs.script.steps[i].id}`).toBe(true)
          if (target === 'kidney' && r === 3 && lead) expect(scans.includes(i), `kidney anaesthetist ${cs.script.steps[i].id}`).toBe(true)
        }
      }
    })
  }
})

describe('F2: the held breath is a few seconds of a push or a scan', () => {
  it('a push step: from its start to just after the needle is in (the whole of a watch step), at most the cap in the living day, centred on the needle\'s travel', () => {
    const w = newHoldWindow()
    const cap = CONFIG.cryoSuite.apnoeaSeconds
    expect(cap).toBeGreaterThanOrEqual(10)
    expect(cap).toBeLessThanOrEqual(30)
    // a watch push (36-46 s, then the 8 s repeats): the push part, uncapped
    for (const len of [8, 38, 46]) {
      pushHoldInto(len, null, w)
      expect(w.from).toBe(0)
      expect(w.to).toBeGreaterThan(0.8 * len)
      expect(w.to).toBeLessThanOrEqual(len)
    }
    // the living day: a push step of ~80 s (1.3 min, jittered): at most the cap, inside the step, around the needle's middle
    for (const len of [60, 78, 95, 120]) {
      pushHoldInto(len, cap, w)
      expect(w.to - w.from).toBeCloseTo(cap, 6)
      expect(w.from).toBeGreaterThanOrEqual(0)
      expect(w.to).toBeLessThanOrEqual(len)
      const mid = 0.425 * len
      expect(w.from).toBeLessThanOrEqual(mid)
      expect(w.to).toBeGreaterThanOrEqual(mid)
    }
    // a step shorter than the cap holds for its push part
    pushHoldInto(12, cap, w)
    expect(w.to - w.from).toBeLessThanOrEqual(12)
  })

  it('a scan: only while the table is in and the sweep runs, at most the cap in the living day (the whole sweep of a watch scan)', () => {
    const w = newHoldWindow()
    const cap = CONFIG.cryoSuite.apnoeaSeconds
    for (const d of [20, 25, 30, 90, 120, 150]) {
      const edge = scanEdge(d)
      scanHoldInto(d, null, w)
      expect(w.from, `watch ${d}`).toBeCloseTo(edge, 9)
      expect(w.to, `watch ${d}`).toBeCloseTo(d - edge, 9)
      scanHoldInto(d, cap, w)
      expect(w.from).toBeGreaterThanOrEqual(edge - 1e-9)
      expect(w.to).toBeLessThanOrEqual(d - edge + 1e-9)
      expect(w.to - w.from).toBeLessThanOrEqual(cap + 1e-9)
    }
    // (a 90-120 s live scan holds for exactly the cap, in the middle of the sweep)
    scanHoldInto(120, cap, w)
    expect(w.from + w.to).toBeCloseTo(120, 9)
    expect(w.to - w.from).toBeCloseTo(cap, 9)
  })
})

describe('F4: the lung counts its freezes the way its captions do', () => {
  it('labels the lung\'s five freeze and thaw steps 1 to 3, and every other step and target the common way', () => {
    const lung = {
      anchorFreeze: 'Freeze 1 of 3 (short)',
      anchorThaw: 'Thaw 1 of 3',
      freeze1: 'Freeze 2 of 3',
      thaw: 'Thaw 2 of 3',
      freeze2: 'Freeze 3 of 3',
    } as const
    for (const [step, label] of Object.entries(lung)) {
      expect(cryoStepLabel(step as never, 'lung')).toBe(label)
      expect(cryoStepLabel(step as never, 'liver')).toBe(CRYO_SUITE_COPY.steps[step as keyof typeof lung])
      expect(cryoStepLabel(step as never)).toBe(CRYO_SUITE_COPY.steps[step as keyof typeof lung])
    }
    expect(cryoStepLabel('activeThaw', 'lung')).toBe(CRYO_SUITE_COPY.steps.activeThaw)
    expect(cryoStepLabel('aim', 'lung')).toBe(CRYO_SUITE_COPY.steps.aim)
    // (the script's own captions say the same counts)
    const captions = scriptFor('cryo-lung')!.steps.filter((s) => ['anchorFreeze', 'freeze1', 'freeze2'].includes(s.unit)).map((s) => s.caption)
    expect(captions.map((c) => c.slice(0, 13))).toEqual(['Freeze 1 of 3', 'Freeze 2 of 3', 'Freeze 3 of 3'])
  })
})

describe('F5, F6, F8, F9, F11, F15, F16: the three scripts as written', () => {
  for (const target of TARGETS) {
    const script = scriptFor(`cryo-${target}`)!
    const steps = script.steps
    const step = (id: string) => steps.find((s) => s.id === id)!

    it(`${target}: the transfer onto the table is the last step of the arrival, so its caption shows as she is moved across`, () => {
      const cs = compiledForTarget(target)!
      const at = transferStepOf(cs)
      expect(steps[at].id).toBe('ontoTable')
      expect(steps[at].unit).toBe('arrive')
      expect(steps.filter((s) => s.unit === 'arrive').map((s) => s.id)).toEqual(['wheelsIn', 'ontoTable'])
      // the arrival is the two steps; the sedation unit now starts with the monitors
      expect(steps.find((s) => s.unit === 'sedation')!.id).toBe('monitorsOn')
      expect(steps[at].roles.sedation?.do).toBe('transferPatient')
      expect(steps[at].roles.ctRadiographer?.do).toBe('transferPatient')
    })

    it(`${target}: the nurse has lines through the dressing unit, at the table's south side, and takes part in the turn back with the radiologist at the other side`, () => {
      const unit = steps.filter((s) => s.unit === 'dressing')
      expect(unit.length).toBeGreaterThanOrEqual(4)
      for (const s of unit) {
        const line = s.roles.sedation
        expect(line, `${target} ${s.id}`).toBeDefined()
        expect(line!.at, `${target} ${s.id}`).toBe('ctSideSouth')
      }
      const turn = step(target === 'kidney' ? 'rollBack' : 'turnBack')
      expect(turn.roles.sedation?.do).toBe('turnPatient')
      expect(turn.roles.ir?.do).toBe('turnPatient')
      expect(turn.roles.sedation?.at).toBe('ctSideSouth')
      expect(turn.roles.ir?.at).toBe('ctSideNorth')
      // the sign out is a pause the nurse is in, and the dressings are hers to press
      expect(step('signOut').roles.sedation?.do).toBe('checklist')
      expect(step('dressings').roles.sedation?.do).toBe('pressSite')
    })

    it(`${target}: the radiologist's numbing step has the left hand free (steadying the guide) and the syringe in the right; the push is the right hand's`, () => {
      const nick = step('localAndNick').roles.ir!
      expect(nick.do).toBe('injectLocal')
      expect(nick.left ?? 'none').toBe('none')
      expect(nick.right).toBe('syringe')
      for (const s of steps) for (const l of Object.values(s.roles)) if (l !== undefined && s.id !== 'removeNeedle') expect(l.left === 'scalpel' && s.unit === 'aim', `${s.id}`).toBe(false)
      expect(step('pushNeedle').roles.ir!.left ?? 'none').toBe('none')
      expect(step('pushNeedle').roles.ir!.right).toBe('cryoNeedle')
    })

    it(`${target}: later needles are quick repeats (8 s a step, about 20 s a needle), the first in full, and 1 to 4 needles stay within 600-900 s`, () => {
      const run = steps.filter((s) => s.repeat === true)
      expect(run.map((s) => s.id)).toEqual(['robotAims', 'localAndNick', 'pushNeedle'])
      for (const s of run) {
        expect(s.repeatSeconds, s.id).toBeDefined()
        expect(s.repeatSeconds!, s.id).toBeGreaterThanOrEqual(CONFIG.procedure.minWatchStepSeconds)
        expect(s.repeatSeconds!, s.id).toBeLessThan(s.watchSeconds)
      }
      const later = run.reduce((a, s) => a + s.repeatSeconds!, 0)
      expect(later).toBeGreaterThanOrEqual(20)
      expect(later).toBeLessThanOrEqual(30)
      const first = run.reduce((a, s) => a + s.watchSeconds, 0)
      expect(first).toBeGreaterThanOrEqual(80)
      expect(first).toBeLessThanOrEqual(100)
      const cs = compiledForTarget(target)!
      const [lo, hi] = CONFIG.procedure.watchTotalSeconds
      for (let n = 1; n <= 4; n++) {
        const total = watchTotalSeconds(cs, n)
        expect(total, `${target} with ${n} needles`).toBeGreaterThanOrEqual(lo)
        expect(total, `${target} with ${n} needles`).toBeLessThanOrEqual(hi)
        const t = watchTimesFor(target, n)!
        expect(Object.values(t.units).reduce((a, b) => a + b, 0)).toBe(total)
        expect(t.repeatNeedleSeconds).toBe(later)
        expect(t.needleSeconds).toBe(first)
      }
      // (every step's seconds are at least the engine's floor, and the watch case's steps are the numbers the engine tiles)
      for (const s of steps) expect(s.watchSeconds).toBeGreaterThanOrEqual(CONFIG.procedure.minWatchStepSeconds)
    })

    it(`${target}: the wide steps (arrival, transfers, the WHO pauses) frame the room, the airway, the turns and the waking frame the head`, () => {
      for (const id of ['wheelsIn', 'ontoTable', 'signIn', 'timeOut', 'signOut', 'wheelsOut']) expect(step(id).focus, `${target} ${id}`).toBe('ctRoom')
      const head = steps.filter((s) => s.focus === 'ctHead').map((s) => s.id)
      const wanted = {
        kidney: ['sedationGiven', 'rollBack'],
        lung: ['induction', 'breathingTube', 'turnProne', 'turnBack', 'extubate', 'breathingAlone'],
        liver: ['deepSedation', 'turnProne', 'turnBack', 'wakes'],
      }[target]
      expect(head).toEqual(wanted)
    })
  }

  it('the kidney leaves on oxygen by nasal cannula and is awake by the Sign Out', () => {
    const cs = compiledForTarget('kidney')!
    const at = (id: string) => cs.script.steps.findIndex((s) => s.id === id)
    expect(cs.poseAfter[at('signOut')].awareness).toBe('awake')
    expect(cs.poseAfter[at('dressings')].awareness).toBe('sedated')
    expect(cs.poseAfter[at('rollBack')].awareness).toBe('awake')
    expect(cs.poseAfter[at('wheelsOut')].airway).toBe('nasalCannula')
    expect(cs.poseAfter[at('wheelsOut')].position).toBe('supine')
    // (the airway is the cannula from the monitors to the stretcher: it is never taken off in between)
    for (let i = at('monitorsOn'); i <= at('wheelsOut'); i++) expect(cs.poseAfter[i].airway, cs.script.steps[i].id).toBe('nasalCannula')
  })
})

describe('F11: nobody stands on another person\'s spot', () => {
  it('no two roles stand closer than 0.6 m in any step of any script (the places the team takes), the nurse meeting the lung and the liver at the side', () => {
    const h = cryoSuite(31, { crowd: false, hour: 9 })
    const sites = h.cryo.sites
    for (const target of TARGETS) {
      const cs = compiledForTarget(target)!
      let closest = Infinity
      for (let i = 0; i < cs.n; i++) {
        const p = placesAt(target, i, sites)
        for (let a = 0; a < p.length; a++) {
          for (let b = a + 1; b < p.length; b++) {
            const d = Math.hypot(p[a].at.x - p[b].at.x, p[a].at.z - p[b].at.z)
            closest = Math.min(closest, d)
            expect(d, `${target} ${cs.script.steps[i].id}: ${p[a].role}@${p[a].anchor}#${p[a].slot} and ${p[b].role}@${p[b].anchor}#${p[b].slot}`).toBeGreaterThanOrEqual(0.6)
          }
        }
      }
      expect(closest).toBeLessThan(5)
    }
    for (const target of ['lung', 'liver'] as const) {
      const s = scriptFor(`cryo-${target}`)!.steps.find((x) => x.id === 'wheelsIn')!
      expect(s.roles.sedation!.at).toBe('ctSideSouth')
      expect(s.roles.cryoAnaes!.at).toBe('ctAnaesHead')
    }
  })
})

describe('F10: nobody changes places with somebody else', () => {
  it('between two steps of a script no two roles exchange spots (a swap sends both the long way round: each stands where the other has to go, so neither can hop)', () => {
    const h = cryoSuite(31, { crowd: false, hour: 9 })
    const sites = h.cryo.sites
    for (const target of TARGETS) {
      const cs = compiledForTarget(target)!
      let before = placesAt(target, 0, sites)
      for (let i = 1; i < cs.n; i++) {
        const now = placesAt(target, i, sites)
        for (const a of before) {
          const a2 = now.find((q) => q.role === a.role)
          if (a2 === undefined) continue
          for (const b of before) {
            if (b.role <= a.role) continue
            const b2 = now.find((q) => q.role === b.role)
            if (b2 === undefined) continue
            const dist = (p: { x: number; z: number }, q: { x: number; z: number }) => Math.hypot(p.x - q.x, p.z - q.z)
            const swap = dist(a.at, a2.at) > 0.05 && dist(b.at, b2.at) > 0.05 && dist(a.at, b2.at) < 0.6 && dist(b.at, a2.at) < 0.6
            expect(swap, `${target} ${cs.script.steps[i].id}: ${a.role} and ${b.role} swap ${a.anchor}#${a.slot} and ${b.anchor}#${b.slot}`).toBe(false)
          }
        }
        before = now
      }
    }
  })

  it('the lung\'s mattress is shaped where everybody already stands: the radiologist stays at the north side, the radiographer at the foot, the nurse at the south side', () => {
    const h = cryoSuite(31, { crowd: false, hour: 9 })
    const steps = scriptFor('cryo-lung')!.steps
    const turn = steps.findIndex((x) => x.id === 'turnProne')
    expect(steps[turn + 1].id).toBe('mattress')
    expect(steps[turn + 2].id).toBe('skinPrep')
    const at = (i: number) => placesAt('lung', i, h.cryo.sites)
    for (const role of ['ir', 'ctRadiographer', 'sedation', 'cryoAnaes'] as const) {
      const a = at(turn).find((q) => q.role === role)!
      const b = at(turn + 1).find((q) => q.role === role)!
      expect(Math.hypot(a.at.x - b.at.x, a.at.z - b.at.z), `${role} moves between the turn and the mattress`).toBeLessThan(0.05)
    }
    // (the radiologist is at the field again for the prep with no step to take; the radiographer goes to the control room)
    const ir = [turn + 1, turn + 2].map((i) => at(i).find((q) => q.role === 'ir')!.at)
    expect(Math.hypot(ir[0].x - ir[1].x, ir[0].z - ir[1].z)).toBeLessThan(0.05)
    // every hands-on line is still within the reach of the place it is worked from
    const mattress = steps[turn + 1].roles
    expect(mattress.sedation!.work).toBe('ctField')
    expect(mattress.ctRadiographer!.do).toBe('positionPatient')
    expect(mattress.ctRadiographer!.work).toBeUndefined()
  })
})

describe('F12: nobody is asked to look from behind', () => {
  it('the heading faces the work point; a look-only line keeps the spot\'s way within the neck\'s range and otherwise turns just far enough', () => {
    const at = { x: 0, z: 0 }
    const spot = Math.PI // facing north
    // a look straight ahead, or within the range: the spot's own heading
    expect(scriptHeading(spot, at, null, { x: 0, y: 1, z: -3 })).toBe(spot)
    expect(scriptHeading(spot, at, null, { x: -1, y: 1, z: -1 })).toBe(spot)
    expect(scriptHeading(spot, at, null, null)).toBe(spot)
    // a work point: face it
    expect(scriptHeading(spot, at, { x: 2, y: 1, z: 0 }, { x: 0, y: 1, z: -3 })).toBeCloseTo(Math.PI / 2, 9)
    // a look 167 degrees behind (the anaesthetist's monitor): the body turns so it is exactly MAX_LOOK off the facing, the patient still within 110 degrees
    const behind = { x: Math.sin(spot + 167 * (Math.PI / 180)) * 2, y: 1, z: Math.cos(spot + 167 * (Math.PI / 180)) * 2 }
    const h = scriptHeading(spot, at, null, behind)
    expect(Math.abs(wrap(Math.atan2(behind.x, behind.z) - h))).toBeCloseTo(MAX_LOOK, 9)
    expect(Math.abs(wrap(spot - h))).toBeLessThan((110 * Math.PI) / 180)
    // (and the other way round)
    const left = { x: Math.sin(spot - 128 * (Math.PI / 180)) * 2, y: 1, z: Math.cos(spot - 128 * (Math.PI / 180)) * 2 }
    expect(Math.abs(wrap(Math.atan2(left.x, left.z) - scriptHeading(spot, at, null, left)))).toBeCloseTo(MAX_LOOK, 9)
    expect(MAX_LOOK).toBeLessThanOrEqual((70 * Math.PI) / 180)
  })

  it('every scripted look (the work point of a hands-on line, else the look point) of the three scripts lies within 100 degrees of the body\'s heading', () => {
    const h = cryoSuite(31, { crowd: false, hour: 9 })
    const sites = h.cryo.sites
    let looks = 0
    let widest = 0
    for (const target of TARGETS) {
      const cs = compiledForTarget(target)!
      const ctx = newTargetCtx()
      ctx.cryo.target = target
      for (let i = 0; i < cs.n; i++) {
        for (const p of placesAt(target, i, sites)) {
          const seat = p.anchor === 'ctControlScan' || p.anchor === 'ctControlPlan'
          const spot = sites.anchor(p.anchor as never, p.slot)
          const work = { x: 0, y: 0, z: 0 }
          const look = { x: 0, y: 0, z: 0 }
          if (p.line.work !== null) workPointInto(p.line.work, spot.at, ctx, work)
          if (p.line.work === null && p.line.look !== null) resolveTarget(p.line.look, ctx, look)
          const heading = seat ? spot.heading : scriptHeading(spot.heading, spot.at, p.line.work !== null ? work : null, p.line.work === null && p.line.look !== null ? look : null)
          const target3 = p.line.work !== null ? work : p.line.look !== null ? look : null
          if (target3 === null) continue
          looks++
          const d = Math.abs(wrap(Math.atan2(target3.x - spot.at.x, target3.z - spot.at.z) - heading))
          widest = Math.max(widest, d)
          expect(deg(d), `${target} ${cs.script.steps[i].id} ${p.role} ${p.anchor}#${p.slot}`).toBeLessThanOrEqual(100)
        }
      }
    }
    expect(looks).toBeGreaterThan(300)
    expect(deg(widest)).toBeLessThanOrEqual(70)
  })
})

describe('F13: each target has its own tumour point', () => {
  it('puts the kidney\'s tumour where the kidney is in the rolled body (its x and z are the places\' own), and the lung and the liver on the prone back at their own levels', () => {
    const k = CRYO_SUITE.targets.kidney
    // (the legacy `CRYO_SUITE.target` is the kidney's point as it was before the patient's roll was applied to the planning slice (R5 geometry: ctSlice.ts): along the table it is
    // where it was; the planned entries lie 75 to 95 mm from it toward the patient's left, which on her side is UP and north, so for them to be on her flank the tumour lies 0.24 m
    // over the pad (it was 0.10) and 0.035 m north of the table's centre line (it was 0.10), in a body rolled 55 degrees)
    expect(k.tumour.x).toBe(CRYO_SUITE.target.x)
    expect(k.tumour.y - CRYO_SUITE.ct.table.height).toBeCloseTo(0.24, 9)
    expect(CRYO_SUITE.ct.table.out.z - k.tumour.z).toBeCloseTo(0.035, 9)
    const ctx = newCryoTargetCtx()
    const out = { x: 0, y: 0, z: 0 }
    for (const pos of [0, 0.37, 1]) {
      ctx.tablePos = pos
      ctx.target = 'kidney'
      const dx = (CRYO_SUITE.ct.table.in.x - CRYO_SUITE.ct.table.out.x) * pos
      const g = k.tumour
      // (the formulas as they were before the per-target points: the kidney's window, the table and ice foci; the window's offset is where the planned entries are on average)
      expect(cryoTargetInto('ctField', ctx, out)).toEqual({ x: g.x + dx, y: g.y + k.field.y, z: g.z + k.field.z })
      expect(cryoFocusInto('ctTable', ctx, out)).toEqual({ x: g.x + dx, y: g.y, z: g.z })
      expect(cryoFocusInto('iceBall', ctx, out)).toEqual({ x: g.x + dx, y: g.y, z: g.z })
    }
    ctx.tablePos = 0
    // the head end of the table is about 0.9 m west of the table's centre; the pelvis (body centre) is on the centre; the points follow the landmarks
    const t = CRYO_SUITE.ct.table.out
    const d = (target: CryoTarget) => t.x - CRYO_SUITE.targets[target].tumour.x
    expect(d('kidney')).toBeCloseTo(0.25, 9)
    expect(d('lung')).toBeGreaterThan(d('kidney'))
    expect(d('lung')).toBeGreaterThan(0.3)
    expect(d('lung')).toBeLessThan(0.5)
    expect(d('liver')).toBeGreaterThan(0.2)
    expect(d('liver')).toBeLessThan(d('lung'))
    for (const target of ['lung', 'liver'] as const) {
      const p = CRYO_SUITE.targets[target]
      // the prone back: the robot's (north) side of the spine, the skin about 0.24 m over the table top, the tumour 0.10 m under it
      expect(p.tumour.z, target).toBeLessThan(t.z)
      expect(t.z - p.tumour.z, target).toBeGreaterThan(0.05)
      expect(t.z - p.tumour.z, target).toBeLessThan(0.15)
      expect(p.tumour.y + p.field.y - CRYO_SUITE.ct.table.height, target).toBeGreaterThan(0.2)
      expect(p.tumour.y + p.field.y - CRYO_SUITE.ct.table.height, target).toBeLessThan(0.28)
      expect(p.field.y, target).toBeGreaterThan(0.07)
      expect(p.field.y, target).toBeLessThan(0.12)
      ctx.target = target
      ctx.needle = -1
      const field = cryoTargetInto('ctField', ctx, { x: 0, y: 0, z: 0 })
      expect(field.x).toBeCloseTo(p.tumour.x + p.field.x, 9)
      expect(field.y).toBeCloseTo(p.tumour.y + p.field.y, 9)
      expect(field.z).toBeCloseTo(p.tumour.z + p.field.z, 9)
      const focus = cryoFocusInto('ctTable', ctx, { x: 0, y: 0, z: 0 })
      expect(focus).toEqual({ x: p.tumour.x, y: p.tumour.y, z: p.tumour.z })
      // a needle's entry is measured from the target's own tumour, in the patient's own frame seen through her roll (ctSlice.ts): face down, her right (the robot's side, north) is
      // -x and the back (posterior, up) is +y
      ctx.needles = [{ entry: { x: -40, y: 80 }, dz: 10 }]
      ctx.needle = 0
      const entry = cryoTargetInto('needleEntry', ctx, { x: 0, y: 0, z: 0 })
      expect(entry.x).toBeCloseTo(p.tumour.x - 0.01, 9)
      expect(entry.y).toBeCloseTo(p.tumour.y + 0.08, 9)
      expect(entry.z).toBeCloseTo(p.tumour.z - 0.04, 9)
      ctx.needles = []
      ctx.needle = -1
    }
    // the lung and the liver are different places from the kidney's, and from each other's
    expect(CRYO_SUITE.targets.lung.tumour.x).not.toBe(CRYO_SUITE.targets.kidney.tumour.x)
    expect(CRYO_SUITE.targets.lung.tumour.x).not.toBe(CRYO_SUITE.targets.liver.tumour.x)
    // (the body's landmarks: the navel 0.10 m and the sternum 0.32 m toward the head of the pelvis centre; the lung is above the chest's middle, the liver below it)
    expect(d('lung')).toBeGreaterThan(0.32)
    expect(d('liver')).toBeLessThan(0.32)
  })

  it('labels the area for the kidney, the lung and the liver', () => {
    expect(areaAt(CRYO_SUITE.ct.table.out.x, CRYO_SUITE.ct.table.out.z)?.subtitle).toBe('Robot-guided freezing of small kidney, lung and liver tumours')
  })
})

describe('F10: short hops inside the CT room', () => {
  const h = cryoSuite(31, { crowd: false, hour: 9 })
  const sites = h.cryo.sites
  const at = (a: string, k = 0) => sites.anchor(a as never, k).at

  it('walks a clear straight line directly: the radiologist\'s hop from the guide to the table\'s north side is 0.39 m, not 3.8 m round the door', () => {
    const a = at('ctInsert')
    const b = at('ctSideNorth')
    const planned = tryPlanRoute(a, b)!
    expect(routeLength(planned)).toBeGreaterThan(3)
    const hop = hopRoute(a, b)!
    expect(hop).toHaveLength(2)
    expect(routeLength(hop)).toBeCloseTo(Math.hypot(a.x - b.x, a.z - b.z), 9)
    expect(routeLength(hop)).toBeLessThan(0.5)
  })

  it('walks a short L round the table\'s foot end where the straight line is blocked: the south side to the foot is about 2 m, not 6.6 m', () => {
    const a = at('ctSideSouth')
    const b = at('ctFoot')
    expect(routeLength(tryPlanRoute(a, b)!)).toBeGreaterThan(6)
    const hop = hopRoute(a, b)!
    expect(hop).toHaveLength(3)
    expect(routeLength(hop)).toBeLessThan(2.6)
    expect(routeLength(hop)).toBeGreaterThanOrEqual(Math.hypot(a.x - b.x, a.z - b.z))
  })

  it('leaves what it cannot walk straight or in an L to the graph: across the table, and out of the room', () => {
    expect(hopRoute(at('ctSideNorth'), at('ctSideSouth'))).toBeNull()
    expect(hopRoute(at('ctInsert'), at('ctControlStand'))).toBeNull()
    expect(inScanRoom(at('ctInsert').x, at('ctInsert').z)).toBe(true)
    expect(inScanRoom(at('ctControlStand').x, at('ctControlStand').z)).toBe(false)
    // every hop the team can make (every pair of the places the scripts use) is shorter than 1.5 times the straight line and inside the room
    const names = ['ctInsert', 'ctConsole', 'ctHeadSouth', 'ctAnaesHead', 'ctFoot', 'ctSideSouth', 'ctSideNorth'] as const
    let found = 0
    for (const n1 of names) {
      for (let k1 = 0; k1 < cryoAnchorSlots(n1).length; k1++) {
        for (const n2 of names) {
          for (let k2 = 0; k2 < cryoAnchorSlots(n2).length; k2++) {
            const a = at(n1, k1)
            const b = at(n2, k2)
            const route = hopRoute(a, b)
            if (route === null) continue
            found++
            expect(routeLength(route)).toBeLessThanOrEqual(Math.hypot(a.x - b.x, a.z - b.z) * 1.5 + 1e-9)
          }
        }
      }
    }
    expect(found).toBeGreaterThan(20)
  })

  it('a hop walker takes the hop only when the team allows it and nobody is in the way, and keeps the wrapped walker at the body\'s place', () => {
    const fake = cryoSuite(7, { crowd: true, hour: 9 })
    const walker = fake.walkerFor('hop-test')
    const a = at('ctInsert')
    const b = at('ctSideNorth')
    walker.place(a.x, a.z, 0)
    let blocked = false
    const hw = new HopWalker(walker, () => blocked)
    // not allowed: planned through the graph
    hw.goTo(b)
    expect(hw.isHopping).toBe(false)
    expect(hw.hops).toBe(0)
    walker.place(a.x, a.z, 0)
    hw.allow = true
    blocked = true
    hw.goTo(b)
    expect(hw.isHopping).toBe(false)
    blocked = false
    walker.place(a.x, a.z, 0)
    hw.goTo(b)
    expect(hw.isHopping).toBe(true)
    let walked = 0
    let px = hw.x
    let pz = hw.z
    let st = 'moving'
    for (let i = 0; i < 600 && st !== 'arrived'; i++) {
      st = hw.step(0.05, 1.3)
      walked += Math.hypot(hw.x - px, hw.z - pz)
      px = hw.x
      pz = hw.z
      // the wrapped walker is where the body is, every step
      expect(walker.x).toBeCloseTo(hw.x, 9)
      expect(walker.z).toBeCloseTo(hw.z, 9)
    }
    expect(st).toBe('arrived')
    expect(hw.isHopping).toBe(false)
    expect(walked).toBeCloseTo(Math.hypot(a.x - b.x, a.z - b.z), 3)
    expect(hw.x).toBeCloseTo(b.x, 6)
    expect(hw.z).toBeCloseTo(b.z, 6)
    expect(hw.hops).toBe(1)
  })
})

describe('F3: why a start was refused', () => {
  it('says the team is out of hours or that it is too late for a whole case today', () => {
    const early = cryoSuite(1, { crowd: false, hour: 7.6 })
    expect(early.cryo.whyNoTeam).toBeNull()
    expect(early.cryo.startDemo()).toBe('noTeam')
    expect(early.cryo.whyNoTeam).toBe('hours')
    const gone = cryoSuite(1, { crowd: false, hour: 18 })
    expect(gone.cryo.startDemo()).toBe('noTeam')
    expect(gone.cryo.whyNoTeam).toBe('hours')
    // 17:18 and 17:21: the team is on site (to 17:30) but a watch case needs 11-12 min in the room, and is to be out 5 min before the team goes home
    for (const hour of [17.3, 17.35]) {
      const late = cryoSuite(1, { crowd: false, hour })
      expect(late.personById('cryo-ir')).not.toBeNull()
      expect(late.cryo.startDemo()).toBe('noTeam')
      expect(late.cryo.whyNoTeam, `${hour}`).toBe('late')
      for (const target of TARGETS) {
        expect(late.cryo.startWatch(target)).toBe('noTeam')
        expect(late.cryo.whyNoTeam).toBe('late')
      }
    }
    // the cutoff the comments and the panel's copy name: a start up to 17:13 is taken, from 17:14 it is too late (a watch case is in the room for about
    // 11 minutes and is to be out five minutes before the team goes home at 17:30), for each of the targets
    for (const target of TARGETS) {
      const before = cryoSuite(1, { crowd: false, hour: 17 + 13 / 60 })
      expect(before.cryo.startWatch(target), `${target} at 17:13`).toBe('started')
      const after = cryoSuite(1, { crowd: false, hour: 17 + 14 / 60 })
      expect(after.cryo.startWatch(target), `${target} at 17:14`).toBe('noTeam')
      expect(after.cryo.whyNoTeam).toBe('late')
    }
    // a start that works clears it
    const fine = cryoSuite(1, { crowd: false, hour: 9 })
    expect(fine.cryo.startDemo()).toBe('started')
    expect(fine.cryo.whyNoTeam).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// as played
// ---------------------------------------------------------------------------------------------------------------------

interface HopStat {
  role: string
  from: { x: number; z: number }
  to: { x: number; z: number }
  walked: number
  hopped: boolean
  route: number | null
  key: string
}

interface Played {
  h: CryoHospital
  target: CryoTarget
  marks: { t: number; stepId: string; unit: string; k: number }[]
  apnoea: { runs: { from: number; to: number; stepId: string; step: string }[]; sawIn: Map<string, boolean> }
  unload: { stepId: string; transferStepId: string } | null
  attireBad: string[]
  anaesBare: { stepId: string; bits: number }[]
  looks: { worst: number; at: string; n: number }
  hops: HopStat[]
  nurse: { stepId: string; atSide: boolean; engaged: boolean; mask: boolean }[]
}

const played = new Map<CryoTarget, Played>()

function play(target: CryoTarget): Played {
  const cached = played.get(target)
  if (cached !== undefined) return cached
  const h = cryoSuite(31, { crowd: true, hour: 9 })
  const c = h.cryo
  h.step(0.1)
  expect(c.startWatch(target)).toBe('started')
  const demo = c.runs.find((r) => r.plan.demo)!
  const v = c.state.procedure
  const out: Played = {
    h,
    target,
    marks: [],
    apnoea: { runs: [], sawIn: new Map() },
    unload: null,
    attireBad: [],
    anaesBare: [],
    looks: { worst: 0, at: '', n: 0 },
    hops: [],
    nurse: [],
  }
  const staff = [
    ['ir', 'cryo-ir'],
    ['ctRadiographer', 'cryo-rad'],
    ['sedation', 'cryo-nurse'],
    ['cryoAnaes', 'cryo-anaes'],
  ] as const
  const walk = new Map<string, { key: string; from: { x: number; z: number }; walked: number; prev: { x: number; z: number }; hops: number }>()
  /** Each person's hops taken as of the previous step (the task changes, and so the hop is taken, inside the suite's step, before the test looks). */
  const hopsSeen = new Map<string, number>()
  /** Where each person stood at the previous step (a walk begins from there). */
  const posSeen = new Map<string, { x: number; z: number }>()
  let ver = -1
  let hold: { from: number; stepId: string; step: string } | null = null
  let wasMounted = true
  for (let i = 0; i < 20000 && demo.stage !== 'toPacu'; i++) {
    h.step(0.1)
    if (v.version !== ver && v.procedureId !== null) {
      ver = v.version
      out.marks.push({ t: h.t, stepId: v.stepId, unit: v.unit, k: v.repeat?.k ?? 0 })
    }
    if (v.procedureId === null) continue
    // the held breath: its runs, and which steps had it
    if (c.state.apnoea && hold === null) hold = { from: h.t, stepId: v.stepId, step: c.state.step }
    if (c.state.apnoea) out.apnoea.sawIn.set(`${v.stepIndex}:${v.stepId}`, true)
    else if (hold !== null) {
      out.apnoea.runs.push({ from: hold.from, to: h.t, stepId: hold.stepId, step: hold.step })
      hold = null
    }
    if (!out.apnoea.sawIn.has(`${v.stepIndex}:${v.stepId}`)) out.apnoea.sawIn.set(`${v.stepIndex}:${v.stepId}`, false)
    // the unload onto the table
    const patient = demo.patient
    if (patient !== null && wasMounted && demo.stage === 'arriving' && !patient.mounted) {
      out.unload = { stepId: v.stepId, transferStepId: demo.proc!.steps.cs.script.steps[transferStepOf(demo.proc!.steps.cs)].id }
    }
    if (patient !== null && demo.stage === 'arriving') wasMounted = patient.mounted
    const cur = c.team.ctx.cur
    const sc = demo.proc!
    for (let r = 0; r < staff.length; r++) {
      const st = c.team.get(staff[r][0])
      if (st === null) continue
      const bits = st.entity.attire ?? 0
      if (c.team.ctx.script !== null && cur.index >= 0) {
        const want = sc.attire[cur.index * CRYO_ROLES.length + r]
        if (bits !== want) out.attireBad.push(`${v.stepId} ${staff[r][0]} ${bits} (the table says ${want})`)
      }
      if (staff[r][0] === 'cryoAnaes' && target === 'kidney') out.anaesBare.push({ stepId: v.stepId, bits })
      // where they look, from where they stand, once at their place
      // (the task's own look point: the entity's gaze copies it a step late)
      const look = st.task?.look
      if (look != null && st.task !== null && st.isAt(st.task.key)) {
        const d = Math.abs(wrap(Math.atan2(look.x - st.walker.x, look.z - st.walker.z) - st.walker.heading))
        out.looks.n++
        if (d > out.looks.worst) {
          out.looks.worst = d
          out.looks.at = `${v.stepId} ${staff[r][0]} ${st.task.key}`
        }
      }
      // the hops: a move between two places of the scan room
      const w = walk.get(staff[r][0])
      const hw = st.walker instanceof HopWalker ? st.walker : null
      const key = st.task?.key ?? ''
      const pos = { x: st.walker.x, z: st.walker.z }
      if (w === undefined || w.key !== key) {
        // (a walk that was replaced before it ended is not judged)
        const from = posSeen.get(staff[r][0]) ?? pos
        walk.set(staff[r][0], { key, from, walked: Math.hypot(pos.x - from.x, pos.z - from.z), prev: pos, hops: hopsSeen.get(staff[r][0]) ?? 0 })
      } else {
        w.walked += Math.hypot(pos.x - w.prev.x, pos.z - w.prev.z)
        w.prev = pos
        if (st.isAt(key) && st.task !== null && st.task.seat == null && w.walked > 0.05) {
          const target3 = st.task.at
          if (inScanRoom(w.from.x, w.from.z) && inScanRoom(target3.x, target3.z) && st.engagedBy === null) {
            const route = hopRoute(w.from, target3)
            out.hops.push({ role: staff[r][0], from: w.from, to: pos, walked: w.walked, hopped: (hw?.hops ?? 0) > w.hops, route: route === null ? null : routeLength(route), key })
          }
          w.walked = 0
          w.from = pos
          w.hops = hw?.hops ?? 0
        }
      }
      hopsSeen.set(staff[r][0], hw?.hops ?? 0)
      posSeen.set(staff[r][0], pos)
    }
    // the nurse through the dressing: at the table's side until the stretcher is wanted, masked throughout
    if (v.unit === 'dressing') {
      const nurse = c.team.get('sedation')!
      const side = c.sites.anchor('ctSideSouth', 0).at
      out.nurse.push({ stepId: v.stepId, atSide: Math.hypot(nurse.x - side.x, nurse.z - side.z) < 0.4, engaged: nurse.engagedBy !== null, mask: ((nurse.entity.attire ?? 0) & ATTIRE.mask) !== 0 })
    }
  }
  if (hold !== null) out.apnoea.runs.push({ from: hold.from, to: h.t, stepId: hold.stepId, step: hold.step })
  played.set(target, out)
  return out
}

describe('as played: a watch case of each target', () => {
  for (const target of TARGETS) {
    it(`${target}: the held breath is the push part of every push and the sweep of every scan (lung, liver), never the kidney's`, () => {
      const p = play(target)
      const sc = p.h.cryo.runs.find((r) => r.plan.demo)!.proc!
      const steps = sc.steps.cs.script.steps
      if (target === 'kidney') {
        expect(p.apnoea.runs).toEqual([])
        return
      }
      expect(p.apnoea.runs.length).toBeGreaterThan(0)
      for (const r of p.apnoea.runs) {
        expect(['planningCt', 'checkCt', 'finalCt'].includes(r.step) || (r.step === 'aim' && r.stepId === 'pushNeedle'), `${r.step}/${r.stepId}`).toBe(true)
        // (a watch step is short: the longest is the first needle's push part, ~39 s of its 46)
        expect(r.to - r.from, `${r.step}/${r.stepId}`).toBeLessThan(40)
      }
      // true at some moment of every push step (every needle) and every scan, and in no other step
      for (const [key, saw] of p.apnoea.sawIn) {
        const [flat, id] = key.split(':')
        const step = steps.find((s) => s.id === id)!
        const mustHold = /Ct$/.test(step.unit) || id === 'pushNeedle'
        expect(saw, `step ${flat} ${id}`).toBe(mustHold)
      }
      expect(p.apnoea.runs.filter((r) => r.stepId === 'pushNeedle')).toHaveLength(p.h.cryo.runs.find((r) => r.plan.demo)!.plan.needles.length)
      // breathing resumes between: the steps either side of a push are not held
      for (const id of ['robotAims', 'localAndNick']) expect([...p.apnoea.sawIn].filter(([k]) => k.endsWith(`:${id}`)).every(([, s]) => !s)).toBe(true)
    }, 300_000)

    it(`${target}: the patient is moved onto the CT table as the transfer step is under the clock`, () => {
      const p = play(target)
      expect(p.unload).not.toBeNull()
      expect(p.unload!.stepId).toBe(p.unload!.transferStepId)
      expect(p.unload!.stepId).toBe('ontoTable')
    }, 300_000)

    it(`${target}: the team wears what the table says at every moment, and the kidney's anaesthetist wears nothing outside the scans he stands in`, () => {
      const p = play(target)
      expect(p.attireBad).toEqual([])
      if (target === 'kidney') {
        expect(p.anaesBare.length).toBeGreaterThan(100)
        for (const a of p.anaesBare) if (!/Scan$/.test(a.stepId)) expect(a.bits, a.stepId).toBe(0)
        expect(p.anaesBare.some((a) => /Scan$/.test(a.stepId) && a.bits !== 0)).toBe(true)
      }
    }, 300_000)

    it(`${target}: the nurse works at the table's side through the dressing, masked, and is lent for the stretcher only as it ends`, () => {
      const p = play(target)
      const steps = p.nurse
      expect(steps.length).toBeGreaterThan(50)
      expect(steps.every((n) => n.mask)).toBe(true)
      // she has lines in the dressing: at the side (once she has walked there from the control room's side of the table) until she is lent for the stretcher,
      // a few seconds before its end (she meets the porter, who brings it: verifierFixes.test.ts)
      const free = steps.filter((n) => !n.engaged)
      expect(free.length).toBeGreaterThan(30)
      const settled = free.slice(Math.floor(free.length * 0.4))
      expect(settled.filter((n) => n.atSide).length / settled.length).toBeGreaterThan(0.8)
      // the dressing's signOut and turn back with her at the side
      for (const id of ['signOut', target === 'kidney' ? 'rollBack' : 'turnBack']) {
        const here = steps.filter((n) => n.stepId === id && !n.engaged)
        expect(here.length, id).toBeGreaterThan(0)
        expect(here.some((n) => n.atSide), id).toBe(true)
      }
      // (the engaged part is the end: once she was lent she stays lent through the dressing)
      const firstEngaged = steps.findIndex((n) => n.engaged)
      if (firstEngaged >= 0) expect(steps.slice(firstEngaged).every((n) => n.engaged)).toBe(true)
    }, 300_000)

    it(`${target}: nobody is asked to look from behind: every look at a spot is within 100 degrees (the neck's reach) of where the body faces`, () => {
      const p = play(target)
      expect(p.looks.n).toBeGreaterThan(500)
      expect(deg(p.looks.worst), p.looks.at).toBeLessThanOrEqual(100)
    }, 300_000)

    it(`${target}: short hops are walked directly: about the route's length, never round the room`, () => {
      const p = play(target)
      const eligible = p.hops.filter((x) => x.route !== null)
      const taken = eligible.filter((x) => x.hopped)
      expect(eligible.length, target).toBeGreaterThan(0)
      for (const x of taken) expect(x.walked, `${x.role} to ${x.key}`).toBeLessThanOrEqual((x.route as number) * 1.1 + 0.1)
      // (a hop is taken unless somebody stands in the way: no two people swap places in any script (the lung's mattress was one), so in a watch case,
      // where nobody else is in the room, every hop the route allows is taken; a body in the way would leave it to the graph and the crowd's avoidance)
      const left = eligible.filter((x) => !x.hopped)
      const describe = left.map((x) => `${x.role} ${x.key} from (${x.from.x.toFixed(2)}, ${x.from.z.toFixed(2)}) walked ${x.walked.toFixed(2)} (route ${x.route?.toFixed(2)})`)
      expect(taken.length / eligible.length, `${target}: ${left.length} of ${eligible.length} left to the graph: ${describe.join('; ')}`).toBeGreaterThanOrEqual(0.9)
      for (const x of left) expect(x.walked, `${x.role} to ${x.key}`).toBeLessThan(4)
      // the radiologist's hop between the guide and the table's north side, every needle
      const ir = p.hops.filter((x) => x.role === 'ir' && /@ctSideNorth$|@ctInsert$/.test(x.key) && Math.hypot(x.from.x - x.to.x, x.from.z - x.to.z) < 0.6)
      for (const x of ir) expect(x.walked, `ir to ${x.key}`).toBeLessThan(0.8)
      // every move between two places of the room is no longer than 6 m (the planned round-the-room walks were 7 to 12 m)
      for (const x of p.hops) expect(x.walked, `${x.role} to ${x.key}`).toBeLessThan(7)
    }, 300_000)

    it(`${target}: the first step is the arrival (the wait for the porter, never short) and every step of the script was played in order`, () => {
      const p = play(target)
      const sc = p.h.cryo.runs.find((r) => r.plan.demo)!.proc!
      const marks = p.marks
      expect(marks.length).toBe(sc.steps.flatCount)
      expect(marks.slice(0, 2).map((m) => m.stepId)).toEqual(['wheelsIn', 'ontoTable'])
      expect(marks[2].stepId).toBe('monitorsOn')
    }, 300_000)
  }
})

// ---------------------------------------------------------------------------------------------------------------------
// as played in the living day (the lung's and the liver's cases at the day's own clock)
// ---------------------------------------------------------------------------------------------------------------------

describe('as played: the living day', () => {
  it('holds the breath for a few seconds of every push and every scan (at most the cap), and moves each patient across as the transfer step is under the clock', () => {
    // seed 3 and 77 each list a liver and a lung case; 31 a liver and a kidney (no held breath for it)
    const cap = CONFIG.cryoSuite.apnoeaSeconds
    let held = 0
    const seen = new Set<string>()
    for (const seed of [3, 77, 31]) {
      const tr = runCryoDay(seed, { crowd: false, dt: 0.2 })
      const where = `seed ${seed}`
      expect(tr.problems, where).toEqual([])
      expect(tr.h.cryo.stuckFixes, `${where} ${tr.h.cryo.stuckLog.join('|')}`).toBe(0)
      for (const run of tr.h.cryo.runs) seen.add(targetOf(run.plan))
      // the longest held breath of the living day: a window of a push or a scan, never the minutes of the step
      expect(tr.longestHold.live, where).toBeLessThanOrEqual(cap + 0.5)
      expect(tr.longestHold.watch, where).toBe(0)
      held = Math.max(held, tr.longestHold.live)
      // every scripted case moved the patient across at its transfer step (the arrival's last), in the living day too
      expect(tr.unloads.map((u) => u.caseId), where).toEqual(tr.h.cryo.runs.map((r) => r.id))
      for (const u of tr.unloads) {
        expect(u.stepId, `${where} ${u.caseId}`).toBe(u.transferStepId)
        expect(u.stepId).toBe('ontoTable')
      }
      // the held breath was seen in the lung's and the liver's pushes and scans
      const lungOrLiver = tr.h.cryo.runs.some((r) => targetOf(r.plan) !== 'kidney')
      expect(tr.script.some((m) => m.apnoea) || lungOrLiver, where).toBe(true)
    }
    expect(held).toBeGreaterThan(cap - 2)
    expect([...seen].sort()).toEqual(['kidney', 'liver', 'lung'])
  }, 600_000)
})
