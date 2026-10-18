// Ported from Waltz City (tools/convert-people.test.ts, wave 10b); the hospital's additions: the lying fit, the atlas layouts and extra materials,
// the garment tint masks and the badge anchor.
import { describe, expect, it } from 'vitest'
import { NOMINAL_BODY, P, PART_COUNT, STAND_CROWN, type BodyDims } from '../src/scene/actors/crowd/constants'
import { applyBinds, skinPoint } from '../src/scene/actors/crowd/avatars'
import {
  ATLAS_SIZE,
  GARMENT,
  MASK,
  atlasLayout,
  atlasUv,
  avatarRows,
  badgeAnchor,
  bindFrames,
  bindInverses,
  fitAvatar,
  fitLying,
  fitSeatedPelvis,
  garmentMask,
  garmentOfPart,
  inRect,
  lodTarget,
  mergeWeights,
  partForBone,
  regionForMaterial,
  shortestArc,
  skinLike,
  srgbToLab,
  transformBy,
  writeMaskAlpha,
  type MaskMesh,
  type MeshJoints,
  type V3,
} from './people-lib'

/** Every bone of a Rocketbox "hipoly_81_bones" skeleton, as FBXLoader names them. */
const ROCKETBOX_BONES = [
  'Bip01', 'Bip01_Pelvis', 'Bip01_Spine', 'Bip01_Spine1', 'Bip01_Spine2', 'Bip01_Neck', 'Bip01_Head', 'Bip01_L_Clavicle', 'Bip01_R_Clavicle',
  'Bip01_L_UpperArm', 'Bip01_L_Forearm', 'Bip01_L_Hand', 'Bip01_R_UpperArm', 'Bip01_R_Forearm', 'Bip01_R_Hand', 'Bip01_L_Thigh', 'Bip01_L_Calf',
  'Bip01_L_Foot', 'Bip01_L_Toe0', 'Bip01_R_Thigh', 'Bip01_R_Calf', 'Bip01_R_Foot', 'Bip01_R_Toe0',
  ...['L', 'R'].flatMap((s) => ['0', '01', '02', '1', '11', '12', '2', '21', '22', '3', '31', '32', '4', '41', '42'].map((f) => `Bip01_${s}_Finger${f}`)),
  'Bip01_MJaw', 'Bip01_RMouthBottom', 'Bip01_RCaninus', 'Bip01_RMouthCorner', 'Bip01_RCheek', 'Bip01_MNose', 'Bip01_ROuterEyebrow', 'Bip01_MBottomLip',
  'Bip01_RMasseter', 'Bip01_MUpperLip', 'Bip01_RUpperlip', 'Bip01_RInnerEyebrow', 'Bip01_MMiddleEyebrow', 'Bip01_REyeBlinkBottom', 'Bip01_REye',
  'Bip01_REyeBlinkTop', 'Bip01_MTongue', 'Bip01_LMouthBottom', 'Bip01_LMouthCorner', 'Bip01_LCaninus', 'Bip01_LOuterEyebrow', 'Bip01_LCheek',
  'Bip01_LMasseter', 'Bip01_LUpperlip', 'Bip01_LInnerEyebrow', 'Bip01_LEyeBlinkBottom', 'Bip01_LEye', 'Bip01_LEyeBlinkTop',
]

/** The joints of a Rocketbox adult woman in mesh space, metres (as the Waltz reference measured them from the FBX bind pose). */
const FEMALE: MeshJoints = {
  spine: [0, 1.044, -0.002],
  neck: [0, 1.454, -0.072],
  hipL: [0.088, 0.923, 0],
  hipR: [-0.088, 0.923, 0],
  kneeL: [0.104, 0.499, -0.032],
  kneeR: [-0.104, 0.499, -0.032],
  ankleL: [0.118, 0.1, -0.063],
  ankleR: [-0.118, 0.1, -0.063],
  shoulderL: [0.172, 1.38, -0.061],
  shoulderR: [-0.172, 1.38, -0.061],
  elbowL: [0.359, 1.21, -0.063],
  elbowR: [-0.359, 1.21, -0.063],
  wristL: [0.524, 1.063, 0.031],
  wristR: [-0.524, 1.063, 0.031],
  fingerL: [0.577, 0.994, 0.066],
  fingerR: [-0.577, 0.994, 0.066],
  crownY: 1.74,
}

