import { describe, expect, it } from 'vitest'
import { HOSTS, NIGHT_STAFF, STAFF } from '@/content/staff'
import { CONFIG } from '../config'
import { AREAS, HANDOVER, NURSE_HUB, ROOMS, areaAt, roomById } from '../places'
import { Rng } from '../rng'
import { isNightHour, isNight, isQuietHour, isCafeOpen, onShift, onShiftAt, ROTA, safetyHuddle, shiftChanges, shiftOf, timeOfClockHour, visitingOpen, handoverPairs, nightRounds, nightCheckSpot, wardChangeTimeline, inHours, rotaOf } from './roster'
import { kitOf } from './kits'
import { LOCKER_SPOTS, LOCKER_WAIT, meetSpot, validStand } from './spots'
import type { World } from '../er/world'

describe('hours', () => {
  it('wraps midnight for the night hours and the night shift', () => {
    expect(inHours([19, 7], 23)).toBe(true)
    expect(inHours([19, 7], 3)).toBe(true)
    expect(inHours([19, 7], 12)).toBe(false)
    expect(inHours([7, 19], 7)).toBe(true)
    expect(inHours([7, 19], 19)).toBe(false)
    expect(inHours([0, 24], 13)).toBe(true)
    // hours past 24 are the next morning
    expect(inHours([7, 19], 31.5)).toBe(true)
  })

  it('isNight follows CONFIG.day.nightHours (22:00 to 06:30)', () => {
    expect(isNight(22)).toBe(true)
    expect(isNight(23.5)).toBe(true)
    expect(isNight(2)).toBe(true)
    expect(isNight(6.4)).toBe(true)
    expect(isNight(6.5)).toBe(false)
    expect(isNight(12)).toBe(false)
    expect(isNight(21.9)).toBe(false)
    expect(isNightHour(23)).toBe(true)
  })

  it('the quiet hour is 13:00-14:00', () => {
    expect(isQuietHour(13)).toBe(true)
    expect(isQuietHour(13.99)).toBe(true)
    expect(isQuietHour(14)).toBe(false)
    expect(isQuietHour(12.9)).toBe(false)
  })

  it('the café is open 07:00-20:00 and visiting runs from 07:30 to 20:30', () => {
    expect(isCafeOpen(6.9)).toBe(false)
    expect(isCafeOpen(7)).toBe(true)
    expect(isCafeOpen(19.99)).toBe(true)
    expect(isCafeOpen(20)).toBe(false)
    expect(isCafeOpen(23)).toBe(false)
    expect(visitingOpen(7.4)).toBe(false)
    expect(visitingOpen(12)).toBe(true)
    expect(visitingOpen(CONFIG.day.visitorsLeaveByHour)).toBe(false)
  })
})

