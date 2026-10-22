import { describe, expect, it } from 'vitest'
import { SeatRegistry } from '../seats'
import type { SeatSpec } from '../types'
import { bayOrder, ErDepartment, newCase, type ErCase } from './department'
import { PorterBoard } from './porterBoard'

function seat(id: string, kind: SeatSpec['kind'], x: number, z: number): SeatSpec {
  return { id, kind, area: kind === 'erBay' ? 'er' : 'triage', x, z, heading: 0, pose: kind === 'erBay' ? 'lie' : 'sit', height: 0.4, approach: { x, z: z - 1 } }
}

function dept() {
  const seats = new SeatRegistry([
    ...[0, 1, 2, 3, 4, 5].map((i) => seat(`erBay:bay:${i}`, 'erBay', -60 + i * 3, 20)),
    ...[0, 1, 2, 3].map((i) => seat(`triageBay:bay:${i}`, 'triageBay', -60 + i * 4, -20)),
    seat('triageBay:desk:0', 'triageBay', -61, -13),
  ])
  return { seats, d: new ErDepartment(seats) }
}

let n = 0
function patient(d: ErDepartment, o: Partial<ErCase> & { acuity: number; arrivedAt: number }): ErCase {
  const c = newCase({ id: `p${++n}`, name: 'X', reason: 'r', ambulance: false, from: { x: -50, z: 6 }, ...o })
  Object.assign(c, o)
  d.add(c)
  return c
}

