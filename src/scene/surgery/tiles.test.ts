/**
 * The surgeryKit atlas tiles in node: where they register, that every tile renders (the painters run against a recording context) with the right words, that a
 * tile's version changes exactly when what it shows changes, and how they behave in the W4 atlas rig (placed, painted once, quiet until something changes, uploaded
 * at most twice a second).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { SURGERY_COPY } from '@/content/surgery'
import { SURGERY_UI } from '@/content/surgeryUi'
import { createStatusRig, STATUS_UPLOAD, type StatusAtlas } from '@/scene/w4kit/statusRig'
import { W4_TILE_PX } from '@/scene/w4kit/tiles'
import { hourAt } from '@/sim/population/schedule'
import type { SurgeryState } from '@/sim/types'
import { KIT_SCREENS, KIT_TILE, KIT_TILE_COUNT } from './dims'
import {
  bayPatient,
  boardVersion,
  circulatorVersion,
  clockText,
  consoleSeconds,
  consoleVersion,
  currentCase,
  fitText,
  sentences,
  nextCase,
  paintCirculator,
  paintConsole,
  paintPacuBoard,
  paintPreOpBoard,
  registerSurgeryTiles,
  stopwatch,
  surgeryTiles,
  versionOf,
} from './tiles'
import { caseView, dockedRobot, stowedRobot, surgeryState, theatre } from './testkit'
import { logCtx } from './testctx'

const W = W4_TILE_PX.w
const H = W4_TILE_PX.h

/** A theatre with a case in its console phase, a patient in PACU bay 0 and one in pre-op bay 1. */
function busy(): SurgeryState {
  const st = surgeryState({
    theatre: theatre('console', {
      cases: [
        caseView('c1', { patientId: 'p1', name: 'Ana Costa', consoleStart: 1000, wheelsIn: 500, plannedIn: 400 }),
        caseView('c2', { patientId: 'p2', name: 'Bo Lindqvist', procedure: 'hysterectomy', plannedIn: 30000 }),
        caseView('c3', { patientId: 'p3', name: 'Chidi Okeke', procedure: 'prostatectomy', plannedIn: 20000 }),
      ],
    }),
    robot: dockedRobot('transverse'),
  })
  st.bays[1].patientId = 'p3'
  st.bays[1].since = 100
  st.bays[4].patientId = 'p1'
  st.bays[4].since = 200
  return st
}

const cleanup: (() => void)[] = []
afterEach(() => {
  while (cleanup.length) cleanup.pop()!()
})

describe('registering the tiles', () => {
  it('registers the five tiles at the contract indexes with the screens\' anchors, and removes them again', () => {
    const st = busy()
    const off = registerSurgeryTiles({ state: () => st, now: () => 1200 })
    cleanup.push(off)
    const reg = surgeryTiles()
    expect(reg.size).toBe(5)
    // R3: the anaesthesia monitor is a live patient monitor (src/scene/monitors); its index stays reserved and unregistered
    expect(reg.has(KIT_TILE.anaesthesia)).toBe(false)
    for (const [name, index] of Object.entries(KIT_TILE)) {
      if (index === KIT_TILE.anaesthesia) continue
      const t = reg.get(index)!
      expect(t, name).toBeDefined()
      expect(t.anchor, name).toBe(KIT_SCREENS[name as keyof typeof KIT_TILE])
      expect(typeof t.version()).toBe('number')
      expect(index).toBeLessThan(KIT_TILE_COUNT)
    }
    off()
    expect(reg.size).toBe(0)
    cleanup.length = 0
  })

  it('has atlas screens at the 320 x 200 tile\'s 1.6 : 1 aspect', () => {
    for (const a of Object.values(KIT_SCREENS)) expect(a.w / a.h).toBeCloseTo(1.6, 6)
    expect(W / H).toBeCloseTo(1.6, 6)
  })

  it('shows up in the atlas rig: five quads placed, painted once, quiet until the theatre changes', () => {
    let state = busy()
    let now = 1200
    cleanup.push(registerSurgeryTiles({ state: () => state, now: () => now }))
    const painted: number[] = []
    const texture = { needsUpdate: false, dispose() {} }
    const atlas: StatusAtlas = { texture, paint: (i, p) => void painted.push(p === null ? -1 : i) }
    const rig = createStatusRig({ atlas, tiles: surgeryTiles })
    rig.step({ generation: 0, now: 0 })
    const five = Object.values(KIT_TILE).filter((i) => i !== KIT_TILE.anaesthesia).sort()
    expect(rig.shown().sort()).toEqual(five)
    expect(painted.sort()).toEqual(five)
    painted.length = 0
    // nothing changed: no repaint, however long it runs
    for (let k = 1; k <= 20; k++) rig.step({ generation: 0, now: k * 0.25 })
    // (the console clocks tick: only those repaint)
    expect(painted.filter((i) => i !== KIT_TILE.consoleSurgeon && i !== KIT_TILE.consoleTeach)).toEqual([])
    // the theatre changes: the version moves and the tiles repaint
    painted.length = 0
    state = busy()
    state.theatre.version += 1
    state.bays[2].patientId = 'p2'
    rig.step({ generation: 0, now: 30 })
    expect(painted).toContain(KIT_TILE.pacuBoard)
    expect(painted).toContain(KIT_TILE.preOpBoard)
    now += 0
    rig.dispose()
  })

  it('uploads the atlas at most twice a second however often tiles repaint', () => {
    const st = busy()
    let t = 0
    cleanup.push(registerSurgeryTiles({ state: () => st, now: () => t }))
    let uploads = 0
    const texture = {
      dispose() {},
      set needsUpdate(v: boolean) {
        if (v) uploads++
      },
    }
    const atlas: StatusAtlas = { texture: texture as StatusAtlas['texture'], paint: () => undefined }
    const rig = createStatusRig({ atlas, tiles: surgeryTiles })
    for (let f = 0; f < 600; f++) {
      t = f / 60
      rig.step({ generation: 0, now: f / 60 })
    }
    expect(uploads).toBeLessThanOrEqual(Math.ceil(10 / STATUS_UPLOAD) + 1)
    expect(uploads).toBeGreaterThan(3)
    rig.dispose()
  })
})