describe('the rota', () => {
  it('knows every member of every roster', () => {
    for (const m of [...STAFF, ...NIGHT_STAFF, ...HOSTS]) {
      if (m.role === 'paramedic') continue
      expect(rotaOf(m.id), m.id).toBeDefined()
      expect(shiftOf(m.id)).toBe(m.shift)
    }
    expect(() => onShift('nobody', 12)).toThrow()
    expect(() => shiftOf('nobody')).toThrow()
  })

  it('day nurses and ward doctors work 07-19, the night nurses and the on-call doctor 19-07', () => {
    expect(onShift('nurse-A1', 7)).toBe(true)
    expect(onShift('nurse-A1', 18.9)).toBe(true)
    expect(onShift('nurse-A1', 19)).toBe(false)
    expect(onShift('nurse-A1', 23)).toBe(false)
    expect(onShift('nurse-N-A', 23)).toBe(true)
    expect(onShift('nurse-N-A', 3)).toBe(true)
    expect(onShift('nurse-N-A', 12)).toBe(false)
    expect(onShift('doc-A', 8)).toBe(true)
    expect(onShift('doc-A', 18)).toBe(true)
    expect(onShift('doc-A', 19)).toBe(false)
    expect(onShift('doc-N', 2)).toBe(true)
    expect(onShift('host-A', 12)).toBe(true)
  })

  it('the ER runs around the clock: night duty keeps one doctor, one ER nurse and one triage nurse on', () => {
    for (const h of [0, 3, 6.9, 12, 19, 22.5]) {
      expect(onShift('doc-ER2', h), `doc-ER2 at ${h}`).toBe(true)
      expect(onShift('nurse-ER2', h)).toBe(true)
      expect(onShift('nurse-T2', h)).toBe(true)
      expect(onShift('rad-CT', h)).toBe(true)
      expect(onShift('rad-XR', h)).toBe(true)
    }
    expect(onShift('doc-ER1', 12)).toBe(true)
    // the whole ER team works the evening peak (18:00-22:00), then the night footing begins
    expect(onShift('doc-ER1', 21.5)).toBe(true)
    expect(onShift('nurse-ER1', 21.5)).toBe(true)
    expect(onShift('nurse-T1', 21.5)).toBe(true)
    expect(onShift('doc-ER1', 22)).toBe(false)
    expect(onShift('doc-ER1', 22.5)).toBe(false)
    expect(onShift('nurse-ER1', 22.5)).toBe(false)
    expect(onShift('nurse-T1', 3)).toBe(false)
    expect(onShift('doc-ER1', 7)).toBe(true)
    // two porters at night: the night porter and the second day porter on night duty
    expect(onShiftAt(23).filter((m) => m.role === 'porter').map((m) => m.id).sort()).toEqual(['porter-2', 'porter-N'])
    expect(onShiftAt(12).filter((m) => m.role === 'porter')).toHaveLength(3)
    expect(onShift('rad-MRI', 7.9)).toBe(false)
    expect(onShift('rad-MRI', 8)).toBe(true)
    expect(onShift('rad-MRI', 18)).toBe(false)
    expect(onShift('sono-1', 20)).toBe(false)
  })

  it('there is somebody at work in every post at every hour (the ER and transport never close)', () => {
    for (let h = 0; h < 24; h += 0.25) {
      const on = onShiftAt(h).map((m) => m.id)
      expect(on.some((id) => ['doc-ER1', 'doc-ER2'].includes(id)), `ER doctor at ${h}`).toBe(true)
      expect(on.some((id) => ['nurse-ER1', 'nurse-ER2'].includes(id)), `ER nurse at ${h}`).toBe(true)
      expect(on.some((id) => ['nurse-T1', 'nurse-T2'].includes(id)), `triage at ${h}`).toBe(true)
      expect(on.includes('recep-1'), `reception at ${h}`).toBe(true)
      expect(on.some((id) => ['porter-1', 'porter-2', 'porter-3', 'porter-N'].includes(id)), `porter at ${h}`).toBe(true)
      expect(on.some((id) => ['cleaner-1', 'cleaner-2', 'cleaner-N'].includes(id)), `cleaner at ${h}`).toBe(true)
      expect(on.some((id) => ['nurse-A1', 'nurse-A2', 'nurse-N-A'].includes(id)), `ward A nurse at ${h}`).toBe(true)
      expect(on.some((id) => ['nurse-B1', 'nurse-B2', 'nurse-N-B'].includes(id)), `ward B nurse at ${h}`).toBe(true)
      expect(on.includes('coord-1'), `coordinator at ${h}`).toBe(true)
    }
  })
})

