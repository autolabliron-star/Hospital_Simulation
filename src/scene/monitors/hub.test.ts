/**
 * The hub and its pump, against a fake world and a recording uploader: the standby faces painted once; a new patient's row filled and then shown;
 * a hot monitor's next sweep painted chunk by chunk ONLY where the screen does not show that slot; cold monitors repeating their sweeps and refreshing
 * their numbers every 5 s; the budget; one model per patient for a PACU bay and the central station; a Jump resetting everything; every copy inside
 * the atlas, the last of a run regenerating the mipmaps.
 */
import { describe, expect, it } from 'vitest'
import { caseView, surgeryState, theatre } from '@/scene/surgery/testkit'
import type { Region } from './atlas'
import { COLD_NUMBERS, MonitorHub } from './hub'
import { GAP, LAYOUT_IDS, SWEEP } from './layouts'
import { entryOf, sweepAt } from './sweep'
import { erCase, fakeWorld, realDefs, recCtx, recUploader, type Copy, type FakeWorld } from './testkit'

function setup(w: FakeWorld = fakeWorld()) {
  const rec = recCtx()
  const hub = new MonitorHub(realDefs(), w.env, { sheet: rec.ctx })
  const up = recUploader()
  hub.attach(up)
  return { hub, up, rec, w }
}

const inside = (c: Copy, r: Region): boolean => c.dx >= r.x && c.dy >= r.y && c.dx + c.w <= r.x + r.w && c.dy + c.h <= r.y + r.h

/** Step the display clock by `seconds` in frames of 1/60 s, pumping every 0.5 s. Calls `each` after every pump with the copies it made. */
function run(hub: MonitorHub, up: ReturnType<typeof recUploader>, seconds: number, each?: (copies: Copy[], t: number) => void): void {
  let sincePump = 0
  for (let f = 0; f < seconds * 60; f++) {
    hub.clock.advance(1 / 60, false)
    sincePump += 1 / 60
    if (sincePump >= 0.5) {
      sincePump = 0
      const before = up.copies.length
      hub.pump(Infinity)
      each?.(up.copies.slice(before), hub.clock.t)
    }
  }
}

