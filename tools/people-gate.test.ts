/**
 * The Rocketbox part of the asset gate (W3 wave B): the allow-list, the magic bytes, and above all the manifest itself.
 * tools/assets.manifest.json is data that decides what is downloaded, so it is checked here against two independent records:
 *   - the GitHub contents API listings of the pinned commit (tools/fixtures/rocketbox-medical-listing.json) for the 33
 *     medical files that are fetched, and
 *   - the pins the Waltz reference recorded for the 22 adult files that are imported through `localFile`
 *     (tools/fixtures/waltz-pinned-adults.json, and the live Waltz manifest when it is on this machine).
 * No network: everything is read from disk.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
// @ts-ignore TS7016: a .mjs module has no declaration file
import * as libModule from './assets-lib.mjs'
// @ts-ignore TS7016: a .mjs module has no declaration file
import * as gateModule from './fetch-assets.mjs'

/* eslint-disable @typescript-eslint/no-explicit-any */
const lib = libModule as any
const gate = gateModule as any
const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const COMMIT = '0943055db6ec570bcef9f2c8b41c9e5467c808f9'
const RAW = `https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/${COMMIT}`
const BLOB = `https://github.com/microsoft/Microsoft-Rocketbox/blob/${COMMIT}`
const RB = `${RAW}/Assets/Avatars/Professions/Business_Female_01`
const WALTZ_MANIFEST = '/Users/lironhagbi/Waltz Game/tools/assets.manifest.json'

const readJson = (file: string) => JSON.parse(readFileSync(path.join(here, file), 'utf8'))
const manifest = readJson('assets.manifest.json')
const listing = readJson('fixtures/rocketbox-medical-listing.json') as { commit: string; listings: Record<string, Array<{ name: string; path: string; size: number; sha: string }>> }
const waltzPins = readJson('fixtures/waltz-pinned-adults.json') as { entries: any[] }

/** The manifest also holds the Poly Haven textures and HDRI (kinds "textures" and "hdri", checked in fetch-assets.test.ts); this file is about the Rocketbox people. */
const assets: any[] = (manifest.assets as any[]).filter((e) => e.kind === 'people')
const medical = assets.filter((e) => e.id.startsWith('rb-medical-'))
const adults = assets.filter((e) => !e.id.startsWith('rb-medical-'))

function fbx(version = 7400, size = 64): Buffer {
  const b = Buffer.alloc(size)
  b.write('Kaydara FBX Binary  ', 0, 'latin1')
  b[20] = 0
  b[21] = 0x1a
  b[22] = 0
  b.writeUInt32LE(version, 23)
  return b
}

function tga(w: number, h: number, depth: 24 | 32, opts: { type?: number; footer?: boolean; extra?: number; colorMap?: number } = {}): Buffer {
  const header = Buffer.alloc(18)
  header[1] = opts.colorMap ?? 0
  header[2] = opts.type ?? 2
  header.writeUInt16LE(w, 12)
  header.writeUInt16LE(h, 14)
  header[16] = depth
  const pixels = Buffer.alloc(w * h * (depth / 8) + (opts.extra ?? 0))
  const footer = opts.footer === false ? Buffer.alloc(0) : Buffer.concat([Buffer.alloc(8), Buffer.from('TRUEVISION-XFILE.\0', 'latin1')])
  return Buffer.concat([header, pixels, footer])
}

