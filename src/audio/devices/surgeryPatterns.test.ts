/**
 * The robotic OR's sounds, in node: every voice is sane, the edges (the docking chime and the endoscope note) fire once and never at load, the servos
 * follow the arms and the boom, the ventilator and the monitor sound only while a patient is under, everything that runs while something happens is
 * periodic on the audio clock (consecutive windows join with no gap and no repeat), and the pattern plugs into the registry.
 */
import { describe, expect, it, vi } from 'vitest'
import { SURGERY } from '@/sim/places'
import type { CasePhase, RobotArmState, RobotPhase, SurgeryState } from '@/sim/types'
import {
  ARM_MOVING_MAX,
  ARM_MOVING_MIN,
  BEEP_HZ,
  BEEP_OFFSET_S,
  BEEP_PERIOD_S,
  BOOM_HOLD_S,
  BOOM_SERVO_OFFSET_S,
  BREATH_PERIOD_S,
  BREATH_S,
  CART_SOUND_Y,
  DRIVING_PHASES,
  EDGE_FRESH_S,
  MONITOR_AT,
  SERVO_OFFSET_S,
  SERVO_PERIOD_S,
  SURGERY_SOUNDS,
  UNDER_PHASES,
  VENTILATOR_AT,
  createSurgeryPattern,
  devicePatterns,
  dockedChime,
  endoscopeNote,
  monitorBeep,
  servoWhine,
  ventilatorBreath,
} from './surgeryPatterns'
import { registerDevicePattern, devicePatterns as registered, type DeviceEvent, type DevicePattern, type DroneSpec, type PatternSink, type PlanWindow } from './registry'

// importing the pattern must not build the hospital: the live sim is loaded on the first plan, in the browser
vi.mock('@/sim', () => {
  throw new Error('the pattern must not load the sim at import')
})

type TheatrePhase = CasePhase | 'idle' | 'turnover'

function arm(i: 0 | 1 | 2 | 3, engage = 0): RobotArmState {
  return { index: i, instrument: '', port: null, drape: 1, engage, force: 0, exchanges: 0 }
}

/** A hand-made surgery state, mutated in place by the tests as the sim does. */
function surgery(o: { theatre?: TheatrePhase; robot?: RobotPhase; engage?: [number, number, number, number]; cart?: { x: number; z: number } } = {}): SurgeryState {
  const e = o.engage ?? [0, 0, 0, 0]
  return {
    theatre: { caseId: null, phase: o.theatre ?? 'idle', phaseSince: 0, phaseEnds: null, lights: false, surgeonAtConsole: false, teachingInUse: false, cases: [], kpis: { casesToday: 0, firstCaseOnTime: null, dockingMin: null, consoleMin: null, turnoverMin: null, pacuMin: null, utilisation: null }, version: 0 },
    robot: {
      phase: o.robot ?? 'stowed',
      cart: { x: o.cart?.x ?? SURGERY.cart.park.at.x, z: o.cart?.z ?? SURGERY.cart.park.at.z, heading: 0 },
      boomYaw: 0,
      boomHeight: 1.74,
      boomExtend: 0,
      laser: false,
      arms: [arm(0, e[0]), arm(1, e[1]), arm(2, e[2]), arm(3, e[3])],
      motionSeed: 1,
      phaseSince: 0,
      version: 0,
    },
    bays: [],
    version: 0,
  }
}

function sink(): PatternSink & { events: DeviceEvent[]; drones: DroneSpec[] } {
  const events: DeviceEvent[] = []
  const drones: DroneSpec[] = []
  return { events, drones, event: (e) => events.push(e), drone: (d) => drones.push({ ...d }) }
}

const win = (from: number, to: number, o: Partial<PlanWindow> = {}): PlanWindow => ({ from, to, now: from, simTime: 0, simSpeed: 1, listener: { x: 0, y: 1.6, z: 0 }, ...o })

/** Plan one window of `p`. */
function plan(p: DevicePattern, from: number, to: number, o: Partial<PlanWindow> = {}) {
  const s = sink()
  p.plan(win(from, to, o), s)
  return s
}

