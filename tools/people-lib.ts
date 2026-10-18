// Ported from Waltz City (tools/people-lib.ts, wave 10b): partForBone, mergeWeights, the fit, the bind frames and the atlas UVs. New for the hospital
// (W3 wave B): fitLying (a patient's back sinks into the mattress and the heels rest on it), per-avatar atlas layouts with a region for the stethoscope, the garment
// tint masks (UV islands classified by body part, then by colour) and the chest point the player's badge is pinned to.
/**
 * The pure pieces of tools/convert-people.mjs: how a Rocketbox avatar's 3ds Max Biped skeleton folds onto the crowd's rigid parts, where each part
 * sits in the mesh, and what the atlas holds. No I/O, no three.js; unit tested in tools/convert-people.test.ts.
 *
 * Spaces. "Mesh space" is the FBX scene as three's FBXLoader gives it, converted to metres: Y up, the avatar faces +Z, +X is its left hand (the
 * crowd's convention), the floor at y = 0. "Nominal space" is mesh space divided by the avatar's factor k, chosen so the avatar's relaxed standing
 * crown is STAND_CROWN, like every crowd body. The converter writes vertices in nominal space; the rig scales a person by look.scale as before.
 *
 * Re-skinning. Every bone maps to one crowd part (`partForBone`): pelvis bone -> pelvis; spine bones and clavicles -> chest; neck, head and the face
 * bones -> head; upper arm -> arm, forearm -> forearm, hand and fingers -> hand; thigh -> thigh, calf -> shin, foot and toes -> foot. `mergeWeights`
 * adds the weights of bones that share a part, keeps the four largest and renormalises them to sum to 1. Only parts 0 to 16 are ever used (the hair
 * pieces, the coat piece, the badge frame and the prop frame of the procedural body are not skinned).
 *
 * Bind frames. B_p is a rigid frame in nominal space at the part's joint: torso parts and feet keep the mesh's orientation (R = I); a limb's frame
 * turns the crowd's "hangs along -Y" onto the mesh's bone by the shortest arc, chained down the limb (forearm from the upper arm, hand from the
 * forearm, shin from the thigh) so the twist is carried along. The avatar's BodyDims are the mesh's own joint offsets, so the rig puts every joint
 * where the mesh has it: a child joint lands at the same point through its parent's and its own frame (no stretching).
 */
import { BODY, LEG_RELAXED, NOMINAL_BODY, P, PART_COUNT, SEATED_HEAD_CENTRE, STAND_CROWN, type BodyDims } from '../src/scene/actors/crowd/constants'
import { LOD_TRIANGLES, applyBinds, invertRigid, skinPoint, type AtlasRect, type AvatarAtlas } from '../src/scene/actors/crowd/avatars'
import { lookFor } from '../src/scene/actors/crowd/outfit'
import { createRig, makeInput, solveRig } from '../src/scene/actors/crowd/rig'

export type V3 = [number, number, number]

// ---------------------------------------------------------------------------------------------
// Bones -> parts
// ---------------------------------------------------------------------------------------------

/**
 * The crowd part a Rocketbox (3ds Max Biped) bone belongs to. Throws on a bone it does not know, so a new skeleton can never be silently
 * mis-skinned.
 */
export function partForBone(name: string): number {
  const m = /^Bip01(?:_(.+))?$/.exec(name)
  if (!m) throw new Error(`not a Biped bone: "${name}"`)
  const b = m[1] ?? ''
  if (b === '' || b === 'Pelvis') return P.pelvis
  if (/^Spine\d?$/.test(b)) return P.chest
  if (/^(Neck\d?|Head|HeadNub)$/.test(b)) return P.head
  const limb = /^([LR])_(Clavicle|UpperArm|Forearm|Hand|Finger\d+|Thigh|Calf|Foot|Toe\d+)(?:Nub)?$/.exec(b)
  if (limb) {
    const left = limb[1] === 'L'
    switch (limb[2]) {
      case 'Clavicle':
        return P.chest
      case 'UpperArm':
        return left ? P.armL : P.armR
      case 'Forearm':
        return left ? P.foreL : P.foreR
      case 'Thigh':
        return left ? P.thighL : P.thighR
      case 'Calf':
        return left ? P.shinL : P.shinR
      case 'Foot':
        return left ? P.footL : P.footR
      default:
        if (limb[2] === 'Hand' || limb[2].startsWith('Finger')) return left ? P.handL : P.handR
        return left ? P.footL : P.footR // Toe0, Toe01 ...
    }
  }
  // facial bones: Bip01_MJaw, Bip01_LEye, Bip01_RCheek, Bip01_MTongue ... (an M, L or R glued to the name)
  if (/^[LRM][A-Z][A-Za-z]+\d*$/.test(b)) return P.head
  throw new Error(`no crowd part for bone "${name}"`)
}

/**
 * Folds per-vertex bone influences onto crowd parts. `indices` / `weights` are 4 per vertex (bone index, weight); `boneParts[bone]` is that bone's
 * part. Returns 4 parts and 4 weights per vertex: the largest four part sums, in decreasing order, renormalised to sum to exactly 1 (unused slots:
 * part 0, weight 0). A vertex with no weight at all goes wholly to `fallback`.
 */