describe('shift changes', () => {
  // from the first minute of the simulated day to just after 07:00 the next morning (31.0)
  const day = shiftChanges(CONFIG.day.startHour, 31.5)

  it('19:00: the night porter and night cleaner relieve; 22:00: the ER day team hands over to the colleague who stays; 07:00 mirrors both', () => {
    const at = (h: number) => day.filter((c) => c.hour === h)
    // 19:00: relief pairs, and the coordinator who goes home
    expect(at(19).find((c) => c.leaver?.member.id === 'porter-1')?.kind).toBe('relief')
    expect(at(19).find((c) => c.leaver?.member.id === 'porter-1')?.comer?.member.id).toBe('porter-N')
    expect(at(19).find((c) => c.leaver?.member.id === 'cleaner-1')?.comer?.member.id).toBe('cleaner-N')
    expect(at(19).find((c) => c.leaver?.member.id === 'coord-2')?.kind).toBe('leave')
    // the ward change: the first day nurse of a ward hands over to the night nurse, the second goes home; doc-A hands over to the on-call doctor
    expect(at(19).find((c) => c.leaver?.member.id === 'nurse-A1')?.kind).toBe('relief')
    expect(at(19).find((c) => c.leaver?.member.id === 'nurse-A1')?.comer?.member.id).toBe('nurse-N-A')
    expect(at(19).find((c) => c.leaver?.member.id === 'nurse-B1')?.comer?.member.id).toBe('nurse-N-B')
    expect(at(19).find((c) => c.leaver?.member.id === 'doc-A')?.comer?.member.id).toBe('doc-N')
    expect(at(19).map((c) => c.leaver?.member.id).sort()).toEqual(['cleaner-1', 'coord-2', 'doc-A', 'doc-B', 'nurse-A1', 'nurse-A2', 'nurse-B1', 'nurse-B2', 'porter-1'])
    // 22:00 (the night footing begins): the ER doctor, ER nurse and triage nurse hand over to the colleague who stays
    for (const [leaver, stayer] of [['doc-ER1', 'doc-ER2'], ['nurse-ER1', 'nurse-ER2'], ['nurse-T1', 'nurse-T2']]) {
      const c = at(22).find((x) => x.leaver?.member.id === leaver)
      expect(c?.kind, leaver).toBe('leaveStayer')
      expect(c?.stayer?.member.id).toBe(stayer)
    }
    // the third porter and the second cleaner go home with nobody to hand to (the second porter is on night duty)
    for (const id of ['porter-3', 'cleaner-2']) expect(at(22).find((c) => c.leaver?.member.id === id)?.kind, id).toBe('leave')
    expect(at(22).map((c) => c.leaver?.member.id).sort()).toEqual(['cleaner-2', 'doc-ER1', 'nurse-ER1', 'nurse-T1', 'porter-3'])
    // 07:00 (the next morning, 31.0): the mirror image
    expect(at(31).find((c) => c.comer?.member.id === 'doc-ER1')?.kind).toBe('comeStayer')
    expect(at(31).find((c) => c.comer?.member.id === 'porter-1')?.kind).toBe('relief')
    expect(at(31).map((c) => c.comer?.member.id).sort()).toEqual(['cleaner-1', 'cleaner-2', 'coord-2', 'doc-A', 'doc-B', 'doc-ER1', 'nurse-A1', 'nurse-A2', 'nurse-B1', 'nurse-B2', 'nurse-ER1', 'nurse-T1', 'porter-1', 'porter-3'])
    // 08:00 and 18:00: the imaging office hours
    expect(at(8).map((c) => c.comer?.member.id).sort()).toEqual(['rad-MRI', 'sono-1'])
    expect(at(18).map((c) => c.leaver?.member.id).sort()).toEqual(['rad-MRI', 'sono-1'])
  })

  it('everybody who arrives also leaves: over two days every come has a later leave and they alternate', () => {
    const two = shiftChanges(0, 48)
    for (const r of ROTA) {
      if (r.post === null) continue
      const mine = two.filter((c) => c.comer === r || c.leaver === r).sort((a, b) => a.hour - b.hour)
      for (let i = 1; i < mine.length; i++) {
        expect(mine[i].comer === r, `${r.member.id} alternates at ${mine[i].hour}`).not.toBe(mine[i - 1].comer === r)
      }
      // somebody who works a fixed shift has both a come and a leave
      const fixed = r.hours.every((w) => !(w[0] === 0 && w[1] === 24))
      if (fixed) {
        expect(mine.some((c) => c.comer === r), `${r.member.id} comes`).toBe(true)
        expect(mine.some((c) => c.leaver === r), `${r.member.id} leaves`).toBe(true)
      }
    }
  })

  it('a relief pair shares a post; everybody else has a post of their own', () => {
    const keys = new Map<string, string[]>()
    for (const r of ROTA) if (r.post) keys.set(`${r.post.kind}:${r.post.index}`, [...(keys.get(`${r.post.kind}:${r.post.index}`) ?? []), r.member.id])
    for (const [k, ids] of keys) {
      if (ids.length === 1) continue
      // two people on one post only when one is the other's relief
      expect(ids.length, k).toBe(2)
      expect(rotaOf(ids[0])!.partner, k).toBe(ids[1])
    }
  })
})

