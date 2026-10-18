#!/usr/bin/env node
// Ported from Waltz City (tools/convert-people.mjs, wave 10b). New for the hospital (W3 wave B): the cast of 14 (the 8 medical avatars and 6
// everyday adults), the stethoscope in the atlas, the surgical cap and mask left out, the garment tint masks, the lying fit, the badge anchor,
// LODs of 4,000 / 1,200 / 350 triangles and a single 1K atlas.
/**
 * convert-people.mjs: Microsoft Rocketbox avatars -> the hospital crowd's realistic people.
 *
 *   npm run convert-people [-- --only id,id] [-- --no-record]        (node --import tsx tools/convert-people.mjs)
 *
 * Inputs are only files that passed tools/fetch-assets.mjs (dest "source", in assets-src/people/, never served): each avatar's FBX (hipoly mesh,
 * 3ds Max Biped skeleton) and its body, head, hair (opacity) and stethoscope colour textures, TGA. Their sha256 is checked against
 * public/assets/manifest.json first. No network. Per avatar:
 *   1. load the FBX with three's FBXLoader as DATA (textures stubbed: only the file names are read; nothing in the file runs), metres, Y up, +Z
 *   2. fold the 80 bones onto the crowd's parts (people-lib partForBone / mergeWeights: face bones -> head, fingers -> hand, toes -> foot,
 *      clavicles -> chest; 4 influences, summing to 1); leave out the glasses and the surgical cap and mask (every dropped material is logged)
 *   3. measure the skeleton (fitAvatar): the avatar's own BodyDims at nominal size and its bind frames B_p; seat it on a 0.45 m chair and lay it
 *      on a 0.62 m mattress with the crowd's own rig to fit the seated and lying pelvis heights
 *   4. weld, then simplify with meshoptimizer to about 4,000 / 1,200 / 350 triangles (LOD 0, 1, 2)
 *   5. write public/assets/people/<id>.lod<n>.glb: one skinned primitive, a skin over the crowd's parts whose inverse bind matrices are B_p^-1,
 *      float positions in nominal space, quantised normals / UVs / weights, EXT_meshopt_compression; each file passes the Khronos validator
 *   6. the atlas: macOS `sips` decodes and downscales the TGAs, `sharp` packs them (people-lib atlasLayout) into <id>.1k.webp (1024 x 1536), whose
 *      alpha is the garment tint mask in the body and head regions (255 untinted, 170 top, 85 bottom) and the hair's opacity in the hair region
 *   7. a palette (skin, hair, top, trousers, shoes ...) sampled from the atlas, the garments' reference luminance and the badge anchor
 * and finally public/assets/people/index.json (PeopleIndex in src/scene/actors/crowd/avatars.ts), LICENSE.txt (the MIT notice) and the derived
 * files' hashes in public/assets/manifest.json + docs/CREDITS.md (under the shared tools/.fetch.lock).
 */
