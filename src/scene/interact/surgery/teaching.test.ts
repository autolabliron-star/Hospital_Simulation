/**
 * Your session at the teaching console in node, with a fake environment: E sits you down on the console's seat, tells the sim you are teaching and opens the card;
 * you are posed in the crowd's 'console' pose while you sit; standing up (E, a move key), closing the card, leaving walk mode or a Jump ends it, clearing the
 * flag and the card; and it refuses a seat somebody holds or when you are not walking.
 */
import { describe, expect, it } from 'vitest'
import type { Entity, PlayerMode, SeatSpec } from '@/sim/types'
import { TEACH_SEAT, TeachingSession, type TeachingEnv, type TeachingSim } from './teaching'

const seatSpec: SeatSpec = { id: TEACH_SEAT, kind: 'console', area: 'l2Or', x: 104.65, z: 6.9, heading: -Math.PI / 2, pose: 'sit', height: 0.45, approach: { x: 105.25, z: 7.75 } }

function setup(over: { mode?: PlayerMode; occupant?: string | null; sitRefused?: boolean } = {}) {
  const log: string[] = []
  const avatar = { anim: 'idle' } as Entity
  const sim: TeachingSim = {
    player: { mode: over.mode ?? 'walk' },
    playerAvatar: avatar,
    seats: { byId: (id) => (id === TEACH_SEAT ? seatSpec : (() => { throw new Error(id) })()), occupant: () => over.occupant ?? null },
    surgery: { setTeaching: (on) => void log.push(`teaching:${on}`) },
  }
  const state = { sim, seat: null as SeatSpec | null, open: false, source: 'seat' as 'seat' | 'panel' }
  const env: TeachingEnv = {
    sim: () => state.sim,
    sitAt: (s) => {
      log.push(`sit:${s.id}`)
      if (over.sitRefused) return false
      state.seat = s
      return true
    },
    seatedOn: () => state.seat,
    standUp: () => {
      log.push('standUp')
      state.seat = null
    },
    card: {
      isOpen: () => state.open,
      source: () => state.source,
      show: (s) => {
        state.open = true
        state.source = s
        log.push(`card:${s}`)
      },
      close: () => {
        state.open = false
        log.push('card:close')
      },
    },
  }
  const session = new TeachingSession(env)
  return { session, state, log, avatar }
}

describe('sitting down at the teaching console', () => {
  it('sits you on the teaching seat, tells the sim you are teaching, opens the card, and poses you at the console', () => {
    const { session, log, avatar, state } = setup()
    session.press()
    expect(log).toEqual([`sit:${TEACH_SEAT}`, 'teaching:true', 'card:seat'])
    expect(session.active).toBe(true)
    // the interaction system poses you 'sit' every frame; the session puts the console pose over it
    avatar.anim = 'sit'
    session.tick()
    expect(avatar.anim).toBe('console')
    avatar.anim = 'sit'
    session.tick()
    expect(avatar.anim).toBe('console')
    expect(state.open).toBe(true)
  })

  it('refuses a seat somebody else holds, when you are not walking, and when the seat is refused', () => {
    for (const over of [{ occupant: 'surgeon-1' }, { mode: 'overview' as PlayerMode }, { mode: 'toWalk' as PlayerMode }]) {
      const { session, log } = setup(over)
      session.press()
      expect(log, JSON.stringify(over)).toEqual([])
      expect(session.active).toBe(false)
    }
    const refused = setup({ sitRefused: true })
    refused.session.press()
    expect(refused.log).toEqual([`sit:${TEACH_SEAT}`])
    expect(refused.session.active).toBe(false)
  })
})

describe('leaving', () => {
  it('ends when the interaction system stands you up (E or a move key): the flag and the card clear, and you are not left in the console pose', () => {
    const { session, log, state, avatar } = setup()
    session.press()
    session.tick()
    session.tick()
    state.seat = null // E, a move key or Tab stood you up
    avatar.anim = 'console'
    log.length = 0
    session.tick()
    expect(log).toEqual(['teaching:false', 'card:close'])
    expect(session.active).toBe(false)
    expect(avatar.anim).toBe('idle')
    // nothing more happens
    session.tick()
    expect(log).toHaveLength(2)
  })

  it('stands you up when the card is closed (Esc, its button), and clears the flag', () => {
    const { session, log, state } = setup()
    session.press()
    for (let i = 0; i < 4; i++) session.tick()
    state.open = false // Esc closed it
    log.length = 0
    session.tick()
    expect(log).toEqual(['standUp', 'teaching:false'])
    expect(session.active).toBe(false)
    expect(state.seat).toBeNull()
  })

  it('does not take a card that has not had a frame to open for a closed one', () => {
    const { session, log, state } = setup()
    session.press()
    state.open = false
    log.length = 0
    session.tick()
    expect(log).toEqual([])
    expect(session.active).toBe(true)
  })

  it('stands you up when you press E at the console again', () => {
    const { session, log } = setup()
    session.press()
    log.length = 0
    session.press()
    expect(log).toEqual(['standUp'])
  })

  it('ends when you leave walk mode', () => {
    const { session, log, state } = setup()
    session.press()
    session.tick()
    state.sim.player!.mode = 'overview'
    log.length = 0
    session.tick()
    expect(log).toEqual(['teaching:false', 'card:close'])
  })

  it('does not close a card that was opened from the OR panel (the panel\'s card is its own)', () => {
    const { session, log, state } = setup()
    session.press()
    session.tick()
    state.source = 'panel'
    state.seat = null
    log.length = 0
    session.tick()
    expect(log).toEqual(['teaching:false'])
    expect(state.open).toBe(true)
  })

  it('forgets everything on a Jump: the new hospital never saw you sit, and its flag is its own', () => {
    const { session, log, state } = setup()
    session.press()
    session.tick()
    state.sim = { ...state.sim, surgery: { setTeaching: (on) => void log.push(`new:${on}`) } }
    log.length = 0
    session.tick()
    expect(session.active).toBe(false)
    expect(log).toEqual(['card:close'])
  })
})