export function mergeWeights(indices: ArrayLike<number>, weights: ArrayLike<number>, boneParts: ArrayLike<number>, vertexCount: number, fallback: number = P.pelvis): { joints: Uint8Array; weights: Float32Array } {
  const joints = new Uint8Array(vertexCount * 4)
  const out = new Float32Array(vertexCount * 4)
  const acc = new Float64Array(PART_COUNT)
  const order: number[] = []
  for (let v = 0; v < vertexCount; v++) {
    acc.fill(0)
    order.length = 0
    for (let i = 0; i < 4; i++) {
      const w = weights[v * 4 + i]
      if (!(w > 0)) continue
      const part = boneParts[indices[v * 4 + i]]
      if (!(part >= 0 && part < PART_COUNT)) throw new Error(`bone ${indices[v * 4 + i]} has no part`)
      if (acc[part] === 0) order.push(part)
      acc[part] += w
    }
    order.sort((a, b) => acc[b] - acc[a] || a - b)
    const n = Math.min(4, order.length)
    let sum = 0
    for (let i = 0; i < n; i++) sum += acc[order[i]]
    if (n === 0 || !(sum > 0)) {
      joints[v * 4] = fallback
      out[v * 4] = 1
      continue
    }
    let written = 0
    for (let i = 0; i < n; i++) {
      joints[v * 4 + i] = order[i]
      const w = i === n - 1 ? 1 - written : Math.fround(acc[order[i]] / sum)
      out[v * 4 + i] = w
      written += w
    }
  }
  return { joints, weights: out }
}

// ---------------------------------------------------------------------------------------------
// Joints -> body proportions and bind frames
// ---------------------------------------------------------------------------------------------