describe('the helpers', () => {
  it('finds the case in the theatre and the next one not yet begun', () => {
    const st = busy()
    expect(currentCase(st)!.id).toBe('c1')
    expect(nextCase(st)!.id).toBe('c3') // planned earlier than c2
    st.theatre.caseId = null
    expect(currentCase(st)).toBeNull()
    expect(nextCase({ ...st, theatre: { ...st.theatre, cases: [] } })).toBeNull()
  })

  it('writes clocks and stopwatches', () => {
    expect(stopwatch(0)).toBe('0:00')
    expect(stopwatch(59)).toBe('0:59')
    expect(stopwatch(600.9)).toBe('10:00')
    expect(stopwatch(-5)).toBe('0:00')
    expect(clockText(0)).toMatch(/^\d\d:\d\d$/)
    const h = hourAt(3600)
    expect(clockText(3600)).toBe(`${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`)
  })

  it('counts the console clock from the console phase\'s start, and only inside it', () => {
    const st = busy()
    expect(consoleSeconds(st, 1600)).toBe(600)
    st.theatre.phase = 'docking'
    expect(consoleSeconds(st, 1600)).toBeNull()
  })

  it('names the patient in a bay, or nobody', () => {
    const st = busy()
    expect(bayPatient(st, st.bays[4])).toBe('Ana Costa')
    expect(bayPatient(st, st.bays[5])).toBe('')
  })

  it('cuts a long line to fit with an ellipsis, and leaves a short one alone', () => {
    const c = logCtx().ctx
    expect(fitText(c, 'short', 12, 200)).toBe('short')
    const cut = fitText(c, 'a very long line of words that cannot possibly fit', 12, 100)
    expect(cut.endsWith('…')).toBe(true)
    expect(cut.length).toBeLessThan(20)
  })

  it('splits a line of copy into its sentences', () => {
    expect(sentences('One. Two three. Four.')).toEqual(['One.', 'Two three.', 'Four.'])
    expect(sentences('No stop')).toEqual(['No stop'])
  })

  it('hashes values to a version that moves when any of them does', () => {
    expect(versionOf(1, 2, 3)).toBe(versionOf(1, 2, 3))
    expect(versionOf(1, 2, 3)).not.toBe(versionOf(1, 2, 4))
    expect(versionOf(1, 2)).not.toBe(versionOf(2, 1))
  })
})

