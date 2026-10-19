/**
 * The kiosk rig as three.js objects, in node: the budget (one draw call, well under 16k triangles for both kiosks), where every light is, and that
 * `updateRig` drives the colour buffers from the states and writes them only when a level moved.
 */
import { BufferAttribute, type Mesh } from 'three'
import { describe, expect, it } from 'vitest'
import { MACHINE_GLOW } from '@/scene/imaging/machines/machineMaterials'
import { triangles } from '@/scene/imaging/machines/geometry'
import { HEALTH_KIOSKS } from '@/sim/places'
import type { HealthKioskPhase, HealthKioskState, VitalsReading } from '@/sim/types'
import { DIGITS, LIGHT, PING_RINGS, SEGMENTS, SLIP_SEGMENTS, buildKioskGlow, glowTriangles, region } from './geometry'
import { KIOSKS } from './layout'
import { createRig, digitSegmentsInto, disposeRig, updateRig, type KioskRig } from './rig'

function reading(over: Partial<VitalsReading> = {}): VitalsReading {
  return { id: 'r1', personId: 'p1', personName: 'Test Patient', at: 0, source: 'kiosk', station: 0, sys: null, dia: null, pulse: null, spo2: null, tempC: null, heightCm: null, weightKg: null, bmi: null, bodyFatPct: null, bp: [], partial: true, ...over }
}

function kiosk(index: number, phase: HealthKioskPhase, over: Partial<HealthKioskState> = {}): HealthKioskState {
  const busy = phase !== 'idle'
  return { index, phase, phaseTime: 0, progress: 0, kind: busy ? 'full' : null, userId: busy ? 'p1' : null, userName: busy ? 'Test Patient' : null, bpRound: 0, cuff: 0, reading: busy ? reading() : null, assisted: false, sessionsToday: 0, version: 1, ...over }
}

const both = (a: HealthKioskState, b: HealthKioskState = kiosk(1, 'idle')): HealthKioskState[] => [a, b]

/** Run the rig for `seconds` of 1/60 s frames with the clock at `t0` ... and return the time reached. */
function run(rig: KioskRig, states: HealthKioskState[], seconds: number, t0 = 0): number {
  let t = t0
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    t += 1 / 60
    updateRig(rig, states, 1 / 60, t)
  }
  return t
}

/** RGBA of the first vertex of a region. */
function colour(rig: KioskRig, name: string): [number, number, number, number] {
  const r = rig.glow.regions[name]
  const a = (rig.glow.geometry.getAttribute('color') as BufferAttribute).array as Float32Array
  const i = r.start * 4
  return [a[i], a[i + 1], a[i + 2], a[i + 3]]
}
const alpha = (rig: KioskRig, name: string): number => colour(rig, name)[3]