/** Plan [from, to) in steps of `step`, collecting everything. */
function run(p: DevicePattern, from: number, to: number, step = 0.05, o: Partial<PlanWindow> = {}) {
  const s = sink()
  const n = Math.round((to - from) / step)
  for (let i = 0; i < n; i++) p.plan(win(from + i * step, from + (i + 1) * step, o), s)
  return s
}

const byTime = (a: DeviceEvent, b: DeviceEvent): number => a.t - b.t || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || a.f0 - b.f0 || a.peak - b.peak
const sorted = (events: DeviceEvent[]): DeviceEvent[] => [...events].sort(byTime)

const UNDER: TheatrePhase[] = ['induction', 'positioning', 'ports', 'docking', 'console', 'undocking', 'closing', 'emergence']
const NOT_UNDER: TheatrePhase[] = ['idle', 'turnover', 'scheduled', 'arrived', 'preOp', 'toTheatre', 'in', 'out', 'pacu', 'phase2', 'leaving', 'done']

describe('the voices', () => {
  const cart = { x: 101, y: CART_SOUND_Y, z: 6 }
  const all: DeviceEvent[] = [...[0, 1, 2, 3, 4].flatMap((i) => servoWhine(0, i, cart)), ...dockedChime(0, cart), ...endoscopeNote(0, cart), ...ventilatorBreath(0), monitorBeep(0), ...ventilatorBreath(2.5, null)]

  it('every event has finite, polite numbers: a positive peak of at most 0.2, a positive duration, pitches between 150 Hz and 3 kHz, an attack shorter than the event', () => {
    for (const e of all) {
      expect(Number.isFinite(e.t)).toBe(true)
      expect(e.t).toBeGreaterThanOrEqual(0)
      expect(e.peak).toBeGreaterThan(0)
      expect(e.peak).toBeLessThanOrEqual(0.2)
      expect(e.dur).toBeGreaterThan(0)
      expect(Number.isFinite(e.f0) && Number.isFinite(e.f1)).toBe(true)
      expect(e.f0).toBeGreaterThan(150)
      expect(e.f1).toBeLessThan(3000)
      expect(e.attack).toBeGreaterThanOrEqual(0)
      expect(e.attack).toBeLessThan(e.dur)
    }
  })

  it('a servo whine is a rising 180..420 Hz sawtooth with a band of noise, and every arm sounds a little different', () => {
    for (let i = 0; i < 5; i++) {
      const [tone, hiss] = servoWhine(1, i, cart)
      expect(tone.kind).toBe('tone')
      expect(tone.kind === 'tone' && ['sawtooth', 'triangle'].includes(tone.wave)).toBe(true)
      expect(tone.f0).toBeGreaterThanOrEqual(180)
      expect(tone.f1).toBeLessThanOrEqual(420)
      expect(tone.f1).toBeGreaterThan(tone.f0) // rising
      expect(tone.peak).toBeLessThanOrEqual(0.06) // soft
      expect(hiss.kind).toBe('noise')
      expect(hiss.f1).toBeGreaterThan(hiss.f0)
      expect(tone.t).toBe(1)
      expect(tone.at).toEqual(cart)
    }
    expect(new Set([0, 1, 2, 3, 4].map((i) => servoWhine(0, i)[0].f0)).size).toBe(5)
    // an out-of-range index is clamped, not thrown
    expect(servoWhine(0, 9)).toEqual(servoWhine(0, 4))
    expect(servoWhine(0, -2)).toEqual(servoWhine(0, 0))
  })

  it('the docking chime is two rising sine notes, the endoscope note one short note', () => {
    const [a, b] = dockedChime(0)
    expect(dockedChime(0).length).toBe(2)
    expect(a.kind === 'tone' && a.wave).toBe('sine')
    expect(b.t).toBeGreaterThan(a.t)
    expect(b.f0).toBeGreaterThan(a.f0)
    const note = endoscopeNote(0)
    expect(note.length).toBe(1)
    expect(note[0].kind).toBe('tone')
    expect(note[0].dur).toBeLessThan(0.4)
  })

  it('the ventilator breath is two quiet bands of noise: one swells up for about 0.85 s, the next falls away for the same, 1.7 s in all', () => {
    const [rise, fall] = ventilatorBreath(10)
    expect(rise.kind).toBe('noise')
    expect(fall.kind).toBe('noise')
    expect(rise.t).toBe(10)
    expect(fall.t).toBeCloseTo(10 + BREATH_S / 2, 9)
    expect(rise.f1).toBeGreaterThan(rise.f0)
    expect(fall.f1).toBeLessThan(fall.f0)
    expect(rise.attack).toBeGreaterThan(0.5) // a slow swell
    expect(fall.attack).toBeLessThan(0.1)
    const end = Math.max(...[rise, fall].map((e) => e.t + e.dur))
    expect(end - 10).toBeGreaterThan(BREATH_S - 0.05)
    expect(end - 10).toBeLessThan(BREATH_S + 0.1)
    for (const e of [rise, fall]) expect(e.peak).toBeLessThanOrEqual(0.12)
    expect(rise.at).toEqual(VENTILATOR_AT)
  })

  it('the monitor beep is an 880 Hz sine for 60 ms, at most 0.1 loud', () => {
    const e = monitorBeep(3)
    expect(e.kind).toBe('tone')
    expect(e.kind === 'tone' && e.wave).toBe('sine')
    expect(e.f0).toBe(880)
    expect(e.f1).toBe(880)
    expect(BEEP_HZ).toBe(880)
    expect(e.dur).toBeCloseTo(0.06, 9)
    expect(e.peak).toBeLessThanOrEqual(0.1)
    expect(e.t).toBe(3)
    expect(e.at).toEqual(MONITOR_AT)
    expect(SURGERY_SOUNDS).toMatchObject({ servoWhine, dockedChime, endoscopeNote, ventilatorBreath, monitorBeep })
  })

  it('the ventilator and the monitor sit at the anaesthesia machine in sim coordinates on level 2, at the heights asked for', () => {
    const m = SURGERY.anaesthesia.machine.at
    expect(VENTILATOR_AT).toEqual({ x: m.x, y: 1.1, z: m.z })
    expect(MONITOR_AT).toEqual({ x: m.x, y: 1.3, z: m.z })
    expect(m.x).toBeGreaterThan(90) // level 2 is at sim x ~ 97..106: a listener on level 1 is out of earshot
    expect(m.x).toBeLessThan(110)
    expect(CART_SOUND_Y).toBe(1.4)
  })

  it('the arms offset their servos so no two ever sound together, the boom included, and the period is about half a second', () => {
    const offsets = [...SERVO_OFFSET_S, BOOM_SERVO_OFFSET_S].map((o) => o % SERVO_PERIOD_S)
    expect(new Set(offsets.map((o) => o.toFixed(6))).size).toBe(offsets.length)
    expect(SERVO_PERIOD_S).toBeGreaterThan(0.4)
    expect(SERVO_PERIOD_S).toBeLessThan(0.5)
    expect(BREATH_PERIOD_S).toBe(4.8)
    expect(BEEP_PERIOD_S).toBe(0.92)
  })
})

