/**
 * The animated lights of both health kiosks as one three.js mesh, and the per-frame update that drives them from the sim's `HealthKioskState`s.
 *
 * `createRig` builds the unlit glow mesh once (geometry.ts, world coordinates). `updateRig` reads the two states, takes the target level of every light
 * (motion.ts `levelsInto`), eases the lights towards it and writes a region's colours only when its level moved by more than `EPS`, so two idle kiosks cost
 * a few dozen comparisons. Nothing is allocated per frame: levels live in the rig's own objects and the maths goes through the module's scratch numbers.
 *
 * Draw calls: 1 (both kiosks share the glow mesh; the moving paper is glow segments, the touchscreens are atlas tiles). It is baked in world
 * coordinates, never moves and casts no shadow.
 */
import { Group, Mesh } from 'three'
import { type GlowGeometry, type GlowRegion, linear, setRegion, setRegionRGB } from '@/scene/imaging/machines/geometry'
import { MACHINE_GLOW } from '@/scene/imaging/machines/machineMaterials'
import type { HealthKioskState } from '@/sim/types'
import { DIGIT_MASK, DIGITS, LIGHT, PING_RINGS, SLIP_SEGMENTS, buildKioskGlow, region } from './geometry'
import { KIOSKS } from './layout'
import { type KioskLevels, levelsInto, newLevels, slipAlpha, smoothTo, stepToward } from './motion'

/** A level must move further than this to be rewritten into a colour buffer. */
const EPS = 0.004

const changed = (a: number, b: number): boolean => !(Math.abs(a - b) <= EPS)

const GREEN = linear(LIGHT.green)
const BLUE = linear(LIGHT.blue)
const TEAL = linear(LIGHT.teal)
const AMBER = linear(LIGHT.amber)

/** The glow's brightness multipliers (colours above 1 feed the bloom). */
const GAIN = { ping: 1.3, grips: 1.1, clip: 1.5, face: 1.3, ir: 1.7, qr: 1, digit: 1.6, slip: 0.95 } as const

interface KioskRegions {
  led: GlowRegion
  beam: GlowRegion
  ping: GlowRegion[]
  /** `digits[d * 7 + s]`. */
  digits: GlowRegion[]
  dot: GlowRegion
  grips: GlowRegion[]
  clip: GlowRegion
  bpClip: GlowRegion
  cuff: GlowRegion
  face: GlowRegion
  ir: GlowRegion
  qr: GlowRegion
  slip: GlowRegion[]
  bpLed: GlowRegion
}

/** The numbers last written into the colour buffers (NaN: nothing written yet). */
interface Written {
  led: number
  ledGain: number
  beam: number
  ping: Float64Array
  digits: number
  digitValue: number
  grips: number
  clip: number
  cuffAmber: number
  cuffGreen: number
  cuffGain: number
  face: number
  ir: number
  qr: number
  slip: number
  bpLed: number
}

export interface KioskRigState {
  index: number
  regions: KioskRegions
  target: KioskLevels
  level: KioskLevels
  written: Written
  /** Which of the 21 digit segments are lit for the shown value, and whether the decimal point is. */
  lit: Uint8Array
  dotLit: boolean
}

export interface KioskRig {
  root: Group
  mesh: Mesh
  glow: GlowGeometry
  kiosks: KioskRigState[]
}

function must(g: GlowGeometry, name: string): GlowRegion {
  const r = g.regions[name]
  if (!r) throw new Error(`kiosk glow has no region ${name}`)
  return r
}

function regionsOf(g: GlowGeometry, i: number): KioskRegions {
  const ping: GlowRegion[] = []
  for (let r = 0; r < PING_RINGS; r++) ping.push(must(g, region.ping(i, r)))
  const digits: GlowRegion[] = []
  for (let d = 0; d < DIGITS; d++) for (let s = 0; s < 7; s++) digits.push(must(g, region.digit(i, d, s)))
  const slip: GlowRegion[] = []
  for (let n = 0; n < SLIP_SEGMENTS; n++) slip.push(must(g, region.slip(i, n)))
  return {
    led: must(g, region.led(i)),
    beam: must(g, region.beam(i)),
    ping,
    digits,
    dot: must(g, region.dot(i)),
    grips: [must(g, region.grip(i, 0)), must(g, region.grip(i, 1))],
    clip: must(g, region.clip(i)),
    bpClip: must(g, region.bpClip(i)),
    cuff: must(g, region.cuff(i)),
    face: must(g, region.face(i)),
    ir: must(g, region.ir(i)),
    qr: must(g, region.qr(i)),
    slip,
    bpLed: must(g, region.bpLed(i)),
  }
}