describe('budget', () => {
  const rig = createRig()

  it('is one mesh, one draw call, under 16k triangles for both kiosks, every vertex finite', () => {
    expect(rig.root.children.length).toBe(1)
    const meshes: Mesh[] = []
    rig.root.traverse((o) => {
      if ((o as Mesh).isMesh) meshes.push(o as Mesh)
    })
    expect(meshes.length).toBeLessThanOrEqual(2)
    expect(meshes.length).toBe(1)
    expect(meshes[0].material).toBe(MACHINE_GLOW)
    const tris = glowTriangles(rig.glow)
    expect(tris).toBe(triangles(rig.mesh.geometry))
    expect(tris).toBeGreaterThan(1000)
    expect(tris).toBeLessThan(16_000)
    const pos = rig.mesh.geometry.getAttribute('position').array as Float32Array
    for (let i = 0; i < pos.length; i++) expect(Number.isFinite(pos[i])).toBe(true)
    // the glow layout of the imaging machines: RGBA per vertex, no normals (unlit)
    expect(rig.mesh.geometry.getAttribute('color').itemSize).toBe(4)
    expect(rig.mesh.geometry.getAttribute('normal')).toBeUndefined()
  })

  it('is baked in world coordinates: it never moves, casts nothing, and its bounds are the lobby strip', () => {
    expect(rig.mesh.matrixAutoUpdate).toBe(false)
    expect(rig.mesh.castShadow).toBe(false)
    const box = rig.mesh.geometry.boundingBox!
    expect(box.min.x).toBeGreaterThan(-54.7)
    expect(box.max.x).toBeLessThan(-51.0)
    expect(box.min.z).toBeGreaterThan(4.5)
    expect(box.max.z).toBeLessThan(5.7)
    expect(box.max.y).toBeLessThan(2.1)
  })

  it('has every named region of both kiosks, and the two kiosks use disjoint vertices', () => {
    const g = buildKioskGlow()
    for (let i = 0; i < 2; i++) {
      const names = [region.led(i), region.beam(i), region.dot(i), region.clip(i), region.bpClip(i), region.cuff(i), region.face(i), region.ir(i), region.qr(i), region.bpLed(i), region.grip(i, 0), region.grip(i, 1)]
      for (let r = 0; r < PING_RINGS; r++) names.push(region.ping(i, r))
      for (let n = 0; n < SLIP_SEGMENTS; n++) names.push(region.slip(i, n))
      for (let d = 0; d < DIGITS; d++) for (let s = 0; s < 7; s++) names.push(region.digit(i, d, s))
      for (const n of names) expect(g.regions[n], n).toBeDefined()
    }
    const ranges = Object.values(g.regions).sort((a, b) => a.start - b.start)
    for (let i = 1; i < ranges.length; i++) expect(ranges[i].start).toBe(ranges[i - 1].start + ranges[i - 1].count)
    expect(ranges.reduce((n, r) => n + r.count, 0)).toBe(g.geometry.getAttribute('position').count)
  })

  it('puts each light where the part is: the cuff ring on the tunnel mouth, the digits on the platform, the puck over the stand spot', () => {
    const g = buildKioskGlow()
    const centre = (name: string) => {
      const r = g.regions[name]
      const p = g.geometry.getAttribute('position')
      let x = 0
      let y = 0
      let z = 0
      for (let i = r.start; i < r.start + r.count; i++) {
        x += p.getX(i)
        y += p.getY(i)
        z += p.getZ(i)
      }
      return { x: x / r.count, y: y / r.count, z: z / r.count }
    }
    for (let i = 0; i < 2; i++) {
      const k = KIOSKS[i]
      const cuff = centre(region.cuff(i))
      expect(Math.hypot(cuff.x - k.axis.x, cuff.y - k.axis.y)).toBeLessThan(0.005)
      expect(Math.abs(cuff.z - (k.axis.mouthZ - 0.002))).toBeLessThan(0.005)
      const beam = centre(region.beam(i))
      expect(Math.hypot(beam.x - HEALTH_KIOSKS[i].stand.at.x, beam.z - HEALTH_KIOSKS[i].stand.at.z)).toBeLessThan(0.005)
      expect(beam.y).toBeLessThan(k.puck.y)
      const dig = centre(region.digit(i, 1, 'g'.charCodeAt(0) - 'a'.charCodeAt(0)))
      expect(Math.abs(dig.x - HEALTH_KIOSKS[i].stand.at.x)).toBeLessThan(0.005)
      expect(dig.y).toBeGreaterThan(0.05)
      expect(dig.y).toBeLessThan(0.06)
      const ir = centre(region.ir(i))
      expect(Math.hypot(ir.x - k.lens.x, ir.y - k.lens.y)).toBeLessThan(0.005)
      // the slip comes out of the printer slot towards the user (smaller z)
      const first = centre(region.slip(i, 0))
      const last = centre(region.slip(i, SLIP_SEGMENTS - 1))
      expect(last.z).toBeLessThan(first.z)
      expect(Math.abs(first.x - k.printer.x)).toBeLessThan(0.005)
    }
  })

  it('disposes its geometry', () => {
    const r = createRig()
    let disposed = 0
    r.glow.geometry.addEventListener('dispose', () => disposed++)
    disposeRig(r)
    expect(disposed).toBe(1)
  })
})