describe('a quiet theatre', () => {
  it('makes no sound at all: an idle theatre, a stowed robot, whatever the windows', () => {
    const p = createSurgeryPattern(() => surgery())
    const s = run(p, 0, 30)
    expect(s.events).toEqual([])
    expect(s.drones).toEqual([])
  })

  it('stays silent between cases (turnover, with the robot being cleaned) and before the patient is under', () => {
    for (const theatre of ['turnover', 'in', 'out', 'toTheatre', 'scheduled'] as TheatrePhase[]) {
      const p = createSurgeryPattern(() => surgery({ theatre, robot: 'cleaning' }))
      const s = run(p, 0, 10)
      expect(s.events, theatre).toEqual([])
      expect(s.drones, theatre).toEqual([])
    }
  })

  it('plans nothing while the reader has no state (before the sim exists)', () => {
    const p = createSurgeryPattern(() => null)
    const s = run(p, 0, 5)
    expect(s.events).toEqual([])
    expect(s.drones).toEqual([])
  })
})

describe('the edges', () => {
  it('learn at the first look: a robot that is already docked, or docking, does not chime at load', () => {
    for (const robot of ['docked', 'docking'] as RobotPhase[]) {
      const p = createSurgeryPattern(() => surgery({ robot }))
      expect(plan(p, 0, 0.05).events).toEqual([])
      expect(plan(p, 0.05, 0.1).events).toEqual([])
    }
  })

  it('the robot becoming docked chimes once, at the front of the window, at the cart', () => {
    const st = surgery({ robot: 'targeting' })
    st.robot.cart.x = SURGERY.cart.dock.at.x
    st.robot.cart.z = SURGERY.cart.dock.at.z
    const p = createSurgeryPattern(() => st)
    expect(plan(p, 0, 0.05).events).toEqual([])
    st.robot.phase = 'docked'
    st.robot.phaseSince = 0
    const edge = plan(p, 0.05, 0.1)
    expect(edge.events.length).toBe(dockedChime(0).length)
    expect(edge.events[0].t).toBeCloseTo(0.05, 9)
    for (const e of edge.events) expect(e.at).toEqual({ x: SURGERY.cart.dock.at.x, y: CART_SOUND_Y, z: SURGERY.cart.dock.at.z })
    // and never again while it stays docked
    for (let i = 2; i < 40; i++) expect(plan(p, i * 0.05, (i + 1) * 0.05).events).toEqual([])
  })

  it('the endoscope arm engaging (docking begins) is one short note, once', () => {
    const st = surgery({ robot: 'driving' })
    const p = createSurgeryPattern(() => st)
    plan(p, 0, 0.05)
    st.robot.phase = 'docking'
    const edge = plan(p, 0.05, 0.1)
    expect(edge.events.length).toBe(endoscopeNote(0).length)
    expect(edge.events[0].t).toBeCloseTo(0.05, 9)
    for (let i = 2; i < 20; i++) expect(plan(p, i * 0.05, (i + 1) * 0.05).events).toEqual([])
  })

  it('a day: docking, targeting, docked, undocking sounds exactly the note then the chime', () => {
    const st = surgery({ robot: 'draped' })
    const p = createSurgeryPattern(() => st)
    plan(p, 0, 0.05)
    const seen: number[] = []
    let t = 0.05
    for (const phase of ['deploying', 'driving', 'docking', 'targeting', 'docked', 'undocking', 'returning', 'cleaning', 'stowed'] as RobotPhase[]) {
      st.robot.phase = phase
      seen.push(plan(p, t, t + 0.05).events.length)
      t += 0.05
    }
    expect(seen).toEqual([0, 0, endoscopeNote(0).length, 0, dockedChime(0).length, 0, 0, 0, 0])
  })

  it('a phase change that is old news (the plan resumes long after) does not chime', () => {
    const st = surgery({ robot: 'targeting' })
    const p = createSurgeryPattern(() => st)
    plan(p, 0, 0.05, { simTime: 10 })
    st.robot.phase = 'docked'
    st.robot.phaseSince = 10
    expect(plan(p, 3600, 3600.05, { simTime: 10 + EDGE_FRESH_S + 1 }).events).toEqual([])
    st.robot.phase = 'docking'
    st.robot.phaseSince = 10 + EDGE_FRESH_S + 1
    expect(plan(p, 3600.05, 3600.1, { simTime: 10 + EDGE_FRESH_S + 2 }).events.length).toBe(1)
  })

  it('a new state object (a Jump swapped the hospital) is learned, not chimed at', () => {
    let st = surgery({ robot: 'targeting' })
    const p = createSurgeryPattern(() => st)
    plan(p, 0, 0.05)
    st = surgery({ robot: 'docked' })
    expect(plan(p, 0.05, 0.1).events).toEqual([])
    st.robot.phase = 'undocking'
    expect(plan(p, 0.1, 0.15).events).toEqual([])
  })
})

