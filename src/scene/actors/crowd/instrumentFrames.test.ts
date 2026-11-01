/**
 * R5: the frames of the instruments in the hands (rig.ts instrumentFrame) for the procedural body and every realistic avatar at 0.94 and 1.06 of its size:
 * the grip point sits where the avatar's own hand mesh is (its middle, 2 cm towards the palm) to 1.5 cm, the frame's origin is that grip point plus the
 * grip's offset, an aimed instrument's axis passes within 5 mm of the point the pose aims it at, and no frame is mirrored (both hands, the patient's tube).
 */
import { describe, expect, it } from 'vitest'
import { ATTIRE, type ProcAction, type ToolKind } from '@/sim/types'
import { modeFor } from './blend'
import { NOMINAL_BODY, P, PART_COUNT, standPelvis, type BodyDims } from './constants'
import { lookFor } from './outfit'
import { AIM_L, AIM_R } from './pose'
import { PROCEDURAL_GRIP, createRig, makeInput, solveRig, type PersonRig } from './rig'
import { handGripOfBody } from './crowdRig'
import { instrumentKindOf, specOfKind } from './instrumentTable'
import { applyBinds } from './avatars'
import { cpuMesh, loadPeopleFromDisk, skinAll } from './avatars.testkit'

type V3 = [number, number, number]

const CASES: [ProcAction, ToolKind, ToolKind][] = [
  ['closeSkin', 'forceps', 'needleHolder'],
  ['intubate', 'laryngoscope', 'breathingTube'],
  ['bagMask', 'bagValveMask', 'none'],
  ['skinPrep', 'none', 'prepStick'],
  ['skinNick', 'none', 'scalpel'],
  ['insertTrocar', 'none', 'trocar12'],
  ['holdScope', 'none', 'laparoscope'],
  ['clipLap', 'none', 'lapClipApplier'],
  ['injectLocal', 'none', 'syringe'],
  ['passInstrument', 'none', 'needleHolder'],
]

function pose(body: Readonly<BodyDims>, scale: number, action: ProcAction, left: ToolKind, right: ToolKind, grip: readonly [number, number]): { rig: PersonRig; out: Float32Array } {
  const look = { ...lookFor({ id: 'scrub', role: 'nurse', outfit: 'theatre', variant: 2 }) }
  look.scale = scale
  const rig = createRig(look, body)
  // (what the model does when it dresses the person: the avatar's measured hand middle)
  rig.dims.grip[0] = grip[0]
  rig.dims.grip[1] = grip[1]
  const inp = makeInput()
  inp.posture = 'stand'
  inp.mode = modeFor('idle', 'stand', 'none', action, true)
  inp.actOn = true
  inp.attire = ATTIRE.gloves | ATTIRE.gown | ATTIRE.mask
  inp.toolL = instrumentKindOf(left)
  inp.toolR = instrumentKindOf(right)
  inp.hasWork = true
  inp.workX = 0.02
  inp.workY = standPelvis(body) * scale + 0.2
  inp.workZ = 0.48
  const out = new Float32Array(PART_COUNT * 12)
  for (let i = 0; i < 75; i++) {
    inp.time = i / 60
    inp.simT = 100 + i / 60
    inp.actProg = 0.35
    solveRig(rig, inp, out, 0)
  }
  return { rig, out }
}

const col = (m: ArrayLike<number>, o: number, c: number, s: number): V3 => [m[o + c] / s, m[o + 4 + c] / s, m[o + 8 + c] / s]
const at = (m: ArrayLike<number>, o: number): V3 => [m[o + 3], m[o + 7], m[o + 11]]
const det = (a: V3, b: V3, c: V3): number => a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])
const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** The grip point the table defines, from the hand part's matrix (`out`, scaled by s). */
function expectedGrip(out: Float32Array, hand: number, side: 1 | -1, kind: number, s: number, grip: readonly number[]): V3 {
  const spec = specOfKind(kind)!
  const o = hand * 12
  const x = col(out, o, 0, s)
  const y = col(out, o, 1, s)
  const z = col(out, o, 2, s)
  const w = at(out, o)
  const gx = -side * (grip[0] * s + spec.offset[0])
  const gy = -grip[1] * s + spec.offset[1]
  const gz = spec.offset[2]
  return [w[0] + x[0] * gx + y[0] * gy + z[0] * gz, w[1] + x[1] * gx + y[1] * gy + z[1] * gz, w[2] + x[2] * gx + y[2] * gy + z[2] * gz]
}

/** The aim point of a hand's pose (root frame). */
function aimOf(rig: PersonRig, base: number): V3 | null {
  const up = rig.up
  const w = up[base]
  if (!(w > 0.99)) return null
  const s = rig.dims.s
  const sp = standPelvis(rig.dims.b)
  return [(up[base + 1] / w) * s, sp * s + (up[base + 2] / w - sp) * s, (up[base + 3] / w) * s]
}