describe('asset gate: Rocketbox sources', () => {
  it('allows the one pinned Rocketbox commit and folder, for .fbx and .tga only', () => {
    expect(lib.POLICY.rocketbox).toMatchObject({ repo: 'microsoft/Microsoft-Rocketbox', commit: COMMIT, pathPrefix: 'Assets/Avatars/', extensions: ['.fbx', '.tga'] })
    expect(lib.checkDownloadUrl(`${RB}/Export/Business_Female_01.fbx`).hostname).toBe('raw.githubusercontent.com')
    expect(lib.checkDownloadUrl(`${RB}/Textures/f014_body_color.tga`).hostname).toBe('raw.githubusercontent.com')
    const refused = [
      `https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/8f3257ad44597f1b94471f2491c41a17313a3b97/Assets/Avatars/Professions/Business_Female_01/Export/Business_Female_01.fbx`, // another commit
      `https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets/Avatars/Professions/Business_Female_01/Export/Business_Female_01.fbx`, // a branch
      `${RAW}/Source/Avatars/Adults/Female_Adult_01/Source/Female_Adult_01.max`, // outside Assets/Avatars
      `${RB}/Business_Female_01.png`, // not fbx/tga
      `https://raw.githubusercontent.com/microsoft/other-repo/${COMMIT}/Assets/Avatars/A/B/x.fbx`,
      `https://media.githubusercontent.com/media/microsoft/Microsoft-Rocketbox/${COMMIT}/Assets/Avatars/A/B/x.fbx`, // LFS host: not needed, not allowed
    ]
    for (const u of refused) expect(() => lib.checkDownloadUrl(u), u).toThrow()
  })

  it('checks FBX and TGA magic: binary FBX 7.x, plain true-colour TGA whose pixels fit the header', () => {
    expect(lib.checkMagic(fbx(), 'fbx').ok).toBe(true)
    expect(lib.checkMagic(fbx(6100), 'fbx').ok).toBe(false)
    expect(lib.checkMagic(Buffer.from('<!doctype html><html>not found</html>'), 'fbx').ok).toBe(false)
    expect(lib.checkMagic(Buffer.from('; FBX 7.4.0 project file ASCII...'), 'fbx').ok).toBe(false)
    expect(lib.checkMagic(tga(4, 4, 24), 'tga').ok).toBe(true)
    expect(lib.checkMagic(tga(4, 4, 32, { footer: false }), 'tga').ok).toBe(true)
    expect(lib.checkMagic(tga(4, 4, 24, { extra: 7 }), 'tga').ok).toBe(false) // more bytes than the header promises
    expect(lib.checkMagic(tga(4, 4, 24, { colorMap: 1 }), 'tga').ok).toBe(false)
    expect(lib.checkMagic(tga(4, 4, 24, { type: 9 }), 'tga').ok).toBe(false)
    expect(lib.checkMagic(tga(0, 4, 24), 'tga').ok).toBe(false)
  })

  it('keeps conversion inputs out of the served folder and its budget', () => {
    const base = {
      id: 'rb-x-fbx',
      kind: 'people',
      type: 'fbx',
      url: `${RB}/Export/Business_Female_01.fbx`,
      sourcePage: 'https://github.com/microsoft/Microsoft-Rocketbox',
      sha256: null,
      gitBlobSha1: 'a'.repeat(40),
      bytes: 600000,
      maxBytes: 612000,
      licence: 'MIT',
    }
    expect(() => lib.validateManifestEntry(base)).toThrow(/dest "source"/)
    expect(lib.validateManifestEntry({ ...base, dest: 'source' }).file).toBe('rb-x-fbx.fbx')
    const installed = { assets: { a: { files: [{ path: 'people/x.fbx', bytes: 1000, root: 'source' }, { path: 'people/x.lod0.glb', bytes: 10, role: 'derived' }] } } }
    expect(gate.installedTotalBytes(installed)).toBe(10)
    expect(gate.installedSourceBytes(installed)).toBe(1000)
  })
})

describe('tools/assets.manifest.json: every entry', () => {
  it('has 55 entries, unique ids and files, and passes the gate\'s own validation and origin check', () => {
    expect(manifest.version).toBe(1)
    expect(assets).toHaveLength(55)
    const ids = new Set<string>()
    const files = new Set<string>()
    for (const raw of assets) {
      const e = lib.validateManifestEntry(raw)
      expect(ids.has(e.id), `duplicate id ${e.id}`).toBe(false)
      expect(files.has(e.file), `duplicate file ${e.file}`).toBe(false)
      ids.add(e.id)
      files.add(e.file)
      expect(() => lib.checkDownloadUrl(e.url), e.id).not.toThrow()
    }
  })

  it('is pinned, hashed, size-capped, source-only and MIT, and every address is the pinned commit under Assets/Avatars', () => {
    for (const e of assets) {
      expect(e.url.startsWith(`${RAW}/Assets/Avatars/`), e.id).toBe(true)
      expect(e.sourcePage, e.id).toBe(e.url.replace(RAW, BLOB))
      expect(e.sourceCommit, e.id).toBe(COMMIT)
      expect(e.licence, e.id).toBe('MIT')
      expect(e.licenceUrl, e.id).toBe(`${BLOB}/LICENSE.md`)
      expect(e.kind, e.id).toBe('people')
      expect(e.dest, e.id).toBe('source')
      expect(['fbx', 'tga'], e.id).toContain(e.type)
      expect(e.url.endsWith(`.${e.type}`), e.id).toBe(true)
      expect(e.gitBlobSha1, e.id).toMatch(/^[0-9a-f]{40}$/)
      expect(e.sha256 === null || /^[0-9a-f]{64}$/.test(e.sha256), e.id).toBe(true) // null until the first fetch pins it
      expect(Number.isInteger(e.bytes) && e.bytes > 0, e.id).toBe(true)
      expect(e.bytes, e.id).toBeLessThanOrEqual(e.maxBytes)
      expect(e.maxBytes, e.id).toBeLessThanOrEqual(lib.POLICY.maxFileBytes)
    }
  })

  it('stays inside the budgets: every file under the per-file cap, all of them under the source budget', () => {
    const total = assets.reduce((s, e) => s + e.bytes, 0)
    expect(total).toBeLessThan(lib.POLICY.maxSourceBytes)
    expect(Math.max(...assets.map((e) => e.bytes))).toBeLessThan(lib.POLICY.maxFileBytes)
  })
})