describe('the servos', () => {
  it('whine every 0.45 s on the audio clock while an arm is mid-travel, from the cart', () => {
    const st = surgery({ engage: [0.5, 0, 0, 0], cart: { x: 101.4, z: 6.2 } })
    const p = createSurgeryPattern(() => st)
    const tones = plan(p, 0, 2.3).events.filter((e) => e.kind === 'tone')
    expect(tones).toHaveLength(6)
    tones.forEach((e, k) => expect(e.t).toBeCloseTo(SERVO_OFFSET_S[0] + k * SERVO_PERIOD_S, 9))
    for (const e of tones) expect(e.at).toEqual({ x: 101.4, y: CART_SOUND_Y, z: 6.2 })
  })

  it('stay silent for an arm that is stowed or on its port: engage up to 0.02, and from 0.98', () => {
    for (const engage of [0, 0.01, ARM_MOVING_MIN, ARM_MOVING_MAX, 0.99, 1]) {
      const p = createSurgeryPattern(() => surgery({ engage: [engage, engage, engage, engage] }))
      expect(run(p, 0, 3).events, String(engage)).toEqual([])
    }
    const moving = createSurgeryPattern(() => surgery({ engage: [0.021, 0, 0, 0] }))
    expect(run(moving, 0, 3).events.length).toBeGreaterThan(0)
    const almost = createSurgeryPattern(() => surgery({ engage: [0, 0, 0, 0.979] }))
    expect(run(almost, 0, 3).events.length).toBeGreaterThan(0)
  })

  it('give each moving arm its own offset and its own pitch, so two arms never sound together', () => {
    const p = createSurgeryPattern(() => surgery({ engage: [0.5, 0.5, 0.5, 0.5] }))
    const tones = plan(p, 0, 0.45).events.filter((e) => e.kind === 'tone')
    expect(tones.length).toBe(4)
    expect(new Set(tones.map((e) => e.t.toFixed(6))).size).toBe(4)
    expect(new Set(tones.map((e) => e.f0)).size).toBe(4)
  })

  it('stop when the demo is paused (the sim speed is 0), even with an arm half way', () => {
    const p = createSurgeryPattern(() => surgery({ engage: [0.5, 0.5, 0, 0] }))
    expect(run(p, 0, 3, 0.05, { simSpeed: 0 }).events).toEqual([])
  })

  it('follow the boom and the cart: they whine only while they move, and a moment after', () => {
    const st = surgery({ robot: 'targeting' })
    const p = createSurgeryPattern(() => st)
    const boom: number[] = []
    const dt = 0.05
    for (let i = 0; i < 100; i++) {
      if (i > 0 && i <= 40) st.robot.boomYaw += 0.001 // moves for two seconds
      if (i > 60 && i <= 70) st.robot.cart.x += 0.01 // then the cart rolls for half a second
      for (const e of plan(p, i * dt, (i + 1) * dt).events) if (e.kind === 'tone') boom.push(e.t)
    }
    expect(boom.length).toBeGreaterThanOrEqual(4)
    for (const t of boom) expect(((t - BOOM_SERVO_OFFSET_S) / SERVO_PERIOD_S) % 1).toSatisfy((x: number) => x < 1e-6 || x > 1 - 1e-6)
    const early = boom.filter((t) => t < 2.3)
    expect(early.length).toBe(Math.ceil((2.05 + BOOM_HOLD_S - BOOM_SERVO_OFFSET_S) / SERVO_PERIOD_S))
    for (const t of boom) expect(t < 2.05 + BOOM_HOLD_S + 1e-9 || (t > 3 && t < 3.55 + BOOM_HOLD_S + 1e-9)).toBe(true)
    // the gaps are the period: no gap and no repeat inside a movement
    const first = early.slice(1).map((t, i) => t - early[i])
    for (const g of first) expect(g).toBeCloseTo(SERVO_PERIOD_S, 6)
  })

  it('the first look cannot tell movement from rest, so nothing sounds for the boom until the second look shows it', () => {
    const st = surgery({ robot: 'targeting' })
    const p = createSurgeryPattern(() => st)
    expect(plan(p, 0, 1).events).toEqual([])
    expect(plan(p, 1, 2).events).toEqual([])
    st.robot.boomHeight += 0.2
    expect(plan(p, 2, 3).events.length).toBeGreaterThan(0)
  })
})

