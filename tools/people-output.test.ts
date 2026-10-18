/**
 * What tools/convert-people.mjs shipped (W3 wave B): public/assets/people. Every file the index names is recorded in public/assets/manifest.json with
 * the sha256 of its bytes (derived from the hashed Rocketbox inputs), the MIT notice ships beside them, every glb passes the Khronos validator and
 * is skinned to the crowd's body parts only, with weights that sum to 1, and every atlas is one 1K WebP whose alpha is the garment mask.
 * No network: everything is read from disk.
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
// @ts-ignore TS7016: a .mjs module has no declaration file
import * as libModule from './assets-lib.mjs'
import { STAND_CROWN } from '../src/scene/actors/crowd/constants'
import { LOD_TRIANGLES, SKINNED_PARTS, type PeopleIndex } from '../src/scene/actors/crowd/avatars'
import { cpuMesh, loadBody } from '../src/scene/actors/crowd/avatars.testkit'
import { ATLAS_SIZE } from './people-lib'

/* eslint-disable @typescript-eslint/no-explicit-any */
const lib = libModule as any
const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '..')
const DIR = path.join(ROOT, 'public', 'assets', 'people')
const COMMIT = '0943055db6ec570bcef9f2c8b41c9e5467c808f9'
const index = JSON.parse(readFileSync(path.join(DIR, 'index.json'), 'utf8')) as PeopleIndex
const installed = JSON.parse(readFileSync(path.join(ROOT, 'public', 'assets', 'manifest.json'), 'utf8')) as { assets: Record<string, any> }
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

const CAST = ['medical_female_01', 'medical_female_02', 'medical_female_03', 'medical_male_01', 'medical_male_02', 'medical_male_03', 'medical_male_04', 'medical_male_05', 'female_adult_15', 'female_adult_17', 'business_female_02', 'male_adult_08', 'male_adult_12', 'male_adult_13']

/** Every derived file recorded in the installed manifest, by its path under public/assets. */
function recorded(): Map<string, { sha256: string; bytes: number; derivedFrom?: string[]; record: string }> {
  const out = new Map()
  for (const [k, rec] of Object.entries(installed.assets)) for (const f of rec.files) if (f.role === 'derived') out.set(f.path, { ...f, record: k })
  return out
}