describe('the 8 medical avatars (downloaded)', () => {
  const avatars = ['Medical_Female_01', 'Medical_Female_02', 'Medical_Female_03', 'Medical_Male_01', 'Medical_Male_02', 'Medical_Male_03', 'Medical_Male_04', 'Medical_Male_05']
  const allListed = avatars.flatMap((a) => [...listing.listings[`${a}/Export`], ...listing.listings[`${a}/Textures`]])

  /** What the policy says to fetch, derived from the API listings alone: never normal or specular maps, never _facial.fbx. */
  const wanted = (name: string) => {
    if (/_facial\.fbx$/i.test(name)) return false
    if (/\.fbx$/i.test(name)) return true
    return /_body_color(_blue)?\.tga$/.test(name) || /_head_color\.tga$/.test(name) || /_opacity_color\.tga$/.test(name) || /_stetoskop_color\.tga$/.test(name) || /_protection_color\.tga$/.test(name)
  }

  it('lists the commit the policy pins, and all 8 avatars with an Export and a Textures folder', () => {
    expect(listing.commit).toBe(COMMIT)
    expect(Object.keys(listing.listings).sort()).toEqual(avatars.flatMap((a) => [`${a}/Export`, `${a}/Textures`]).sort())
    for (const f of allListed) expect(f.path.startsWith('Assets/Avatars/Professions/Medical_'), f.path).toBe(true)
  })

  it('has 33 entries: 8 fbx, 8 body, 8 head, 5 opacity, 2 stethoscope and 2 protection colours', () => {
    expect(medical).toHaveLength(33)
    const count = (suffix: string) => medical.filter((e) => e.id.endsWith(suffix)).length
    expect(count('-fbx')).toBe(8)
    expect(count('-body-color')).toBe(8)
    expect(count('-head-color')).toBe(8)
    expect(count('-opacity-color')).toBe(5)
    expect(count('-stethoscope-color')).toBe(2)
    expect(count('-protection-color')).toBe(2)
    for (const e of medical) expect(e.localFile, e.id).toBeUndefined() // these are downloaded, through the gate
  })

  it('is exactly the wanted files of the listing: same paths, same git blob ids, same byte counts', () => {
    const expected = allListed.filter((f) => wanted(f.name))
    expect(expected).toHaveLength(33)
    const byUrl = new Map(medical.map((e) => [e.url, e]))
    expect([...byUrl.keys()].sort()).toEqual(expected.map((f) => `${RAW}/${f.path}`).sort())
    for (const f of expected) {
      const e = byUrl.get(`${RAW}/${f.path}`)!
      expect(e.gitBlobSha1, f.path).toBe(f.sha)
      expect(e.bytes, f.path).toBe(f.size)
      expect(e.maxBytes, f.path).toBeGreaterThanOrEqual(f.size)
      expect(e.maxBytes, f.path).toBeLessThanOrEqual(f.size * 1.02 + 1)
    }
  })

  it('lives under Assets/Avatars/Professions/Medical_*, is fbx or tga, and has no normal, specular or _facial entry', () => {
    for (const e of medical) {
      expect(e.url, e.id).toMatch(new RegExp(`^${RAW}/Assets/Avatars/Professions/Medical_(Female_0[1-3]|Male_0[1-5])/(Export|Textures)/[A-Za-z0-9_]+\\.(fbx|tga)$`))
      expect(e.url, e.id).not.toMatch(/normal|specular|facial/i)
      expect(e.file, e.id).not.toMatch(/normal|specular|facial/i)
      expect(['fbx', 'tga']).toContain(e.type)
      expect(e.dest).toBe('source')
    }
    for (const e of medical.filter((x) => x.type === 'fbx')) expect(e.url).toMatch(/\/Export\/Medical_(Female|Male)_0\d\.fbx$/)
    for (const e of medical.filter((x) => x.type === 'tga')) expect(e.url).toMatch(/\/Textures\//)
  })

  it('names the files the converter will read, and keeps the avatar of each id in its own folder', () => {
    for (const e of medical) {
      const stem = e.id.replace(/^rb-/, '').replace(/-/g, '_') // medical_female_01_body_color
      expect(e.file, e.id).toBe(e.type === 'fbx' ? `${stem.replace(/_fbx$/, '')}.fbx` : `${stem}.tga`)
      const who = e.id.match(/^rb-medical-(female|male)-(\d\d)-/)
      expect(who, e.id).not.toBeNull()
      expect(e.url, e.id).toContain(`/Medical_${who![1] === 'female' ? 'Female' : 'Male'}_${who![2]}/`)
    }
    // Female_03 and Male_02 ship only a *_body_color_blue.tga: that is the one fetched, under the normal body_color name
    const blue = medical.filter((e) => /_body_color_blue\.tga$/.test(e.url)).map((e) => e.id)
    expect(blue.sort()).toEqual(['rb-medical-female-03-body-color', 'rb-medical-male-02-body-color'])
    for (const id of blue) expect(medical.find((e) => e.id === id)!.file).toMatch(/^medical_(female_03|male_02)_body_color\.tga$/)
  })
})

describe('the 6 everyday adults (imported through localFile, not downloaded)', () => {
  it('are the 22 entries Waltz pinned: same url, sourcePage, sha256, git blob id, bytes, maxBytes and licence', () => {
    expect(adults).toHaveLength(22)
    expect(waltzPins.entries).toHaveLength(22)
    for (const w of waltzPins.entries) {
      const e = adults.find((x) => x.id === w.id)
      expect(e, w.id).toBeDefined()
      for (const key of ['file', 'url', 'sourcePage', 'sha256', 'gitBlobSha1', 'bytes', 'maxBytes', 'licence']) expect(e[key], `${w.id}.${key}`).toBe(w[key])
      expect(e.sha256, w.id).toMatch(/^[0-9a-f]{64}$/)
      expect(e.localFile, w.id).toBe(`people/${w.file}`)
    }
    const avatars = new Set(adults.map((e) => e.id.replace(/-(fbx|body-color|head-color|opacity-color)$/, '')))
    expect([...avatars].sort()).toEqual(['rb-business-female-02', 'rb-female-adult-15', 'rb-female-adult-17', 'rb-male-adult-08', 'rb-male-adult-12', 'rb-male-adult-13'])
  })

  it.runIf(existsSync(WALTZ_MANIFEST))('match the live Waltz reference manifest on this machine', () => {
    const waltz = JSON.parse(readFileSync(WALTZ_MANIFEST, 'utf8')).assets as any[]
    for (const e of adults) {
      const w = waltz.find((x) => x.id === e.id)
      expect(w, e.id).toBeDefined()
      for (const key of ['file', 'url', 'sourcePage', 'sourceCommit', 'sha256', 'gitBlobSha1', 'bytes', 'maxBytes', 'licence', 'licenceUrl', 'author']) expect(e[key], `${e.id}.${key}`).toBe(w[key])
    }
  })

  // The staged copies (gitignored, assets-src/_import/people) are byte-for-byte copies of Waltz's verified originals.
  const staged = path.join(repoRoot, 'assets-src', '_import', 'people')
  it.runIf(existsSync(staged))('are staged byte for byte: every staged file hashes to its pinned sha256 and git blob id', () => {
    for (const e of adults) {
      const bytes = readFileSync(path.join(staged, e.file))
      expect(bytes.length, e.id).toBe(e.bytes)
      expect(createHash('sha256').update(bytes).digest('hex'), e.id).toBe(e.sha256)
      expect(lib.gitBlobSha1Hex(bytes), e.id).toBe(e.gitBlobSha1)
      expect(lib.checkMagic(bytes, e.type).ok, e.id).toBe(true)
    }
  })
})