describe('the console panels', () => {
  it('show the procedure, the theatre phase, the robot phase, the console clock and, once docked, the insufflation', () => {
    const st = busy()
    const l = logCtx()
    paintConsole(l.ctx, W, H, st, 1600, false)
    expect(l.texts).toContain(SURGERY_COPY.procedures.cholecystectomy.short)
    expect(l.texts).toContain(SURGERY_COPY.phases.console)
    expect(l.texts).toContain(SURGERY_COPY.robotPhases.docked)
    expect(l.texts).toContain(SURGERY_UI.console.clock)
    expect(l.texts).toContain('10:00')
    expect(l.texts).toContain(`12 ${SURGERY_UI.console.mmHg}`)
    expect(l.texts).toContain(SURGERY_UI.console.insufflation)
  })

  it('shows the teaching console\'s own title and its "view only · Simulated" line', () => {
    const l = logCtx()
    paintConsole(l.ctx, W, H, busy(), 1600, true)
    expect(l.texts).toContain(SURGERY_UI.console.title)
    expect(l.texts).toContain(SURGERY_UI.console.subtitle)
    expect(SURGERY_UI.console.subtitle).toContain('Simulated')
  })

  it('shows a dash for the clock and no insufflation before the robot is docked', () => {
    const st = surgeryState({ theatre: theatre('induction', { cases: [caseView('c1')] }), robot: stowedRobot() })
    const l = logCtx()
    paintConsole(l.ctx, W, H, st, 100, false)
    expect(l.texts).toContain('–')
    expect(l.texts.some((t) => t.includes(SURGERY_UI.console.mmHg))).toBe(false)
    expect(l.texts).toContain(SURGERY_COPY.phases.induction)
  })

  it('has a version that moves with the console clock (each second of the console phase), the phase, and the robot, and holds still otherwise', () => {
    const st = busy()
    const v = consoleVersion(st, 1600)
    expect(consoleVersion(st, 1600.4)).toBe(v)
    expect(consoleVersion(st, 1601.2)).not.toBe(v)
    const other = busy()
    other.robot.phase = 'targeting'
    expect(consoleVersion(other, 1600)).not.toBe(v)
    const idle = surgeryState()
    expect(consoleVersion(idle, 10)).toBe(consoleVersion(idle, 500))
  })
})

describe('the circulator\'s desk', () => {
  it('shows the case in the room with its patient, procedure, phase and robot phase; or the next case\'s standby line when the room is free', () => {
    const l = logCtx()
    paintCirculator(l.ctx, W, H, busy(), 1200)
    expect(l.texts).toContain('Ana Costa')
    // (the full name is cut to fit the tile: the first words are there)
    expect(l.texts.some((t) => t.startsWith('Robotic cholecystectomy'))).toBe(true)
    expect(l.texts).toContain(SURGERY_COPY.phases.console)
    expect(l.texts).toContain(SURGERY_COPY.robotPhases.docked)
    const free = busy()
    free.theatre.caseId = null
    free.theatre.phase = 'idle'
    const f = logCtx()
    paintCirculator(f.ctx, W, H, free, 1200)
    expect(f.texts).toContain(SURGERY_UI.panel.empty.room)
    expect(f.texts.some((t) => t.startsWith('Next:'))).toBe(true)
    expect(f.texts).toContain('The robot is not docked yet.')
    const none = surgeryState()
    const n = logCtx()
    paintCirculator(n.ctx, W, H, none, 1200)
    expect(n.texts).toContain('The robot is not docked yet.')
    expect(n.texts).toContain('No more cases today.')
  })

  it('has a version that moves with the theatre, the robot and the minute', () => {
    const st = busy()
    const v = circulatorVersion(st, 1200)
    expect(circulatorVersion(st, 1230)).toBe(v)
    expect(circulatorVersion(st, 1290)).not.toBe(v)
    st.theatre.version++
    expect(circulatorVersion(st, 1200)).not.toBe(v)
  })
})

describe('the PACU and pre-op boards', () => {
  it('list the bays: its number, who is in it and for how long; the empty line when nobody is', () => {
    const st = busy()
    const l = logCtx()
    paintPacuBoard(l.ctx, W, H, st, 1260)
    expect(l.texts).toContain(SURGERY_UI.panel.pacu.title)
    expect(l.texts).toContain('Bay 1')
    expect(l.texts).toContain('Bay 3')
    expect(l.texts).toContain('Ana Costa')
    expect(l.texts).toContain('18 min')
    expect(l.texts).not.toContain(SURGERY_UI.panel.pacu.empty)
    const p = logCtx()
    paintPreOpBoard(p.ctx, W, H, st, 1260)
    expect(p.texts).toContain(SURGERY_UI.panel.preOp.title)
    expect(p.texts).toContain('Bay 4')
    expect(p.texts).toContain('Chidi Okeke')
    const empty = logCtx()
    paintPacuBoard(empty.ctx, W, H, surgeryState(), 1260)
    expect(empty.texts).toContain(SURGERY_UI.panel.pacu.empty)
  })

  it('moves its version when a patient comes or goes, or a minute passes', () => {
    const st = busy()
    const v = boardVersion(st, 1260)
    expect(boardVersion(st, 1280)).toBe(v)
    expect(boardVersion(st, 1330)).not.toBe(v)
    st.bays[5].patientId = 'p2'
    expect(boardVersion(st, 1260)).not.toBe(v)
  })
})