function newWritten(): Written {
  return {
    led: NaN,
    ledGain: NaN,
    beam: NaN,
    ping: new Float64Array(PING_RINGS).fill(NaN),
    digits: NaN,
    digitValue: NaN,
    grips: NaN,
    clip: NaN,
    cuffAmber: NaN,
    cuffGreen: NaN,
    cuffGain: NaN,
    face: NaN,
    ir: NaN,
    qr: NaN,
    slip: NaN,
    bpLed: NaN,
  }
}

export function createRig(): KioskRig {
  const glow = buildKioskGlow()
  const mesh = new Mesh(glow.geometry, MACHINE_GLOW)
  mesh.name = 'kiosk-glow'
  // baked in world coordinates, never moves, casts nothing
  mesh.matrixAutoUpdate = false
  mesh.updateMatrix()
  mesh.castShadow = false
  mesh.receiveShadow = false
  const root = new Group()
  root.name = 'health-kiosks'
  root.add(mesh)
  const kiosks: KioskRigState[] = KIOSKS.map((k) => ({
    index: k.index,
    regions: regionsOf(glow, k.index),
    target: newLevels(),
    level: newLevels(),
    written: newWritten(),
    lit: new Uint8Array(DIGITS * 7),
    dotLit: false,
  }))
  return { root, mesh, glow, kiosks }
}

/** Free the geometry (the shared material belongs to someone else). */
export function disposeRig(rig: KioskRig): void {
  rig.glow.geometry.dispose()
}

/** Which segments light for `value` tenths of a kilogram (-1: dashes), into `lit` (3 digits x 7 segments); returns whether the decimal point is lit. */
export function digitSegmentsInto(lit: Uint8Array, value: number): boolean {
  if (value < 0) {
    for (let d = 0; d < DIGITS; d++) for (let s = 0; s < 7; s++) lit[d * 7 + s] = s === 6 ? 1 : 0 // the middle bar of every digit
    return false
  }
  const d0 = Math.floor(value / 100) % 10
  const d1 = Math.floor(value / 10) % 10
  const d2 = value % 10
  for (let s = 0; s < 7; s++) {
    lit[s] = d0 === 0 ? 0 : (DIGIT_MASK[d0] >> s) & 1
    lit[7 + s] = (DIGIT_MASK[d1] >> s) & 1
    lit[14 + s] = (DIGIT_MASK[d2] >> s) & 1
  }
  return true
}

function writeDigits(s: KioskRigState, g: GlowGeometry, level: number): void {
  const r = s.regions
  for (let n = 0; n < r.digits.length; n++) setRegion(g.geometry, r.digits[n], GAIN.digit, s.lit[n] === 1 ? level : 0)
  setRegion(g.geometry, r.dot, GAIN.digit, s.dotLit ? level : 0)
}

