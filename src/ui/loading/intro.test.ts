import { describe, expect, it } from 'vitest'
import { enterHospital, holdSim, introFlags, type IntroPorts } from './intro'

/** The sim, the world store, audio and the gate, as fakes. `publishNow` publishes to the listeners at once, like the real loop does. */
function fakes() {
  const listeners = new Set<(s: { paused: boolean }) => void>()
  const log: string[] = []
  const sim = {
    paused: false,
    publishNow() {
      log.push(`publish paused=${sim.paused}`)
      for (const l of [...listeners]) l({ paused: sim.paused })
    },
  }
  const state = { entered: false }
  const ports: IntroPorts = {
    sim,
    world: {
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    audio: { unlock: () => log.push('audio unlock') },
    gate: {
      enter: () => {
        state.entered = true
        log.push('entered')
      },
      entered: () => state.entered,
    },
  }
  return { ports, sim, state, log, listeners }
}

describe('?skipIntro', () => {
  it('is only the explicit flag; ?present and ?probe change nothing', () => {
    expect(introFlags('').skipIntro).toBe(false)
    expect(introFlags('?present=1').skipIntro).toBe(false)
    expect(introFlags('?probe=1&present=1').skipIntro).toBe(false)
    expect(introFlags('?skipIntro=1').skipIntro).toBe(true)
    expect(introFlags('?present=1&skipIntro=1&probe=1').skipIntro).toBe(true)
    expect(introFlags('?skipIntro=true').skipIntro).toBe(true)
    expect(introFlags('?skipIntro=0').skipIntro).toBe(false)
  })
})

describe('holding the day until Enter', () => {
  it('pauses the sim at once', () => {
    const f = fakes()
    holdSim(f.ports)
    expect(f.sim.paused).toBe(true)
  })

  it('puts the pause back when something unpauses it before Enter (the Space key, the HUD button)', () => {
    const f = fakes()
    holdSim(f.ports)
    f.sim.paused = false // togglePause()
    f.sim.publishNow()
    expect(f.sim.paused).toBe(true)
  })

  it('stops holding once the presenter is in, and never fights the stop function', () => {
    const f = fakes()
    const stop = holdSim(f.ports)
    enterHospital(f.ports, { gesture: true })
    expect(f.sim.paused).toBe(false)
    f.sim.paused = true // the presenter pauses on purpose, later
    f.sim.publishNow()
    expect(f.sim.paused).toBe(true)
    f.sim.paused = false
    f.sim.publishNow()
    expect(f.sim.paused).toBe(false)
    stop()
    expect(f.listeners.size).toBe(0)
  })
})

describe('Enter', () => {
  it('unlocks audio (a click or key is a gesture), then starts the day and marks the gate', () => {
    const f = fakes()
    holdSim(f.ports)
    f.log.length = 0
    enterHospital(f.ports, { gesture: true })
    expect(f.log).toEqual(['audio unlock', 'entered', 'publish paused=false'])
    expect(f.sim.paused).toBe(false)
    expect(f.state.entered).toBe(true)
  })

  it('does not touch audio when it is not a gesture (?skipIntro=1): the browser would refuse it', () => {
    const f = fakes()
    holdSim(f.ports)
    enterHospital(f.ports, { gesture: false })
    expect(f.log).not.toContain('audio unlock')
    expect(f.sim.paused).toBe(false)
  })

  it('is idempotent: a second click does nothing', () => {
    const f = fakes()
    holdSim(f.ports)
    enterHospital(f.ports, { gesture: true })
    f.log.length = 0
    enterHospital(f.ports, { gesture: true })
    expect(f.log).toEqual([])
  })
})