describe('public/assets/people', () => {
  it('holds the 14 avatars of the cast, each with three LODs and one 1K atlas, and nothing else', () => {
    expect(index.version).toBe(1)
    expect(index.source).toEqual({ repo: 'microsoft/Microsoft-Rocketbox', commit: COMMIT, licence: 'MIT' })
    expect(index.avatars.map((a) => a.id)).toEqual(CAST)
    const expected = new Set(['index.json', 'LICENSE.txt'])
    for (const a of index.avatars) {
      expect(a.lods.map((l) => l.file)).toEqual([0, 1, 2].map((i) => `${a.id}.lod${i}.glb`))
      expect(a.texture.file).toBe(`${a.id}.1k.webp`)
      for (const f of [...a.lods.map((l) => l.file), a.texture.file]) expected.add(f)
      a.lods.forEach((l, i) => {
        expect(l.triangles, l.file).toBeLessThanOrEqual(LOD_TRIANGLES[i] * 1.1)
        expect(l.triangles, l.file).toBeGreaterThan(LOD_TRIANGLES[i] * 0.9)
      })
    }
    expect(readdirSync(DIR).sort()).toEqual([...expected].sort())
  })

  it('records every file with the sha256 of its bytes, derived from the hashed Rocketbox inputs of its own avatar', () => {
    const rec = recorded()
    let total = 0
    for (const a of index.avatars) {
      const fbx = installed.assets[`rb-${a.id.replace(/_/g, '-')}-fbx`]
      expect(fbx, a.id).toBeDefined()
      const inputs = Object.entries(installed.assets)
        .filter(([k]) => k.startsWith(`rb-${a.id.replace(/_/g, '-')}-`))
        .map(([, r]) => r.files.find((f: any) => f.role === 'original').sha256)
        .sort()
      for (const file of [...a.lods.map((l) => l.file), a.texture.file]) {
        const bytes = readFileSync(path.join(DIR, file))
        total += bytes.length
        const r = rec.get(`people/${file}`)
        expect(r, file).toBeDefined()
        expect(r!.sha256, file).toBe(sha(bytes))
        expect(r!.bytes, file).toBe(bytes.length)
        expect([...r!.derivedFrom!].sort(), file).toEqual(inputs)
        expect(r!.record, file).toBe(`rb-${a.id.replace(/_/g, '-')}-fbx`)
      }
      expect(a.lods.reduce((s, l) => s + l.bytes, 0) + a.texture.bytes).toBe(a.lods.map((l) => readFileSync(path.join(DIR, l.file)).length).reduce((s, n) => s + n, 0) + readFileSync(path.join(DIR, a.texture.file)).length)
    }
    for (const file of ['index.json', 'LICENSE.txt']) {
      const bytes = readFileSync(path.join(DIR, file))
      expect(rec.get(`people/${file}`)?.sha256, file).toBe(sha(bytes))
      expect(rec.get(`people/${file}`)?.record, file).toBe('rb-people-index')
    }
    // a few MB in all
    expect(total).toBeLessThan(6 * 1048576)
    expect(total).toBeGreaterThan(1 * 1048576)
  })

  it('ships the MIT notice of the Rocketbox library beside the avatars', () => {
    const text = readFileSync(path.join(DIR, 'LICENSE.txt'), 'utf8')
    expect(text).toContain('MIT License')
    expect(text).toContain('Copyright (c) 2020 Microsoft')
    expect(text).toContain('The above copyright notice and this permission notice shall be included in all')
    expect(text).toContain('THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND')
    expect(text).toContain(COMMIT)
  })

  it('every glb passes the Khronos validator with no error, as one skinned primitive', async () => {
    for (const a of index.avatars) {
      for (const l of a.lods) {
        const report = await lib.validateGltfBytes(readFileSync(path.join(DIR, l.file)), { uri: l.file })
        expect(report.errors, `${l.file}: ${report.errorMessages.join(' | ')}`).toBe(0)
        expect(report.info.hasSkins, l.file).toBe(true)
        expect(report.info.drawCalls, l.file).toBe(1)
        expect(report.info.maxInfluences, l.file).toBeLessThanOrEqual(4)
      }
    }
  }, 120_000)

  it('skins every vertex of every LOD to body parts only, with weights that sum to 1', async () => {
    const skinned = new Set(SKINNED_PARTS)
    for (const a of index.avatars) {
      for (let lod = 0; lod < 3; lod++) {
        const m = cpuMesh(await loadBody(a, lod))
        for (let v = 0; v < m.count; v++) {
          let sum = 0
          for (let k = 0; k < 4; k++) {
            const w = m.weights[v * 4 + k]
            sum += w
            if (w > 0) expect(skinned.has(Math.round(m.joints[v * 4 + k])), `${a.id} lod ${lod} vertex ${v}`).toBe(true)
          }
          expect(Math.abs(sum - 1), `${a.id} lod ${lod} vertex ${v}`).toBeLessThan(1e-3)
        }
      }
    }
  }, 120_000)

  it('each atlas is a 1024 x 1536 WebP whose alpha is the garment mask in the body and head regions and the opacity in the hair', async () => {
    for (const a of index.avatars) {
      const { data, info } = await sharp(path.join(DIR, a.texture.file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      expect([info.width, info.height]).toEqual([...ATLAS_SIZE])
      expect([a.texture.width, a.texture.height]).toEqual([...ATLAS_SIZE])
      const counts = new Map<number, number>()
      for (const rect of [a.atlas.body, a.atlas.head]) {
        for (let y = Math.round(rect[1] * info.height); y < Math.round((rect[1] + rect[3]) * info.height); y++) {
          for (let x = Math.round(rect[0] * info.width); x < Math.round((rect[0] + rect[2]) * info.width); x++) {
            const al = data[(y * info.width + x) * 4 + 3]
            counts.set(al, (counts.get(al) ?? 0) + 1)
          }
        }
      }
      // the mask survives the encoder exactly (lossless alpha): only its three values
      expect([...counts.keys()].sort((x, y) => x - y), a.id).toEqual([85, 170, 255])
      expect(a.tintRef.top, a.id).toBeGreaterThan(0)
      expect(a.tintRef.top, a.id).toBeLessThan(1)
    }
  })

  it('leaves out the surgical cap and mask and the glasses, keeps the stethoscopes, and sizes everyone like the crowd', () => {
    const by = (id: string) => index.avatars.find((a) => a.id === id)!
    for (const id of ['medical_male_04', 'medical_male_05']) expect(by(id).dropped.join(' '), id).toMatch(/_protection .*cap and mask/)
    expect(by('business_female_02').dropped.join(' ')).toMatch(/_glasses/)
    for (const id of ['medical_female_02', 'medical_male_03']) expect(by(id).atlas.extra, id).not.toBeNull()
    expect(by('medical_female_02').atlas.hair).not.toBeNull()
    expect(by('medical_male_03').atlas.hair).toBeNull()
    for (const a of index.avatars) {
      const b = a.body
      expect(b.ankle + 0.985 * (b.thigh + b.shin) + b.hipDrop + b.waist + b.neck + b.crown, a.id).toBeCloseTo(STAND_CROWN, 3)
      expect(b.seatedPelvis, a.id).toBeGreaterThan(0.08)
      expect(b.seatedPelvis, a.id).toBeLessThan(0.23)
      expect(b.liePelvis, a.id).toBeGreaterThan(0.05)
      expect(b.liePelvis, a.id).toBeLessThan(0.25)
      expect(b.lieFeet, a.id).toBeGreaterThanOrEqual(0)
      expect(b.lieFeet, a.id).toBeLessThan(0.25)
      expect(a.badge[0], a.id).toBeGreaterThan(0)
      for (const c of Object.values(a.palette)) expect(c).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})