/** Joint positions of a Biped in mesh space (metres, floor at 0), plus the top of the head. */
export interface MeshJoints {
  /** Bip01_Spine: where the chest bends over the pelvis (the crowd's waist joint). */
  spine: V3
  /** Bip01_Neck: the neck base (the crowd's head joint). */
  neck: V3
  hipL: V3
  hipR: V3
  kneeL: V3
  kneeR: V3
  ankleL: V3
  ankleR: V3
  shoulderL: V3
  shoulderR: V3
  elbowL: V3
  elbowR: V3
  wristL: V3
  wristR: V3
  /** Base of the middle finger (Bip01_L_Finger2). */
  fingerL: V3
  fingerR: V3
  /** Highest point of the head (hair included), metres above the floor. */
  crownY: number
  /**
   * How far the back of the upper thighs reaches behind the hip joints, metres: what the person sits on. When given, the seated pelvis is placed
   * so the thighs rest on the seat; otherwise so the seated head is at SEATED_HEAD_CENTRE.
   */
  seatDepth?: number
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2])
const norm = (a: V3): V3 => {
  const l = len(a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
const mirror = (a: V3): V3 => [-a[0], a[1], a[2]]
const avg = (a: V3, b: V3): V3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]

const PAIRS = [['hipL', 'hipR'], ['kneeL', 'kneeR'], ['ankleL', 'ankleR'], ['shoulderL', 'shoulderR'], ['elbowL', 'elbowR'], ['wristL', 'wristR'], ['fingerL', 'fingerR']] as const

/** Makes the skeleton exactly left-right symmetric (Biped meshes are, to a fraction of a millimetre) and centres the spine. */
export function symmetrise(j: MeshJoints): MeshJoints {
  const out = { ...j } as MeshJoints
  for (const [l, r] of PAIRS) {
    const left = avg(j[l], mirror(j[r]))
    out[l] = left
    out[r] = mirror(left)
  }
  out.spine = [0, j.spine[1], j.spine[2]]
  out.neck = [0, j.neck[1], j.neck[2]]
  return out
}

export interface AvatarFit {
  /** Mesh metres per nominal metre. */
  k: number
  body: BodyDims
  /** The joints in nominal space (symmetric). */
  joints: MeshJoints
  /** Pelvis centre in nominal space (the pelvis part's origin): BODY.hipDrop above the hips. */
  pelvis: V3
}

/**
 * The avatar's skeleton at nominal size. k makes its relaxed standing crown (legs at LEG_RELAXED, like the rig) exactly STAND_CROWN; its head
 * centre is then STAND_HEAD_CENTRE too. Seated, the pelvis sits so the thighs rest on the seat (`seatDepth`; fitSeatedPelvis refines it on the real
 * mesh); lying, it starts at the procedural body's height above the mattress (fitLying refines it).
 */
export function fitAvatar(meshJoints: MeshJoints): AvatarFit {
  const s = symmetrise(meshJoints)
  const thighM = len(sub(s.kneeL, s.hipL))
  const shinM = len(sub(s.ankleL, s.kneeL))
  const k = (s.ankleL[1] + LEG_RELAXED * (thighM + shinM) + (s.crownY - s.hipL[1])) / STAND_CROWN
  const n = 1 / k
  const j: MeshJoints = { ...s }
  for (const key of Object.keys(s) as (keyof MeshJoints)[]) {
    if (key === 'crownY') j.crownY = s.crownY * n
    else if (key === 'seatDepth') j.seatDepth = s.seatDepth === undefined ? undefined : s.seatDepth * n
    else j[key] = scale(s[key] as V3, n)
  }
  const pelvis: V3 = [0, j.hipL[1] + BODY.hipDrop, j.hipL[2]]
  const waist = j.spine[1] - pelvis[1]
  const neck = j.neck[1] - j.spine[1]
  const crown = j.crownY - j.neck[1]
  const headCentre = crown - (BODY.crown - BODY.headCentre)
  const body: BodyDims = {
    ankle: j.ankleL[1],
    thigh: len(sub(j.kneeL, j.hipL)),
    shin: len(sub(j.ankleL, j.kneeL)),
    hipHalf: j.hipL[0],
    hipDrop: BODY.hipDrop,
    waist,
    waistZ: j.spine[2] - pelvis[2],
    neck,
    neckZ: j.neck[2] - j.spine[2],
    shoulderHalf: j.shoulderL[0],
    shoulderUp: j.shoulderL[1] - j.spine[1],
    shoulderZ: j.shoulderL[2] - j.spine[2],
    upperArm: len(sub(j.elbowL, j.shoulderL)),
    forearm: len(sub(j.wristL, j.elbowL)),
    hand: len(sub(j.fingerL, j.wristL)),
    headCentre,
    crown,
    // thighs on the seat (1 cm of cushion), or failing a measurement the seated head where head.ts expects it
    seatedPelvis: Math.min(0.17, Math.max(0.09, j.seatDepth !== undefined ? BODY.hipDrop + j.seatDepth - 0.01 : SEATED_HEAD_CENTRE - (waist + neck + headCentre))),
    liePelvis: NOMINAL_BODY.liePelvis,
    lieFeet: 0,
  }
  return { k, body, joints: j, pelvis }
}

/** A skinned mesh in nominal space: positions and 4 parts + 4 weights per vertex. */
export interface SkinnedPoints {
  pos: ArrayLike<number>
  joints: ArrayLike<number>
  weights: ArrayLike<number>
}

/**
 * Height of the chair the seated fit uses, and of the mattress the lying fit uses. The lying fit is relative to its mattress (the rig puts the pelvis at
 * the surface plus `liePelvis`, whatever the surface is), so any height gives the same numbers: this one stays at the 0.62 m the shipped index was fitted
 * with, so a re-run of the converter reproduces it bit for bit, though the crowd's real beds are lower now (LIE.bed 0.49, LIE.trolley 0.44, LIE.stretcher 0.79).
 */
export const FIT_SEAT = 0.45
export const FIT_BED = 0.62

/** The rig's rows for one pose of an avatar (binds applied), after `frames` frames of a still person: what the vertex shader skins with. */
export function avatarRows(body: BodyDims, bindInverse: ArrayLike<number>, posture: 'stand' | 'sit' | 'lie', opts: { surface?: number; recline?: number; frames?: number; speed?: number; scale?: number } = {}): Float32Array {
  const look = { ...lookFor({ id: 'avatar-fit', role: 'visitor', variant: 0 }), scale: opts.scale ?? 1, build: 1 }
  const rig = createRig(look, body)
  const inp = makeInput()
  inp.posture = posture
  inp.mode = posture === 'stand' ? 'relaxed' : posture
  inp.seatHeight = opts.surface ?? (posture === 'lie' ? FIT_BED : FIT_SEAT)
  rig.ctx.recline = opts.recline ?? 0
  const rows = new Float32Array(PART_COUNT * 12)
  const v = opts.speed ?? 0
  let z = 0
  const frames = opts.frames ?? 150
  for (let i = 0; i < frames; i++) {
    z += v / 60
    inp.time = i / 60
    inp.z = z
    inp.vz = v
    inp.speed = v
    solveRig(rig, inp, rows, 0)
  }
  applyBinds(rows, 0, bindInverse)
  return rows
}

/** The lowest skinned point of the vertices whose main part is one of `parts` (and that pass `keep`, nominal bind position). */
export function lowestSkinned(rows: ArrayLike<number>, mesh: SkinnedPoints, parts: readonly number[], keep: (x: number, y: number, z: number, out: number[]) => boolean = () => true): number {
  let low = Infinity
  const out = [0, 0, 0]
  const j = [0, 0, 0, 0]
  const w = [0, 0, 0, 0]
  const n = mesh.pos.length / 3
  for (let v = 0; v < n; v++) {
    if (!parts.includes(mesh.joints[v * 4])) continue
    for (let k = 0; k < 4; k++) {
      j[k] = mesh.joints[v * 4 + k]
      w[k] = mesh.weights[v * 4 + k]
    }
    skinPoint(rows, j, w, mesh.pos[v * 3], mesh.pos[v * 3 + 1], mesh.pos[v * 3 + 2], out)
    if (!keep(mesh.pos[v * 3], mesh.pos[v * 3 + 1], mesh.pos[v * 3 + 2], out)) continue
    if (out[1] < low) low = out[1]
  }
  return low
}

/**
 * The seated pelvis height (above the seat surface, nominal) at which the avatar's buttocks and thighs rest on the seat, sunk `cushion` metres
 * into it: the rig seats the avatar on a 0.45 m chair, the mesh is skinned as the shader does, and the pelvis moves by however far the lowest
 * point over the seat is off (three passes). Only the body from 16 cm below the hip joints (`hipY`, nominal) up counts: a skirt's hem may drape.
 */
export function fitSeatedPelvis(body: BodyDims, bindInverse: ArrayLike<number>, mesh: SkinnedPoints, hipY: number, cushion = 0.012): number {
  let sp = body.seatedPelvis
  for (let iter = 0; iter < 3; iter++) {
    const rows = avatarRows({ ...body, seatedPelvis: sp }, bindInverse, 'sit', { frames: 90 })
    const low = lowestSkinned(rows, mesh, [P.pelvis, P.thighL, P.thighR], (_x, y, _z, out) => y >= hipY - 0.16 && Math.abs(out[0]) < 0.2 && Math.abs(out[2]) < 0.2)
    if (!Number.isFinite(low)) break
    sp += FIT_SEAT - cushion - low
  }
  return Math.min(0.22, Math.max(0.09, sp))
}

/**
 * How the avatar lies on a 0.62 m mattress: the pelvis height above it (`liePelvis`, nominal) at which its back and buttocks sink `sink` metres
 * into the mattress, and how far back the feet go (`lieFeet`) so its heels sink `heelSink` into it rather than hover (a real body is thicker
 * than the procedural one). The rig lays the avatar flat, the mesh is skinned as the shader does, and both move by however far the lowest torso
 * point (pelvis and chest vertices) and the lowest foot point are off (four passes).
 */
export function fitLying(body: BodyDims, bindInverse: ArrayLike<number>, mesh: SkinnedPoints, sink = 0.025, heelSink = 0.01): { liePelvis: number; lieFeet: number } {
  let lp = body.liePelvis
  let lf = body.lieFeet
  for (let iter = 0; iter < 4; iter++) {
    const rows = avatarRows({ ...body, liePelvis: lp, lieFeet: lf }, bindInverse, 'lie', { frames: 150 })
    const low = lowestSkinned(rows, mesh, [P.pelvis, P.chest])
    const heel = lowestSkinned(rows, mesh, [P.footL, P.footR])
    if (!Number.isFinite(low) || !Number.isFinite(heel)) break
    lp += FIT_BED - sink - low
    // moving the feet back by d lowers the heels by about d (the body pivots at the hips)
    lf = Math.min(0.25, Math.max(0, lf + heel + (FIT_BED - sink - low) - (FIT_BED - heelSink)))
  }
  return { liePelvis: Math.min(0.25, Math.max(-0.05, lp)), lieFeet: lf }
}

/** Rotation (3x3 row-major) that turns unit vector a onto unit vector b by the shortest arc. */
export function shortestArc(a: V3, b: V3): number[] {
  const u = norm(a)
  const v = norm(b)
  const c = u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
  let ax: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
  let s = len(ax)
  if (s < 1e-9) {
    if (c > 0) return [1, 0, 0, 0, 1, 0, 0, 0, 1]
    // opposite: half turn about any axis perpendicular to a
    ax = Math.abs(u[0]) < 0.9 ? norm([0, -u[2], u[1]]) : norm([-u[2], 0, u[0]])
    s = 0
  } else ax = [ax[0] / s, ax[1] / s, ax[2] / s]
  const t = 1 - c
  const [x, y, z] = ax
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ]
}