describe('the wheel motors', () => {
  it('hum quietly (a drone at the cart) while it drives in and while it drives back, and not otherwise', () => {
    for (const robot of ['driving', 'returning'] as RobotPhase[]) {
      const st = surgery({ robot, cart: { x: 100.2, z: 7.5 } })
      const s = plan(createSurgeryPattern(() => st), 0, 0.05)
      expect(s.drones.length, robot).toBe(1)
      const d = s.drones[0]
      expect(d.id).toBe('surgery:wheels')
      expect(d.voice).toBe('hum')
      expect(d.level).toBeGreaterThan(0)
      expect(d.level).toBeLessThanOrEqual(0.08) // quieter than the lab's conveyor
      expect(d.hz).toBeGreaterThan(30)
      expect(d.hz).toBeLessThan(200)
      expect(d.at).toEqual({ x: 100.2, y: CART_SOUND_Y, z: 7.5 })
    }
    expect([...DRIVING_PHASES].sort()).toEqual(['driving', 'returning'])
    for (const robot of ['stowed', 'draping', 'draped', 'deploying', 'docking', 'targeting', 'docked', 'undocking', 'cleaning'] as RobotPhase[]) {
      expect(plan(createSurgeryPattern(() => surgery({ robot })), 0, 0.05).drones, robot).toEqual([])
    }
  })

  it('the hum follows the cart and stops when the demo is paused', () => {
    const st = surgery({ robot: 'driving', cart: { x: 100, z: 8 } })
    const p = createSurgeryPattern(() => st)
    expect(plan(p, 0, 0.05).drones[0].at).toEqual({ x: 100, y: CART_SOUND_Y, z: 8 })
    st.robot.cart.x = 100.4
    expect(plan(p, 0.05, 0.1).drones[0].at!.x).toBe(100.4)
    expect(plan(p, 0.1, 0.15, { simSpeed: 0 }).drones).toEqual([])
  })
})