describe('ErDepartment: bays', () => {
  it('has six ER bays and four triage bays (the desk chairs are not bays)', () => {
    const { d } = dept()
    expect(d.bays).toHaveLength(6)
    expect(d.triageBays).toHaveLength(4)
  })

  it('hands the next bay to the most urgent patient, then the one who arrived first', () => {
    const { d } = dept()
    for (const b of d.bays.slice(0, 5)) {
      b.state = 'occupied'
      b.caseId = 'busy'
    }
    const low = patient(d, { acuity: 5, arrivedAt: 10, state: 'waitingDoctor', ready: true })
    const mid = patient(d, { acuity: 3, arrivedAt: 20, state: 'waitingDoctor', ready: true })
    const midLater = patient(d, { acuity: 3, arrivedAt: 30, state: 'waitingDoctor', ready: true })
    expect(d.assignBays(100)).toEqual([mid])
    expect(low.bay).toBe(-1)
    expect(midLater.bay).toBe(-1)
  })

  it('an ambulance patient with acuity 1-2 takes the next bay before anyone waiting, even a walk-in acuity 3', () => {
    const { d } = dept()
    for (const b of d.bays.slice(0, 5)) {
      b.state = 'occupied'
      b.caseId = 'busy'
    }
    const walkIn = patient(d, { acuity: 3, arrivedAt: 1, state: 'waitingDoctor', ready: true })
    const amb = patient(d, { acuity: 2, ambulance: true, arrivedAt: 500, state: 'waitingDoctor', ready: true })
    expect(d.assignBays(600)).toEqual([amb])
    expect(walkIn.bay).toBe(-1)
    expect(bayOrder(amb, walkIn)).toBeLessThan(0)
  })

  it('a priority 1-2 walk-in is critical: no triage queue, and they take the next bay before a waiting priority 3', () => {
    const { d } = dept()
    for (const b of d.bays.slice(0, 5)) {
      b.state = 'occupied'
      b.caseId = 'busy'
    }
    const waiting = patient(d, { acuity: 3, arrivedAt: 1, state: 'waitingDoctor', ready: true })
    const critical = patient(d, { acuity: 1, arrivedAt: 900, state: 'waitingDoctor', ready: true })
    expect(critical.critical).toBe(true)
    expect(waiting.critical).toBe(false)
    expect(d.assignBays(1000)).toEqual([critical])
  })

  it('an ambulance with acuity 3 does not jump the queue', () => {
    const { d } = dept()
    for (const b of d.bays.slice(0, 5)) b.state = 'occupied'
    const walkIn = patient(d, { acuity: 3, arrivedAt: 1, state: 'waitingDoctor', ready: true })
    const amb = patient(d, { acuity: 3, ambulance: true, arrivedAt: 500, state: 'waitingDoctor', ready: true })
    expect(d.assignBays(600)).toEqual([walkIn])
    expect(amb.bay).toBe(-1)
  })

  it('does not assign to patients who are not ready, and picks the nearest free bay', () => {
    const { d } = dept()
    const away = patient(d, { acuity: 2, arrivedAt: 1, state: 'waitingDoctor', ready: false })
    expect(d.assignBays(5)).toEqual([])
    expect(away.bay).toBe(-1)
    away.ready = true
    away.from = { x: -45, z: 6 }
    d.assignBays(6)
    expect(away.bay).toBe(5) // the bay with the largest x is nearest to x = -45
  })

  it('walks a bay through free -> occupied -> needsCleaning -> free and never gives it away while dirty', () => {
    const { d, seats } = dept()
    for (const b of d.bays.slice(1)) {
      b.state = 'occupied'
      b.caseId = 'busy'
    }
    const a = patient(d, { acuity: 3, arrivedAt: 1, state: 'waitingDoctor', ready: true, from: { x: -60, z: 6 } })
    d.assignBays(10)
    expect(d.bays[0].state).toBe('occupied')
    expect(seats.occupant(d.bays[0].seat.id)).toBe(a.id)
    d.vacate(a, 100)
    expect(d.bays[0].state).toBe('needsCleaning')
    expect(seats.occupant(d.bays[0].seat.id)).toBeNull()
    const b = patient(d, { acuity: 1, arrivedAt: 50, state: 'waitingDoctor', ready: true })
    expect(d.assignBays(110)).toEqual([])
    expect(b.bay).toBe(-1)
    const bay = d.claimClean('cleaner-1')!
    expect(bay).toBe(d.bays[0])
    expect(d.claimClean('cleaner-2')).toBeNull()
    d.finishClean(bay, 160)
    expect(bay.state).toBe('free')
    expect(d.maxCleanWait).toBe(60)
    expect(d.assignBays(161)).toEqual([b])
  })

  it('claims cleaning jobs oldest first', () => {
    const { d } = dept()
    d.bays[2].state = 'needsCleaning'
    d.bays[2].since = 50
    d.bays[4].state = 'needsCleaning'
    d.bays[4].since = 20
    expect(d.claimClean('a')!.index).toBe(4)
    expect(d.claimClean('b')!.index).toBe(2)
  })

  it('a doctor takes the most urgent patient whose trolley is ready, and nobody twice', () => {
    const { d } = dept()
    const a = patient(d, { acuity: 4, arrivedAt: 1, state: 'inBay.waitingExam', onTrolley: true, trolleyAt: 10 })
    const b = patient(d, { acuity: 2, arrivedAt: 2, state: 'inBay.waitingExam', onTrolley: true, trolleyAt: 20 })
    const c = patient(d, { acuity: 2, arrivedAt: 3, state: 'inBay.waitingExam', onTrolley: true, trolleyAt: 15 })
    patient(d, { acuity: 1, arrivedAt: 4, state: 'inBay.walking', onTrolley: false })
    expect(d.claimExam('doc1')).toBe(c)
    expect(d.claimExam('doc2')).toBe(b)
    expect(d.claimExam('doc1')).toBe(a)
    expect(d.claimExam('doc2')).toBeNull()
  })

  it('escorts walk-ins with a bay promised, oldest first, and leaves ambulance patients to the paramedics', () => {
    const { d } = dept()
    const w1 = patient(d, { acuity: 4, arrivedAt: 1, state: 'inBay.walking', ready: true, bay: 2 })
    const w2 = patient(d, { acuity: 3, arrivedAt: 2, state: 'inBay.walking', ready: true, bay: 3 })
    patient(d, { acuity: 2, ambulance: true, arrivedAt: 3, state: 'inBay.walking', ready: true, bay: 4 })
    patient(d, { acuity: 3, arrivedAt: 4, state: 'waitingDoctor', ready: true, bay: -1 })
    expect(d.claimEscort('n1')).toBe(w2) // acuity 3 before 4
    expect(d.claimEscort('n2')).toBe(w1)
    expect(d.claimEscort('n1')).toBeNull()
  })
})

describe('ErDepartment: handovers and outcomes', () => {
  it('offers an ambulance handover to one nurse, once the patient is on the trolley', () => {
    const { d } = dept()
    const a = patient(d, { acuity: 2, ambulance: true, arrivedAt: 1, state: 'inBay.waitingExam', onTrolley: false })
    expect(d.claimHandover('n1')).toBeNull()
    a.onTrolley = true
    a.trolleyAt = 5
    expect(d.claimHandover('n1')).toBe(a)
    expect(d.claimHandover('n2')).toBeNull()
  })

  it('records each outcome once', () => {
    const { d } = dept()
    const a = patient(d, { acuity: 3, arrivedAt: 1 })
    d.finish(a, 'discharged', 100)
    d.finish(a, 'admitted', 101)
    expect(d.finished).toEqual([{ id: a.id, outcome: 'discharged', acuity: 3, ambulance: false, arrivedAt: 1, endedAt: 100 }])
  })
})