const mul3 = (a: number[], b: number[]): number[] => {
  const o = new Array<number>(9)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]
  return o
}
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const DOWN: V3 = [0, -1, 0]

function put(out: Float64Array, part: number, r: number[], t: V3): void {
  const o = part * 12
  out[o] = r[0]
  out[o + 1] = r[1]
  out[o + 2] = r[2]
  out[o + 3] = t[0]
  out[o + 4] = r[3]
  out[o + 5] = r[4]
  out[o + 6] = r[5]
  out[o + 7] = t[1]
  out[o + 8] = r[6]
  out[o + 9] = r[7]
  out[o + 10] = r[8]
  out[o + 11] = t[2]
}

/** A limb chain's rotations: the first bone from "hanging along -Y", each next one from the previous bone. */
function chain(points: V3[]): number[][] {
  const rots: number[][] = []
  let prevDir = DOWN
  let prev = I3
  for (let i = 0; i + 1 < points.length; i++) {
    const d = norm(sub(points[i + 1], points[i]))
    const r = mul3(shortestArc(prevDir, d), prev)
    rots.push(r)
    prevDir = d
    prev = r
  }
  return rots
}

/** The bind frames B_p (PART_COUNT x 12, row-major 3x4) of a fitted avatar, in nominal space. */
export function bindFrames(fit: AvatarFit): Float64Array {
  const j = fit.joints
  const B = new Float64Array(PART_COUNT * 12)
  for (let p = 0; p < PART_COUNT; p++) put(B, p, I3, [0, 0, 0])
  put(B, P.pelvis, I3, fit.pelvis)
  put(B, P.chest, I3, j.spine)
  put(B, P.head, I3, j.neck)
  for (const side of ['L', 'R'] as const) {
    const L = side === 'L'
    const arm = chain([j[`shoulder${side}`], j[`elbow${side}`], j[`wrist${side}`], j[`finger${side}`]])
    put(B, L ? P.armL : P.armR, arm[0], j[`shoulder${side}`])
    put(B, L ? P.foreL : P.foreR, arm[1], j[`elbow${side}`])
    put(B, L ? P.handL : P.handR, arm[2], j[`wrist${side}`])
    const leg = chain([j[`hip${side}`], j[`knee${side}`], j[`ankle${side}`]])
    put(B, L ? P.thighL : P.thighR, leg[0], j[`hip${side}`])
    put(B, L ? P.shinL : P.shinR, leg[1], j[`knee${side}`])
    put(B, L ? P.footL : P.footR, I3, j[`ankle${side}`])
  }
  return B
}

