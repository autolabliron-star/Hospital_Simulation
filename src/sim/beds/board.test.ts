import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { EventLog } from '../events'
import { MedSystem } from '../meds/system'
import { Simulation } from '../Simulation'
import type { RoomId } from '../types'
import type { BedBoard } from './board'

const DT = CONFIG.sim.step
const BEDS = CONFIG.beds

/** A hospital without the crowd, just to get a bed board; every bed starts occupied. */
function boardOnly(): { sim: Simulation; board: BedBoard } {
  const sim = new Simulation(5, { population: false })
  return { sim, board: sim.beds.board }
}

/** Empty a room and put it in a cleaning state with a known clean time (no person is moved: the rules are what is tested). */
function empty(board: BedBoard, room: RoomId, stage: 'ready' | 'needsCleaning', cleanSeconds = 400): void {
  board.warmSet(room, { stage, since: 0, person: null, record: null, clean: stage === 'needsCleaning' ? { seconds: cleanSeconds } : undefined })
}

describe('the bed manager', () => {
  it('assigns a ready bed at once, with no boarding, and never the same bed twice', () => {
    const { board } = boardOnly()
    empty(board, 'A3', 'ready')
    empty(board, 'B2', 'ready')
    const a = board.requestBed('c1', 'Test One', 0, 100)
    const b = board.requestBed('c2', 'Test Two', 1, 101)
    const c = board.requestBed('c3', 'Test Three', 2, 102)
    // the bed nearest the spine goes first (B2 is nearer to the lifts and the ER than A3)
    expect(a).toEqual({ roomId: 'B2', boarding: false })
    expect(b).toEqual({ roomId: 'A3', boarding: false })
    expect(c).toBeNull()
    expect(board.log.assigned.map((x) => x.roomId)).toEqual(['B2', 'A3'])
    expect(board.get('B2').reservation?.caseId).toBe('c1')
    expect(board.boardingNow).toBe(0)
    // the door tile shows the reservation (teal) with the incoming patient
    expect(board.life.rooms.get('B2')).toMatchObject({ bed: 'reserved', patientId: 'c1', patientName: 'Test One' })
  })

  it('reserves a bed that will be ready within the window and boards the patient; at most two bays board', () => {
    const { board } = boardOnly()
    empty(board, 'A1', 'needsCleaning', 300)
    empty(board, 'A2', 'needsCleaning', 600)
    empty(board, 'A3', 'needsCleaning', 700)
    const a = board.requestBed('c1', 'One', 0, 100)
    const b = board.requestBed('c2', 'Two', 1, 100)
    const c = board.requestBed('c3', 'Three', 2, 100)
    expect(a).toEqual({ roomId: 'A1', boarding: true })
    expect(b).toEqual({ roomId: 'A2', boarding: true })
    expect(c).toBeNull() // two bays already board: the third goes upstairs
    expect(board.boardingNow).toBe(BEDS.boardingMaxBays)
    expect(board.life.rooms.get('A1')?.boarding).toEqual({ bayId: expect.any(String), since: 100 })
  })

  it('does not reserve a bed that will not be ready within the window', () => {
    const { board } = boardOnly()
    empty(board, 'B4', 'needsCleaning', BEDS.reserveWindowSeconds + 300)
    expect(board.requestBed('c1', 'One', 0, 50)).toBeNull()
    expect(board.get('B4').reservation).toBeNull()
  })

  it('never offers a bed a patient still has, one that is being left, or one already promised', () => {
    const { board } = boardOnly()
    expect(board.requestBed('c1', 'One', 0, 10)).toBeNull() // all sixteen occupied
    empty(board, 'A5', 'ready')
    expect(board.requestBed('c2', 'Two', 0, 10)?.roomId).toBe('A5')
    expect(board.requestBed('c3', 'Three', 1, 11)).toBeNull()
    expect(board.log.violations).toEqual([])
  })

  it('gives up a boarding reservation after the boarding limit: the patient goes upstairs and the bed is free again', () => {
    const { board } = boardOnly()
    empty(board, 'A6', 'needsCleaning', 5000)
    // a bed that is ready in time, then the clean takes far longer than promised
    board.get('A6').clean!.seconds = 600
    const a = board.requestBed('c1', 'One', 0, 100)
    expect(a?.boarding).toBe(true)
    board.step(100 + BEDS.boardingMaxSeconds - 1)
    expect(board.get('A6').reservation).not.toBeNull()
    board.step(100 + BEDS.boardingMaxSeconds + 1)
    expect(board.get('A6').reservation).toBeNull()
    expect(board.boardingNow).toBe(0)
    expect(board.life.rooms.get('A6')?.bed).toBe('needsCleaning')
    expect(board.stats.longestBoardingSeconds).toBeGreaterThanOrEqual(BEDS.boardingMaxSeconds)
  })

  it('a room is cleaned (cleaning, then linen, then ready) before it can be assigned', () => {
    const { board } = boardOnly()
    empty(board, 'B7', 'needsCleaning', 400)
    const job = board.claimClean('cleaner-1', 10)!
    expect(job.roomId).toBe('B7')
    expect(board.get('B7').stage).toBe('needsCleaning') // the stage changes when the cleaner is in the room
    board.cleanStarted('B7', 20)
    expect(board.life.rooms.get('B7')?.bed).toBe('cleaning')
    expect(board.claimLinen()).toBe('B7')
    board.cleanFinished('B7', 420)
    expect(board.get('B7').stage).toBe('cleaning') // still waiting for the linen
    board.linenDelivered('B7', 440)
    expect(board.life.rooms.get('B7')?.bed).toBe('ready')
    expect(board.log.cleaned).toEqual([{ t: 440, roomId: 'B7' }])
  })

  it('one cleaner at a time takes a ward room, so the other stays free for the ER bays', () => {
    const { board } = boardOnly()
    empty(board, 'A1', 'needsCleaning')
    empty(board, 'A2', 'needsCleaning')
    expect(board.claimClean('cleaner-1', 5)).not.toBeNull()
    expect(board.claimClean('cleaner-2', 6)).toBeNull()
  })

  it('writes the room panel details and bumps the version only when something changed', () => {
    const { board } = boardOnly()
    const r = board.life.rooms.get('A2')!
    expect(r).toMatchObject({ patientName: 'Bruno Varga', patientAge: 58, patientReason: 'Heart failure, fluid check', dayOfStay: 3 })
    const v = r.version
    board.syncRoom(board.get('A2'))
    expect(r.version).toBe(v)
    empty(board, 'A2', 'ready')
    expect(r.version).toBeGreaterThan(v)
    expect(r.patientAge).toBeUndefined()
    expect(r.patientReason).toBeUndefined()
    expect(r.dayOfStay).toBeUndefined()
    expect(r.patientId).toBeNull()
  })

  it('stats include what the warm start already did', () => {
    const sim = new Simulation(5, { startHour: 15 })
    const s = sim.beds.stats
    expect(s.dischargesToday).toBe(5) // A1, B5, B4, A6 and B2 are gone by 15:00; A8 is yet to sign
    expect(s.dischargesBeforeNoon).toBe(2)
    expect(s.boardingNow).toBe(0)
  })
})