describe('the ventilator and the monitor', () => {
  it('sound while the patient is under (induction to emergence) and only then', () => {
    expect([...UNDER_PHASES].sort()).toEqual([...UNDER].sort())
    for (const theatre of UNDER) {
      const s = run(createSurgeryPattern(() => surgery({ theatre })), 0, 5)
      expect(s.events.length, theatre).toBeGreaterThan(0)
      expect(s.events.some((e) => e.kind === 'noise'), theatre).toBe(true)
      expect(s.events.some((e) => e.kind === 'tone' && e.f0 === 880), theatre).toBe(true)
    }
    for (const theatre of NOT_UNDER) expect(run(createSurgeryPattern(() => surgery({ theatre })), 0, 5).events, theatre).toEqual([])
  })

  it('a theatre in the middle of a case sounds at once, with no history to learn', () => {
    const s = plan(createSurgeryPattern(() => surgery({ theatre: 'console' })), 0, 1)
    expect(s.events.length).toBeGreaterThan(0)
  })

  it('breathes every 4.8 s on the audio clock, two noise events a breath, quiet, at the machine', () => {
    const s = run(createSurgeryPattern(() => surgery({ theatre: 'console' })), 0, 20)
    const noise = s.events.filter((e) => e.kind === 'noise')
    expect(noise.length).toBe(2 * 5) // breaths at 0, 4.8, 9.6, 14.4, 19.2
    const starts = noise.filter((_, i) => i % 2 === 0).map((e) => e.t).sort((a, b) => a - b)
    expect(starts.length).toBe(5)
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeCloseTo(BREATH_PERIOD_S, 9)
    for (const e of noise) {
      expect(e.peak).toBeLessThanOrEqual(0.12)
      expect(e.at).toEqual(VENTILATOR_AT)
    }
  })

  it('beeps every 0.92 s from the machine, soft, with no gap and no repeat over a minute of 50 ms windows', () => {
    const s = run(createSurgeryPattern(() => surgery({ theatre: 'console' })), 0, 60)
    const beeps = s.events.filter((e) => e.kind === 'tone').map((e) => e.t).sort((a, b) => a - b)
    expect(beeps.length).toBe(Math.floor((60 - BEEP_OFFSET_S) / BEEP_PERIOD_S) + 1)
    for (let i = 1; i < beeps.length; i++) expect(beeps[i] - beeps[i - 1]).toBeCloseTo(BEEP_PERIOD_S, 9)
    expect(beeps[0]).toBeCloseTo(BEEP_OFFSET_S, 9)
    for (const e of s.events.filter((x) => x.kind === 'tone')) {
      expect(e.peak).toBeLessThanOrEqual(0.1)
      expect(e.at).toEqual(MONITOR_AT)
    }
  })

  it('goes quiet as the case ends: the patient out of the room, the machine is silent', () => {
    const st = surgery({ theatre: 'emergence' })
    const p = createSurgeryPattern(() => st)
    expect(run(p, 0, 3).events.length).toBeGreaterThan(0)
    st.theatre.phase = 'out'
    expect(run(p, 3, 8).events).toEqual([])
  })
})