/** B_p^-1 for every part (the frames are rigid). */
export function bindInverses(B: Float64Array): Float64Array {
  const out = new Float64Array(B.length)
  for (let p = 0; p < PART_COUNT; p++) invertRigid(B, p * 12, out, p * 12)
  return out
}

/** Transform a point by part p of a PART_COUNT x 12 block. */
export function transformBy(m: ArrayLike<number>, p: number, v: V3): V3 {
  const o = p * 12
  return [m[o] * v[0] + m[o + 1] * v[1] + m[o + 2] * v[2] + m[o + 3], m[o + 4] * v[0] + m[o + 5] * v[1] + m[o + 6] * v[2] + m[o + 7], m[o + 8] * v[0] + m[o + 9] * v[1] + m[o + 10] * v[2] + m[o + 11]]
}

// ---------------------------------------------------------------------------------------------
// Materials, atlas and LODs
// ---------------------------------------------------------------------------------------------

export type AtlasRegion = 'body' | 'head' | 'hair' | 'extra'

/** The atlas, pixels [width, height]: the 2K body texture at 1024 in the top two thirds, the head and the hair (or stethoscope) at 512 below. */
export const ATLAS_SIZE = Object.freeze([1024, 1536] as const)

/**
 * Where each texture sits, by what the avatar has. Body on top, head bottom left, the bottom right for the hair (alpha = opacity, the only
 * alpha-tested region). An avatar with a stethoscope and hair shares the bottom right: the hair (a 2:1 texture for medical_female_02) in its top
 * half, the stethoscope (4:1) in its bottom half. An avatar with a stethoscope and no hair cards gives it the whole bottom right.
 */
export function atlasLayout(hasHair: boolean, hasExtra: boolean): AvatarAtlas {
  const body: AtlasRect = [0, 0, 1, 2 / 3]
  const head: AtlasRect = [0, 2 / 3, 0.5, 1 / 3]
  const corner: AtlasRect = [0.5, 2 / 3, 0.5, 1 / 3]
  if (hasHair && hasExtra) return { body, head, hair: [0.5, 2 / 3, 0.5, 1 / 6], extra: [0.5, 5 / 6, 0.5, 1 / 6] }
  if (hasHair) return { body, head, hair: corner, extra: null }
  if (hasExtra) return { body, head, hair: null, extra: corner }
  return { body, head, hair: null, extra: null }
}

export interface MaterialUse {
  region: AtlasRegion | null
  /** Why a dropped material was left out. */
  why?: string
}

/**
 * Which atlas region a Rocketbox material uses (`f152_body`, `m152_head`, `f152_opacity`, `f153_stetoskop`), or null to drop it: the glasses (the
 * close-up face of the crowd has its own), and the surgical cap and mask (`m162_protection`) of medical_male_04 and _05, so the male nurses,
 * pharmacists and radiographers show their faces (their lead apron, for the radiographer, is part of the body texture and stays).
 */
export function regionForMaterial(name: string): MaterialUse {
  if (/_body$/i.test(name)) return { region: 'body' }
  if (/_head$/i.test(name)) return { region: 'head' }
  if (/_opacity$/i.test(name)) return { region: 'hair' }
  if (/_(stetoskop|stethoscope)$/i.test(name)) return { region: 'extra' }
  if (/_protection$/i.test(name)) return { region: null, why: 'surgical cap and mask: a nurse, pharmacist or radiographer shows their face' }
  if (/_glasses$/i.test(name)) return { region: null, why: 'glasses' }
  return { region: null, why: 'not a body, head, hair or stethoscope material' }
}

/** A source UV (v up, as FBXLoader gives it) mapped into an atlas rectangle (v down). Clamped into the rectangle. */
export function atlasUv(rect: Readonly<AtlasRect>, u: number, v: number): [number, number] {
  const [x, y, w, h] = rect
  const cu = Math.min(1, Math.max(0, u))
  const cv = Math.min(1, Math.max(0, v))
  return [x + cu * w, y + (1 - cv) * h]
}

/** Is an atlas UV inside a rectangle (edges included)? */
export function inRect(rect: Readonly<AtlasRect> | null, u: number, v: number): boolean {
  return !!rect && u >= rect[0] && u <= rect[0] + rect[2] && v >= rect[1] && v <= rect[1] + rect[3]
}