describe('the monitor hub', () => {
  it('paints the standby faces and the station\'s title bar once at warm-up, all inside the atlas, the last copy with mipmaps', () => {
    const { hub, up } = setup()
    hub.warm()
    // one standby face per distinct picture (the pre-op monitor shares the bedside one), and the station's title bar
    expect(up.copies.length).toBe(new Set(Object.values(hub.plan.idle)).size + 1)
    expect(new Set(Object.values(hub.plan.idle)).size).toBe(LAYOUT_IDS.length - 1)
    for (const id of LAYOUT_IDS) expect(up.copies.some((c) => c.dx === hub.plan.idle[id].x && c.dy === hub.plan.idle[id].y)).toBe(true)
    for (const c of up.copies) {
      expect(c.dx + c.w).toBeLessThanOrEqual(hub.plan.width)
      expect(c.dy + c.h).toBeLessThanOrEqual(hub.plan.height)
    }
    expect(up.copies.map((c) => c.mips)).toEqual([...up.copies.slice(0, -1).map(() => false), true])
    // nobody anywhere: every row shows the standby face
    for (const m of hub.monitors) for (const r of m.rows) expect(r.live).toBe(false)
  })

  it('fills a new patient\'s row (statics, labels, both sweep slots) before showing it, and shows the standby face again when they leave', () => {
    const { hub, up, w } = setup()
    hub.warm()
    w.er.bays[2].caseId = 'e1'
    w.er.cases.set('e1', erCase('e1', 2, { acuity: 2, name: 'Rosa Lindgren', trolleyAt: w.simT - 120 }))
    hub.clock.advance(0.05, false)
    const before = up.copies.length
    hub.pump(Infinity)
    const m = hub.monitors.find((x) => x.def.id === 'er:2')!
    expect(m.rows[0].live).toBe(true)
    expect(m.rows[0].numbers.name).toBe('Rosa Lindgren')
    const mine = up.copies.slice(before)
    // every static, every label slot and both sweep slots of the three bands
    for (const r of m.regions.statics) expect(mine.some((c) => inside(c, r))).toBe(true)
    for (const b of m.regions.bands) {
      expect(mine.some((c) => inside(c, b.label))).toBe(true)
      expect(mine.filter((c) => inside(c, b.entries[0]) && c.w === b.entries[0].w)).toHaveLength(1)
      expect(mine.filter((c) => inside(c, b.entries[1]) && c.w === b.entries[1].w)).toHaveLength(1)
    }
    expect(m.bands.map((b) => b.wave)).toEqual(['ecg', 'pleth', 'resp'])
    // the other ER monitors stay on standby
    expect(hub.monitors.filter((x) => x.def.id.startsWith('er:') && x.rows[0].live)).toHaveLength(1)
    // they leave: standby again, and the model is gone
    w.er.bays[2].caseId = null
    hub.pump(Infinity)
    expect(m.rows[0].live).toBe(false)
    expect(hub.models.size).toBe(0)
  })

  it('a hot monitor paints its next sweep chunk by chunk, never over columns the screen shows', () => {
    const { hub, up, w } = setup()
    hub.warm()
    w.er.bays[4].caseId = 'e9'
    w.er.cases.set('e9', erCase('e9', 4))
    const m = hub.monitors.find((x) => x.def.id === 'er:4')!
    w.you = { x: m.def.anchor.x, z: m.def.anchor.z + 1.5 }
    hub.clock.advance(1, false)
    hub.pump(Infinity)
    expect(m.hot).toBe(true)
    let chunks = 0
    const at = { k: 0, c: 0 }
    run(hub, up, 60, (copies, t) => {
      m.layout.bands.forEach((spec, b) => {
        const reg = m.regions.bands[b]
        sweepAt(t, m.phase, SWEEP[spec.speed], spec.w, at)
        for (const c of copies) {
          for (const e of [0, 1] as const) {
            const r = reg.entries[e]
            if (!inside(c, r) || c.w === r.w) continue
            chunks++
            const x0 = c.dx - r.x
            const x1 = x0 + c.w
            if (e === entryOf(at.k)) {
              // this sweep's slot: only columns the cursor has not reached
              expect(x0, `band ${b} t ${t}`).toBeGreaterThanOrEqual(Math.floor(at.c))
            } else {
              // the slot shown right of the erase bar: only columns already wiped (left of the bar's far edge)
              expect(x1, `band ${b} t ${t}`).toBeLessThanOrEqual(Math.floor(at.c + GAP))
            }
          }
        }
      })
    })
    // about a chunk per band per pump (the slow band's chunks are smaller and as frequent)
    expect(chunks).toBeGreaterThan(100)
    // and the slots keep up: every band holds this sweep and paints the next
    for (const bs of m.bands) expect(bs.sweep.every((k) => Number.isFinite(k))).toBe(true)
  })

  it('a cold monitor repeats its sweeps (no new slots) and repaints its numbers every 5 s', () => {
    const { hub, up, w } = setup()
    hub.warm()
    w.er.bays[0].caseId = 'e2'
    w.er.cases.set('e2', erCase('e2', 0))
    hub.clock.advance(1, false)
    hub.pump(Infinity)
    const m = hub.monitors.find((x) => x.def.id === 'er:0')!
    expect(m.hot).toBe(false)
    const numbers = m.regions.statics[1]
    let slotCopies = 0
    let numberCopies = 0
    run(hub, up, 30, (copies) => {
      for (const c of copies) {
        for (const b of m.regions.bands) if (inside(c, b.entries[0]) || inside(c, b.entries[1])) slotCopies++
        if (inside(c, numbers)) numberCopies++
      }
    })
    expect(slotCopies).toBe(0)
    expect(numberCopies).toBeGreaterThanOrEqual(Math.floor(30 / COLD_NUMBERS) - 1)
    expect(numberCopies).toBeLessThanOrEqual(Math.ceil(30 / COLD_NUMBERS) + 1)
  })

  it('a focused room makes its monitors hot', () => {
    const { hub, w } = setup()
    hub.warm()
    w.focus = 'er'
    hub.pump(Infinity)
    expect(hub.monitors.filter((m) => m.hot).map((m) => m.def.id)).toEqual(['er:0', 'er:1', 'er:2', 'er:3', 'er:4', 'er:5'])
  })

  it('keeps to its budget: a run stops after the job that crosses it, and the rest is painted on the next runs', () => {
    const { hub, w } = setup()
    hub.warm()
    for (let i = 0; i < 6; i++) {
      w.er.bays[i].caseId = `b${i}`
      w.er.cases.set(`b${i}`, erCase(`b${i}`, i))
    }
    // every look at the clock costs 0.6 ms: a 1.5 ms budget allows about two fills per run
    const ms = { t: 0 }
    w.env.nowMs = () => (ms.t += 0.6)
    hub.clock.advance(1, false)
    hub.pump()
    const live1 = hub.monitors.filter((m) => m.def.id.startsWith('er:') && m.rows[0].live).length
    expect(live1).toBeGreaterThanOrEqual(1)
    expect(live1).toBeLessThan(6)
    for (let k = 0; k < 6; k++) hub.pump()
    expect(hub.monitors.filter((m) => m.def.id.startsWith('er:') && m.rows[0].live)).toHaveLength(6)
  })

  it('shows a recovering patient on their bay and on the central station from ONE model (same beats, same numbers)', () => {
    const st = surgeryState({ theatre: theatre('idle', { cases: [caseView('c1', { patientId: 'p1', name: 'Ana Costa', procedure: 'hysterectomy' })] }) })
    st.bays.find((b) => b.seatId === 'surgeryBed:pacu:1')!.patientId = 'p1'
    st.bays.find((b) => b.seatId === 'surgeryBed:pacu:1')!.since = 3000
    const { hub, w } = setup(fakeWorld(st))
    hub.warm()
    hub.clock.advance(20, false)
    hub.pump(Infinity)
    const bay = hub.monitors.find((m) => m.def.id === 'pacu:1')!
    const station = hub.monitors.find((m) => m.def.id === 'pacu:station')!
    expect(bay.rows[0].live).toBe(true)
    expect(station.rows.map((r) => r.live)).toEqual([false, true, false])
    expect(hub.models.size).toBe(1)
    expect(station.rows[1].model).toBe(bay.rows[0].model)
    expect(station.rows[1].numbers.hr).toBe(bay.rows[0].numbers.hr)
    expect(station.rows[1].numbers.name).toBe('Ana Costa')
    // the HR shown is counted from the beats, near the target
    expect(Math.abs(bay.rows[0].numbers.hr - bay.rows[0].model!.vit.hr)).toBeLessThan(8)
    void w
  })

  it('a Jump (a new sim generation) resets every row and every model', () => {
    const { hub, w } = setup()
    hub.warm()
    w.er.bays[1].caseId = 'j1'
    w.er.cases.set('j1', erCase('j1', 1))
    hub.pump(Infinity)
    const m = hub.monitors.find((x) => x.def.id === 'er:1')!
    const model = m.rows[0].model
    expect(m.rows[0].live).toBe(true)
    w.gen++
    hub.pump(Infinity)
    expect(m.rows[0].live).toBe(true)
    expect(m.rows[0].model).not.toBe(model)
    expect(hub.models.size).toBe(1)
  })

  it('in theatre: the arterial line for the prostatectomy, the capnogram, and every copy inside the atlas', () => {
    const st = surgeryState({ theatre: theatre('console', { cases: [caseView('c1', { patientId: 'p7', name: 'Chidi Okeke', procedure: 'prostatectomy', wheelsIn: 2000, dockedAt: 2600 })] }) })
    const { hub, up, w } = setup(fakeWorld(st))
    hub.warm()
    w.focus = 'l2Or'
    run(hub, up, 15)
    const or = hub.monitors[0]
    expect(or.def.id).toBe('or')
    expect(or.rows[0].live).toBe(true)
    expect(or.bands.map((b) => b.wave)).toEqual(['ecg', 'art', 'pleth', 'co2'])
    expect(or.rows[0].numbers.art).toBe(true)
    expect(or.rows[0].numbers.ventilated).toBe(true)
    for (const c of up.copies) {
      expect(c.dx).toBeGreaterThanOrEqual(0)
      expect(c.dy).toBeGreaterThanOrEqual(0)
      expect(c.dx + c.w).toBeLessThanOrEqual(hub.plan.width)
      expect(c.dy + c.h).toBeLessThanOrEqual(hub.plan.height)
    }
  })
})