describe('medicines follow the patient in the bed', () => {
  function pipeline() {
    const log = new EventLog()
    const meds = new MedSystem(log, { name: (id) => id })
    let occupant: { id: string; name: string } | null = { id: 'pt-1', name: 'Ann Test' }
    meds.setOccupancy({ occupantOf: (room) => (room === 'A1' ? occupant : null) })
    let t = 0
    const run = (seconds: number) => {
      for (let i = 0, n = Math.round(seconds / DT); i < n; i++) {
        t += DT
        meds.step(DT, t)
      }
    }
    return { meds, run, setOccupant: (o: typeof occupant) => (occupant = o) }
  }

  it('refuses an order for an empty room', () => {
    const { meds } = pipeline()
    const r = meds.prescribe({ roomId: 'A2', items: [{ medId: 'paracetamol', qty: 1 }], prescriberId: 'doc', source: 'sim' })
    expect(r.ok).toBe(false)
  })

  it('takes the patient of the order from the bed, not the catalogue', () => {
    const { meds } = pipeline()
    const r = meds.prescribe({ roomId: 'A1', items: [{ medId: 'paracetamol', qty: 1 }], prescriberId: 'doc', source: 'sim' })
    expect(r.ok && r.order.patientId).toBe('pt-1')
  })

  it('cancels an order whose patient has left before it is checked or picked, and never gives a pod a pack for them', () => {
    const { meds, run, setOccupant } = pipeline()
    const r = meds.prescribe({ roomId: 'A1', items: [{ medId: 'paracetamol', qty: 1 }], prescriberId: 'doc', source: 'sim' })
    if (!r.ok) throw new Error(r.reason)
    setOccupant(null)
    run(60)
    expect(r.order.cancelledAt).toBeDefined()
    expect(r.order.stage).toBe('prescribed')
    expect(r.order.stageAt.picking).toBeUndefined()
    expect(r.order.podId).toBeUndefined()
  })

  it('an order for the previous patient is cancelled when the bed has a new one', () => {
    const { meds, run, setOccupant } = pipeline()
    const r = meds.prescribe({ roomId: 'A1', items: [{ medId: 'paracetamol', qty: 1 }], prescriberId: 'doc', source: 'sim' })
    if (!r.ok) throw new Error(r.reason)
    setOccupant({ id: 'pt-2', name: 'Bob Test' })
    run(60)
    expect(r.order.cancelledAt).toBeDefined()
  })

  it('a pod that arrives after the patient has gone does not load the drawer, and the drawer never holds the old patient\'s packs', () => {
    const { meds, run, setOccupant } = pipeline()
    const r = meds.prescribe({ roomId: 'A1', items: [{ medId: 'paracetamol', qty: 1 }], prescriberId: 'doc', source: 'sim' })
    if (!r.ok) throw new Error(r.reason)
    // let it get under way (verified, picked, on its way), then the patient leaves
    let guard = 0
    while (r.order.stage !== 'enRoute' && guard++ < 200) run(1)
    expect(r.order.stage).toBe('enRoute')
    setOccupant(null)
    run(180)
    expect(r.order.cancelledAt).toBeDefined()
    expect(meds.drawers.get('A1')!.state).toBe('empty')
    expect(meds.drawers.get('A1')!.orderIds).toEqual([])
  })

  it('releasing a room empties its drawer and cancels what was in it', () => {
    const { meds, run } = pipeline()
    const r = meds.prescribe({ roomId: 'A1', items: [{ medId: 'paracetamol', qty: 1 }], prescriberId: 'doc', source: 'sim', doseAt: 1e9 })
    if (!r.ok) throw new Error(r.reason)
    let guard = 0
    while (r.order.stage !== 'inDrawer' && guard++ < 400) run(1)
    expect(meds.drawers.get('A1')!.state).toBe('loaded')
    meds.releaseRoom('A1')
    expect(meds.drawers.get('A1')!.state).toBe('empty')
    expect(r.order.cancelledAt).toBeDefined()
  })
})