describe('re-skinning: bones to crowd parts', () => {
  it('maps every bone of a Rocketbox skeleton to a skinned part, left to +X parts, fingers to the hand, face to the head', () => {
    for (const b of ROCKETBOX_BONES) {
      const p = partForBone(b)
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThanOrEqual(P.footR) // never a hair piece, the coat piece, the badge frame or the prop frame
    }
    expect(partForBone('Bip01_L_UpperArm')).toBe(P.armL)
    expect(partForBone('Bip01_R_Forearm')).toBe(P.foreR)
    expect(partForBone('Bip01_L_Finger42')).toBe(P.handL)
    expect(partForBone('Bip01_R_Toe0')).toBe(P.footR)
    expect(partForBone('Bip01_L_Clavicle')).toBe(P.chest)
    expect(partForBone('Bip01_Spine2')).toBe(P.chest)
    expect(partForBone('Bip01_Pelvis')).toBe(P.pelvis)
    expect(partForBone('Bip01_LEye')).toBe(P.head)
    expect(partForBone('Bip01_MJaw')).toBe(P.head)
    expect(partForBone('Bip01_Neck')).toBe(P.head)
    expect(partForBone('Bip01_L_Calf')).toBe(P.shinL)
    expect(() => partForBone('mixamorig:Hips')).toThrow()
    expect(() => partForBone('Bip01_L_Tail')).toThrow()
  })

  it('merges bone weights onto parts: sums to 1, keeps the four largest, maps every source bone', () => {
    const boneParts = ROCKETBOX_BONES.map(partForBone)
    const idx = (n: string) => ROCKETBOX_BONES.indexOf(n)
    const indices = [idx('Bip01_L_Finger1'), idx('Bip01_L_Finger11'), idx('Bip01_L_Hand'), idx('Bip01_L_Forearm'), idx('Bip01_MJaw'), idx('Bip01_LCheek'), idx('Bip01_Head'), idx('Bip01_Neck'), 0, 0, 0, 0]
    const weights = [0.3, 0.2, 0.3, 0.2, 0.25, 0.25, 0.25, 0.25, 0, 0, 0, 0]
    const out = mergeWeights(indices, weights, boneParts, 3)
    expect([...out.joints.subarray(0, 2)]).toEqual([P.handL, P.foreL])
    expect(out.weights[0]).toBeCloseTo(0.8, 6)
    expect(out.weights[1]).toBeCloseTo(0.2, 6)
    expect(out.joints[4]).toBe(P.head)
    expect(out.weights[4]).toBe(1)
    expect(out.joints[8]).toBe(P.pelvis) // a weightless vertex falls back to the pelvis
    let seed = 7
    const rand = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296
    const n = 500
    const ri = Array.from({ length: n * 4 }, () => Math.floor(rand() * ROCKETBOX_BONES.length))
    const rw = Array.from({ length: n * 4 }, () => rand())
    const m = mergeWeights(ri, rw, boneParts, n)
    for (let v = 0; v < n; v++) {
      let sum = 0
      for (let k = 0; k < 4; k++) {
        sum += m.weights[v * 4 + k]
        expect(m.joints[v * 4 + k]).toBeLessThan(PART_COUNT)
        if (k > 0) expect(m.weights[v * 4 + k]).toBeLessThanOrEqual(m.weights[v * 4 + k - 1] + 1e-7)
      }
      expect(Math.abs(sum - 1)).toBeLessThan(1e-6)
    }
  })
})

