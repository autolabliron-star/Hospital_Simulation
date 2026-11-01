/**
 * R5 wave 3: what the watch reads of each room, against the LIVE simulation (the structural `WatchSim` the app casts the sim to): the views, the CT table's
 * cradle, the ports' answers and the anchors that follow the CT suite's state.
 */
import { describe, expect, it } from 'vitest'
import { PROCEDURE_META } from '@/content/procedures'
import { CONFIG } from '@/sim/config'
import { CRYO_SUITE } from '@/sim/places'
import { Simulation } from '@/sim/Simulation'
import type { ProcedureId, WatchResult } from '@/sim/types'
import { anchorInto, newAnchorCtx, syncAnchorCtx, syncCryoAnchors } from './anchors'
import { CRADLE, proceduresOfRoom, roomCart, roomOfProcedure, roomPort, roomView, type WatchSim } from './rooms'

const RESULTS: readonly WatchResult[] = ['started', 'queued', 'following', 'noTeam', 'busy']

describe('the rooms of the watch, against the live simulation', () => {
  const sim = new Simulation(7, { startHour: 10, inFlight: false })
  const w = sim as unknown as WatchSim

  it('maps every procedure to its room, and every room to its procedures', () => {
    expect(proceduresOfRoom('or')).toEqual(['or-cholecystectomy', 'or-hysterectomy', 'or-prostatectomy'])
    expect(proceduresOfRoom('cryo')).toEqual(['cryo-kidney', 'cryo-lung', 'cryo-liver'])
    expect(proceduresOfRoom('us')).toEqual(['us-breastCancer', 'us-fibroadenoma'])
    for (const id of Object.keys(PROCEDURE_META) as ProcedureId[]) expect(proceduresOfRoom(roomOfProcedure(id))).toContain(id)
  })

  it('reads each room\'s own procedure view', () => {
    expect(roomView(w, 'or')).toBe(sim.surgery.state.procedure)
    expect(roomView(w, 'cryo')).toBe(sim.cryoSuite.state.procedure)
    expect(roomView(w, 'us')).toBe(sim.imaging.scanners.us.procedure)
    // three different objects, none of them a case yet
    expect(new Set([roomView(w, 'or'), roomView(w, 'cryo'), roomView(w, 'us')]).size).toBe(3)
  })

  it('the CT cradle follows the table\'s travel; the theatre\'s cart is the robot\'s; the ultrasound room has no moving machine', () => {
    const c = roomCart(w, 'cryo')!
    const t = CRYO_SUITE.ct.table
    expect(sim.cryoSuite.state.tablePos).toBe(0)
    expect(c.x).toBeCloseTo(t.out.x + CRADLE.dx, 9)
    expect(c.z).toBe(t.out.z)
    expect(c.heading).toBe(t.heading)
    const same = roomCart(w, 'cryo')
    expect(same).toBe(c) // one shared object, rewritten (nothing is allocated in a frame)
    expect(roomCart(w, 'or')).toBe(sim.surgery.state.robot.cart)
    expect(roomCart(w, 'us')).toBeNull()
  })

  it('every room has a port: it answers with a watch result, and says when the booked case starts (a number or null)', () => {
    for (const [room, id] of [['or', 'or-cholecystectomy'], ['cryo', 'cryo-kidney'], ['us', 'us-breastCancer']] as const) {
      const s = new Simulation(7, { startHour: 10, inFlight: false })
      const port = roomPort(s as unknown as WatchSim, room)!
      expect(port, room).not.toBeNull()
      expect(port.startsAt(), room).toBeNull()
      const r = port.start(id)
      expect(RESULTS, `${room}: ${r}`).toContain(r)
      const at = port.startsAt()
      expect(at === null || (typeof at === 'number' && at >= s.t - 1), room).toBe(true)
      expect(port.whyNoTeam() === null || port.whyNoTeam() === 'hours' || port.whyNoTeam() === 'late').toBe(true)
    }
  })

  it('the team out of hours answers noTeam, and the CT suite says why (the hours, not the time of day)', () => {
    const night = new Simulation(7, { startHour: 3, inFlight: false })
    const cryo = roomPort(night as unknown as WatchSim, 'cryo')!
    expect(cryo.start('cryo-kidney')).toBe('noTeam')
    expect(cryo.whyNoTeam()).toBe('hours')
    expect(roomPort(night as unknown as WatchSim, 'or')!.whyNoTeam()).toBeNull()
    expect(roomPort(night as unknown as WatchSim, 'us')!.start('us-breastCancer')).toBe('noTeam')
    expect(CONFIG.cryoSuite.teamFromHour).toBeGreaterThan(3)
  })

  it('the anchors follow the CT suite\'s state: the table\'s travel and the case\'s target', () => {
    const ctx = newAnchorCtx()
    const p = { x: 0, y: 0, z: 0 }
    const q = { x: 0, y: 0, z: 0 }
    syncAnchorCtx(ctx, sim.cryoSuite.state.procedure, sim.entities, null)
    syncCryoAnchors(ctx, sim.cryoSuite.state)
    anchorInto('ctRoom', ctx, p)
    expect(p.x).toBeCloseTo(CRYO_SUITE.ct.table.out.x, 9)
    syncCryoAnchors(ctx, { tablePos: 1, target: 'lung', needle: -1, needles: [] })
    anchorInto('ctRoom', ctx, q)
    expect(q.x).toBeCloseTo(CRYO_SUITE.ct.table.in.x, 9)
    anchorInto('ctField', ctx, p)
    expect(p.z).toBeCloseTo(CRYO_SUITE.targets.lung.tumour.z + CRYO_SUITE.targets.lung.field.z, 9)
  })
})