function updateKiosk(s: KioskRigState, g: GlowGeometry, k: HealthKioskState, dt: number, t: number): void {
  const tgt = s.target
  const cur = s.level
  const w = s.written
  const geo = g.geometry
  const r = s.regions
  levelsInto(tgt, k, t)

  // --- the status LED: the colour eases between green and blue, the brightness follows its own pulse
  cur.led = stepToward(cur.led, tgt.led, dt, 0.25)
  cur.ledGain = smoothTo(cur.ledGain, tgt.ledGain, 14, dt)
  if (changed(cur.led, w.led) || changed(cur.ledGain, w.ledGain)) {
    const m = cur.led
    const gain = cur.ledGain
    setRegionRGB(geo, r.led, (GREEN[0] + (BLUE[0] - GREEN[0]) * m) * gain, (GREEN[1] + (BLUE[1] - GREEN[1]) * m) * gain, (GREEN[2] + (BLUE[2] - GREEN[2]) * m) * gain, 1)
    w.led = cur.led
    w.ledGain = cur.ledGain
  }
  cur.bpLed = smoothTo(cur.bpLed, tgt.bpLed, 8, dt)
  if (changed(cur.bpLed, w.bpLed)) {
    setRegion(geo, r.bpLed, 1.1, cur.bpLed)
    w.bpLed = cur.bpLed
  }

  // --- ultrasonic height
  cur.beam = stepToward(cur.beam, tgt.beam, dt, tgt.beam > cur.beam ? 0.4 : 0.3)
  if (changed(cur.beam, w.beam)) {
    setRegion(geo, r.beam, 1, cur.beam)
    w.beam = cur.beam
  }
  for (let n = 0; n < PING_RINGS; n++) {
    cur.ping[n] = tgt.ping[n]
    if (changed(cur.ping[n], w.ping[n])) {
      setRegion(geo, r.ping[n], GAIN.ping, cur.ping[n] * 0.9)
      w.ping[n] = cur.ping[n]
    }
  }

  // --- the platform's digits: the segments follow the value, their brightness follows the level
  cur.digits = stepToward(cur.digits, tgt.digits, dt, 0.2)
  if (tgt.digitValue !== w.digitValue) {
    s.dotLit = digitSegmentsInto(s.lit, tgt.digitValue)
    cur.digitValue = tgt.digitValue
    w.digitValue = tgt.digitValue
    writeDigits(s, g, cur.digits)
    w.digits = cur.digits
  } else if (changed(cur.digits, w.digits)) {
    writeDigits(s, g, cur.digits)
    w.digits = cur.digits
  }

  // --- the grips and the two SpO2 LEDs
  cur.grips = stepToward(cur.grips, tgt.grips, dt, 0.3)
  if (changed(cur.grips, w.grips)) {
    setRegion(geo, r.grips[0], GAIN.grips, cur.grips * 0.85)
    setRegion(geo, r.grips[1], GAIN.grips, cur.grips * 0.85)
    w.grips = cur.grips
  }
  cur.clip = stepToward(cur.clip, tgt.clip, dt, 0.1)
  if (changed(cur.clip, w.clip)) {
    setRegion(geo, r.clip, GAIN.clip, cur.clip)
    setRegion(geo, r.bpClip, GAIN.clip, cur.clip)
    w.clip = cur.clip
  }

  // --- the cuff ring: teal, amber as it inflates, green once the reading is done
  cur.cuffAmber = stepToward(cur.cuffAmber, tgt.cuffAmber, dt, 0.2)
  cur.cuffGreen = stepToward(cur.cuffGreen, tgt.cuffGreen, dt, 0.3)
  cur.cuffGain = smoothTo(cur.cuffGain, tgt.cuffGain, 10, dt)
  if (changed(cur.cuffAmber, w.cuffAmber) || changed(cur.cuffGreen, w.cuffGreen) || changed(cur.cuffGain, w.cuffGain)) {
    const a = cur.cuffAmber
    const gr = cur.cuffGreen
    const gain = cur.cuffGain
    const rr = (TEAL[0] + (AMBER[0] - TEAL[0]) * a) * (1 - gr) + GREEN[0] * gr
    const gg = (TEAL[1] + (AMBER[1] - TEAL[1]) * a) * (1 - gr) + GREEN[1] * gr
    const bb = (TEAL[2] + (AMBER[2] - TEAL[2]) * a) * (1 - gr) + GREEN[2] * gr
    setRegionRGB(geo, r.cuff, rr * gain, gg * gain, bb * gain, 1)
    w.cuffAmber = cur.cuffAmber
    w.cuffGreen = cur.cuffGreen
    w.cuffGain = cur.cuffGain
  }

  // --- the camera: face frame and IR dot
  cur.face = stepToward(cur.face, tgt.face, dt, 0.2)
  if (changed(cur.face, w.face)) {
    setRegion(geo, r.face, GAIN.face, cur.face)
    w.face = cur.face
  }
  cur.ir = tgt.ir
  if (changed(cur.ir, w.ir)) {
    setRegion(geo, r.ir, GAIN.ir, cur.ir)
    w.ir = cur.ir
  }
  cur.qr = tgt.qr
  if (changed(cur.qr, w.qr)) {
    setRegion(geo, r.qr, GAIN.qr, cur.qr * 0.9)
    w.qr = cur.qr
  }

  // --- the paper slip: the segments come out one after another (a unit of `slip` per segment, about 6 a second); it is gone at once when the kiosk is free again
  cur.slip = tgt.slip < cur.slip ? tgt.slip : stepToward(cur.slip, tgt.slip, dt, 1 / 6)
  if (changed(cur.slip, w.slip)) {
    for (let n = 0; n < SLIP_SEGMENTS; n++) setRegion(geo, r.slip[n], GAIN.slip, slipAlpha(cur.slip, n))
    w.slip = cur.slip
  }
}

/**
 * Animate both kiosks from their states. `dt` is the seconds to advance (0 while the sim is paused: levels hold), `t` a running clock for the periodic
 * parts (LED breathing, pings, pulses).
 */
export function updateRig(rig: KioskRig, kiosks: readonly HealthKioskState[], dt: number, t: number): void {
  for (let i = 0; i < rig.kiosks.length; i++) {
    const k = kiosks[i]
    if (k) updateKiosk(rig.kiosks[i], rig.glow, k, dt, t)
  }
}