describe('bind maths and the fit', () => {
  const fit = fitAvatar(FEMALE)
  const B = bindFrames(fit)
  const Binv = bindInverses(B)

  it("fits the avatar to the crowd: its relaxed standing crown is STAND_CROWN, its bones are the mesh's, and the procedural extras start nominal", () => {
    const b = fit.body
    expect(b.ankle + 0.985 * (b.thigh + b.shin) + b.hipDrop + b.waist + b.neck + b.crown).toBeCloseTo(STAND_CROWN, 6)
    expect(fit.k).toBeGreaterThan(0.95)
    expect(fit.k).toBeLessThan(1.05)
    expect(b.upperArm).toBeCloseTo(Math.hypot(0.359 - 0.172, 1.21 - 1.38, 0.002) / fit.k, 6)
    expect(b.shoulderHalf).toBeCloseTo(0.172 / fit.k, 6)
    expect(b.neckZ).toBeLessThan(0) // the neck sits behind the waist, as in a real body
    expect(b.liePelvis).toBe(NOMINAL_BODY.liePelvis)
    expect(b.lieFeet).toBe(0)
    expect(Object.keys(b).sort()).toEqual(Object.keys(NOMINAL_BODY).sort())
    for (const v of Object.values(b)) expect(Number.isFinite(v)).toBe(true)
  })

  it('bind frames are rigid and sit on the joints; limbs hang from them by their own length', () => {
    for (let p = 0; p < PART_COUNT; p++) {
      const o = p * 12
      const r = [B[o], B[o + 1], B[o + 2], B[o + 4], B[o + 5], B[o + 6], B[o + 8], B[o + 9], B[o + 10]]
      const det = r[0] * (r[4] * r[8] - r[5] * r[7]) - r[1] * (r[3] * r[8] - r[5] * r[6]) + r[2] * (r[3] * r[7] - r[4] * r[6])
      expect(det).toBeCloseTo(1, 6)
    }
    const j = fit.joints
    const local = (part: number, v: V3) => transformBy(Binv, part, v)
    const expectV = (a: V3, b: V3) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 6))
    expectV(local(P.armL, j.elbowL), [0, -fit.body.upperArm, 0])
    expectV(local(P.foreL, j.wristL), [0, -fit.body.forearm, 0])
    expectV(local(P.thighR, j.kneeR), [0, -fit.body.thigh, 0])
    expectV(local(P.shinR, j.ankleR), [0, -fit.body.shin, 0])
    expectV(local(P.chest, j.shoulderL), [fit.body.shoulderHalf, fit.body.shoulderUp, fit.body.shoulderZ])
    expectV(local(P.pelvis, j.hipL), [fit.body.hipHalf, -fit.body.hipDrop, 0])
    expectV(local(P.footL, j.ankleL), [0, 0, 0])
    const arc = shortestArc([0, -1, 0], [1, 0, 0])
    expectV([-arc[1], -arc[4], -arc[7]], [1, 0, 0])
  })

  it('skinning with rows equal to the bind frames reproduces the bind pose exactly', () => {
    const rows = Float32Array.from(B)
    applyBinds(rows, 0, Binv)
    const pts: V3[] = [[0.1, 1.2, 0.05], [0.4, 1.1, 0], [-0.1, 0.3, 0.02], [0, 1.6, 0.08]]
    for (const v of pts) {
      const out = skinPoint(rows, [P.chest, P.armL, P.head, P.thighR], [0.4, 0.3, 0.2, 0.1], v[0], v[1], v[2])
      out.forEach((x, i) => expect(x).toBeCloseTo(v[i], 5))
    }
  })

  it('every joint lands at the same point through its parent and through itself: standing, walking, seated, lying and reclined', () => {
    const j = fit.joints
    const pairs: [number, number, V3][] = [
      [P.pelvis, P.chest, j.spine],
      [P.chest, P.head, j.neck],
      [P.chest, P.armL, j.shoulderL],
      [P.chest, P.armR, j.shoulderR],
      [P.armL, P.foreL, j.elbowL],
      [P.foreR, P.handR, j.wristR],
      [P.pelvis, P.thighL, j.hipL],
      [P.thighR, P.shinR, j.kneeR],
      [P.shinL, P.footL, j.ankleL],
    ]
    const body: BodyDims = { ...fit.body, lieFeet: 0.06 }
    const cases = [
      avatarRows(body, Binv, 'stand', {}),
      avatarRows(body, Binv, 'stand', { speed: 1.4, frames: 100, scale: 1.05 }),
      avatarRows(body, Binv, 'sit', {}),
      avatarRows(body, Binv, 'lie', {}),
      avatarRows(body, Binv, 'lie', { recline: 1 }),
    ]
    for (const rows of cases) {
      for (const [a, b, joint] of pairs) {
        const pa = transformBy(rows, a, joint)
        const pb = transformBy(rows, b, joint)
        expect(Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2])).toBeLessThan(1e-4)
      }
    }
  })

  it('seats the avatar on its thighs and lays it on its back: the lowest point over the seat and of the back end just inside the cushion', () => {
    // a crude body: points around the hips and under the thighs, weighted to pelvis and thighs; a back and heels for the bed
    const pos: number[] = []
    const joints: number[] = []
    const weights: number[] = []
    const hy = fit.joints.hipL[1]
    for (let i = 0; i < 40; i++) {
      const x = ((i % 8) - 3.5) * 0.04
      const y = hy - 0.02 - (Math.floor(i / 8) % 5) * 0.025
      pos.push(x, y, -0.11)
      joints.push(x > 0 ? P.thighL : P.thighR, P.pelvis, 0, 0)
      weights.push(0.6, 0.4, 0, 0)
    }
    for (let i = 0; i < 10; i++) {
      pos.push(((i % 5) - 2) * 0.05, hy + 0.05 + i * 0.04, -0.13) // the back
      joints.push(i < 4 ? P.pelvis : P.chest, 0, 0, 0)
      weights.push(1, 0, 0, 0)
    }
    for (const side of [1, -1]) {
      pos.push(side * 0.12, fit.joints.ankleL[1] - 0.06, fit.joints.ankleL[2] - 0.07) // a heel
      joints.push(side > 0 ? P.footL : P.footR, 0, 0, 0)
      weights.push(1, 0, 0, 0)
    }
    const mesh = { pos, joints, weights }
    const sp = fitSeatedPelvis(fit.body, Binv, mesh, hy)
    expect(sp).toBeGreaterThan(0.09)
    expect(sp).toBeLessThan(0.22)
    const seatRows = avatarRows({ ...fit.body, seatedPelvis: sp }, Binv, 'sit', { frames: 90 })
    let low = Infinity
    for (let v = 0; v < 40; v++) {
      const p = skinPoint(seatRows, joints.slice(v * 4, v * 4 + 4), weights.slice(v * 4, v * 4 + 4), pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2])
      if (Math.abs(p[0]) < 0.2 && Math.abs(p[2]) < 0.2) low = Math.min(low, p[1])
    }
    expect(low).toBeGreaterThan(0.45 - 0.02)
    expect(low).toBeLessThan(0.45)
    const lying = fitLying(fit.body, Binv, mesh)
    expect(lying.liePelvis).toBeGreaterThan(0)
    expect(lying.lieFeet).toBeGreaterThanOrEqual(0)
    const bedRows = avatarRows({ ...fit.body, ...lying }, Binv, 'lie', {})
    let back = Infinity
    let heel = Infinity
    for (let v = 40; v < pos.length / 3; v++) {
      const p = skinPoint(bedRows, joints.slice(v * 4, v * 4 + 4), weights.slice(v * 4, v * 4 + 4), pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2])
      if (v < 50) back = Math.min(back, p[1])
      else heel = Math.min(heel, p[1])
    }
    expect(0.62 - back).toBeGreaterThan(0.015)
    expect(0.62 - back).toBeLessThan(0.035)
    expect(Math.abs(0.62 - 0.01 - heel)).toBeLessThan(0.02)
  })
})

