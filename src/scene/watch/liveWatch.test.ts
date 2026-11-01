/**
 * R5 wave 3: the watch camera on the LIVE simulation, a whole step-by-step case of each of the five new procedures (the CT suite's kidney, lung and liver,
 * the ultrasound room's breast cancer and fibroadenoma), at 60 Hz from "watch" to the hand-back. The shots tests prove every step from where the script puts
 * the team; this proves it with the people really walking (the sim's own team, the porter, the patient on the CT table riding into the bore): the camera is
 * never in a person, in the furniture or the cradle, or out of its room, once a move has settled; no frame is not a number; every step is shown, each
 * room by its own shots; the case ends and the director hands the camera back.
 */
import { describe, expect, it } from 'vitest'
import { getLayout } from '@/scene/building/layout'
import { CONFIG } from '@/sim/config'
import { areaById } from '@/sim/places'
import { Simulation } from '@/sim/Simulation'
import type { ProcedureId } from '@/sim/types'
import { PROCEDURE_META, scriptFor } from '@/content/procedures'
import { PERSON_RADIUS, insideObstacle, moveObstacle } from './limits'
import { ENDED_HOLD_SECONDS } from './director'
import { roomCart, roomObstacles, roomOfProcedure, roomPort, roomView, type WatchRoomId, type WatchSim } from './rooms'
import { SHOTS, shotsOfRoom } from './shots'
import { harness } from './testkit'

const CASES: readonly ProcedureId[] = ['cryo-kidney', 'cryo-lung', 'cryo-liver', 'us-breastCancer', 'us-fibroadenoma']
const DT = CONFIG.sim.step
/** A watch case lasts 10-15 minutes in the room (CONFIG.procedure.watchTotalSeconds): the arrival and the way out are on top. */
const HORIZON_SECONDS = 20 * 60

/** The shots each room's cases show somewhere (every shot of the CT suite is used by every cryoablation, the ultrasound room's by both ProSense cases). */
const EXPECTED: Record<'cryo' | 'us', string[]> = {
  cryo: ['ct.establish', 'ct.table', 'ct.head', 'ct.turn', 'ct.needle', 'ct.robot', 'ct.ice', 'ct.iceBig', 'ct.console', 'ct.bore', 'ct.boreCt', 'ct.plan', 'ct.planBig'],
  us: ['us.establish', 'us.field', 'us.fieldUs', 'us.fieldUsBig', 'us.prosense'],
}

describe.each(CASES)('the watch camera on a live %s', (id) => {
  const room = roomOfProcedure(id) as 'cryo' | 'us'
  it('shows every step with its own room\'s shots, never in a person, the furniture or the CT table, and hands the camera back at the end', { timeout: 300_000 }, () => {
    const sim = new Simulation(7, { startHour: 10, inFlight: false })
    const w = sim as unknown as WatchSim
    const h = harness({ sim: w })
    h.clock.speed = 1
    expect(['started', 'queued']).toContain(roomPort(w, room)!.start(id))
    expect(h.director.begin({ room, mode: 'watch', procedureId: id })).toBe(true)
    const view = roomView(w, room as WatchRoomId)!
    const obstacles = roomObstacles(room, getLayout().footprints)
    const shots = new Map<string, number>()
    const steps = new Set<number>()
    const statuses: string[] = []
    let settled = 0
    let inObstacle = 0
    let onPerson = 0
    let outOfRoom = 0
    let notANumber = 0
    let ended = -1
    for (let i = 0; i < Math.round(HORIZON_SECONDS / DT); i++) {
      sim.step(DT)
      h.director.update(DT)
      if (h.director.phase === 'off') {
        ended = i * DT
        break
      }
      if (statuses[statuses.length - 1] !== h.ui.status) statuses.push(h.ui.status as string)
      if (view.procedureId !== null && h.ui.status === 'case') steps.add(view.stepIndex)
      const sid = h.director.shotId
      if (sid !== null) shots.set(sid, (shots.get(sid) ?? 0) + 1)
      const e = h.director.pose.eye
      const t = h.director.pose.target
      if (![e.x, e.y, e.z, t.x, t.y, t.z].every(Number.isFinite)) notANumber++
      // a move that has landed (a dolly or a cut is flown through the room; it is the shot, held, that must be clear)
      if (h.director.moving || h.ui.status !== 'case' || sid === null || h.director.freeLook !== 'off') continue
      settled++
      if (room === 'cryo') {
        const c = roomCart(w, 'cryo')!
        moveObstacle(obstacles.obstacles, obstacles.cartSlot, c.x, c.z, c.heading)
      }
      const rect = areaById(SHOTS[sid].area).rect
      if (e.x < rect.x0 + 0.25 || e.x > rect.x1 - 0.25 || e.z < rect.z0 + 0.25 || e.z > rect.z1 - 0.25) outOfRoom++
      if (insideObstacle(obstacles.obstacles, e.x, e.y, e.z, 0, 0) >= 0) inObstacle++
      if (e.y < 1.95) {
        let near = false
        sim.entities.forEach((p, pid) => {
          if (pid === 'player' || p.anim === 'lie' || p.riding === true || (p.fade ?? 1) < 0.4) return
          if (p.position.x < rect.x0 - 0.5 || p.position.x > rect.x1 + 0.5 || p.position.z < rect.z0 - 0.5 || p.position.z > rect.z1 + 0.5) return
          if (Math.hypot(p.position.x - e.x, p.position.z - e.z) < PERSON_RADIUS - 0.02) near = true
        })
        if (near) onPerson++
      }
    }
    // the case ran to its end, was seen end to end (waiting for the patient, the case, its end), and the director gave the camera back
    expect(ended, 'the watch ended').toBeGreaterThan(0)
    expect(h.director.phase).toBe('off')
    expect(h.lease.held).toBe(false)
    // (the status only ever goes forward: waiting for the patient, the case, its end; a room that is free starts the case at once)
    expect(statuses.filter((s) => s !== 'waiting')).toEqual(['case', 'ended'])
    expect(statuses.indexOf('waiting') <= 0).toBe(true)
    expect(h.clock.speed).toBe(1)
    // every step of the script was shown (the cryoablations repeat a run of steps once per needle: more flat steps than script steps)
    expect(steps.size).toBeGreaterThanOrEqual(scriptFor(id)!.steps.length)
    for (let k = 0; k < scriptFor(id)!.steps.length; k++) expect(steps.has(k), `step ${k} was shown`).toBe(true)
    // each room's own shots, and (the cases are the same room's) all of them
    for (const sid of shots.keys()) expect(SHOTS[sid].room, sid).toBe(room)
    for (const sid of EXPECTED[room]) expect(shots.get(sid) ?? 0, `${sid} was used`).toBeGreaterThan(0)
    expect(shotsOfRoom(room).map((s) => s.id).sort()).toEqual([...EXPECTED[room]].sort()) // (no shot of the room is unused: a new one is listed here)
    // nothing was ever in the way once the camera had settled (a little slack for a person who steps into the lens between two frames)
    expect(settled).toBeGreaterThan(20000)
    expect(notANumber).toBe(0)
    expect(inObstacle / settled).toBeLessThan(0.005)
    expect(onPerson / settled).toBeLessThan(0.005)
    expect(outOfRoom / settled).toBeLessThan(0.005)
    // the case itself is the one the watch asked for, and the hand-back came after the case left, not before
    expect(PROCEDURE_META[id].machine).toBe(room === 'cryo' ? 'cryoCt' : 'prosense')
    expect(ended).toBeGreaterThan(ENDED_HOLD_SECONDS)
  })
})