/** Triangle target of LOD `level` for a source of `sourceTriangles` (never more than the source). */
export function lodTarget(sourceTriangles: number, level: 0 | 1 | 2): number {
  return Math.min(sourceTriangles, LOD_TRIANGLES[level])
}

// ---------------------------------------------------------------------------------------------
// Garment tint masks
// ---------------------------------------------------------------------------------------------

/** What the atlas alpha says in the body and head regions (the hair region keeps its opacity). */
export const MASK = { untinted: 255, top: 170, bottom: 85 } as const
export const GARMENT = { none: 0, top: 1, bottom: 2 } as const
export type Garment = (typeof GARMENT)[keyof typeof GARMENT]

const TOP_PARTS: readonly number[] = [P.chest, P.armL, P.armR, P.foreL, P.foreR]
const BOTTOM_PARTS: readonly number[] = [P.thighL, P.thighR, P.shinL, P.shinR]

/**
 * The garment a body triangle is part of, by its main part: the chest and the arms are the top, the thighs and shins the bottom, the pelvis the
 * top above `hipY + 0.04` (a tunic over the hips) and the bottom below it; the head, hands and feet are skin, hair and shoes (none).
 */
export function garmentOfPart(part: number, centroidY: number, hipY: number): Garment {
  if (TOP_PARTS.includes(part)) return GARMENT.top
  if (BOTTOM_PARTS.includes(part)) return GARMENT.bottom
  if (part === P.pelvis) return centroidY > hipY + 0.04 ? GARMENT.top : GARMENT.bottom
  return GARMENT.none
}

/** sRGB 8-bit -> CIELAB (D65). */
export function srgbToLab(r: number, g: number, b: number, out: number[] = [0, 0, 0]): number[] {
  const lin = (c: number) => {
    const x = c / 255
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
  }
  const R = lin(r)
  const G = lin(g)
  const B = lin(b)
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
  const fx = f(X)
  const fy = f(Y)
  const fz = f(Z)
  out[0] = 116 * fy - 16
  out[1] = 500 * (fx - fy)
  out[2] = 200 * (fy - fz)
  return out
}

/** Linear luminance of an sRGB 8-bit colour (what the shader computes from the decoded texel). */
export function linearLuminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const x = c / 255
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/**
 * How far a colour is from a garment's main colour: CIELAB with the lightness at half weight, so the folds and shading baked into a garment
 * stay in it while skin, white reflective bands, dark trims and printed logos do not.
 */
export function garmentDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const dl = (a[0] - b[0]) * 0.5
  const da = a[1] - b[1]
  const db = a[2] - b[2]
  return Math.sqrt(dl * dl + da * da + db * db)
}
/** Colours within this garmentDistance of the main colour are the garment. */
export const GARMENT_DISTANCE = 18

/** A CIELAB colour that looks like skin (light to dark, warm hue): never taken as a garment's main colour. */
export function skinLike(lab: ArrayLike<number>): boolean {
  const [l, a, b] = [lab[0], lab[1], lab[2]]
  return l >= 25 && l <= 92 && a >= 5 && a <= 35 && b >= 8 && b <= 45 && b >= 0.5 * a
}

/** Optional main colours (sRGB hex) for an avatar whose garment is not its most common colour. */
export interface GarmentHints {
  top?: string
  bottom?: string
}

export interface MaskMesh {
  /** Nominal positions (3 per vertex), atlas UVs (2 per vertex), 4 parts + 4 weights per vertex, triangles. */
  pos: ArrayLike<number>
  uv: ArrayLike<number>
  joints: ArrayLike<number>
  weights: ArrayLike<number>
  index: ArrayLike<number>
  triRegion: readonly AtlasRegion[]
}

export interface GarmentStats {
  /** Texels in the mask, the mean linear luminance (the tint reference) and the main colour (sRGB hex). */
  texels: number
  luminance: number
  colour: string
}

export interface TintMask {
  /** Per texel: GARMENT.none / top / bottom after the colour check (and a 3-texel dilation into the gutters). */
  garment: Uint8Array
  top: GarmentStats
  bottom: GarmentStats
}