import { execFileSync } from 'node:child_process'
import { promises as fs, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions'
import { quantize, reorder } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
import { sha256Hex, validateGltfBytes } from './assets-lib.mjs'
import { PROJECT_ROOT, acquireLock, paths, readInstalled, verifyInstalledAsset, writeCredits, writeInstalled } from './fetch-assets.mjs'
import {
  ATLAS_SIZE,
  atlasLayout,
  atlasUv,
  badgeAnchor,
  bindFrames,
  bindInverses,
  fitAvatar,
  fitLying,
  fitSeatedPelvis,
  garmentMask,
  inRect,
  lodTarget,
  mergeWeights,
  partForBone,
  regionForMaterial,
  writeMaskAlpha,
} from './people-lib.ts'
import { P, PART_COUNT } from '../src/scene/actors/crowd/constants.ts'

export const CONVERTER_VERSION = 1
const COMMIT = '0943055db6ec570bcef9f2c8b41c9e5467c808f9'
const OUT_DIR = path.join(PROJECT_ROOT, 'public', 'assets', 'people')

/** The cast: Rocketbox folder and gender. Who wears which is decided at run time (avatars.ts UNIFORM, GOWN, EVERYDAY). */
export const AVATARS = [
  { id: 'medical_female_01', source: 'Professions/Medical_Female_01', gender: 'female' },
  { id: 'medical_female_02', source: 'Professions/Medical_Female_02', gender: 'female' },
  { id: 'medical_female_03', source: 'Professions/Medical_Female_03', gender: 'female' },
  { id: 'medical_male_01', source: 'Professions/Medical_Male_01', gender: 'male' },
  { id: 'medical_male_02', source: 'Professions/Medical_Male_02', gender: 'male' },
  { id: 'medical_male_03', source: 'Professions/Medical_Male_03', gender: 'male' },
  { id: 'medical_male_04', source: 'Professions/Medical_Male_04', gender: 'male' },
  // the scrub top is the green under the blue lead apron (the apron keeps its colour)
  { id: 'medical_male_05', source: 'Professions/Medical_Male_05', gender: 'male', garments: { top: '#15775d' } },
  { id: 'female_adult_15', source: 'Adults/Female_Adult_15', gender: 'female' },
  { id: 'female_adult_17', source: 'Adults/Female_Adult_17', gender: 'female' },
  { id: 'business_female_02', source: 'Professions/Business_Female_02', gender: 'female' },
  { id: 'male_adult_08', source: 'Adults/Male_Adult_08', gender: 'male' },
  { id: 'male_adult_12', source: 'Adults/Male_Adult_12', gender: 'male' },
  { id: 'male_adult_13', source: 'Adults/Male_Adult_13', gender: 'male' },
]

/**
 * The Rocketbox licence, verbatim from LICENSE.md at COMMIT (git blob 9bcfb3ece5301a55d3a41bbd00a029ab27d61d13, 1,066 bytes; see
 * docs/ASSETS-POLICY.md). MIT asks that this notice ships with the avatars, so it is written next to them as public/assets/people/LICENSE.txt.
 */
export const ROCKETBOX_LICENSE = `MIT License

Copyright (c) 2020 Microsoft

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`

const PART_NAMES = Object.entries(P).sort((a, b) => a[1] - b[1]).map(([name]) => name)
const log = (...a) => console.log(...a)

// ---------------------------------------------------------------------------------------------
// Loading the FBX in Node
// ---------------------------------------------------------------------------------------------

/** FBXLoader would load textures through an <img>; here a texture only remembers its file name. */
function stubTextures() {
  THREE.TextureLoader.prototype.load = function load(url) {
    const t = new THREE.Texture()
    t.userData.file = String(url).split(/[\\/]/).pop()
    return t
  }
}

/** The avatar's skinned mesh as world-space corners (non-indexed), metres, with its bones' bind positions and each triangle's region. */
export function readFbx(bytes) {
  stubTextures()
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const root = new FBXLoader().parse(ab, '')
  root.updateMatrixWorld(true)
  const meshes = []
  root.traverse((o) => {
    if (o.isSkinnedMesh) meshes.push(o)
  })
  if (meshes.length !== 1) throw new Error(`expected one skinned mesh, found ${meshes.length}`)
  const mesh = meshes[0]
  const g = mesh.geometry
  if (g.index) throw new Error('expected FBXLoader to give a non-indexed geometry')
  const toWorld = mesh.bindMatrix.clone()
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(toWorld)
  const pos = g.getAttribute('position')
  const nor = g.getAttribute('normal')
  const uv = g.getAttribute('uv')
  const si = g.getAttribute('skinIndex')
  const sw = g.getAttribute('skinWeight')
  const n = pos.count
  const P3 = new Float32Array(n * 3)
  const N3 = new Float32Array(n * 3)
  const v = new THREE.Vector3()
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(toWorld).multiplyScalar(0.01)
    P3.set([v.x, v.y, v.z], i * 3)
    v.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize()
    N3.set([v.x, v.y, v.z], i * 3)
  }
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const region = new Array(n / 3).fill(null)
  const textures = {}
  const dropped = new Map()
  for (const gr of g.groups) {
    const m = mats[gr.materialIndex]
    const use = regionForMaterial(m.name)
    if (use.region && m.map?.userData.file) textures[use.region] = m.map.userData.file
    if (!use.region) dropped.set(m.name, { why: use.why, triangles: (dropped.get(m.name)?.triangles ?? 0) + gr.count / 3 })
    for (let t = gr.start / 3; t < (gr.start + gr.count) / 3; t++) region[t] = use.region
  }
  const bones = mesh.skeleton.bones
  const joints = {}
  const m4 = new THREE.Matrix4()
  bones.forEach((b, i) => {
    m4.copy(mesh.skeleton.boneInverses[i]).invert()
    const p = new THREE.Vector3().setFromMatrixPosition(m4).multiplyScalar(0.01)
    joints[b.name] = [p.x, p.y, p.z]
  })
  const skinIndex = new Uint16Array(n * 4)
  const skinWeight = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 4; k++) {
      skinIndex[i * 4 + k] = si.getComponent(i, k)
      skinWeight[i * 4 + k] = sw.getComponent(i, k)
    }
  }
  return {
    name: mesh.name,
    corners: n,
    pos: P3,
    nor: N3,
    uv: Float32Array.from({ length: n * 2 }, (_, i) => (i & 1 ? uv.getY(i >> 1) : uv.getX(i >> 1))),
    region,
    textures,
    dropped: [...dropped].map(([name, d]) => ({ name, ...d })),
    boneNames: bones.map((b) => b.name),
    joints,
    skinIndex,
    skinWeight,
  }
}