describe('the instrument frames', () => {
  it('sit on the grip point, aim at the work, and are never mirrored: every case, every skeleton, both sizes', async () => {
    const loaded = await loadPeopleFromDisk()
    const bodies: { id: string; body: Readonly<BodyDims>; mesh: ReturnType<typeof cpuMesh> | null; binds: number[] | null; grip: readonly [number, number] }[] = [
      { id: 'procedural', body: NOMINAL_BODY, mesh: null, binds: null, grip: PROCEDURAL_GRIP },
      ...loaded.avatars.map((a) => ({ id: a.entry.id, body: a.entry.body, mesh: cpuMesh(a.lods[0]), binds: a.entry.bindInverse, grip: handGripOfBody(a.lods[0], a.entry.bindInverse)! })),
    ]
    const out: string[] = []
    let frames = 0
    for (const b of bodies) {
      for (const scale of [0.94, 1.06]) {
        for (const [action, left, right] of CASES) {
          const { rig, out: rows } = pose(b.body, scale, action, left, right, b.grip)
          for (const [side, part, hand, inst, aimBase] of [
            [1, P.propL, P.handL, rig.instL, AIM_L],
            [-1, P.prop, P.handR, rig.instR, AIM_R],
          ] as const) {
            if (inst === 0) continue
            frames++
            const o = part * 12
            const X = col(rows, o, 0, 1)
            const Y = col(rows, o, 1, 1)
            const Z = col(rows, o, 2, 1)
            const label = `${b.id} ${scale} ${action} ${side === 1 ? 'L' : 'R'}`
            if (!(det(X, Y, Z) > 0.9)) out.push(`${label}: det ${det(X, Y, Z).toFixed(3)}`)
            const g = expectedGrip(rows, hand, side, inst, scale, b.grip)
            if (dist(at(rows, o), g) > 0.001) out.push(`${label}: origin ${(dist(at(rows, o), g) * 1000).toFixed(1)} mm off the grip point`)
            // the aimed axis: the line from the origin along -Y passes the aim point
            const aim = specOfKind(inst)!.aim ? aimOf(rig, aimBase) : null
            if (aim) {
              const d: V3 = [aim[0] - rows[o + 3], aim[1] - rows[o + 7], aim[2] - rows[o + 11]]
              const t = -(d[0] * Y[0] + d[1] * Y[1] + d[2] * Y[2])
              const off = Math.hypot(d[0] + t * Y[0], d[1] + t * Y[1], d[2] + t * Y[2])
              if (t > 0.008 && off > 0.005) out.push(`${label}: axis ${(off * 1000).toFixed(1)} mm from the aim point`)
            }
          }
          // the palm-side middle of the hand is where the avatar's hand mesh is
          if (b.mesh && b.binds) {
            const skinRows = Float32Array.from(rows)
            applyBinds(skinRows, 0, b.binds)
            const pts = skinAll(b.mesh, skinRows)
            for (const [side, hand] of [
              [1, P.handL],
              [-1, P.handR],
            ] as const) {
              let n = 0
              const c: V3 = [0, 0, 0]
              for (let v = 0; v < b.mesh.count; v++) {
                let w = 0
                for (let k = 0; k < 4; k++) if (Math.round(b.mesh.joints[v * 4 + k]) === hand) w += b.mesh.weights[v * 4 + k]
                if (w < 0.8) continue
                n++
                c[0] += pts[v * 3]
                c[1] += pts[v * 3 + 1]
                c[2] += pts[v * 3 + 2]
              }
              const mid: V3 = [c[0] / n, c[1] / n, c[2] / n]
              const ho = hand * 12
              const x = col(rows, ho, 0, scale)
              const y = col(rows, ho, 1, scale)
              const w = at(rows, ho)
              const palmMid: V3 = [0, 1, 2].map((i) => w[i] - y[i] * b.grip[1] * scale - side * x[i] * b.grip[0] * scale) as V3
              if (dist(mid, palmMid) > 0.015) out.push(`${b.id} ${scale} ${action} ${side === 1 ? 'L' : 'R'}: the hand mesh's middle is ${(dist(mid, palmMid) * 100).toFixed(1)} cm from the grip's`)
            }
          }
        }
      }
    }
    expect(out).toEqual([])
    expect(frames).toBeGreaterThan(bodies.length * 2 * CASES.length)
  }, 120_000)

  it("a procedure patient's breathing tube rides the left-hand frame at the mouth, right handed, out of the face", () => {
    const look = { ...lookFor({ id: 'patient', role: 'patient', outfit: 'gown', variant: 1 }) }
    const rig = createRig(look, NOMINAL_BODY)
    const inp = makeInput()
    inp.posture = 'lie'
    inp.mode = 'lie'
    inp.seatHeight = 0.88
    inp.tube = true
    const rows = new Float32Array(PART_COUNT * 12)
    for (let i = 0; i < 90; i++) {
      inp.time = i / 60
      solveRig(rig, inp, rows, 0)
    }
    expect(rig.tube).toBe(true)
    const o = P.propL * 12
    const X = col(rows, o, 0, 1)
    const Y = col(rows, o, 1, 1)
    const Z = col(rows, o, 2, 1)
    expect(det(X, Y, Z)).toBeGreaterThan(0.99)
    // lying face up: the tube comes out of the mouth upwards, above the head's middle
    expect(Y[1]).toBeGreaterThan(0.8)
    const head = at(rows, P.head * 12)
    expect(rows[o + 7]).toBeGreaterThan(head[1])
    inp.tube = false
    solveRig(rig, inp, rows, 0)
    expect(rig.tube).toBe(false)
    // nothing drawn: the frame is collapsed (its axes zero; the lying transform moves its origin only)
    for (const k of [0, 1, 2, 4, 5, 6, 8, 9, 10]) expect(rows[o + k]).toBe(0)
  })
})