const hex2 = (c: number[]) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`

/**
 * The garment masks of an avatar's atlas (`width` x `height` RGBA sRGB). UV islands of the body and head regions (triangles that share a UV
 * point) are classified by the parts of their triangles, area weighted (garmentOfPart); every texel of an island is then rasterised. Within each
 * garment, the main colour is the most common colour (CIELAB bins of the texels), and only texels within GARMENT_DISTANCE of it stay in the mask:
 * skin showing at a short sleeve, reflective bands, buttons, logos and trims keep their own colour. The mask spreads 3 texels into the unpainted
 * gutters around its islands, so mip filtering does not wash the garment's edge back to "untinted".
 */
export function garmentMask(mesh: MaskMesh, atlas: { width: number; height: number; data: Uint8Array }, hipY: number, hints: GarmentHints = {}): TintMask {
  const { width: W, height: H, data } = atlas
  const nTri = mesh.index.length / 3
  // 1. UV islands (union-find over triangles sharing a UV point), body and head regions only
  const parent = new Int32Array(nTri)
  for (let t = 0; t < nTri; t++) parent[t] = t
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]
      x = parent[x]
    }
    return x
  }
  const seen = new Map<string, number>()
  const used = (t: number) => mesh.triRegion[t] === 'body' || mesh.triRegion[t] === 'head'
  for (let t = 0; t < nTri; t++) {
    if (!used(t)) continue
    for (let c = 0; c < 3; c++) {
      const i = mesh.index[t * 3 + c]
      const key = `${Math.round(mesh.uv[i * 2] * 8192)},${Math.round(mesh.uv[i * 2 + 1] * 8192)}`
      const other = seen.get(key)
      if (other === undefined) seen.set(key, t)
      else {
        const a = find(t)
        const b = find(other)
        if (a !== b) parent[a] = b
      }
    }
  }
  // 2. each island's garment, area weighted by its triangles' main parts
  const votes = new Map<number, [number, number, number]>()
  const triGarment = new Uint8Array(nTri)
  const partSum = new Float64Array(PART_COUNT)
  for (let t = 0; t < nTri; t++) {
    if (!used(t)) continue
    partSum.fill(0)
    let cy = 0
    const ids = [mesh.index[t * 3], mesh.index[t * 3 + 1], mesh.index[t * 3 + 2]]
    for (const i of ids) {
      for (let k = 0; k < 4; k++) partSum[mesh.joints[i * 4 + k]] += mesh.weights[i * 4 + k]
      cy += mesh.pos[i * 3 + 1] / 3
    }
    let part = 0
    for (let p = 1; p < PART_COUNT; p++) if (partSum[p] > partSum[part]) part = p
    const g = garmentOfPart(part, cy, hipY)
    const [a, b, c] = ids.map((i) => [mesh.pos[i * 3], mesh.pos[i * 3 + 1], mesh.pos[i * 3 + 2]] as V3)
    const e1 = sub(b, a)
    const e2 = sub(c, a)
    const area = 0.5 * len([e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]])
    const root = find(t)
    const v = votes.get(root) ?? [0, 0, 0]
    v[g] += area
    votes.set(root, v)
  }
  for (let t = 0; t < nTri; t++) {
    if (!used(t)) continue
    const v = votes.get(find(t))!
    triGarment[t] = v[GARMENT.top] > v[GARMENT.none] && v[GARMENT.top] >= v[GARMENT.bottom] ? GARMENT.top : v[GARMENT.bottom] > v[GARMENT.none] ? GARMENT.bottom : GARMENT.none
  }
  // 3. rasterise the triangles in texel space: a texel takes its triangle's garment; skin, hair and shoes (none) win over a garment
  const cls = new Uint8Array(W * H).fill(255) // 255: no triangle
  for (let t = 0; t < nTri; t++) {
    if (!used(t)) continue
    const g = triGarment[t]
    const px: number[] = []
    const py: number[] = []
    for (let c = 0; c < 3; c++) {
      const i = mesh.index[t * 3 + c]
      px.push(mesh.uv[i * 2] * W)
      py.push(mesh.uv[i * 2 + 1] * H)
    }
    const x0 = Math.max(0, Math.floor(Math.min(...px) - 1))
    const x1 = Math.min(W - 1, Math.ceil(Math.max(...px) + 1))
    const y0 = Math.max(0, Math.floor(Math.min(...py) - 1))
    const y1 = Math.min(H - 1, Math.ceil(Math.max(...py) + 1))
    const area = (px[1] - px[0]) * (py[2] - py[0]) - (px[2] - px[0]) * (py[1] - py[0])
    if (Math.abs(area) < 1e-9) continue
    // conservative: a texel whose centre is within about 0.7 texel of the triangle counts (seams stay closed)
    const edge = (ax: number, ay: number, bx: number, by: number, x: number, y: number) => {
      const ex = bx - ax
      const ey = by - ay
      const l = Math.hypot(ex, ey) || 1
      return ((x - ax) * ey - (y - ay) * ex) / l
    }
    const sgn = area > 0 ? -1 : 1
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const cx = x + 0.5
        const cyy = y + 0.5
        const d0 = sgn * edge(px[0], py[0], px[1], py[1], cx, cyy)
        const d1 = sgn * edge(px[1], py[1], px[2], py[2], cx, cyy)
        const d2 = sgn * edge(px[2], py[2], px[0], py[0], cx, cyy)
        if (d0 < -0.7 || d1 < -0.7 || d2 < -0.7) continue
        const o = y * W + x
        if (cls[o] === 255 || g === GARMENT.none) cls[o] = g
      }
    }
  }
  // 4. each garment's main colour: the fullest CIELAB bin of its texels (L in 8s, a and b in 6s), averaged
  const lab = [0, 0, 0]
  const stats = (g: Garment): { main: number[]; colour: string } | null => {
    const bins = new Map<string, { n: number; lab: number[]; rgb: number[] }>()
    for (let o = 0; o < W * H; o++) {
      if (cls[o] !== g) continue
      const r = data[o * 4]
      const gg = data[o * 4 + 1]
      const b = data[o * 4 + 2]
      srgbToLab(r, gg, b, lab)
      const key = `${Math.floor(lab[0] / 8)},${Math.floor(lab[1] / 6)},${Math.floor(lab[2] / 6)}`
      const bin = bins.get(key) ?? { n: 0, lab: [0, 0, 0], rgb: [0, 0, 0] }
      bin.n++
      for (let k = 0; k < 3; k++) bin.lab[k] += lab[k]
      bin.rgb[0] += r
      bin.rgb[1] += gg
      bin.rgb[2] += b
      bins.set(key, bin)
    }
    let total = 0
    for (const bin of bins.values()) total += bin.n
    let best: { n: number; lab: number[]; rgb: number[] } | null = null
    const hint = g === GARMENT.top ? hints.top : hints.bottom
    if (hint) {
      // the cast names the garment's colour (medical_male_05: the scrubs under the lead apron): the sizeable bin nearest to it
      const h = srgbToLab(parseInt(hint.slice(1, 3), 16), parseInt(hint.slice(3, 5), 16), parseInt(hint.slice(5, 7), 16))
      let bestD = Infinity
      for (const bin of bins.values()) {
        if (bin.n < total * 0.005) continue
        const d = garmentDistance(bin.lab.map((v) => v / bin.n), h)
        if (d < bestD) {
          bestD = d
          best = bin
        }
      }
    } else {
      // the fullest bin, skin excepted (bare arms under a short sleeve can outnumber a garment's own colour)
      for (const bin of bins.values()) if (!skinLike(bin.lab.map((v) => v / bin.n)) && (!best || bin.n > best.n)) best = bin
      if (!best) for (const bin of bins.values()) if (!best || bin.n > best.n) best = bin
    }
    if (!best) return null
    return { main: best.lab.map((v) => v / best!.n), colour: hex2(best.rgb.map((v) => v / best!.n)) }
  }
  const garment = new Uint8Array(W * H)
  const out: TintMask = { garment, top: { texels: 0, luminance: 0, colour: '#000000' }, bottom: { texels: 0, luminance: 0, colour: '#000000' } }
  for (const g of [GARMENT.top, GARMENT.bottom] as const) {
    const s = stats(g)
    if (!s) continue
    let n = 0
    let lum = 0
    for (let o = 0; o < W * H; o++) {
      if (cls[o] !== g) continue
      const r = data[o * 4]
      const gg = data[o * 4 + 1]
      const b = data[o * 4 + 2]
      if (garmentDistance(srgbToLab(r, gg, b, lab), s.main) > GARMENT_DISTANCE) continue
      garment[o] = g
      n++
      lum += linearLuminance(r, gg, b)
    }
    const st = g === GARMENT.top ? out.top : out.bottom
    st.texels = n
    st.luminance = n > 0 ? lum / n : 0
    st.colour = s.colour
  }
  // 5. spread the garments 3 texels into the gutters (texels no triangle covers)
  for (let pass = 0; pass < 3; pass++) {
    const prev = garment.slice()
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = y * W + x
        if (cls[o] !== 255 || prev[o] !== GARMENT.none) continue
        let g = 0
        if (x > 0 && prev[o - 1]) g = prev[o - 1]
        else if (x < W - 1 && prev[o + 1]) g = prev[o + 1]
        else if (y > 0 && prev[o - W]) g = prev[o - W]
        else if (y < H - 1 && prev[o + W]) g = prev[o + W]
        garment[o] = g
      }
    }
  }
  return out
}

/** Writes the garment mask into the atlas alpha of the body and head regions (MASK values); the hair region is left as it is. */
export function writeMaskAlpha(atlas: { width: number; height: number; data: Uint8Array }, garment: Uint8Array, layout: AvatarAtlas): void {
  const { width: W, height: H, data } = atlas
  for (const rect of [layout.body, layout.head]) {
    const x0 = Math.round(rect[0] * W)
    const y0 = Math.round(rect[1] * H)
    const x1 = Math.round((rect[0] + rect[2]) * W)
    const y1 = Math.round((rect[1] + rect[3]) * H)
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const o = y * W + x
        const g = garment[o]
        data[o * 4 + 3] = g === GARMENT.top ? MASK.top : g === GARMENT.bottom ? MASK.bottom : MASK.untinted
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The badge
// ---------------------------------------------------------------------------------------------

/**
 * Where the player's "You" badge is pinned, nominal bind space: on the front of the chest, the wearer's left (+X), half the shoulder width out
 * and 13 cm below the shoulder joints, 6 mm proud of the cloth (the frontmost chest vertex within 3 cm of that point).
 */
export function badgeAnchor(mesh: SkinnedPoints, fit: AvatarFit): V3 {
  const x = fit.body.shoulderHalf * 0.5
  const y = fit.joints.shoulderL[1] - 0.13
  let front = -Infinity
  const n = mesh.pos.length / 3
  for (let v = 0; v < n; v++) {
    if (mesh.joints[v * 4] !== P.chest) continue
    const px = mesh.pos[v * 3]
    const py = mesh.pos[v * 3 + 1]
    if (Math.abs(px - x) > 0.03 || Math.abs(py - y) > 0.03) continue
    front = Math.max(front, mesh.pos[v * 3 + 2])
  }
  if (!Number.isFinite(front)) front = fit.joints.spine[2] + 0.12
  return [x, y, front + 0.006]
}