describe('the lights follow the states', () => {
  it('free: a green status LED, a teal cuff ring, everything else dark', () => {
    const rig = createRig()
    run(rig, both(kiosk(0, 'idle')), 1)
    const led = colour(rig, region.led(0))
    expect(led[1]).toBeGreaterThan(led[0]) // green
    expect(led[1]).toBeGreaterThan(led[2])
    const cuff = colour(rig, region.cuff(0))
    expect(cuff[2]).toBeGreaterThan(cuff[0]) // teal
    for (const n of [region.beam(0), region.ping(0, 0), region.grip(0, 0), region.clip(0), region.face(0), region.ir(0), region.slip(0, 0), region.digit(0, 0, 0)]) expect(alpha(rig, n), n).toBe(0)
  })

  it('in use: the status LED turns blue', () => {
    const rig = createRig()
    run(rig, both(kiosk(0, 'idle')), 0.5)
    const states = both(kiosk(0, 'height', { progress: 0.3 }))
    run(rig, states, 1)
    const led = colour(rig, region.led(0))
    expect(led[2]).toBeGreaterThan(led[0])
    expect(led[2]).toBeGreaterThan(led[1] * 0.6)
    // and kiosk 1 is untouched: still free (green)
    const other = colour(rig, region.led(1))
    expect(other[1]).toBeGreaterThan(other[2])
  })

  it('height: the beam and the rings come up; they go again after it', () => {
    const rig = createRig()
    const t = run(rig, both(kiosk(0, 'height', { progress: 0.5 })), 1)
    expect(alpha(rig, region.beam(0))).toBeGreaterThan(0.08)
    expect(Math.max(alpha(rig, region.ping(0, 0)), alpha(rig, region.ping(0, 1)), alpha(rig, region.ping(0, 2)))).toBeGreaterThan(0.2)
    run(rig, both(kiosk(0, 'weight')), 1, t)
    expect(alpha(rig, region.beam(0))).toBe(0)
    expect(alpha(rig, region.ping(0, 1))).toBe(0)
  })

  it('weight then body fat: the digits show dashes, then the weight (71.4: a 7, a 1 and a 4, with the point)', () => {
    const rig = createRig()
    let t = run(rig, both(kiosk(0, 'weight', { progress: 0.5 })), 1)
    // dashes: only the middle bar of each digit (g, index 6) is lit at some moment of its blink
    let lit = 0
    for (let n = 0; n < 200; n++) {
      t = run(rig, both(kiosk(0, 'weight', { progress: 0.5 })), 0.01, t)
      for (let d = 0; d < DIGITS; d++) for (let s = 0; s < 7; s++) if (alpha(rig, region.digit(0, d, s)) > 0.3) lit += s === 6 ? 1 : 1000
    }
    expect(lit).toBeGreaterThan(0)
    expect(lit).toBeLessThan(1000) // never anything but the middle bars
    t = run(rig, both(kiosk(0, 'bodyFat', { reading: reading({ weightKg: 71.4 }) })), 1, t)
    const on = (d: number): string => [...SEGMENTS].filter((_, s) => alpha(rig, region.digit(0, d, s)) > 0.9).join('')
    expect(on(0)).toBe('abc') // 7: a b c
    expect(on(1)).toBe('bc') // 1: b c
    expect(on(2)).toBe('bcfg') // 4: b c f g
    expect(alpha(rig, region.dot(0))).toBeGreaterThan(0.9)
    // glow colours above 1 feed the bloom
    const c = colour(rig, region.digit(0, 1, 1))
    expect(Math.max(c[0], c[1], c[2])).toBeGreaterThan(1)
    // done: dark again
    run(rig, both(kiosk(0, 'sit')), 1, t)
    for (let d = 0; d < DIGITS; d++) for (let s = 0; s < 7; s++) expect(alpha(rig, region.digit(0, d, s))).toBe(0)
  })

  it('digitSegmentsInto: 0 and 8 and the blank leading zero, dashes', () => {
    const lit = new Uint8Array(DIGITS * 7)
    expect(digitSegmentsInto(lit, 805)).toBe(true) // 80.5
    expect(Array.from(lit.slice(0, 7))).toEqual([1, 1, 1, 1, 1, 1, 1]) // 8
    expect(Array.from(lit.slice(7, 14))).toEqual([1, 1, 1, 1, 1, 1, 0]) // 0
    digitSegmentsInto(lit, 55) // 5.5: the leading zero is blank
    expect(Array.from(lit.slice(0, 7))).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(digitSegmentsInto(lit, -1)).toBe(false)
    for (let d = 0; d < DIGITS; d++) expect(Array.from(lit.slice(d * 7, d * 7 + 7))).toEqual([0, 0, 0, 0, 0, 0, 1])
  })

  it('body fat: the grip sleeves glow blue', () => {
    const rig = createRig()
    run(rig, both(kiosk(0, 'bodyFat')), 1)
    for (const side of [0, 1]) {
      const c = colour(rig, region.grip(0, side))
      expect(c[3]).toBeGreaterThan(0.3)
      expect(c[2]).toBeGreaterThan(c[0])
    }
    expect(alpha(rig, region.grip(1, 0))).toBe(0)
  })

  it('SpO2: both red LEDs light and pulse', () => {
    const rig = createRig()
    let t = 0
    const seen: number[] = []
    for (let i = 0; i < 90; i++) {
      t = run(rig, both(kiosk(0, 'spo2')), 1 / 60, t)
      seen.push(alpha(rig, region.clip(0)))
      expect(alpha(rig, region.bpClip(0))).toBeCloseTo(alpha(rig, region.clip(0)), 6)
    }
    expect(Math.max(...seen)).toBeGreaterThan(0.9)
    expect(Math.min(...seen)).toBeLessThan(0.45)
    const c = colour(rig, region.clip(0))
    expect(c[0]).toBeGreaterThan(c[1])
  })

  it('blood pressure: the ring is teal, amber while the cuff is up, green for the rest', () => {
    const rig = createRig()
    let t = run(rig, both(kiosk(0, 'spo2')), 1)
    let c = colour(rig, region.cuff(0))
    expect(c[2]).toBeGreaterThan(c[0]) // teal: blue-green
    t = run(rig, both(kiosk(0, 'bp', { cuff: 1, progress: 0.4, bpRound: 1 })), 1, t)
    c = colour(rig, region.cuff(0))
    expect(c[0]).toBeGreaterThan(c[2] * 2) // amber: red, some green, hardly any blue
    expect(c[1]).toBeGreaterThan(c[2])
    t = run(rig, both(kiosk(0, 'bpRest', { bpRound: 1 })), 1.2, t)
    c = colour(rig, region.cuff(0))
    expect(c[1]).toBeGreaterThan(c[0] * 1.5) // green
  })

  it('temperature: the face ring and the red infrared dot; the QR window flickers at login', () => {
    const rig = createRig()
    let t = run(rig, both(kiosk(0, 'login')), 0.6)
    const qr: number[] = []
    for (let i = 0; i < 120; i++) {
      t = run(rig, both(kiosk(0, 'login')), 1 / 60, t)
      qr.push(alpha(rig, region.qr(0)))
    }
    expect(Math.max(...qr) - Math.min(...qr)).toBeGreaterThan(0.4)
    t = run(rig, both(kiosk(0, 'temp')), 1, t)
    expect(alpha(rig, region.face(0))).toBeGreaterThan(0.9)
    const ir = colour(rig, region.ir(0))
    expect(ir[3]).toBeGreaterThan(0.3)
    expect(ir[0]).toBeGreaterThan(ir[1])
  })

  it('report: the five slip segments come out one after another and are gone when the kiosk is free again', () => {
    const rig = createRig()
    let t = 0
    const order: number[] = []
    for (const progress of [0, 0.1, 0.25, 0.4, 0.55, 0.7, 1]) {
      t = run(rig, both(kiosk(0, 'report', { progress })), 0.8, t)
      order.push(Array.from({ length: SLIP_SEGMENTS }, (_, n) => alpha(rig, region.slip(0, n))).filter((a) => a > 0.95).length)
    }
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(order[0]).toBe(0)
    expect(order[order.length - 1]).toBe(SLIP_SEGMENTS)
    const paper = colour(rig, region.slip(0, 0))
    expect(paper[0]).toBeGreaterThan(0.7)
    expect(Math.max(paper[0], paper[1], paper[2])).toBeLessThanOrEqual(1) // paper does not bloom
    run(rig, both(kiosk(0, 'idle')), 0.2, t)
    for (let n = 0; n < SLIP_SEGMENTS; n++) expect(alpha(rig, region.slip(0, n))).toBe(0)
    expect(LIGHT.paper).toMatch(/^#f/i)
  })
})

describe('writes only when something moved', () => {
  const version = (rig: KioskRig): number => (rig.glow.geometry.getAttribute('color') as BufferAttribute).version

  it('a steady state with the clock held writes nothing the second time', () => {
    const rig = createRig()
    const states = both(kiosk(0, 'bodyFat', { reading: reading({ weightKg: 70 }) }))
    run(rig, states, 2)
    // the clock stands still and the sim is paused (dt 0): the same levels again
    updateRig(rig, states, 0, 5)
    const v = version(rig)
    for (let i = 0; i < 20; i++) updateRig(rig, states, 0, 5)
    expect(version(rig)).toBe(v)
  })

  it('a free kiosk written once stays untouched while the clock runs only in the LED\'s own breathing', () => {
    const rig = createRig()
    const states = both(kiosk(0, 'idle'))
    run(rig, states, 1)
    const v = version(rig)
    // 4 frames: the breathing LED may rewrite its few vertices, but the update is flagged at most once a frame
    for (let i = 0; i < 4; i++) updateRig(rig, states, 1 / 60, 1 + i / 60)
    expect(version(rig) - v).toBeLessThanOrEqual(4)
  })

  it('pausing the sim holds every eased level', () => {
    const rig = createRig()
    const states = both(kiosk(0, 'height', { progress: 0.5 }))
    run(rig, states, 0.1)
    const before = alpha(rig, region.beam(0))
    updateRig(rig, both(kiosk(0, 'idle')), 0, 10)
    expect(alpha(rig, region.beam(0))).toBeCloseTo(before, 9) // dt 0: the beam has not started to fade
  })

  it('survives a missing kiosk state', () => {
    const rig = createRig()
    expect(() => updateRig(rig, [kiosk(0, 'idle')], 1 / 60, 0)).not.toThrow()
  })
})