describe('where a shift change stands', () => {
  it('the lockers, their waiting spots and every post and meet spot are walkable and out of every doorway', () => {
    for (const s of [...LOCKER_SPOTS, ...LOCKER_WAIT]) expect(validStand(s.at.x, s.at.z), `locker spot ${s.at.x},${s.at.z}`).toBe(true)
    for (const r of ROTA) {
      if (r.post === null || r.post.kind === 'imaging' || r.post.kind === 'command') continue
      const post = kitOf(r.post.kind).post(null as unknown as World, r)
      expect(validStand(post.at.x, post.at.z), `${r.member.id} post`).toBe(true)
      const meet = meetSpot(post)
      expect(validStand(meet.at.x, meet.at.z), `${r.member.id} meet`).toBe(true)
      expect(Math.hypot(meet.at.x - post.at.x, meet.at.z - post.at.z), `${r.member.id} meet distance`).toBeGreaterThan(0.5)
    }
  })

  it('the lockers are in the staff room', () => {
    for (const s of LOCKER_SPOTS) expect(areaAt(s.at.x, s.at.z)?.id).toBe('staffA')
    expect(AREAS.some((a) => a.id === 'staffA')).toBe(true)
  })
})

describe('the ward staff API', () => {
  it('the morning safety huddle is the 4 minutes after 07:33 at each nurse hub', () => {
    for (const ward of ['A', 'B'] as const) {
      const h = safetyHuddle(ward)
      expect(h.startT).toBeCloseTo(timeOfClockHour(CONFIG.day.safetyHuddle.atHour), 6)
      expect(h.endT - h.startT).toBe(CONFIG.day.safetyHuddle.seconds)
      expect(h.spots).toBe(NURSE_HUB[ward])
    }
  })

  it('every ward has eight bedside handover pairs, inside their own rooms', () => {
    for (const ward of ['A', 'B'] as const) {
      const pairs = handoverPairs(ward)
      expect(pairs).toHaveLength(8)
      for (const p of pairs) {
        expect(areaAt(p.outgoing.at.x, p.outgoing.at.z)?.id).toBe(`room:${p.roomId}`)
        expect(areaAt(p.incoming.at.x, p.incoming.at.z)?.id).toBe(`room:${p.roomId}`)
        expect([p.outgoing, p.incoming]).toEqual(HANDOVER[p.roomId])
      }
    }
  })

  it('a ward change is timed from the hour: arrive early, change, huddle, then the bedside rounds', () => {
    const d = CONFIG.day
    for (let seed = 1; seed <= 20; seed++) {
      const at = timeOfClockHour(19)
      const t = wardChangeTimeline(19, new Rng(seed))
      expect(at - t.arriveT).toBeGreaterThanOrEqual(d.arriveEarlySeconds[0])
      expect(at - t.arriveT).toBeLessThanOrEqual(d.arriveEarlySeconds[1])
      expect(t.lockersDoneT).toBeGreaterThan(t.arriveT)
      expect(t.huddleStartT).toBeGreaterThanOrEqual(at)
      expect(t.huddleEndT - t.huddleStartT).toBeGreaterThanOrEqual(d.huddleSeconds[0])
      expect(t.huddleEndT - t.huddleStartT).toBeLessThanOrEqual(d.huddleSeconds[1])
      expect(t.bedsideStartT).toBeGreaterThan(t.huddleEndT)
      expect(t.bedsideSeconds).toBeGreaterThanOrEqual(d.bedsideHandoverSeconds[0])
      expect(t.bedsideSeconds).toBeLessThanOrEqual(d.bedsideHandoverSeconds[1])
    }
  })

  it('the night nurse checks every room every two hours from 22:30 to 04:30, from just inside the door', () => {
    const rounds = nightRounds('A', timeOfClockHour(7), timeOfClockHour(31))
    expect(rounds.map((r) => r.startT)).toEqual([22.5, 24.5, 26.5, 28.5].map((h) => timeOfClockHour(h)))
    for (const r of rounds) {
      expect(r.checks).toHaveLength(8)
      expect(r.checks.every((c) => c.seconds === CONFIG.day.nightCheckSeconds)).toBe(true)
      for (const c of r.checks) {
        const room = roomById(c.roomId)
        expect(room.ward).toBe('A')
        expect(c.spot.at).toEqual(room.doorInside)
        expect(nightCheckSpot(c.roomId)).toEqual(c.spot)
        expect(areaAt(c.spot.at.x, c.spot.at.z)?.id).toBe(`room:${c.roomId}`)
      }
    }
    // none by day
    expect(nightRounds('B', timeOfClockHour(8), timeOfClockHour(20))).toEqual([])
    expect(ROOMS.length).toBe(16)
  })
})