describe('windows join', () => {
  const busy = () => surgery({ theatre: 'console', robot: 'targeting', engage: [0.5, 0.3, 0.9, 0.05] })

  it('the same pattern planned over [0, 0.5) then [0.5, 1) equals [0, 1)', () => {
    const split = createSurgeryPattern(busy)
    const a = plan(split, 0, 0.5)
    const b = plan(split, 0.5, 1)
    const whole = plan(createSurgeryPattern(busy), 0, 1)
    expect(a.events.length + b.events.length).toBe(whole.events.length)
    expect(sorted([...a.events, ...b.events])).toEqual(sorted(whole.events))
    expect(whole.events.length).toBeGreaterThan(0)
  })

  it('50 ms windows over ten seconds equal one window over the ten seconds, for the servos, the breath and the beeps', () => {
    const steps = run(createSurgeryPattern(busy), 0, 10)
    const whole = plan(createSurgeryPattern(busy), 0, 10)
    expect(steps.events.length).toBe(whole.events.length)
    expect(sorted(steps.events)).toEqual(sorted(whole.events))
  })

  it('ragged windows (as the engine plans them: from where the last ended, to now + 120 ms) neither gap nor repeat', () => {
    const p = createSurgeryPattern(busy)
    const s = sink()
    let from = 0
    let now = 0
    for (let i = 0; i < 200; i++) {
      now += 0.037 + (i % 5) * 0.011
      const to = now + 0.12
      if (to > from) {
        p.plan(win(from, to, { now }), s)
        from = to
      }
    }
    const whole = plan(createSurgeryPattern(busy), 0, from)
    expect(sorted(s.events)).toEqual(sorted(whole.events))
  })
})

describe('the pattern', () => {
  it('reads the state through the reader it is given, afresh on every plan', () => {
    let st: SurgeryState | null = null
    const p = createSurgeryPattern(() => st)
    expect(p.id).toBe('surgery')
    expect(plan(p, 0, 1).events).toEqual([])
    st = surgery({ theatre: 'console' })
    expect(plan(p, 1, 2).events.length).toBeGreaterThan(0)
    st = surgery({ theatre: 'idle' })
    expect(plan(p, 2, 3).events).toEqual([])
  })

  it("is exported for the engine's glob (devicePatterns) without building a hospital, and plugs into the registry", () => {
    expect(devicePatterns.length).toBe(1)
    expect(devicePatterns[0].id).toBe('surgery')
    // (its live reader loads the sim on the first plan, in the browser: importing this module built nothing, or the sim mock above would have thrown)
    const off = registerDevicePattern(devicePatterns[0])
    expect(registered().some((p) => p.id === 'surgery')).toBe(true)
    off()
    expect(registered().some((p) => p.id === 'surgery')).toBe(false)
  })

  it('the pattern id does not clash with the kiosk, lab or draw centre', () => {
    for (const other of ['kiosk', 'lab', 'draw']) expect(devicePatterns[0].id).not.toBe(other)
  })
})