describe('ErDepartment: triage', () => {
  it('calls the patient who has waited longest into a free bay of the nurse, and reserves the chair', () => {
    const { d, seats } = dept()
    const first = patient(d, { acuity: 5, arrivedAt: 1, state: 'waitingTriage', ready: true, readyAt: 30 })
    const second = patient(d, { acuity: 1, arrivedAt: 2, state: 'waitingTriage', ready: true, readyAt: 40 })
    const r1 = d.claimTriage('t1', [0, 1])!
    expect(r1.c).toBe(first)
    expect(r1.bay.index).toBe(0)
    expect(seats.occupant('triageBay:bay:0')).toBe(first.id)
    const r2 = d.claimTriage('t1', [0, 1])!
    expect(r2.c).toBe(second)
    expect(r2.bay.index).toBe(1)
    expect(d.claimTriage('t1', [0, 1])).toBeNull()
    d.releaseTriageBay(first)
    expect(d.triageBays[0].state).toBe('free')
    expect(seats.occupant('triageBay:bay:0')).toBeNull()
  })

  it('does not call patients who are not seated yet', () => {
    const { d } = dept()
    patient(d, { acuity: 3, arrivedAt: 1, state: 'waitingTriage', ready: false })
    expect(d.claimTriage('t1', [0, 1, 2, 3])).toBeNull()
  })
})

describe('PorterBoard', () => {
  it('serves admissions first and everything else first come, first served', () => {
    const b = new PorterBoard()
    const j1 = b.request('toDiagnostics', 'a', 1)
    const j2 = b.request('fromDiagnostics', 'b', 2)
    const j3 = b.request('admit', 'c', 3)
    const j4 = b.request('admit', 'd', 4)
    expect(b.pending).toBe(4)
    expect(b.claim('p1')).toBe(j3)
    expect(b.claim('p2')).toBe(j4)
    expect(b.claim('p3')).toBe(j1)
    expect(b.claim('p3')).toBe(j2)
    expect(b.claim('p3')).toBeNull()
    b.complete(j3)
    expect(j3.done).toBe(true)
    expect(b.history).toHaveLength(4)
  })
})

describe('ErDepartment: the nurse\'s care and the doctor\'s review', () => {
  it('the care goes to the most urgent patient on a trolley, once, and an ambulance patient only after the handover', () => {
    const { d } = dept()
    const a = patient(d, { acuity: 4, arrivedAt: 1, state: 'inBay.waitingCare', onTrolley: true, trolleyAt: 10 })
    const b = patient(d, { acuity: 2, arrivedAt: 5, state: 'inBay.waitingCare', onTrolley: true, trolleyAt: 20 })
    const amb = patient(d, { acuity: 1, ambulance: true, arrivedAt: 2, state: 'inBay.waitingCare', onTrolley: true, trolleyAt: 5 })
    expect(d.claimCare('n1')).toBe(b) // the ambulance patient's handover is not done
    expect(b.careBy).toBe('n1')
    amb.handover = 'done'
    expect(d.claimCare('n2')).toBe(amb)
    expect(d.claimCare('n1')).toBe(a)
    expect(d.claimCare('n1')).toBeNull()
  })

  it('the doctor sees assessments only once the care is done, and reviews only patients whose results are in', () => {
    const { d } = dept()
    patient(d, { acuity: 3, arrivedAt: 1, state: 'inBay.care', onTrolley: true })
    expect(d.claimExam('d1')).toBeNull()
    const ready = patient(d, { acuity: 3, arrivedAt: 2, state: 'inBay.waitingExam', onTrolley: true, trolleyAt: 1 })
    const waitingResults = patient(d, { acuity: 1, arrivedAt: 2, state: 'tests.awaitingResults', onTrolley: true })
    const review = patient(d, { acuity: 3, arrivedAt: 3, state: 'inBay.waitingReview', onTrolley: true, trolleyAt: 2 })
    expect(d.claimReview('d1')).toBe(review)
    expect(d.claimReview('d2')).toBeNull()
    expect(d.claimExam('d2', 2)).toBeNull() // nobody at priority 1-2 is waiting for an assessment
    expect(d.claimExam('d2')).toBe(ready)
    expect(waitingResults.doctorId).toBeNull()
  })
})