describe('atlas, materials and LODs', () => {
  it('lays the atlas out by what the avatar has: hair alone, hair and stethoscope, stethoscope alone', () => {
    const area = (l: ReturnType<typeof atlasLayout>) => [l.body, l.head, l.hair, l.extra].reduce((s, r) => s + (r ? r[2] * r[3] : 0), 0)
    const both = atlasLayout(true, true)
    expect(area(both)).toBeCloseTo(1, 9) // the regions tile the atlas without overlapping
    expect(both.hair![3] * ATLAS_SIZE[1]).toBe(256) // 512 x 256: medical_female_02's 2:1 hair texture at half size
    expect(area(atlasLayout(true, false))).toBeCloseTo(1, 9)
    expect(atlasLayout(false, true).hair).toBeNull()
    expect(atlasLayout(false, true).extra).toEqual([0.5, 2 / 3, 0.5, 1 / 3])
    expect(atlasLayout(false, false).extra).toBeNull()
    expect(atlasUv([0, 0, 1, 2 / 3], 0, 1)).toEqual([0, 0])
    expect(atlasUv([0, 0, 1, 2 / 3], 1, 0)).toEqual([1, 2 / 3])
    const [u, v] = atlasUv([0.5, 2 / 3, 0.5, 1 / 3], 0.5, 0.5)
    expect(u).toBeCloseTo(0.75, 9)
    expect(v).toBeCloseTo(2 / 3 + 1 / 6, 9)
    expect(inRect(both.hair, 0.75, 0.7)).toBe(true)
    expect(inRect(both.hair, 0.75, 0.9)).toBe(false)
    expect(inRect(null, 0.75, 0.7)).toBe(false)
  })

  it('keeps the body, head, hair and stethoscope; drops the surgical cap and mask and the glasses, saying why', () => {
    expect(regionForMaterial('f152_body').region).toBe('body')
    expect(regionForMaterial('m162_head').region).toBe('head')
    expect(regionForMaterial('f152_opacity').region).toBe('hair')
    expect(regionForMaterial('f153_stetoskop').region).toBe('extra')
    const cap = regionForMaterial('m162_protection')
    expect(cap.region).toBeNull()
    expect(cap.why).toMatch(/cap and mask/)
    expect(regionForMaterial('f015_glasses').region).toBeNull()
    expect(regionForMaterial('x_unknown').region).toBeNull()
  })

  it('asks for about 4,000 / 1,200 / 350 triangles, never more than the source has', () => {
    expect([0, 1, 2].map((l) => lodTarget(8966, l as 0 | 1 | 2))).toEqual([4000, 1200, 350])
    expect(lodTarget(3000, 0)).toBe(3000)
  })
})