// ---------------------------------------------------------------------------------------------
// Geometry: re-skin, normalise, weld, simplify
// ---------------------------------------------------------------------------------------------

const J = (joints, name) => {
  const j = joints[name]
  if (!j) throw new Error(`skeleton has no ${name}`)
  return j
}

/** Everything in nominal space, welded into an indexed mesh with crowd-part skinning and atlas UVs (`layout`). */
export function buildAvatarMesh(src, layout) {
  const boneParts = src.boneNames.map(partForBone)
  const merged = mergeWeights(src.skinIndex, src.skinWeight, boneParts, src.corners)
  const kept = (t) => src.region[t] !== null && layout[src.region[t]] !== null
  // floor and crown (the top of everything weighted mostly to the head: hair included)
  let floor = Infinity
  let crown = -Infinity
  for (let i = 0; i < src.corners; i++) {
    if (!kept(Math.floor(i / 3))) continue
    const y = src.pos[i * 3 + 1]
    floor = Math.min(floor, y)
    if (merged.joints[i * 4] === P.head) crown = Math.max(crown, y)
  }
  const lift = (p) => [p[0], p[1] - floor, p[2]]
  const j = src.joints
  const meshJoints = {
    spine: lift(J(j, 'Bip01_Spine')),
    neck: lift(J(j, 'Bip01_Neck')),
    hipL: lift(J(j, 'Bip01_L_Thigh')),
    hipR: lift(J(j, 'Bip01_R_Thigh')),
    kneeL: lift(J(j, 'Bip01_L_Calf')),
    kneeR: lift(J(j, 'Bip01_R_Calf')),
    ankleL: lift(J(j, 'Bip01_L_Foot')),
    ankleR: lift(J(j, 'Bip01_R_Foot')),
    shoulderL: lift(J(j, 'Bip01_L_UpperArm')),
    shoulderR: lift(J(j, 'Bip01_R_UpperArm')),
    elbowL: lift(J(j, 'Bip01_L_Forearm')),
    elbowR: lift(J(j, 'Bip01_R_Forearm')),
    wristL: lift(J(j, 'Bip01_L_Hand')),
    wristR: lift(J(j, 'Bip01_R_Hand')),
    fingerL: lift(J(j, 'Bip01_L_Finger2')),
    fingerR: lift(J(j, 'Bip01_R_Finger2')),
    crownY: crown - floor,
  }
  // the back of the upper thighs (8 to 20 cm below the hips): what the avatar sits on
  const hipY = (meshJoints.hipL[1] + meshJoints.hipR[1]) / 2
  const hipZ = (meshJoints.hipL[2] + meshJoints.hipR[2]) / 2
  let seatDepth = 0
  for (let i = 0; i < src.corners; i++) {
    if (!kept(Math.floor(i / 3))) continue
    const part = merged.joints[i * 4]
    if (part !== P.thighL && part !== P.thighR) continue
    const y = src.pos[i * 3 + 1] - floor
    if (y < hipY - 0.2 || y > hipY - 0.08) continue
    seatDepth = Math.max(seatDepth, hipZ - src.pos[i * 3 + 2])
  }
  meshJoints.seatDepth = seatDepth
  const fit = fitAvatar(meshJoints)
  const inv = 1 / fit.k

  // weld identical corners (position, normal, uv, skin)
  const key = new Map()
  const pos = []
  const nor = []
  const uv = []
  const jo = []
  const we = []
  const idx = []
  const triRegion = []
  for (let t = 0; t < src.corners / 3; t++) {
    if (!kept(t)) continue
    const r = src.region[t]
    triRegion.push(r)
    for (let c = 0; c < 3; c++) {
      const i = t * 3 + c
      const x = src.pos[i * 3] * inv
      const y = (src.pos[i * 3 + 1] - floor) * inv
      const z = src.pos[i * 3 + 2] * inv
      const [u, v] = atlasUv(layout[r], src.uv[i * 2], src.uv[i * 2 + 1])
      const nx = src.nor[i * 3]
      const ny = src.nor[i * 3 + 1]
      const nz = src.nor[i * 3 + 2]
      const jw = [0, 1, 2, 3].map((k) => `${merged.joints[i * 4 + k]}:${Math.round(merged.weights[i * 4 + k] * 1000)}`).join(',')
      const k = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}|${Math.round(nx * 1e3)},${Math.round(ny * 1e3)},${Math.round(nz * 1e3)}|${Math.round(u * 1e5)},${Math.round(v * 1e5)}|${jw}`
      let id = key.get(k)
      if (id === undefined) {
        id = pos.length / 3
        key.set(k, id)
        pos.push(x, y, z)
        nor.push(nx, ny, nz)
        uv.push(u, v)
        for (let q = 0; q < 4; q++) {
          jo.push(merged.joints[i * 4 + q])
          we.push(merged.weights[i * 4 + q])
        }
      }
      idx.push(id)
    }
  }
  return {
    fit,
    floor,
    mesh: { pos: new Float32Array(pos), nor: new Float32Array(nor), uv: new Float32Array(uv), joints: new Uint8Array(jo), weights: new Float32Array(we), index: new Uint32Array(idx), triRegion },
  }
}

/**
 * meshoptimizer simplification to about `target` triangles, attribute-aware (normals, UVs), then compacted. The far body (`far`, 350 triangles)
 * may collapse across UV seams ('Permissive') but weighs the UVs heavily and the normals lightly, and drops tiny detached pieces ('Prune'): at that
 * budget a seam-locked simplification starves the face and the legs, and an evenly weighted one smears the face texture.
 */
export function simplifyMesh(m, target, far = false) {
  const tris = m.index.length / 3
  if (target >= tris) return { ...m, index: m.index.slice() }
  const n = m.pos.length / 3
  const attrs = new Float32Array(n * 5)
  for (let i = 0; i < n; i++) {
    attrs[i * 5] = m.nor[i * 3]
    attrs[i * 5 + 1] = m.nor[i * 3 + 1]
    attrs[i * 5 + 2] = m.nor[i * 3 + 2]
    attrs[i * 5 + 3] = m.uv[i * 2]
    attrs[i * 5 + 4] = m.uv[i * 2 + 1]
  }
  const weights = [0.25, 0.25, 0.25, 1, 1]
  let index
  if (far) [index] = MeshoptSimplifier.simplifyWithAttributes(m.index, m.pos, 3, attrs, 5, [0.1, 0.1, 0.1, 8, 8], null, target * 3, 1, ['Permissive', 'Prune'])
  else [index] = MeshoptSimplifier.simplifyWithAttributes(m.index, m.pos, 3, attrs, 5, weights, null, target * 3, 1, [])
  if (!far && index.length / 3 > target * 1.15) {
    // UV seams stop the plain simplifier on the smallest LODs: let it collapse across them
    ;[index] = MeshoptSimplifier.simplifyWithAttributes(m.index, m.pos, 3, attrs, 5, weights, null, target * 3, 1, ['Permissive'])
  }
  // compact
  const remap = new Int32Array(n).fill(-1)
  let count = 0
  for (const i of index) if (remap[i] < 0) remap[i] = count++
  const out = { pos: new Float32Array(count * 3), nor: new Float32Array(count * 3), uv: new Float32Array(count * 2), joints: new Uint8Array(count * 4), weights: new Float32Array(count * 4), index: new Uint32Array(index.length) }
  for (let i = 0; i < n; i++) {
    const r = remap[i]
    if (r < 0) continue
    out.pos.set(m.pos.subarray(i * 3, i * 3 + 3), r * 3)
    out.nor.set(m.nor.subarray(i * 3, i * 3 + 3), r * 3)
    out.uv.set(m.uv.subarray(i * 2, i * 2 + 2), r * 2)
    out.joints.set(m.joints.subarray(i * 4, i * 4 + 4), r * 4)
    out.weights.set(m.weights.subarray(i * 4, i * 4 + 4), r * 4)
  }
  for (let i = 0; i < index.length; i++) out.index[i] = remap[index[i]]
  return out
}

// ---------------------------------------------------------------------------------------------
// glb
// ---------------------------------------------------------------------------------------------

/** Column-major 4x4 of a row-major 3x4. */
const mat4Of = (m, o) => [m[o], m[o + 4], m[o + 8], 0, m[o + 1], m[o + 5], m[o + 9], 0, m[o + 2], m[o + 6], m[o + 10], 0, m[o + 3], m[o + 7], m[o + 11], 1]

export async function writeGlb(id, lod, m, B, Binv) {
  const doc = new Document()
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE })
  const buffer = doc.createBuffer()
  const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer)
  const nv = m.pos.length / 3
  const material = doc.createMaterial(`${id}`).setBaseColorFactor([1, 1, 1, 1]).setDoubleSided(true).setRoughnessFactor(0.8).setMetallicFactor(0)
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', acc('VEC3', m.pos))
    .setAttribute('NORMAL', acc('VEC3', m.nor))
    .setAttribute('TEXCOORD_0', acc('VEC2', m.uv))
    .setAttribute('JOINTS_0', acc('VEC4', m.joints))
    .setAttribute('WEIGHTS_0', acc('VEC4', m.weights))
    .setIndices(acc('SCALAR', nv < 65535 ? Uint16Array.from(m.index) : m.index))
    .setMaterial(material)
  const mesh = doc.createMesh(`${id}.lod${lod}`).addPrimitive(prim)
  const skeleton = doc.createNode('crowd-parts')
  const joints = []
  const q = new THREE.Quaternion()
  const mx = new THREE.Matrix4()
  for (let p = 0; p < PART_COUNT; p++) {
    mx.fromArray(mat4Of(B, p * 12))
    q.setFromRotationMatrix(mx)
    const node = doc.createNode(PART_NAMES[p]).setTranslation([B[p * 12 + 3], B[p * 12 + 7], B[p * 12 + 11]]).setRotation([q.x, q.y, q.z, q.w])
    skeleton.addChild(node)
    joints.push(node)
  }
  const ibm = new Float32Array(PART_COUNT * 16)
  for (let p = 0; p < PART_COUNT; p++) ibm.set(mat4Of(Binv, p * 12), p * 16)
  const skin = doc.createSkin('crowd-parts').setSkeleton(skeleton).setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buffer))
  for (const jn of joints) skin.addJoint(jn)
  const body = doc.createNode(id).setMesh(mesh).setSkin(skin)
  doc.createScene(id).addChild(skeleton).addChild(body)
  doc.getRoot().getAsset().generator = `The Ideal Hospital tools/convert-people.mjs v${CONVERTER_VERSION} (glTF-Transform)`
  await MeshoptEncoder.ready
  // positions stay float (nominal space), so the inverse bind matrices are exactly B^-1 for every LOD
  await doc.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }), quantize({ pattern: /^(NORMAL|TEXCOORD_0|JOINTS_0|WEIGHTS_0)$/, quantizeNormal: 10, quantizeTexcoord: 12, quantizeWeight: 8, normalizeWeights: true }))
  // quantize() only declares KHR_mesh_quantization when POSITION is quantised; the normals and UVs need it too
  doc.createExtension(KHRMeshQuantization).setRequired(true)
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
  return Buffer.from(await io.writeBinary(doc))
}

// ---------------------------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------------------------

/** macOS sips (a system binary): TGA -> PNG at w x h (sips -z takes height then width). */
function sipsPng(tga, w, h, dir) {
  const out = path.join(dir, `${path.basename(tga, '.tga')}-${w}x${h}.png`)
  execFileSync('/usr/bin/sips', ['-s', 'format', 'png', '-z', String(h), String(w), tga, '--out', out], { stdio: 'ignore' })
  return out
}

/** The packed atlas as raw RGBA (sRGB), alpha 255 except the hair's opacity. Hair texels that are fully transparent take the hair's mean colour. */
export async function buildAtlas(files, layout, tmp) {
  const [W, H] = ATLAS_SIZE
  const data = new Uint8Array(W * H * 4)
  for (let i = 3; i < data.length; i += 4) data[i] = 255
  for (const region of ['body', 'head', 'hair', 'extra']) {
    const file = files[region]
    const rect = layout[region]
    if (!file || !rect) continue
    const [x, y, w, h] = rect
    const pw = Math.round(w * W)
    const ph = Math.round(h * H)
    const png = sipsPng(file, pw, ph, tmp)
    const { data: raw, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    if (info.width !== pw || info.height !== ph || info.channels !== 4) throw new Error(`${path.basename(file)}: sips gave ${info.width} x ${info.height} x ${info.channels}, expected ${pw} x ${ph} x 4`)
    if (region === 'hair') fillTransparent(raw)
    else for (let i = 3; i < raw.length; i += 4) raw[i] = 255
    // copied in by hand (no compositing: the colour under the hair's transparent texels must survive untouched)
    const left = Math.round(x * W)
    const top = Math.round(y * H)
    for (let row = 0; row < ph; row++) data.set(raw.subarray(row * pw * 4, (row + 1) * pw * 4), ((top + row) * W + left) * 4)
  }
  return { width: W, height: H, data }
}

function fillTransparent(raw) {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let i = 0; i < raw.length; i += 4) {
    if (raw[i + 3] > 200) {
      r += raw[i]
      g += raw[i + 1]
      b += raw[i + 2]
      n++
    }
  }
  if (!n) return
  r = Math.round(r / n)
  g = Math.round(g / n)
  b = Math.round(b / n)
  for (let i = 0; i < raw.length; i += 4) {
    if (raw[i + 3] < 16) {
      raw[i] = r
      raw[i + 1] = g
      raw[i + 2] = b
    }
  }
}

const hex = (c) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`

/** Area-weighted mean atlas colour of the triangles of each crowd part (hair from the hair texture or the scalp). */
export function samplePalette(mesh, atlas, crownY, layout) {
  const acc = new Map()
  const add = (key, c, w) => {
    const a = acc.get(key) ?? [0, 0, 0, 0]
    a[0] += c[0] * w
    a[1] += c[1] * w
    a[2] += c[2] * w
    a[3] += w
    acc.set(key, a)
  }
  const { pos, uv, joints, index } = mesh
  for (let t = 0; t < index.length / 3; t++) {
    const [i0, i1, i2] = [index[t * 3], index[t * 3 + 1], index[t * 3 + 2]]
    const ax = pos[i1 * 3] - pos[i0 * 3]
    const ay = pos[i1 * 3 + 1] - pos[i0 * 3 + 1]
    const az = pos[i1 * 3 + 2] - pos[i0 * 3 + 2]
    const bx = pos[i2 * 3] - pos[i0 * 3]
    const by = pos[i2 * 3 + 1] - pos[i0 * 3 + 1]
    const bz = pos[i2 * 3 + 2] - pos[i0 * 3 + 2]
    const area = 0.5 * Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx)
    const u = (uv[i0 * 2] + uv[i1 * 2] + uv[i2 * 2]) / 3
    const v = (uv[i0 * 2 + 1] + uv[i1 * 2 + 1] + uv[i2 * 2 + 1]) / 3
    const px = Math.min(atlas.width - 1, Math.floor(u * atlas.width))
    const py = Math.min(atlas.height - 1, Math.floor(v * atlas.height))
    const o = (py * atlas.width + px) * 4
    const c = [atlas.data[o], atlas.data[o + 1], atlas.data[o + 2]]
    const alpha = atlas.data[o + 3]
    const part = joints[i0 * 4]
    if (inRect(layout.hair, u, v)) {
      if (alpha > 128) add('hairTex', c, area)
      continue
    }
    if (inRect(layout.extra, u, v)) continue
    const y = (pos[i0 * 3 + 1] + pos[i1 * 3 + 1] + pos[i2 * 3 + 1]) / 3
    if (part === P.head && y > crownY - 0.06) add('scalp', c, area)
    const key = { [P.chest]: 'top', [P.armL]: 'sleeve', [P.armR]: 'sleeve', [P.handL]: 'skin', [P.handR]: 'skin', [P.thighL]: 'upperLeg', [P.thighR]: 'upperLeg', [P.shinL]: 'lowerLeg', [P.shinR]: 'lowerLeg', [P.footL]: 'shoes', [P.footR]: 'shoes', [P.pelvis]: 'pants' }[part]
    if (key) add(key, c, area)
  }
  const mean = (k, fallback) => {
    const a = acc.get(k)
    return a && a[3] > 0 ? hex([a[0] / a[3], a[1] / a[3], a[2] / a[3]]) : fallback
  }
  const top = mean('top', '#808080')
  return {
    skin: mean('skin', '#c48b60'),
    hair: mean('hairTex', mean('scalp', '#3a261a')),
    top,
    sleeve: mean('sleeve', top),
    pants: mean('pants', mean('upperLeg', '#3a4d70')),
    upperLeg: mean('upperLeg', '#3a4d70'),
    lowerLeg: mean('lowerLeg', '#3a4d70'),
    shoes: mean('shoes', '#222326'),
  }
}

// ---------------------------------------------------------------------------------------------
// The whole cast
// ---------------------------------------------------------------------------------------------

/** The gate-installed source files of an avatar, re-hashed against public/assets/manifest.json before anything reads them. */
async function sourcesOf(slug, installed) {
  const id = slug.replace(/_/g, '-')
  const records = Object.entries(installed.assets).filter(([k]) => k.startsWith(`rb-${id}-`))
  if (!records.find(([k]) => k === `rb-${id}-fbx`)) throw new Error(`rb-${id}-fbx is not installed: run node tools/fetch-assets.mjs first`)
  const files = {}
  for (const [k, rec] of records) {
    const problems = await verifyInstalledAsset(rec, PROJECT_ROOT, { originalsOnly: true })
    if (problems.length) throw new Error(`${k}: ${problems.join('; ')}`)
    const f = rec.files.find((x) => x.role === 'original')
    if (!f || f.root !== 'source') throw new Error(`${k}: no source-only original recorded`)
    files[k.slice(`rb-${id}-`.length)] = { abs: path.join(paths().source, f.path), sha256: f.sha256, record: k }
  }
  return files
}

export async function convertAvatar(spec, installed, tmp) {
  const src = await sourcesOf(spec.id, installed)
  const fbx = readFbx(await fs.readFile(src.fbx.abs))
  const texFiles = { body: src['body-color']?.abs, head: src['head-color']?.abs, hair: src['opacity-color']?.abs, extra: src['stethoscope-color']?.abs }
  if (!texFiles.body || !texFiles.head) throw new Error(`${spec.id}: body or head texture missing`)
  const has = (r) => fbx.region.includes(r)
  const dropped = fbx.dropped.map((d) => `${d.name} (${d.triangles} triangles): ${d.why}`)
  for (const r of ['hair', 'extra']) {
    if (has(r) && !texFiles[r]) {
      // a region the mesh uses but whose texture was not fetched: its triangles are left out too
      dropped.push(`${r} triangles: no ${r === 'hair' ? 'opacity' : 'stethoscope'} texture installed`)
      texFiles[r] = undefined
    }
  }
  const layout = atlasLayout(has('hair') && !!texFiles.hair, has('extra') && !!texFiles.extra)
  const { fit, mesh } = buildAvatarMesh(fbx, layout)
  const B = bindFrames(fit)
  const Binv = bindInverses(B)
  // seated: thighs on a 0.45 m chair; lying: the back 2.5 cm into a 0.62 m mattress, measured by posing the skinned mesh with the crowd's rig
  fit.body.seatedPelvis = fitSeatedPelvis(fit.body, Binv, mesh, fit.joints.hipL[1])
  Object.assign(fit.body, fitLying(fit.body, Binv, mesh))
  const tris = mesh.index.length / 3
  log(`  ${fbx.name}: ${fbx.corners / 3} source triangles, ${tris} kept, ${mesh.pos.length / 3} welded vertices, k ${fit.k.toFixed(4)}, seated pelvis ${fit.body.seatedPelvis.toFixed(3)}, lying pelvis ${fit.body.liePelvis.toFixed(3)}, lying feet ${fit.body.lieFeet.toFixed(3)}`)
  for (const d of dropped) log(`  dropped: ${d}`)

  const written = []
  const lods = []
  for (const level of [0, 1, 2]) {
    const m = simplifyMesh(mesh, lodTarget(tris, level), level === 2)
    const bytes = await writeGlb(spec.id, level, m, B, Binv)
    const report = await validateGltfBytes(bytes, { uri: `${spec.id}.lod${level}.glb` })
    if (report.errors > 0) throw new Error(`${spec.id}.lod${level}.glb: the Khronos validator reported ${report.errors} error(s): ${report.errorMessages.join(' | ')}`)
    const file = `${spec.id}.lod${level}.glb`
    await fs.writeFile(path.join(OUT_DIR, file), bytes)
    written.push({ file, bytes })
    lods.push({ file, triangles: m.index.length / 3, vertices: m.pos.length / 3, bytes: bytes.length })
    log(`  LOD ${level}: ${m.index.length / 3} triangles, ${m.pos.length / 3} vertices, ${(bytes.length / 1024).toFixed(1)} KB, validator ${report.errors} errors ${report.warnings} warnings`)
  }
  const atlas = await buildAtlas(texFiles, layout, tmp)
  const palette = samplePalette(mesh, atlas, fit.joints.crownY, layout)
  const tint = garmentMask(mesh, atlas, fit.joints.hipL[1], spec.garments)
  writeMaskAlpha(atlas, tint.garment, layout)
  const file = `${spec.id}.1k.webp`
  const webp = await sharp(Buffer.from(atlas.data.buffer, atlas.data.byteOffset, atlas.data.byteLength), { raw: { width: atlas.width, height: atlas.height, channels: 4 } })
    .webp({ quality: 82, alphaQuality: 100, effort: 5, smartSubsample: true, exact: true })
    .toBuffer()
  await fs.writeFile(path.join(OUT_DIR, file), webp)
  written.push({ file, bytes: webp })
  log(`  atlas: ${atlas.width} x ${atlas.height}, ${(webp.length / 1024).toFixed(1)} KB; top ${tint.top.colour} (${tint.top.texels} texels, luminance ${tint.top.luminance.toFixed(3)}), bottom ${tint.bottom.colour} (${tint.bottom.texels} texels, luminance ${tint.bottom.luminance.toFixed(3)})`)
  const round = (x) => Number(x.toFixed(5))
  const rect = (r) => (r ? r.map(round) : null)
  const entry = {
    id: spec.id,
    source: spec.source,
    gender: spec.gender,
    sourceHeight: round(fit.joints.crownY * fit.k),
    k: round(fit.k),
    body: Object.fromEntries(Object.entries(fit.body).map(([k, v]) => [k, round(v)])),
    bindInverse: Array.from(Binv, round),
    palette,
    tintRef: { top: round(tint.top.luminance), bottom: round(tint.bottom.luminance) },
    atlas: { body: rect(layout.body), head: rect(layout.head), hair: rect(layout.hair), extra: rect(layout.extra) },
    badge: badgeAnchor(mesh, fit).map(round),
    dropped,
    lods,
    texture: { file, width: atlas.width, height: atlas.height, bytes: webp.length },
  }
  return { entry, written, sources: Object.values(src).map((s) => s.sha256), fbxRecord: src.fbx.record }
}

async function recordDerived(results, indexBytes, licenceBytes) {
  const release = await acquireLock(PROJECT_ROOT, { log })
  try {
    const installed = await readInstalled()
    for (const r of results) {
      const rec = installed.assets[r.fbxRecord]
      rec.files = rec.files.filter((f) => f.role !== 'derived')
      for (const w of r.written) {
        rec.files.push({ path: `people/${w.file}`, sha256: sha256Hex(w.bytes), bytes: w.bytes.length, role: 'derived', derivedFrom: r.sources, tool: `tools/convert-people.mjs v${CONVERTER_VERSION}` })
      }
    }
    installed.assets['rb-people-index'] = {
      kind: 'people',
      type: 'json',
      source: { url: null, page: `https://github.com/microsoft/Microsoft-Rocketbox/tree/${COMMIT}/Assets/Avatars`, commit: COMMIT, local: null },
      licence: 'MIT',
      licenceUrl: `https://github.com/microsoft/Microsoft-Rocketbox/blob/${COMMIT}/LICENSE.md`,
      author: 'Microsoft Rocketbox Avatar Library (Copyright (c) 2020 Microsoft); index written by tools/convert-people.mjs',
      notes: 'Index of the converted Rocketbox avatars (skeleton proportions, bind frames, tint references, atlas layouts, files), read by src/scene/actors/crowd/avatars.ts; LICENSE.txt is the MIT notice that ships with them.',
      sha256: sha256Hex(indexBytes),
      bytes: indexBytes.length,
      files: [
        { path: 'people/index.json', sha256: sha256Hex(indexBytes), bytes: indexBytes.length, role: 'derived', tool: `tools/convert-people.mjs v${CONVERTER_VERSION}` },
        { path: 'people/LICENSE.txt', sha256: sha256Hex(licenceBytes), bytes: licenceBytes.length, role: 'derived', tool: `tools/convert-people.mjs v${CONVERTER_VERSION}` },
      ],
      validator: null,
      fetchedAt: new Date().toISOString(),
    }
    await writeInstalled(installed)
    await writeCredits(installed)
  } finally {
    await release()
  }
}

export async function main(argv = process.argv.slice(2)) {
  let only = null
  let record = true
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only') only = String(argv[++i] ?? '').split(',').filter(Boolean)
    else if (argv[i] === '--no-record') record = false
    else throw new Error(`unknown argument ${argv[i]}`)
  }
  await MeshoptSimplifier.ready
  await MeshoptEncoder.ready
  await fs.mkdir(OUT_DIR, { recursive: true })
  const installed = await readInstalled()
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'hospital-people-'))
  const indexFile = path.join(OUT_DIR, 'index.json')
  const previous = await fs.readFile(indexFile, 'utf8').then(JSON.parse).catch(() => null)
  const results = []
  try {
    for (const spec of AVATARS) {
      if (only && !only.includes(spec.id)) {
        const prev = previous?.avatars.find((a) => a.id === spec.id)
        if (prev) results.push({ entry: prev, written: null })
        continue
      }
      log(spec.id)
      results.push(await convertAvatar(spec, installed, tmp))
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  const index = {
    version: 1,
    generatedBy: `tools/convert-people.mjs v${CONVERTER_VERSION}`,
    source: { repo: 'microsoft/Microsoft-Rocketbox', commit: COMMIT, licence: 'MIT' },
    avatars: results.map((r) => r.entry),
  }
  const indexBytes = Buffer.from(`${JSON.stringify(index, null, 1)}\n`)
  await fs.writeFile(indexFile, indexBytes)
  const licenceBytes = Buffer.from(`Microsoft Rocketbox Avatar Library, https://github.com/microsoft/Microsoft-Rocketbox (commit ${COMMIT}).\nThe avatars in this folder were converted from it by tools/convert-people.mjs. Its licence:\n\n${ROCKETBOX_LICENSE}`)
  await fs.writeFile(path.join(OUT_DIR, 'LICENSE.txt'), licenceBytes)
  const total = results.reduce((s, r) => s + (r.written ?? []).reduce((a, w) => a + w.bytes.length, 0), 0)
  log(`wrote ${results.length} avatars, ${(total / 1048576).toFixed(2)} MB (index ${(indexBytes.length / 1024).toFixed(1)} KB)`)
  if (record) {
    // rows for avatars skipped by --only keep their recorded files
    const fresh = results.filter((r) => r.written)
    await recordDerived(fresh, indexBytes, licenceBytes)
  }
}

const invoked = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : ''
if (invoked === import.meta.url) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}