describe('garment tint masks', () => {
  it('classifies parts into garments: chest and arms the top, legs the bottom, the pelvis by height, head, hands and feet none', () => {
    expect(garmentOfPart(P.chest, 1.2, 0.9)).toBe(GARMENT.top)
    expect(garmentOfPart(P.foreL, 1.0, 0.9)).toBe(GARMENT.top)
    expect(garmentOfPart(P.shinR, 0.3, 0.9)).toBe(GARMENT.bottom)
    expect(garmentOfPart(P.pelvis, 1.0, 0.9)).toBe(GARMENT.top)
    expect(garmentOfPart(P.pelvis, 0.85, 0.9)).toBe(GARMENT.bottom)
    for (const p of [P.head, P.handL, P.footR]) expect(garmentOfPart(p, 1, 0.9)).toBe(GARMENT.none)
    // skin is never a garment's main colour; saturated cloth and dark suits are not skin
    expect(skinLike(srgbToLab(196, 139, 96))).toBe(true)
    expect(skinLike(srgbToLab(108, 61, 38))).toBe(true)
    expect(skinLike(srgbToLab(35, 79, 189))).toBe(false)
    expect(skinLike(srgbToLab(21, 119, 93))).toBe(false)
    expect(skinLike(srgbToLab(55, 25, 21))).toBe(false)
  })

  it('masks a garment by island and colour: its logo, skin and gutters stay untinted, the hair region keeps its opacity', () => {
    // a 12 x 15 atlas: a "shirt" island (chest) of blue texels with one white logo texel, a "trouser" island (thigh) of grey texels and a skin
    // island (hand) in the body region (the top 10 rows), two texels of black gutter between them; the hair region keeps an alpha of 40
    const W = 12
    const H = 15
    const data = new Uint8Array(W * H * 4)
    const fill = (x0: number, y0: number, x1: number, y1: number, c: [number, number, number, number]) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set(c, (y * W + x) * 4)
    }
    fill(0, 0, W, H, [0, 0, 0, 255])
    fill(0, 0, 4, 4, [40, 80, 190, 255]) // shirt
    data.set([250, 250, 250, 255], (1 * W + 1) * 4) // the logo
    fill(6, 0, 10, 4, [120, 120, 125, 255]) // trousers
    fill(0, 6, 3, 9, [200, 150, 120, 255]) // a hand
    fill(6, 10, 12, 15, [90, 60, 30, 40]) // hair
    const quad = (x0: number, y0: number, x1: number, y1: number): number[] => [x0 / W, y0 / H, x1 / W, y0 / H, x1 / W, y1 / H, x0 / W, y1 / H]
    const uv = [...quad(0, 0, 4, 4), ...quad(6, 0, 10, 4), ...quad(0, 6, 3, 9)]
    const pos = [0, 1.2, 0, 0.2, 1.2, 0, 0.2, 1.4, 0, 0, 1.4, 0, 0, 0.5, 0, 0.2, 0.5, 0, 0.2, 0.7, 0, 0, 0.7, 0, 0.3, 0.8, 0, 0.4, 0.8, 0, 0.4, 0.9, 0, 0.3, 0.9, 0]
    const part = [P.chest, P.thighL, P.handL]
    const joints: number[] = []
    const weights: number[] = []
    for (let q = 0; q < 3; q++) {
      for (let k = 0; k < 4; k++) {
        joints.push(part[q], 0, 0, 0)
        weights.push(1, 0, 0, 0)
      }
    }
    const index: number[] = []
    for (let q = 0; q < 3; q++) index.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3)
    const mesh: MaskMesh = { pos, uv, joints, weights, index, triRegion: ['body', 'body', 'body', 'body', 'body', 'body'] }
    const atlas = { width: W, height: H, data }
    const m = garmentMask(mesh, atlas, 0.9)
    const at = (x: number, y: number) => m.garment[y * W + x]
    expect(at(0, 0)).toBe(GARMENT.top)
    expect(at(3, 3)).toBe(GARMENT.top)
    expect(at(1, 1)).toBe(GARMENT.none) // the logo
    expect(at(7, 2)).toBe(GARMENT.bottom)
    expect(at(1, 7)).toBe(GARMENT.none) // the hand
    expect(at(5, 2)).toBe(GARMENT.none) // the gutter between two islands that both paint it
    expect(m.top.texels).toBe(15)
    expect(m.bottom.texels).toBe(16)
    expect(m.top.luminance).toBeGreaterThan(0.05)
    expect(m.top.luminance).toBeLessThan(0.15)
    const layout = { body: [0, 0, 1, 10 / 15], head: [0, 10 / 15, 0.5, 5 / 15], hair: [0.5, 10 / 15, 0.5, 5 / 15], extra: null } as Parameters<typeof writeMaskAlpha>[2]
    writeMaskAlpha(atlas, m.garment, layout)
    expect(data[(0 * W + 0) * 4 + 3]).toBe(MASK.top)
    expect(data[(2 * W + 7) * 4 + 3]).toBe(MASK.bottom)
    expect(data[(1 * W + 1) * 4 + 3]).toBe(MASK.untinted)
    expect(data[(7 * W + 1) * 4 + 3]).toBe(MASK.untinted)
    expect(data[(12 * W + 8) * 4 + 3]).toBe(40) // the hair's opacity is untouched
  })

  it('pins the badge on the front of the chest at the wearer left, a few millimetres proud of the cloth', () => {
    const fit = fitAvatar(FEMALE)
    const pos: number[] = []
    const joints: number[] = []
    const weights: number[] = []
    for (let i = 0; i < 25; i++) {
      pos.push(0.04 + (i % 5) * 0.02, fit.joints.shoulderL[1] - 0.17 + Math.floor(i / 5) * 0.02, 0.1)
      joints.push(P.chest, 0, 0, 0)
      weights.push(1, 0, 0, 0)
    }
    const b = badgeAnchor({ pos, joints, weights }, fit)
    expect(b[0]).toBeGreaterThan(0) // the wearer's left is +X
    expect(b[2]).toBeCloseTo(0.106, 6)
    expect(b[1]).toBeLessThan(fit.joints.shoulderL[1])
  })
})
