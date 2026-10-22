/**
 * Tests for the asset validation gate (tools/assets-lib.mjs + tools/fetch-assets.mjs), ported from the Waltz City gate tests
 * and narrowed to this project's two sources (Microsoft Rocketbox at one pinned commit, and the CC0 textures and HDRIs of
 * Poly Haven on dl.polyhaven.org, see section 9).
 * Every fixture is built in memory and the network is a mock: nothing here touches the internet, and the project's own
 * public/assets, assets-src and docs are never written (each test gets its own temp project root).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
// The gate is plain ESM so `node tools/fetch-assets.mjs` needs no loader; its API is typed below.
// @ts-ignore TS7016: a .mjs module has no declaration file
import * as libModule from './assets-lib.mjs'
// @ts-ignore TS7016: a .mjs module has no declaration file
import * as gateModule from './fetch-assets.mjs'

/* eslint-disable @typescript-eslint/no-explicit-any */
interface GateErrorLike extends Error {
  code: string
  details: Record<string, unknown>
}
interface Lib {
  checkDownloadUrl(url: string): URL
  checkMagic(bytes: Uint8Array, type: string): { ok: boolean; reason?: string }
  validateManifestEntry(entry: any): any
  gitBlobSha1Hex(bytes: Uint8Array): string
  sha256Hex(bytes: Uint8Array): string
  applyCreditsBlock(text: string, block: string): string
  renderCreditsBlock(installed: any): string
  validateGltfBytes(bytes: Uint8Array, opts?: any): Promise<any>
  POLICY: { maxFileBytes: number; maxSourceBytes: number; maxTotalBytes: number }
}
interface Gate {
  processEntry(entry: any, ctx: any): Promise<any>
  runGate(opts: any): Promise<{ results: any[]; failures: any[] }>
  emptyInstalled(): any
  verifyAll(opts: any): Promise<number>
  acquireLock(root: string, opts?: any): Promise<() => Promise<void>>
  parseArgs(argv: string[]): any
  paths(root: string): Record<string, string>
}
const lib = libModule as unknown as Lib
const gate = gateModule as unknown as Gate

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url))
const COMMIT = '0943055db6ec570bcef9f2c8b41c9e5467c808f9'
const RB = `https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/${COMMIT}/Assets/Avatars/Professions/Medical_Male_01`
const FBX_URL = `${RB}/Export/Medical_Male_01.fbx`
const TGA_URL = `${RB}/Textures/m152_body_color.tga`
const SOURCE_PAGE = `https://github.com/microsoft/Microsoft-Rocketbox/blob/${COMMIT}/Assets/Avatars/Professions/Medical_Male_01/Export/Medical_Male_01.fbx`

/** A binary FBX 7.x header followed by `size - 27` bytes of `fill`. */
function fbx(fill = 0, version = 7400, size = 96): Buffer {
  const b = Buffer.alloc(size, fill)
  b.write('Kaydara FBX Binary  ', 0, 'latin1')
  b[20] = 0
  b[21] = 0x1a
  b[22] = 0
  b.writeUInt32LE(version, 23)
  return b
}

/** A plain true-colour TGA whose pixel bytes fit its header (plus the TGA 2.0 footer). */
function tga(w: number, h: number, depth: 24 | 32, opts: { type?: number; footer?: boolean; extra?: number; colorMap?: number } = {}): Buffer {
  const header = Buffer.alloc(18)
  header[1] = opts.colorMap ?? 0
  header[2] = opts.type ?? 2
  header.writeUInt16LE(w, 12)
  header.writeUInt16LE(h, 14)
  header[16] = depth
  const pixels = Buffer.alloc(w * h * (depth / 8) + (opts.extra ?? 0), 0x7f)
  const footer = opts.footer === false ? Buffer.alloc(0) : Buffer.concat([Buffer.alloc(8), Buffer.from('TRUEVISION-XFILE.\0', 'latin1')])
  return Buffer.concat([header, pixels, footer])
}

type Route = { status?: number; body?: Uint8Array | string; headers?: Record<string, string> }

/** A fake network: unknown URLs 404, HEAD mirrors GET headers, and every request is recorded. */
function mockNetwork(routes: Record<string, Route>) {
  const calls: Array<{ url: string; method: string }> = []
  const fetchImpl = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const href = String(url)
    const method = init?.method ?? 'GET'
    calls.push({ url: href, method })
    const route = routes[href]
    if (!route) return new Response('not found', { status: 404 })
    const body = typeof route.body === 'string' ? Buffer.from(route.body) : route.body
    const headers = new Headers(route.headers)
    if (body && !headers.has('content-length') && !headers.has('x-omit-length')) headers.set('content-length', String(body.length))
    if (method === 'HEAD') return new Response(null, { status: route.status ?? 200, headers })
    return new Response(body ? new Uint8Array(body) : null, { status: route.status ?? 200, headers })
  }
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls }
}

/** A manifest entry that fits `bytes` exactly (size, git blob id) and is still unpinned (sha256 null). */
const entryFor = (bytes: Buffer, over: Record<string, unknown> = {}) => ({
  id: 'rb-test-fbx',
  kind: 'people',
  type: 'fbx',
  dest: 'source',
  file: 'test.fbx',
  url: FBX_URL,
  sourcePage: SOURCE_PAGE,
  sourceCommit: COMMIT,
  sha256: null,
  gitBlobSha1: lib.gitBlobSha1Hex(bytes),
  bytes: bytes.length,
  maxBytes: bytes.length + 100,
  licence: 'MIT (test fixture)',
  ...over,
})

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'hospital-gate-'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const rel = (...p: string[]) => path.join(root, ...p)
const exists = (...p: string[]) => fs.stat(rel(...p)).then(() => true, () => false)
const quarantineIsClean = async () => (await fs.readdir(rel('public', 'assets', '_downloads')).catch(() => [] as string[])).length === 0
/** Every file below a folder of the temp project, relative to the project root. */
const filesBelow = async (dir: string) => {
  const out: string[] = []
  const walk = async (d: string) => {
    for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) await walk(full)
      else out.push(path.relative(root, full))
    }
  }
  await walk(rel(dir))
  return out.sort()
}
const writeManifest = async (assets: unknown[]) => {
  await fs.mkdir(rel('tools'), { recursive: true })
  await fs.writeFile(rel('tools', 'assets.manifest.json'), JSON.stringify({ version: 1, assets }))
}
const readManifest = async () => JSON.parse(await fs.readFile(rel('tools', 'assets.manifest.json'), 'utf8'))
const stage = async (file: string, bytes: Buffer) => {
  await fs.mkdir(path.dirname(rel('assets-src', '_import', file)), { recursive: true })
  await fs.writeFile(rel('assets-src', '_import', file), bytes)
}

/** Runs one entry through the gate against a mock network and returns the thrown GateError, if any. */
async function runEntry(entry: Record<string, unknown>, routes: Record<string, Route>, flags: Record<string, boolean> = {}) {
  const net = mockNetwork(routes)
  const installed = gate.emptyInstalled()
  const outcome = await gate.processEntry(entry, { root, installed, fetchImpl: net.fetchImpl, flags }).then(
    (r: any) => ({ result: r, error: null as GateErrorLike | null }),
    (e: GateErrorLike) => ({ result: null, error: e }),
  )
  return { ...outcome, calls: net.calls, installed }
}

const quiet = () => {}

// ---------------------------------------------------------------------------------------------
// 1. Origin allow-list
// ---------------------------------------------------------------------------------------------

describe('origin gate', () => {
  it('accepts the one allow-listed origin: raw.githubusercontent.com, Microsoft-Rocketbox, the pinned commit, Assets/Avatars, .fbx and .tga', () => {
    for (const ok of [
      FBX_URL,
      TGA_URL,
      `https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/${COMMIT}/Assets/Avatars/Adults/Female_Adult_15/Textures/f018_body_color.tga`,
      `https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/${COMMIT}/Assets/Avatars/Professions/Business_Female_02/Export/Business_Female_02.fbx`,
    ]) {
      expect(lib.checkDownloadUrl(ok).hostname, ok).toBe('raw.githubusercontent.com')
    }
  })

  it('rejects everything else: other hosts, look-alikes, userinfo, ports, http, query strings, other repos, commits and folders, traversal', () => {
    const other = '8f3257ad44597f1b94471f2491c41a17313a3b97'
    const raw = `https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox`
    const folder = 'Assets/Avatars/Professions/Medical_Male_01/Export/Medical_Male_01.fbx'
    for (const bad of [
      'https://evil.example.com/Medical_Male_01.fbx',
      `https://raw.githubusercontent.com.evil.com/microsoft/Microsoft-Rocketbox/${COMMIT}/${folder}`,
      `https://evil.com/raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/${COMMIT}/${folder}`,
      `https://raw.githubusercontent.com@evil.com/microsoft/Microsoft-Rocketbox/${COMMIT}/${folder}`,
      `https://user:pass@raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/${COMMIT}/${folder}`,
      `https://raw.githubusercontent.com:8443/microsoft/Microsoft-Rocketbox/${COMMIT}/${folder}`,
      `http://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/${COMMIT}/${folder}`,
      `ftp://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/${COMMIT}/${folder}`,
      `https://www.raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/${COMMIT}/${folder}`,
      `https://github.com/microsoft/Microsoft-Rocketbox/raw/${COMMIT}/${folder}`, // the web host: not allow-listed
      `https://api.github.com/repos/microsoft/Microsoft-Rocketbox/contents/${folder}?ref=${COMMIT}`, // no metadata host either
      `https://media.githubusercontent.com/media/microsoft/Microsoft-Rocketbox/${COMMIT}/${folder}`, // the LFS host: not needed, not allowed
      `https://gist.githubusercontent.com/someone/abc/raw/x.fbx`,
      `https://kenney.nl/media/pages/assets/x.zip`, // sources of the Waltz gate that this gate does not carry
      `https://api.polyhaven.com/files/terrazzo_tiles`, // the metadata API is read by hand, never by the gate
      `https://polyhaven.com/a/terrazzo_tiles`,
      `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/x/x_diff_1k.fbx`, // a Poly Haven path, but not an allow-listed type
      `https://dl.polyhaven.org/${COMMIT}/Assets/Avatars/Professions/Medical_Male_01/Export/Medical_Male_01.fbx`, // Rocketbox path on the other host
      `https://raw.githubusercontent.com/mrdoob/three.js/9b4a2ac29c63ccb43fd51c5661f2f873ac2c39b8/examples/models/gltf/Xbot.glb`,
      `https://raw.githubusercontent.com/someone-else/Microsoft-Rocketbox/${COMMIT}/${folder}`,
      `https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox-fork/${COMMIT}/${folder}`,
      `https://raw.githubusercontent.com/Microsoft/Microsoft-Rocketbox/${COMMIT}/${folder}`, // exact repo name, case included
      `${raw}/${other}/${folder}`, // another commit
      `${raw}/master/${folder}`, // a branch
      `${raw}/${COMMIT.slice(0, 7)}/${folder}`, // a short SHA
      `${raw}/${COMMIT.toUpperCase()}/${folder}`,
      `${raw}/${COMMIT}/Source/Avatars/Adults/Female_Adult_01/Source/Female_Adult_01.max`, // outside Assets/Avatars
      `${raw}/${COMMIT}/LICENSE.md`,
      `${raw}/${COMMIT}/Assets/Avatars/Professions/Medical_Male_01/Export/Medical_Male_01.png`, // not fbx/tga
      `${raw}/${COMMIT}/Assets/Avatars/Professions/Medical_Male_01/Export/Medical_Male_01.max`,
      `${raw}/${COMMIT}/Assets/Avatars/Professions/Medical_Male_01/Export/Medical_Male_01.fbx?token=1`, // query string
      `${raw}/${COMMIT}/Assets/Avatars/Professions/Medical_Male_01/Export/Medical_Male_01.fbx#x`, // fragment
      `${raw}/${COMMIT}/Assets/Avatars/Professions/Medical_Male_01/Export/../../../../../../x.fbx`, // traversal
      `${raw}/${COMMIT}/Assets/Avatars/Professions/Medical_Male_01/Export/${'%2e%2e/'.repeat(6)}x.fbx`, // escapes to the repository root
      `${raw}/${COMMIT}/Assets/Avatars/../../Source/Avatars/Adults/Female_Adult_01/Source/Female_Adult_01.fbx`, // collapses to a folder outside Assets/Avatars
      `${raw}/${COMMIT}/Assets/Avatars/Professions/Medical_Male_01/Export%2fMedical_Male_01.fbx`, // encoded slash
      `${raw}/${COMMIT}/Assets/Avatars/Professions/Medical_Male_01/Export/Medical%20Male.fbx`, // escapes are not plain names
      `${raw}/${COMMIT}/Assets/Avatars/Professions/Medical_Male_01//Medical_Male_01.fbx`, // empty segment
      `${raw}/${COMMIT}/Assets/Avatars/x.fbx`, // too shallow
      `${raw}/${COMMIT}/Assets/Avatars/Professions/Medical_Male_01/Export/.hidden.fbx`,
      `${raw}/${COMMIT}/Assets/Avatars\\Professions/Medical_Male_01/Export/Medical_Male_01.fbx`, // backslash
      'not a url',
      '',
    ]) {
      expect(() => lib.checkDownloadUrl(bad), bad).toThrowError(expect.objectContaining({ name: 'GateError' }))
    }
    expect(() => lib.checkDownloadUrl('https://evil.example.com/x.fbx')).toThrowError(expect.objectContaining({ code: 'ORIGIN_NOT_ALLOWED' }))
    expect(() => lib.checkDownloadUrl(`${raw}/master/${folder}`)).toThrowError(expect.objectContaining({ code: 'GITHUB_UNPINNED' }))
    expect(() => lib.checkDownloadUrl(`${raw}/${other}/${folder}`)).toThrowError(expect.objectContaining({ code: 'ORIGIN_NOT_ALLOWED' }))
  })

  it('refuses a rejected origin before a single request is made', async () => {
    const bytes = fbx()
    for (const url of ['https://evil.example.com/Medical_Male_01.fbx', FBX_URL.replace(COMMIT, 'master'), FBX_URL.replace(COMMIT, '8f3257ad44597f1b94471f2491c41a17313a3b97')]) {
      const { error, calls } = await runEntry(entryFor(bytes, { url }), { [url]: { body: bytes } })
      expect(['ORIGIN_NOT_ALLOWED', 'GITHUB_UNPINNED']).toContain(error?.code)
      expect(calls).toEqual([])
    }
    expect(await filesBelow('assets-src')).toEqual([])
  })

  it('re-checks every redirect hop: an allow-listed host cannot bounce us elsewhere', async () => {
    const bytes = fbx()
    for (const evil of [
      'https://evil.example.com/Medical_Male_01.fbx',
      `https://media.githubusercontent.com/media/microsoft/Microsoft-Rocketbox/${COMMIT}/Assets/Avatars/Professions/Medical_Male_01/Export/Medical_Male_01.fbx`,
      `https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/8f3257ad44597f1b94471f2491c41a17313a3b97/Assets/Avatars/Professions/Medical_Male_01/Export/Medical_Male_01.fbx`,
      'http://raw.githubusercontent.com/x.fbx',
    ]) {
      const { error, calls } = await runEntry(entryFor(bytes), { [FBX_URL]: { status: 302, headers: { location: evil } }, [evil]: { body: bytes } })
      expect(['ORIGIN_NOT_ALLOWED', 'GITHUB_UNPINNED'], evil).toContain(error?.code)
      expect(calls.map((c) => c.url)).toEqual([FBX_URL]) // the HEAD hop only; the other URL was never requested
    }
    expect(await filesBelow('assets-src')).toEqual([])
  })

  it('follows a redirect between two allowed URLs, but at most four hops, and refuses an unparsable Location', async () => {
    const bytes = fbx()
    const moved = `${RB}/Export/Moved.fbx`
    const ok = await runEntry(entryFor(bytes), { [FBX_URL]: { status: 301, headers: { location: moved } }, [moved]: { body: bytes } })
    expect(ok.error).toBeNull()
    expect(ok.result.status).toBe('installed')

    const hops = Array.from({ length: 7 }, (_, i) => `${RB}/Export/Hop${i}.fbx`)
    const routes: Record<string, Route> = { [FBX_URL]: { status: 302, headers: { location: hops[0] } } }
    hops.forEach((h, i) => (routes[h] = i + 1 < hops.length ? { status: 302, headers: { location: hops[i + 1] } } : { body: bytes }))
    expect((await runEntry(entryFor(bytes), routes)).error?.code).toBe('TOO_MANY_REDIRECTS')

    const garbled = await runEntry(entryFor(bytes), { [FBX_URL]: { status: 302, headers: { location: 'https://[bad' } } })
    expect(garbled.error?.code).toBe('BAD_URL')
  })

  it('turns a network failure into a GateError instead of crashing the run', async () => {
    const bytes = fbx()
    const boom = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const outcome = await gate.processEntry(entryFor(bytes), { root, installed: gate.emptyInstalled(), fetchImpl: boom }).catch((e: GateErrorLike) => e)
    expect((outcome as GateErrorLike).code).toBe('NETWORK_ERROR')

    const broken = (async (_url: string, init?: RequestInit) =>
      init?.method === 'HEAD'
        ? new Response(null, { status: 200, headers: { 'content-length': String(bytes.length) } })
        : new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array(10))
                controller.error(new Error('connection reset'))
              },
            }),
            { status: 200 },
          )) as unknown as typeof fetch
    const midStream = await gate.processEntry(entryFor(bytes), { root, installed: gate.emptyInstalled(), fetchImpl: broken }).catch((e: GateErrorLike) => e)
    expect((midStream as GateErrorLike).code).toBe('NETWORK_ERROR')
    expect(await quarantineIsClean()).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------
// 2. Magic bytes
// ---------------------------------------------------------------------------------------------

describe('magic bytes', () => {
  it('rejects an HTML page served in place of an .fbx, installs nothing and leaves quarantine empty', async () => {
    const html = Buffer.from('<!DOCTYPE html><html><body>Sign in to continue to the download</body></html>')
    const { error, installed } = await runEntry(entryFor(html), { [FBX_URL]: { body: html } })
    expect(error?.code).toBe('BAD_MAGIC')
    expect(error?.message).toMatch(/HTML/)
    expect(Object.keys(installed.assets)).toEqual([])
    expect(await filesBelow('assets-src')).toEqual([])
    expect(await quarantineIsClean()).toBe(true)
  })

  it('rejects ASCII FBX, a wrong FBX version, a TGA declared as an FBX and a truncated TGA', async () => {
    const ascii = Buffer.from('; FBX 7.4.0 project file\n; ASCII, which this gate never reads\n'.padEnd(96, ' '))
    expect((await runEntry(entryFor(ascii), { [FBX_URL]: { body: ascii } })).error?.code).toBe('BAD_MAGIC')
    const old = fbx(0, 6100)
    expect((await runEntry(entryFor(old), { [FBX_URL]: { body: old } })).error?.code).toBe('BAD_MAGIC')
    const image = tga(4, 4, 24)
    expect((await runEntry(entryFor(image), { [FBX_URL]: { body: image } })).error?.code).toBe('BAD_MAGIC')
    const model = fbx()
    const asTga = entryFor(model, { id: 'rb-test-tga', type: 'tga', url: TGA_URL, file: 'test.tga' })
    expect((await runEntry(asTga, { [TGA_URL]: { body: model } })).error?.code).toBe('BAD_MAGIC')
    const cut = tga(8, 8, 24).subarray(0, 100)
    const truncated = entryFor(cut, { id: 'rb-test-tga', type: 'tga', url: TGA_URL, file: 'test.tga' })
    const r = await runEntry(truncated, { [TGA_URL]: { body: cut } })
    expect(r.error?.code).toBe('BAD_MAGIC')
    expect(await filesBelow('assets-src')).toEqual([])
  })

  it('checks FBX and TGA headers field by field', () => {
    const ok = (b: Buffer, t: string) => lib.checkMagic(b, t).ok
    expect(ok(fbx(), 'fbx')).toBe(true)
    expect(ok(fbx(0, 7000), 'fbx')).toBe(true)
    expect(ok(fbx(0, 7999), 'fbx')).toBe(true)
    expect(ok(fbx(0, 6999), 'fbx')).toBe(false)
    expect(ok(fbx(0, 8000), 'fbx')).toBe(false)
    expect(ok(tga(4, 4, 24), 'tga')).toBe(true)
    expect(ok(tga(4, 4, 32, { footer: false }), 'tga')).toBe(true)
    expect(ok(tga(4, 4, 24, { type: 10, extra: 0 }), 'tga')).toBe(true) // RLE: size only has to fit
    expect(ok(tga(4, 4, 24, { extra: 7 }), 'tga')).toBe(false) // more bytes than the header promises
    expect(ok(tga(4, 4, 24, { colorMap: 1 }), 'tga')).toBe(false)
    expect(ok(tga(4, 4, 24, { type: 9 }), 'tga')).toBe(false)
    expect(ok(tga(0, 4, 24), 'tga')).toBe(false)
    expect(ok(tga(8193, 1, 24), 'tga')).toBe(false)
    expect(ok(Buffer.from('<html><body>not found</body></html>'), 'tga')).toBe(false)
    expect(ok(Buffer.alloc(8), 'fbx')).toBe(false)
    expect(ok(fbx(), 'glb')).toBe(false) // no rule for any other type: the manifest cannot declare one
  })
})

// ---------------------------------------------------------------------------------------------
// 3. sha256 pin, git blob id, byte count
// ---------------------------------------------------------------------------------------------

describe('hashes', () => {
  it('fails loudly on a sha256 mismatch and installs nothing', async () => {
    const bytes = fbx(1)
    const wrong = createHash('sha256').update('something else').digest('hex')
    const { error, installed } = await runEntry(entryFor(bytes, { sha256: wrong }), { [FBX_URL]: { body: bytes } })
    expect(error?.code).toBe('SHA_MISMATCH')
    expect(error?.message).toContain(wrong)
    expect(error?.message).toContain(lib.sha256Hex(bytes))
    expect(Object.keys(installed.assets)).toEqual([])
    expect(await filesBelow('assets-src')).toEqual([])
    expect(await quarantineIsClean()).toBe(true)
  })

  it('refuses a git blob mismatch even when the sha256 pin matches, and a byte-count mismatch', async () => {
    const bytes = fbx(2)
    const net = { [FBX_URL]: { body: bytes } }
    expect((await runEntry(entryFor(bytes), net)).error).toBeNull()
    const blob = await runEntry(entryFor(bytes, { gitBlobSha1: 'a'.repeat(40), sha256: lib.sha256Hex(bytes) }), net)
    expect(blob.error?.code).toBe('HASH_MISMATCH')
    expect(blob.error?.message).toMatch(/git blob id/)
    expect(await quarantineIsClean()).toBe(true)
    expect((await runEntry(entryFor(bytes, { bytes: bytes.length + 1, maxBytes: bytes.length + 100 }), net)).error?.code).toBe('SIZE_MISMATCH')
    // same size, different content: the pinned blob id catches a swapped file on the very first fetch
    await fs.rm(rel('assets-src'), { recursive: true, force: true })
    const swapped = fbx(3)
    const first = await runEntry(entryFor(bytes), { [FBX_URL]: { body: swapped } })
    expect(first.error?.code).toBe('HASH_MISMATCH')
    expect(await filesBelow('assets-src')).toEqual([])
  })

  it('records the sha256 on first fetch, writes it back, then pins it for every later fetch', async () => {
    const bytes = fbx(4)
    await writeManifest([entryFor(bytes)])
    const first = mockNetwork({ [FBX_URL]: { body: bytes } })
    const r1 = await gate.runGate({ root, fetchImpl: first.fetchImpl, log: quiet })
    expect(r1.failures).toEqual([])
    expect(r1.results[0]).toMatchObject({ status: 'installed', firstFetch: true })
    const pinned = (await readManifest()).assets[0].sha256
    expect(pinned).toBe(lib.sha256Hex(bytes))
    const record = JSON.parse(await fs.readFile(rel('public', 'assets', 'manifest.json'), 'utf8'))
    expect(record.assets['rb-test-fbx'].files[0]).toMatchObject({ path: 'people/test.fbx', sha256: pinned, role: 'original', root: 'source' })
    expect(record.assets['rb-test-fbx'].gitBlobSha1).toBe(lib.gitBlobSha1Hex(bytes))
    expect(await fs.readFile(rel('assets-src', 'people', 'test.fbx'))).toEqual(bytes)
    expect(await fs.readFile(rel('docs', 'CREDITS.md'), 'utf8')).toContain('`rb-test-fbx`')
    expect(await quarantineIsClean()).toBe(true)
    expect(await exists('tools', '.fetch.lock')).toBe(false) // the lock is dropped

    // second run: verified offline, no network
    const second = mockNetwork({})
    const r2 = await gate.runGate({ root, fetchImpl: second.fetchImpl, log: quiet })
    expect(r2.results[0].status).toBe('up-to-date')
    expect(second.calls).toEqual([])

    // editing the licence or author in the manifest refreshes the credits without any network traffic
    const edited = await readManifest()
    edited.assets[0].author = 'A Different Author'
    await fs.writeFile(rel('tools', 'assets.manifest.json'), JSON.stringify(edited))
    const offline = mockNetwork({})
    const r2b = await gate.runGate({ root, fetchImpl: offline.fetchImpl, log: quiet })
    expect(r2b.results[0]).toMatchObject({ status: 'up-to-date', metadataUpdated: true })
    expect(offline.calls).toEqual([])
    expect(await fs.readFile(rel('docs', 'CREDITS.md'), 'utf8')).toContain('A Different Author')

    // forced re-download of swapped content (same size, so the sha256 pin is what stops it): refused, the installed file untouched
    const swapped = fbx(5)
    const third = mockNetwork({ [FBX_URL]: { body: swapped } })
    const r3 = await gate.runGate({ root, fetchImpl: third.fetchImpl, log: quiet, flags: { force: true } })
    expect(r3.failures).toHaveLength(1)
    expect(['SHA_MISMATCH', 'HASH_MISMATCH']).toContain(r3.failures[0].code)
    expect(await fs.readFile(rel('assets-src', 'people', 'test.fbx'))).toEqual(bytes)
    expect(await quarantineIsClean()).toBe(true)
  })

  it('notices an installed file that was edited by hand, and --verify reports it', async () => {
    const bytes = fbx(6)
    await writeManifest([entryFor(bytes)])
    await gate.runGate({ root, fetchImpl: mockNetwork({ [FBX_URL]: { body: bytes } }).fetchImpl, log: quiet })
    await fs.appendFile(rel('assets-src', 'people', 'test.fbx'), 'tampered')
    const lines: string[] = []
    expect(await gate.verifyAll({ root, log: (m: string) => lines.push(m) })).toBe(1)
    expect(lines.join('\n')).toMatch(/FAIL rb-test-fbx/)
    const again = await gate.runGate({ root, fetchImpl: mockNetwork({}).fetchImpl, log: quiet })
    expect(again.failures[0].code).toBe('INSTALLED_MISMATCH')
  })

  it('fetches again when an installed original has gone missing', async () => {
    const bytes = fbx(7)
    await writeManifest([entryFor(bytes)])
    await gate.runGate({ root, fetchImpl: mockNetwork({ [FBX_URL]: { body: bytes } }).fetchImpl, log: quiet })
    await fs.rm(rel('assets-src', 'people', 'test.fbx'))
    const net = mockNetwork({ [FBX_URL]: { body: bytes } })
    const again = await gate.runGate({ root, fetchImpl: net.fetchImpl, log: quiet })
    expect(again.failures).toEqual([])
    expect(again.results[0].status).toBe('installed')
    expect(await fs.readFile(rel('assets-src', 'people', 'test.fbx'))).toEqual(bytes)
    expect(net.calls.length).toBeGreaterThan(0)
  })

  it('--strict refuses an entry whose sha256 is still null, and --only reports ids that are not in the manifest', async () => {
    const bytes = fbx(8)
    const { error, calls } = await runEntry(entryFor(bytes), { [FBX_URL]: { body: bytes } }, { strict: true })
    expect(error?.code).toBe('UNPINNED_HASH')
    expect(calls).toEqual([])
    await writeManifest([entryFor(bytes)])
    const r = await gate.runGate({ root, only: ['typo'], fetchImpl: mockNetwork({}).fetchImpl, log: quiet })
    expect(r.failures[0]).toMatchObject({ id: 'typo', code: 'UNKNOWN_ID' })
  })
})

// ---------------------------------------------------------------------------------------------
// 4. Sizes
// ---------------------------------------------------------------------------------------------

describe('size limits', () => {
  it('refuses on the HEAD size before downloading', async () => {
    const big = fbx(0, 7400, 4000)
    const { error, calls } = await runEntry(entryFor(fbx(), { maxBytes: 200 }), { [FBX_URL]: { body: big } })
    expect(error?.code).toBe('SIZE_LIMIT')
    expect(calls.every((c) => c.method === 'HEAD')).toBe(true)
  })

  it('refuses a HEAD size that is not the exact byte count the manifest knows', async () => {
    const bytes = fbx()
    const longer = fbx(0, 7400, bytes.length + 10)
    const { error, calls } = await runEntry(entryFor(bytes), { [FBX_URL]: { body: longer } })
    expect(error?.code).toBe('SIZE_MISMATCH')
    expect(calls.every((c) => c.method === 'HEAD')).toBe(true)
  })

  it('stops a body that outgrows the cap even when the server hides its size', async () => {
    const big = fbx(0, 7400, 5000)
    const { error } = await runEntry(entryFor(fbx()), { [FBX_URL]: { body: big, headers: { 'x-omit-length': '1' } } })
    expect(error?.code).toBe('SIZE_LIMIT')
    expect(await quarantineIsClean()).toBe(true)
    expect(await filesBelow('assets-src')).toEqual([])
  })

  it('cannot declare a cap above the policy limit or far above the exact size, and reports a non-200 answer', async () => {
    const bytes = fbx()
    const bad = (over: Record<string, unknown>) => expect(() => lib.validateManifestEntry(entryFor(bytes, over)), JSON.stringify(over)).toThrowError(expect.objectContaining({ code: 'BAD_MANIFEST' }))
    bad({ maxBytes: lib.POLICY.maxFileBytes + 1 })
    bad({ maxBytes: bytes.length * 2 + 5000 })
    bad({ bytes: undefined })
    bad({ bytes: bytes.length + 500 }) // larger than maxBytes
    expect((await runEntry(entryFor(bytes), {})).error?.code).toBe('HTTP_STATUS')
  })
})

// ---------------------------------------------------------------------------------------------
// 5. Conversion inputs go to assets-src, never to public/
// ---------------------------------------------------------------------------------------------

describe('source-only destination', () => {
  it('installs only below assets-src/people and never creates public/assets/people', async () => {
    const model = fbx(9)
    const image = tga(4, 4, 24)
    await writeManifest([entryFor(model), entryFor(image, { id: 'rb-test-body-color', type: 'tga', url: TGA_URL, file: 'test_body_color.tga' })])
    const net = mockNetwork({ [FBX_URL]: { body: model }, [TGA_URL]: { body: image } })
    const r = await gate.runGate({ root, fetchImpl: net.fetchImpl, log: quiet })
    expect(r.failures).toEqual([])
    expect(await filesBelow('assets-src')).toEqual([path.join('assets-src', 'people', 'test.fbx'), path.join('assets-src', 'people', 'test_body_color.tga')].sort())
    expect(await filesBelow('public')).toEqual([path.join('public', 'assets', 'manifest.json')]) // nothing served, nothing left in quarantine
    expect(await exists('public', 'assets', 'people')).toBe(false)
  })

  it('refuses an fbx or tga entry without dest "source", and any other dest', () => {
    const bytes = fbx()
    const noDest: any = entryFor(bytes)
    delete noDest.dest
    expect(() => lib.validateManifestEntry(noDest)).toThrow(/dest "source"/)
    expect(() => lib.validateManifestEntry(entryFor(bytes, { dest: 'public' }))).toThrow(/dest "source"/)
    expect(lib.validateManifestEntry(entryFor(bytes)).file).toBe('test.fbx')
    expect(lib.validateManifestEntry({ ...entryFor(bytes), file: undefined }).file).toBe('rb-test-fbx.fbx')
  })

  it('keeps the source budget apart from the served budget, and enforces both', async () => {
    const bytes = fbx(10)
    const installed = gate.emptyInstalled()
    installed.assets.big = { files: [{ path: 'people/big.tga', bytes: lib.POLICY.maxSourceBytes - 10, root: 'source', sha256: 'a'.repeat(64), role: 'original' }] }
    const net = mockNetwork({ [FBX_URL]: { body: bytes } })
    await expect(gate.processEntry(entryFor(bytes), { root, installed, fetchImpl: net.fetchImpl })).rejects.toMatchObject({ code: 'TOTAL_SIZE_LIMIT' })
    const served = gate.emptyInstalled()
    served.assets.big = { files: [{ path: 'people/a.glb', bytes: lib.POLICY.maxTotalBytes - 10, role: 'derived', sha256: 'a'.repeat(64) }] }
    // a served 200 MB does not touch the source budget: this entry still installs
    const ok = await gate.processEntry(entryFor(bytes), { root, installed: served, fetchImpl: net.fetchImpl })
    expect(ok.status).toBe('installed')
  })

  it('never overwrites a file that is not recorded, unless --force', async () => {
    const bytes = fbx(11)
    await fs.mkdir(rel('assets-src', 'people'), { recursive: true })
    await fs.writeFile(rel('assets-src', 'people', 'test.fbx'), 'someone put this here')
    const net = { [FBX_URL]: { body: bytes } }
    expect((await runEntry(entryFor(bytes), net)).error?.code).toBe('DEST_EXISTS')
    expect(await fs.readFile(rel('assets-src', 'people', 'test.fbx'), 'utf8')).toBe('someone put this here')
    expect((await runEntry(entryFor(bytes), net, { force: true })).error).toBeNull()
    expect(await fs.readFile(rel('assets-src', 'people', 'test.fbx'))).toEqual(bytes)
  })
})

// ---------------------------------------------------------------------------------------------
// 6. localFile imports: verified copies, never downloaded
// ---------------------------------------------------------------------------------------------

describe('localFile import', () => {
  const localEntry = (bytes: Buffer, over: Record<string, unknown> = {}) => entryFor(bytes, { localFile: 'people/test.fbx', sha256: lib.sha256Hex(bytes), ...over })

  it('installs a staged file with no network request at all, and leaves the staged copy in place', async () => {
    const bytes = fbx(12)
    await stage('people/test.fbx', bytes)
    const { error, result, calls, installed } = await runEntry(localEntry(bytes), {})
    expect(error).toBeNull()
    expect(result).toMatchObject({ status: 'installed', firstFetch: false })
    expect(calls).toEqual([])
    expect(await fs.readFile(rel('assets-src', 'people', 'test.fbx'))).toEqual(bytes)
    expect(await fs.readFile(rel('assets-src', '_import', 'people', 'test.fbx'))).toEqual(bytes)
    expect(installed.assets['rb-test-fbx'].source).toMatchObject({ url: FBX_URL, local: 'people/test.fbx' })
    expect(await exists('public', 'assets', '_downloads')).toBe(false)
  })

  it('refuses a staged file whose sha256, git blob id, size or magic differs from the pins, and installs nothing', async () => {
    const good = fbx(13)
    const evil = fbx(14)
    await stage('people/test.fbx', evil)
    const sha = await runEntry(localEntry(good), {})
    expect(sha.error?.code).toBe('SHA_MISMATCH')
    // same sha256 pin as the staged bytes, but not the blob the repository lists
    const blob = await runEntry(localEntry(evil, { gitBlobSha1: lib.gitBlobSha1Hex(good) }), {})
    expect(blob.error?.code).toBe('HASH_MISMATCH')
    const size = await runEntry(localEntry(evil, { bytes: evil.length + 1 }), {})
    expect(size.error?.code).toBe('SIZE_MISMATCH')
    const html = Buffer.from('<html><body>' + 'x'.repeat(100) + '</body></html>')
    await stage('people/test.fbx', html)
    expect((await runEntry(localEntry(html), {})).error?.code).toBe('BAD_MAGIC')
    expect(await filesBelow('assets-src/people')).toEqual([])
  })

  it('refuses a missing file, a missing staging folder, an oversize file, a symbolic link and a link out of the folder', async () => {
    const bytes = fbx(15)
    expect((await runEntry(localEntry(bytes), {})).error?.code).toBe('LOCAL_FILE_MISSING') // no staging folder
    await fs.mkdir(rel('assets-src', '_import', 'people'), { recursive: true })
    expect((await runEntry(localEntry(bytes), {})).error?.code).toBe('LOCAL_FILE_MISSING') // folder, no file
    await fs.writeFile(rel('assets-src', '_import', 'people', 'test.fbx'), fbx(15, 7400, 4000))
    expect((await runEntry(localEntry(bytes), {})).error?.code).toBe('SIZE_LIMIT')
    await fs.rm(rel('assets-src', '_import', 'people', 'test.fbx'))

    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'hospital-outside-'))
    try {
      await fs.writeFile(path.join(outside, 'secret.fbx'), bytes)
      await fs.symlink(path.join(outside, 'secret.fbx'), rel('assets-src', '_import', 'people', 'test.fbx'))
      expect((await runEntry(localEntry(bytes), {})).error?.code).toBe('LOCAL_FILE_UNSAFE') // a symlink to a file with the right bytes is still refused
      await fs.rm(rel('assets-src', '_import', 'people'), { recursive: true })
      await fs.symlink(outside, rel('assets-src', '_import', 'people'))
      await fs.writeFile(path.join(outside, 'test.fbx'), bytes)
      expect((await runEntry(localEntry(bytes), {})).error?.code).toBe('LOCAL_FILE_UNSAFE') // a folder link that resolves outside
      await fs.rm(rel('assets-src', '_import', 'people'))
      await fs.mkdir(rel('assets-src', '_import', 'people', 'test.fbx'), { recursive: true })
      expect((await runEntry(localEntry(bytes), {})).error?.code).toBe('LOCAL_FILE_UNSAFE') // a directory
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
    expect(await filesBelow('assets-src/people')).toEqual([])
  })

  it('needs its sha256 already pinned, a plain relative path inside assets-src/_import, and a matching extension', () => {
    const bytes = fbx()
    const bad = (over: Record<string, unknown>) => expect(() => lib.validateManifestEntry(localEntry(bytes, over)), JSON.stringify(over)).toThrowError(expect.objectContaining({ code: 'BAD_MANIFEST' }))
    bad({ sha256: null })
    for (const localFile of ['../escape.fbx', 'people/../../escape.fbx', '/etc/passwd.fbx', 'people//x.fbx', './x.fbx', '.hidden.fbx', 'a/b/c/d.fbx', 'people/x.tga', 'people\\x.fbx', 'people/x y.fbx', '', 'C:/x.fbx']) bad({ localFile })
    expect(lib.validateManifestEntry(localEntry(bytes, { localFile: 'a/b/c.fbx' })).localFile).toBe('a/b/c.fbx')
  })

  it('still demands an on-list url as provenance, so an off-list address cannot hide behind a localFile', async () => {
    const bytes = fbx(16)
    await stage('people/test.fbx', bytes)
    const { error, calls } = await runEntry(localEntry(bytes, { url: 'https://evil.example.com/x.fbx' }), {})
    expect(error?.code).toBe('ORIGIN_NOT_ALLOWED')
    expect(calls).toEqual([])
  })

  it('is verified by --dry-run too: full checks, nothing installed, and a download entry gets its HEAD only', async () => {
    const bytes = fbx(17)
    await stage('people/test.fbx', bytes)
    const dry = await runEntry(localEntry(bytes), {}, { dryRun: true })
    expect(dry.error).toBeNull()
    expect(dry.result.status).toBe('dry-run-ok')
    expect(await filesBelow('assets-src/people')).toEqual([])
    await stage('people/test.fbx', fbx(18))
    expect((await runEntry(localEntry(bytes), {}, { dryRun: true })).error?.code).toBe('SHA_MISMATCH')

    const download = await runEntry(entryFor(bytes), { [FBX_URL]: { body: bytes } }, { dryRun: true })
    expect(download.result.status).toBe('dry-run-ok')
    expect(download.calls).toEqual([{ url: FBX_URL, method: 'HEAD' }])
    expect(await exists('public')).toBe(false)
  })

  it('is up to date once installed: the staging folder is not needed any more', async () => {
    const bytes = fbx(19)
    await stage('people/test.fbx', bytes)
    await writeManifest([localEntry(bytes)])
    const first = await gate.runGate({ root, fetchImpl: mockNetwork({}).fetchImpl, log: quiet })
    expect(first.results[0].status).toBe('installed')
    await fs.rm(rel('assets-src', '_import'), { recursive: true })
    const again = await gate.runGate({ root, fetchImpl: mockNetwork({}).fetchImpl, log: quiet })
    expect(again.failures).toEqual([])
    expect(again.results[0].status).toBe('up-to-date')
  })
})

// ---------------------------------------------------------------------------------------------
// 7. The whole manifest: validated first, dry run, refusals, lock, --verify
// ---------------------------------------------------------------------------------------------

describe('runGate', () => {
  it('validates and origin-checks the whole manifest before the first request', async () => {
    const bytes = fbx(20)
    const net = mockNetwork({ [FBX_URL]: { body: bytes } })
    await writeManifest([entryFor(bytes), entryFor(bytes, { id: 'rb-test-evil', file: 'evil.fbx', url: 'https://evil.example.com/x.fbx' })])
    await expect(gate.runGate({ root, fetchImpl: net.fetchImpl, log: quiet })).rejects.toMatchObject({ code: 'ORIGIN_NOT_ALLOWED' })
    await writeManifest([entryFor(bytes), entryFor(bytes, { id: 'rb-test-bad', file: 'bad.fbx', typo: true })])
    await expect(gate.runGate({ root, fetchImpl: net.fetchImpl, log: quiet })).rejects.toMatchObject({ code: 'BAD_MANIFEST' })
    await writeManifest([entryFor(bytes), entryFor(bytes)])
    await expect(gate.runGate({ root, fetchImpl: net.fetchImpl, log: quiet })).rejects.toMatchObject({ code: 'BAD_MANIFEST' })
    expect(net.calls).toEqual([])
    expect(await filesBelow('assets-src')).toEqual([])
    expect(await exists('tools', '.fetch.lock')).toBe(false)
  })

  it('--dry-run sends HEAD requests only, writes nothing and takes no lock', async () => {
    const bytes = fbx(21)
    await writeManifest([entryFor(bytes)])
    const net = mockNetwork({ [FBX_URL]: { body: bytes } })
    const r = await gate.runGate({ root, fetchImpl: net.fetchImpl, log: quiet, flags: { dryRun: true } })
    expect(r.failures).toEqual([])
    expect(r.results[0].status).toBe('dry-run-ok')
    expect(net.calls).toEqual([{ url: FBX_URL, method: 'HEAD' }])
    expect(await exists('public')).toBe(false)
    expect(await exists('assets-src')).toBe(false)
    expect(await exists('docs')).toBe(false)
    expect((await readManifest()).assets[0].sha256).toBeNull()
  })

  it('does not let one refusal stop the others, and still pins and records the good ones', async () => {
    const a = fbx(22)
    const b = fbx(23)
    const urlB = `${RB}/Export/Other.fbx`
    await writeManifest([entryFor(a), entryFor(b, { id: 'rb-test-two', file: 'two.fbx', url: urlB })])
    const net = mockNetwork({ [FBX_URL]: { body: Buffer.from('<html>login</html>' + ' '.repeat(100)) }, [urlB]: { body: b } })
    const r = await gate.runGate({ root, fetchImpl: net.fetchImpl, log: quiet })
    expect(r.failures.map((f: any) => f.id)).toEqual(['rb-test-fbx'])
    expect(r.results.map((x: any) => x.id)).toEqual(['rb-test-two'])
    const manifest = await readManifest()
    expect(manifest.assets[0].sha256).toBeNull()
    expect(manifest.assets[1].sha256).toBe(lib.sha256Hex(b))
    expect(await filesBelow('assets-src')).toEqual([path.join('assets-src', 'people', 'two.fbx')])
    expect(await exists('tools', '.fetch.lock')).toBe(false)
  })

  it('holds tools/.fetch.lock while it writes, waits for a lock that is taken and never breaks one', async () => {
    const bytes = fbx(24)
    await writeManifest([entryFor(bytes)])
    const net = mockNetwork({ [FBX_URL]: { body: bytes } })
    const release = await gate.acquireLock(root)
    expect(await exists('tools', '.fetch.lock')).toBe(true)
    // a taken lock that is never released: the gate stops with a message, does not delete it, and has installed nothing
    await expect(gate.runGate({ root, fetchImpl: net.fetchImpl, log: quiet, lockOptions: { pollMs: 5, maxWaitMs: 40 } })).rejects.toMatchObject({ code: 'LOCK_TIMEOUT' })
    expect(await exists('tools', '.fetch.lock')).toBe(true)
    expect(net.calls).toEqual([])
    // released while the gate waits: it goes on
    const waiting = gate.runGate({ root, fetchImpl: net.fetchImpl, log: quiet, lockOptions: { pollMs: 5, maxWaitMs: 5000 } })
    setTimeout(() => void release(), 60)
    const r = await waiting
    expect(r.results[0].status).toBe('installed')
    expect(await exists('tools', '.fetch.lock')).toBe(false)
  })
})

describe('--verify', () => {
  const install = async (bytes: Buffer) => {
    await writeManifest([entryFor(bytes)])
    await gate.runGate({ root, fetchImpl: mockNetwork({ [FBX_URL]: { body: bytes } }).fetchImpl, log: quiet })
  }

  it('re-hashes every installed original offline and reports ok', async () => {
    await install(fbx(25))
    const lines: string[] = []
    expect(await gate.verifyAll({ root, log: (m: string) => lines.push(m) })).toBe(0)
    expect(lines[0]).toBe('ok   rb-test-fbx (1 file)')
    expect(lines.at(-1)).toMatch(/1 asset\(s\), 0\.00 MB of 200 MB served, 0\.00 MB of 1024 MB source-only/)
  })

  it('also checks the originals against the manifest pins: the sha256, and the git blob id and size of the file at the commit', async () => {
    const bytes = fbx(26)
    await install(bytes)
    const pinned = await readManifest()
    const lines: string[] = []
    const log = (m: string) => lines.push(m)
    pinned.assets[0].sha256 = 'b'.repeat(64)
    await fs.writeFile(rel('tools', 'assets.manifest.json'), JSON.stringify(pinned))
    expect(await gate.verifyAll({ root, log })).toBe(1)
    expect(lines.join('\n')).toMatch(/recorded sha256 differs from the manifest pin/)
    pinned.assets[0].sha256 = lib.sha256Hex(bytes)
    pinned.assets[0].gitBlobSha1 = 'c'.repeat(40)
    await fs.writeFile(rel('tools', 'assets.manifest.json'), JSON.stringify(pinned))
    lines.length = 0
    expect(await gate.verifyAll({ root, log })).toBe(1)
    expect(lines.join('\n')).toMatch(/git blob id does not match the manifest/)
  })

  it('reports entries that are not installed, and fails for them only with --require-all', async () => {
    const bytes = fbx(27)
    await writeManifest([entryFor(bytes)])
    await fs.mkdir(rel('public', 'assets'), { recursive: true })
    const lines: string[] = []
    expect(await gate.verifyAll({ root, log: (m: string) => lines.push(m) })).toBe(0)
    expect(lines.join('\n')).toMatch(/skip rb-test-fbx: not installed/)
    expect(await gate.verifyAll({ root, log: quiet, requireAll: true })).toBe(1)
  })

  it('reports a recorded file that is missing', async () => {
    await install(fbx(28))
    await fs.rm(rel('assets-src', 'people', 'test.fbx'))
    expect(await gate.verifyAll({ root, log: quiet })).toBe(1)
  })
})

// ---------------------------------------------------------------------------------------------
// 8. Manifest shape, credits, CLI, hygiene
// ---------------------------------------------------------------------------------------------

describe('manifest entries', () => {
  it('rejects malformed entries', () => {
    const bytes = fbx()
    const bad = (over: Record<string, unknown>) => expect(() => lib.validateManifestEntry(entryFor(bytes, over)), JSON.stringify(over)).toThrowError(expect.objectContaining({ code: 'BAD_MANIFEST' }))
    bad({ id: 'Has Spaces' })
    bad({ id: '../x' })
    bad({ kind: 'secrets' })
    bad({ kind: 'props' }) // only "people", "textures" and "hdri" exist in this project
    bad({ kind: 'textures' }) // fbx is not a texture type
    bad({ group: 'terrazzo_tiles' }) // group is for textures only
    bad({ type: 'exe' })
    bad({ type: 'glb', url: FBX_URL.replace('.fbx', '.glb'), file: 'x.glb' })
    bad({ typo: true })
    bad({ md5: 'a'.repeat(32) }) // not part of this gate
    bad({ include: [] })
    bad({ extract: [] })
    bad({ sha256: 'abc' })
    bad({ sha256: 'A'.repeat(64) })
    bad({ gitBlobSha1: undefined })
    bad({ gitBlobSha1: 'abc' })
    bad({ gitBlobSha1: 'A'.repeat(40) })
    bad({ url: undefined })
    bad({ url: FBX_URL.replace('.fbx', '.tga') }) // url extension != type
    bad({ file: '../escape.fbx' })
    bad({ file: 'wrong.tga' })
    bad({ licence: '' })
    bad({ sourcePage: 'javascript:alert(1)' })
    bad({ licenceUrl: 'http://example.com/LICENSE' })
    bad({ sourceCommit: 'master' })
    bad({ maxBytes: 0 })
  })
})

describe('credits block', () => {
  const installed = {
    assets: {
      'rb-x-fbx': { kind: 'people', files: [{ path: 'people/x.fbx', root: 'source' }], licence: 'MIT', licenceUrl: null, author: 'Rocketbox', source: { page: 'https://example.com/x' }, sha256: 'a'.repeat(64) },
    },
  }
  it('replaces only the generated block and is idempotent', () => {
    const block = lib.renderCreditsBlock(installed)
    const text = '# Credits\n\nHand-written note.\n'
    const once = lib.applyCreditsBlock(text, block)
    expect(once).toContain('Hand-written note.')
    expect(once).toContain('`rb-x-fbx`')
    expect(once).toContain('`assets-src/people/x.fbx`')
    const twice = lib.applyCreditsBlock(once.replace('Hand-written note.', 'Edited note.'), block)
    expect(twice).toContain('Edited note.')
    expect(twice.match(/BEGIN GENERATED ASSETS/g)).toHaveLength(1)
    expect(lib.applyCreditsBlock(twice, block)).toBe(twice)
  })
})

describe('command line', () => {
  it('parses the flags, and refuses anything it does not know (including the Waltz-only resolvers)', () => {
    expect(gate.parseArgs(['--dry-run', '--force', '--strict', '--only', 'a,b'])).toMatchObject({ flags: { dryRun: true, force: true, strict: true }, only: ['a', 'b'] })
    expect(gate.parseArgs(['--verify', '--require-all'])).toMatchObject({ verify: true, requireAll: true })
    for (const bad of ['--resolve-polyhaven', '--url', 'https://example.com/x.fbx', '--bogus']) expect(() => gate.parseArgs([bad])).toThrowError(expect.objectContaining({ code: 'USAGE' }))
  })
})

describe('the gate never executes what it downloads, and knows two hosts', () => {
  const read = async (file: string) => {
    const src = await fs.readFile(path.join(here, file), 'utf8')
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  }

  it('has no process spawning, eval or dynamic import in its source', async () => {
    for (const file of ['assets-lib.mjs', 'fetch-assets.mjs']) {
      const code = await read(file)
      for (const forbidden of [/child_process/, /\beval\s*\(/, /new Function\s*\(/, /\bFunction\s*\(/, /\bspawn(Sync)?\s*\(/, /\bexec(Sync|File|FileSync)?\s*\(/, /\bimport\s*\(/, /\brequire\s*\(/, /\bvm\b\./, /worker_threads/, /node:(http|https|net|dns|tls)\b/]) {
        expect(code, `${file} must not match ${forbidden}`).not.toMatch(forbidden)
      }
    }
  })

  it('imports only node:crypto, node:fs, node:path, node:url, the glTF validator and its own library', async () => {
    const allowed = new Set(['node:crypto', 'node:fs', 'node:path', 'node:url', 'gltf-validator', './assets-lib.mjs'])
    for (const file of ['assets-lib.mjs', 'fetch-assets.mjs']) {
      const code = await read(file)
      const specifiers = [...code.matchAll(/^import[^;]*?from\s+'([^']+)'/gms)].map((m) => m[1])
      expect(specifiers.length, file).toBeGreaterThan(0)
      for (const s of specifiers) expect(allowed.has(s), `${file} imports ${s}`).toBe(true)
    }
  })

  it('names exactly two hosts in code (GitHub raw and Poly Haven files), and writes no other URL', async () => {
    for (const file of ['assets-lib.mjs', 'fetch-assets.mjs']) {
      const code = await read(file)
      expect(code, `${file}: no URL literal`).not.toMatch(/https?:\/\/[a-z0-9]/i)
      const hosts = [...code.matchAll(/['"`]((?:[a-z0-9-]+\.)+(?:com|org|net|io|nl|dev))['"`]/g)].map((m) => m[1])
      expect([...new Set(hosts)].sort(), file).toEqual(file === 'assets-lib.mjs' ? ['dl.polyhaven.org', 'raw.githubusercontent.com'] : [])
      expect(code, `${file}: the Poly Haven metadata API is never contacted`).not.toMatch(/api\.polyhaven/)
    }
  })

  it('reaches the network only through safeFetch, and only with fetch()', async () => {
    const lib = await read('assets-lib.mjs')
    expect([...lib.matchAll(/\bfetchImpl\(/g)]).toHaveLength(1) // the one request site, behind the origin gate
    expect(lib).toMatch(/globalThis\.fetch/)
    expect(await read('fetch-assets.mjs')).not.toMatch(/\bfetch\s*\(/)
  })
})

// ---------------------------------------------------------------------------------------------
// 9. Poly Haven: CC0 textures and HDRIs (kinds "textures" and "hdri")
// ---------------------------------------------------------------------------------------------

const PH = 'https://dl.polyhaven.org/file/ph-assets'
const TEX_URL = `${PH}/Textures/jpg/2k/terrazzo_tiles/terrazzo_tiles_diff_2k.jpg`
const NOR_URL = `${PH}/Textures/png/1k/concrete_wall_001/concrete_wall_001_nor_gl_1k.png`
const HDR_URL = `${PH}/HDRIs/hdr/2k/kloofendal_38d_partly_cloudy_2k.hdr`
const EXR_URL = `${PH}/HDRIs/exr/1k/kloofendal_38d_partly_cloudy_1k.exr`

/** A JPEG-looking body (FF D8 FF E0 ...). */
const jpg = (fill = 0x11, size = 64) => {
  const b = Buffer.alloc(size, fill)
  b.set([0xff, 0xd8, 0xff, 0xe0], 0)
  return b
}
const png = (fill = 0x22, size = 64) => {
  const b = Buffer.alloc(size, fill)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return b
}
const hdr = (fill = 0x33, size = 64, magic = '#?RADIANCE\n') => {
  const b = Buffer.alloc(size, fill)
  b.write(magic, 0, 'latin1')
  return b
}
const exr = (fill = 0x44, size = 64) => {
  const b = Buffer.alloc(size, fill)
  b.set([0x76, 0x2f, 0x31, 0x01], 0)
  return b
}

/** A Poly Haven manifest entry for `bytes`: no git blob id (there is no commit to pin), sha256 still null. */
const phEntry = (bytes: Buffer, over: Record<string, unknown> = {}) => ({
  id: 'ph-terrazzo-tiles-diff-2k',
  kind: 'textures',
  type: 'jpg',
  dest: 'source',
  group: 'terrazzo_tiles',
  file: 'terrazzo_tiles_diff_2k.jpg',
  url: TEX_URL,
  sourcePage: 'https://polyhaven.com/a/terrazzo_tiles',
  sha256: null,
  bytes: bytes.length,
  maxBytes: bytes.length + 100,
  licence: 'CC0 1.0 Universal',
  ...over,
})
const hdriEntry = (bytes: Buffer, over: Record<string, unknown> = {}) =>
  phEntry(bytes, { id: 'ph-kloofendal-hdr-2k', kind: 'hdri', type: 'hdr', group: undefined, file: 'kloofendal_38d_partly_cloudy_2k.hdr', url: HDR_URL, sourcePage: 'https://polyhaven.com/a/kloofendal_38d_partly_cloudy', ...over })

describe('Poly Haven origin gate', () => {
  it('accepts texture and HDRI paths: Textures/<jpg|png>/<1k|2k>/<id>/<id>_<map>_<res>.<fmt>, HDRIs/<hdr|exr>/<1k|2k>/<name>_<res>.<fmt>', () => {
    for (const ok of [
      TEX_URL,
      NOR_URL,
      `${PH}/Textures/jpg/1k/poly_wool_herringbone/poly_wool_herringbone_arm_1k.jpg`,
      `${PH}/Textures/png/2k/oak_veneer_02/oak_veneer_02_rough_2k.png`,
      `${PH}/Textures/jpg/1k/horn-koppe_x/horn-koppe_x_diff_1k.jpg`,
      HDR_URL,
      EXR_URL,
      `${PH}/HDRIs/hdr/1k/studio_small_03_1k.hdr`,
    ]) {
      expect(lib.checkDownloadUrl(ok).hostname, ok).toBe('dl.polyhaven.org')
    }
  })

  it('refuses other hosts, paths, resolutions, formats, extensions, query strings, fragments and traversal', () => {
    const bad = [
      'https://polyhaven.com/file/ph-assets/Textures/jpg/2k/terrazzo_tiles/terrazzo_tiles_diff_2k.jpg', // the web host
      'https://api.polyhaven.com/files/terrazzo_tiles',
      'https://dl.polyhaven.org.evil.com/file/ph-assets/Textures/jpg/2k/terrazzo_tiles/terrazzo_tiles_diff_2k.jpg',
      'https://www.dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/terrazzo_tiles/terrazzo_tiles_diff_2k.jpg',
      'https://cdn.polyhaven.org/file/ph-assets/Textures/jpg/2k/terrazzo_tiles/terrazzo_tiles_diff_2k.jpg',
      'http://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/terrazzo_tiles/terrazzo_tiles_diff_2k.jpg',
      'https://dl.polyhaven.org:8443/file/ph-assets/Textures/jpg/2k/terrazzo_tiles/terrazzo_tiles_diff_2k.jpg',
      'https://user:pw@dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/terrazzo_tiles/terrazzo_tiles_diff_2k.jpg',
      `${TEX_URL}?download=1`, // query string
      `${TEX_URL}#x`, // fragment
      `${PH}/Textures/jpg/4k/terrazzo_tiles/terrazzo_tiles_diff_4k.jpg`, // resolution
      `${PH}/Textures/jpg/8k/terrazzo_tiles/terrazzo_tiles_diff_8k.jpg`,
      `${PH}/Textures/jpg/512/terrazzo_tiles/terrazzo_tiles_diff_512.jpg`,
      `${PH}/Textures/jpg/2K/terrazzo_tiles/terrazzo_tiles_diff_2K.jpg`,
      `${PH}/Textures/exr/2k/terrazzo_tiles/terrazzo_tiles_disp_2k.exr`, // textures are jpg or png only
      `${PH}/Textures/hdr/2k/terrazzo_tiles/terrazzo_tiles_diff_2k.hdr`,
      `${PH}/Textures/blend/2k/terrazzo_tiles/terrazzo_tiles_2k.blend`, // other formats of the store
      `${PH}/Textures/gltf/2k/terrazzo_tiles/terrazzo_tiles_2k.gltf`,
      `${PH}/Textures/zip/2k/terrazzo_tiles/terrazzo_tiles_2k.zip`,
      `${PH}/HDRIs/jpg/2k/kloofendal_38d_partly_cloudy_2k.jpg`, // HDRIs are hdr or exr only
      `${PH}/HDRIs/png/2k/kloofendal_38d_partly_cloudy_2k.png`,
      `${PH}/HDRIs/hdr/8k/kloofendal_38d_partly_cloudy_8k.hdr`,
      `${PH}/HDRIs/hdr/2k/kloofendal_38d_partly_cloudy_2k.exr`, // extension != folder
      `${PH}/Textures/jpg/2k/terrazzo_tiles/terrazzo_tiles_diff_2k.png`,
      `${PH}/Textures/jpg/2k/terrazzo_tiles/terrazzo_tiles_diff_1k.jpg`, // file resolution != folder
      `${PH}/Textures/jpg/2k/terrazzo_tiles/other_asset_diff_2k.jpg`, // file is not that asset's
      `${PH}/Textures/jpg/2k/terrazzo_tiles/terrazzo_tiles_diff_2k.jpg.exe`,
      `${PH}/Textures/jpg/2k/terrazzo_tiles/.hidden_2k.jpg`,
      `${PH}/Textures/jpg/2k/terrazzo_tiles/terrazzo_tiles_diff_2k.JPG`, // case matters: the folder says jpg
      `${PH}/Textures/jpg/2k/terrazzo_tiles/extra/terrazzo_tiles_diff_2k.jpg`, // too deep
      `${PH}/Textures/jpg/2k/terrazzo_tiles_diff_2k.jpg`, // too shallow (no asset folder)
      `${PH}/HDRIs/hdr/2k/sub/kloofendal_38d_partly_cloudy_2k.hdr`,
      `${PH}/HDRIs/hdr/kloofendal_38d_partly_cloudy_2k.hdr`,
      `${PH}/Models/jpg/2k/terrazzo_tiles/terrazzo_tiles_diff_2k.jpg`, // other store folders
      `${PH}/Backplates/jpg/2k/x/x_2k.jpg`,
      `${PH}/Textures/jpg/2k/Terrazzo_Tiles/Terrazzo_Tiles_diff_2k.jpg`, // ids are lowercase
      `${PH}/Textures/jpg/2k/terrazzo_tiles/terrazzo_tiles_diff_2k.jpg/`,
      'https://dl.polyhaven.org/ph-assets/Textures/jpg/2k/terrazzo_tiles/terrazzo_tiles_diff_2k.jpg', // no /file/
      'https://dl.polyhaven.org/file/other-assets/Textures/jpg/2k/terrazzo_tiles/terrazzo_tiles_diff_2k.jpg',
      'https://dl.polyhaven.org/',
      'https://dl.polyhaven.org/file/ph-assets/',
      `${PH}/Textures/jpg/2k/terrazzo_tiles/../../../../../../etc/x_2k.jpg`, // collapses outside the folder
      `${PH}/Textures/jpg/2k/terrazzo_tiles/${'%2e%2e/'.repeat(6)}x_2k.jpg`,
      `${PH}/Textures/jpg/2k/terrazzo_tiles%2fterrazzo_tiles_diff_2k.jpg`, // encoded slash
      `${PH}/Textures/jpg/2k/terrazzo_tiles/terrazzo%20tiles_diff_2k.jpg`, // escapes are not plain names
      `${PH}/Textures/jpg/2k/terrazzo_tiles/terrazzo_tiles_diff_2k.jpg\\x`, // backslash
      `${PH}/Textures/jpg/2k//terrazzo_tiles_diff_2k.jpg`, // empty segment
    ]
    for (const url of bad) expect(() => lib.checkDownloadUrl(url), url).toThrowError(expect.objectContaining({ name: 'GateError', code: expect.stringMatching(/ORIGIN_NOT_ALLOWED|BAD_URL/) }))
    // the Rocketbox rules are untouched: still exactly one commit and folder
    expect(lib.checkDownloadUrl(FBX_URL).hostname).toBe('raw.githubusercontent.com')
    expect(() => lib.checkDownloadUrl(FBX_URL.replace(COMMIT, 'master'))).toThrowError(expect.objectContaining({ code: 'GITHUB_UNPINNED' }))
  })

  it('refuses a redirect from an allowed Poly Haven file to anywhere off the list, before requesting it', async () => {
    const bytes = jpg()
    for (const evil of ['https://evil.example.com/x_2k.jpg', `${PH}/Textures/jpg/4k/terrazzo_tiles/terrazzo_tiles_diff_4k.jpg`, 'https://api.polyhaven.com/files/terrazzo_tiles']) {
      const { error, calls } = await runEntry(phEntry(bytes), { [TEX_URL]: { status: 302, headers: { location: evil } }, [evil]: { body: bytes } })
      expect(error?.code, evil).toBe('ORIGIN_NOT_ALLOWED')
      expect(calls.map((c) => c.url)).toEqual([TEX_URL])
    }
  })

  it('keeps the two sources apart: kind people only on GitHub, kind textures and hdri only on Poly Haven, and url, type, group and file must agree', async () => {
    const bytes = jpg()
    const refused = async (entry: Record<string, unknown>, routes: Record<string, Route> = {}) => {
      const r = await runEntry(entry, routes)
      expect(r.calls).toEqual([]) // refused before any request
      return r.error?.code
    }
    expect(await refused(phEntry(bytes, { kind: 'people', type: 'jpg' }))).toBe('BAD_MANIFEST')
    const fbxBytes = fbx()
    expect(await refused(entryFor(fbxBytes, { kind: 'textures', type: 'fbx' }))).toBe('BAD_MANIFEST') // textures hold jpg/png
    expect(await refused(entryFor(fbxBytes, { gitBlobSha1: undefined, url: TEX_URL.replace('.jpg', '.fbx') }))).toBe('ORIGIN_NOT_ALLOWED') // people entry, Poly Haven host
    expect(await refused(phEntry(bytes, { kind: 'hdri', type: 'hdr', group: undefined, file: 'terrazzo_tiles_diff_2k.hdr', url: TEX_URL.replace('.jpg', '.hdr') }))).toBe('ORIGIN_NOT_ALLOWED') // hdri entry pointing into Textures
    expect(await refused(phEntry(bytes, { file: 'renamed.jpg' }))).toBe('ORIGIN_NOT_ALLOWED') // file is the url's file name
    expect(await refused(phEntry(bytes, { group: 'other_asset' }))).toBe('ORIGIN_NOT_ALLOWED') // group is the asset id
    expect(await refused(phEntry(bytes, { group: undefined }))).toBe('ORIGIN_NOT_ALLOWED')
    const h = hdr()
    expect(await refused(hdriEntry(h, { group: 'terrazzo_tiles' }))).toBe('BAD_MANIFEST') // group is for textures
    expect(await refused(hdriEntry(h, { type: 'exr' }))).toBe('BAD_MANIFEST') // url says hdr
  })
})

describe('Poly Haven magic bytes', () => {
  const ok = (b: Buffer, t: string) => lib.checkMagic(b, t).ok
  it('checks PNG, JPEG, Radiance HDR and OpenEXR headers', () => {
    expect(ok(png(), 'png')).toBe(true)
    expect(ok(jpg(), 'jpg')).toBe(true)
    expect(ok(hdr(), 'hdr')).toBe(true)
    expect(ok(hdr(0x20, 64, '#?RGBE\n'), 'hdr')).toBe(true)
    expect(ok(exr(), 'exr')).toBe(true)
    // each type refuses the others and anything near-miss
    expect(ok(png(), 'jpg')).toBe(false)
    expect(ok(jpg(), 'png')).toBe(false)
    expect(ok(exr(), 'hdr')).toBe(false)
    expect(ok(hdr(), 'exr')).toBe(false)
    const badPng = png()
    badPng[4] = 0
    expect(ok(badPng, 'png')).toBe(false)
    const badJpg = jpg()
    badJpg[1] = 0xd9
    expect(ok(badJpg, 'jpg')).toBe(false)
    const badExr = exr()
    badExr[3] = 0x02
    expect(ok(badExr, 'exr')).toBe(false)
    expect(ok(hdr(0x20, 64, '#?RADIANC\n'), 'hdr')).toBe(false)
    expect(ok(hdr(0x20, 64, '#!RADIANCE\n'), 'hdr')).toBe(false)
    expect(ok(Buffer.from('<html><body>not found, sign in</body></html>'), 'jpg')).toBe(false)
    expect(lib.checkMagic(Buffer.from('<!DOCTYPE html><html>nope</html>'), 'exr').reason).toMatch(/HTML/)
    expect(ok(Buffer.alloc(8), 'png')).toBe(false)
    expect(ok(jpg(), 'webp')).toBe(false)
  })

  it('rejects an HTML page served in place of a texture or an HDRI, and installs nothing', async () => {
    const html = Buffer.from('<!DOCTYPE html><html><body>Cloudflare: access denied</body></html>')
    const tex = await runEntry(phEntry(html), { [TEX_URL]: { body: html } })
    expect(tex.error?.code).toBe('BAD_MAGIC')
    const sky = await runEntry(hdriEntry(html), { [HDR_URL]: { body: html } })
    expect(sky.error?.code).toBe('BAD_MAGIC')
    // a PNG body under a .jpg url, and an EXR body under a .hdr url
    const asJpg = await runEntry(phEntry(png()), { [TEX_URL]: { body: png() } })
    expect(asJpg.error?.code).toBe('BAD_MAGIC')
    const asHdr = await runEntry(hdriEntry(exr()), { [HDR_URL]: { body: exr() } })
    expect(asHdr.error?.code).toBe('BAD_MAGIC')
    expect(await filesBelow('assets-src')).toEqual([])
    expect(await quarantineIsClean()).toBe(true)
  })
})

describe('Poly Haven manifest entries: bytes + sha256, no git blob id', () => {
  it('validates without gitBlobSha1, and refuses one on a Poly Haven entry', () => {
    const bytes = jpg()
    expect(lib.validateManifestEntry(phEntry(bytes)).file).toBe('terrazzo_tiles_diff_2k.jpg')
    expect(lib.validateManifestEntry(hdriEntry(hdr())).sha256).toBeNull()
    const bad = (over: Record<string, unknown>) => expect(() => lib.validateManifestEntry(phEntry(bytes, over)), JSON.stringify(over)).toThrowError(expect.objectContaining({ code: 'BAD_MANIFEST' }))
    bad({ gitBlobSha1: lib.gitBlobSha1Hex(bytes) })
    bad({ bytes: undefined })
    bad({ type: 'png' }) // url ends in .jpg
    bad({ type: 'tga' }) // kind textures does not hold tga
    bad({ dest: 'public' }) // image originals are conversion inputs: dest "source"
    bad({ group: '../x' })
    bad({ group: 'Has Space' })
    bad({ file: '../x.jpg' })
    bad({ sha256: 'ABC' })
    bad({ maxBytes: bytes.length * 2 + 5000 })
    // GitHub-sourced entries still need the blob id
    const rb = fbx()
    expect(() => lib.validateManifestEntry(entryFor(rb, { gitBlobSha1: undefined }))).toThrow(/gitBlobSha1/)
    expect(() => lib.validateManifestEntry(entryFor(rb, { gitBlobSha1: undefined, url: 'https://raw.githubusercontent.com/other/repo/' + COMMIT + '/x.fbx' }))).toThrow(/gitBlobSha1/)
    expect(lib.validateManifestEntry(entryFor(rb)).gitBlobSha1).toBe(lib.gitBlobSha1Hex(rb))
  })

  it('installs below assets-src/textures/<id>/ and assets-src/hdri/, records sha256 on first fetch, never writes public/ files other than the record', async () => {
    const tex = jpg(0x51, 200)
    const sky = hdr(0x52, 300)
    await writeManifest([phEntry(tex), hdriEntry(sky)])
    const net = mockNetwork({ [TEX_URL]: { body: tex }, [HDR_URL]: { body: sky } })
    const r = await gate.runGate({ root, fetchImpl: net.fetchImpl, log: quiet })
    expect(r.failures).toEqual([])
    expect(r.results.map((x: any) => [x.status, x.firstFetch])).toEqual([['installed', true], ['installed', true]])
    expect(await filesBelow('assets-src')).toEqual([path.join('assets-src', 'hdri', 'kloofendal_38d_partly_cloudy_2k.hdr'), path.join('assets-src', 'textures', 'terrazzo_tiles', 'terrazzo_tiles_diff_2k.jpg')])
    expect(await filesBelow('public')).toEqual([path.join('public', 'assets', 'manifest.json')])
    const m = await readManifest()
    expect(m.assets.map((e: any) => e.sha256)).toEqual([lib.sha256Hex(tex), lib.sha256Hex(sky)])
    const record = JSON.parse(await fs.readFile(rel('public', 'assets', 'manifest.json'), 'utf8'))
    expect(record.assets['ph-terrazzo-tiles-diff-2k']).toMatchObject({ kind: 'textures', gitBlobSha1: null, sha256: lib.sha256Hex(tex) })
    expect(record.assets['ph-terrazzo-tiles-diff-2k'].files[0]).toMatchObject({ path: 'textures/terrazzo_tiles/terrazzo_tiles_diff_2k.jpg', root: 'source', role: 'original' })
    expect(await fs.readFile(rel('docs', 'CREDITS.md'), 'utf8')).toContain('`assets-src/textures/terrazzo_tiles/terrazzo_tiles_diff_2k.jpg`')
    // a second run is verified offline
    const again = mockNetwork({})
    expect((await gate.runGate({ root, fetchImpl: again.fetchImpl, log: quiet })).results.map((x: any) => x.status)).toEqual(['up-to-date', 'up-to-date'])
    expect(again.calls).toEqual([])
  })

  it('pins by bytes and sha256: a swapped body of the same size is refused, a size change is refused', async () => {
    const tex = jpg(0x61, 200)
    const swapped = jpg(0x62, 200)
    const wrong = await runEntry(phEntry(tex, { sha256: lib.sha256Hex(tex) }), { [TEX_URL]: { body: swapped } })
    expect(wrong.error?.code).toBe('SHA_MISMATCH')
    const longer = jpg(0x61, 210)
    expect((await runEntry(phEntry(tex), { [TEX_URL]: { body: longer } })).error?.code).toBe('SIZE_MISMATCH')
    expect(await filesBelow('assets-src')).toEqual([])
    expect(await quarantineIsClean()).toBe(true)
  })

  it('--strict refuses an unpinned Poly Haven entry before any request, and accepts a pinned one', async () => {
    const tex = jpg(0x71, 200)
    const unpinned = await runEntry(phEntry(tex), { [TEX_URL]: { body: tex } }, { strict: true })
    expect(unpinned.error?.code).toBe('UNPINNED_HASH')
    expect(unpinned.calls).toEqual([])
    const pinned = await runEntry(phEntry(tex, { sha256: lib.sha256Hex(tex) }), { [TEX_URL]: { body: tex } }, { strict: true })
    expect(pinned.error).toBeNull()
    expect(pinned.result).toMatchObject({ status: 'installed', firstFetch: false })
  })

  it('--verify checks Poly Haven originals against sha256 and the byte count (no git blob id), and --strict also fails an unpinned entry', async () => {
    const tex = jpg(0x81, 200)
    await writeManifest([phEntry(tex)])
    await gate.runGate({ root, fetchImpl: mockNetwork({ [TEX_URL]: { body: tex } }).fetchImpl, log: quiet })
    const lines: string[] = []
    const log = (m: string) => lines.push(m)
    expect(await gate.verifyAll({ root, log, strict: true })).toBe(0)
    expect(lines[0]).toBe('ok   ph-terrazzo-tiles-diff-2k (1 file)')

    const pinned = await readManifest()
    pinned.assets[0].bytes = tex.length + 1
    await fs.writeFile(rel('tools', 'assets.manifest.json'), JSON.stringify(pinned))
    lines.length = 0
    expect(await gate.verifyAll({ root, log })).toBe(1)
    expect(lines.join('\n')).toMatch(/200 bytes, manifest says 201/)

    pinned.assets[0].bytes = tex.length
    pinned.assets[0].sha256 = 'b'.repeat(64)
    await fs.writeFile(rel('tools', 'assets.manifest.json'), JSON.stringify(pinned))
    lines.length = 0
    expect(await gate.verifyAll({ root, log })).toBe(1)
    expect(lines.join('\n')).toMatch(/recorded sha256 differs from the manifest pin/)

    pinned.assets[0].sha256 = null
    await fs.writeFile(rel('tools', 'assets.manifest.json'), JSON.stringify(pinned))
    expect(await gate.verifyAll({ root, log: quiet })).toBe(0)
    lines.length = 0
    expect(await gate.verifyAll({ root, log, strict: true })).toBe(1)
    expect(lines.join('\n')).toMatch(/sha256 is null and --strict/)

    await fs.appendFile(rel('assets-src', 'textures', 'terrazzo_tiles', 'terrazzo_tiles_diff_2k.jpg'), 'tampered')
    pinned.assets[0].sha256 = lib.sha256Hex(tex)
    await fs.writeFile(rel('tools', 'assets.manifest.json'), JSON.stringify(pinned))
    expect(await gate.verifyAll({ root, log: quiet })).toBe(1)
  })

  it('parses --strict together with --verify', () => {
    expect(gate.parseArgs(['--verify', '--strict'])).toMatchObject({ verify: true, flags: { strict: true } })
  })
})

describe('tools/assets.manifest.json: the Poly Haven entries', () => {
  const manifest = JSON.parse(readFileSync(path.join(here, 'assets.manifest.json'), 'utf8'))
  const ph = (manifest.assets as any[]).filter((e) => e.kind === 'textures' || e.kind === 'hdri')

  it('has entries, each valid, on the Poly Haven allow-list, CC0, source-only, with bytes and no git blob id', () => {
    expect(ph.length).toBeGreaterThan(0)
    const ids = new Set<string>()
    for (const raw of ph) {
      const e = lib.validateManifestEntry(raw)
      expect(ids.has(e.id), `duplicate id ${e.id}`).toBe(false)
      ids.add(e.id)
      const url = lib.checkDownloadUrl(e.url)
      expect(url.hostname, e.id).toBe('dl.polyhaven.org')
      expect(() => (lib as any).assertEntryMatchesSource(e, url), e.id).not.toThrow()
      expect(e.dest, e.id).toBe('source')
      expect(e.licence, e.id).toMatch(/^CC0/)
      expect(e.sourcePage, e.id).toMatch(/^https:\/\/polyhaven\.com\/a\/[a-z0-9_-]+$/)
      expect(e.gitBlobSha1, e.id).toBeUndefined()
      expect(e.sha256 === null || /^[0-9a-f]{64}$/.test(e.sha256), e.id).toBe(true)
      expect(e.bytes, e.id).toBeLessThanOrEqual(e.maxBytes)
    }
  })

  it('stays within the look-work budget: about 60 MB in all, 1k maps except the 2k floors and the 2k sky', () => {
    expect(ph.reduce((s, e) => s + e.bytes, 0)).toBeLessThan(60 * 1024 * 1024)
    for (const e of ph) {
      const res = /_(\dk)\.[a-z]+$/.exec(e.file)?.[1]
      expect(['1k', '2k'], e.id).toContain(res)
      if (res === '2k') expect(['terrazzo_tiles', 'floor_tiles_02'].includes(e.group) || e.kind === 'hdri', e.id).toBe(true)
    }
  })
})

describe('glTF validator (used by the converter on the glbs it writes)', () => {
  it('is still exported and reports errors', async () => {
    const text = JSON.stringify({ asset: { version: '2.0' }, nodes: [{ mesh: 0 }] })
    const jb = Buffer.from(text + ' '.repeat((4 - (text.length % 4)) % 4))
    const header = Buffer.alloc(12)
    header.write('glTF', 0, 'ascii')
    header.writeUInt32LE(2, 4)
    header.writeUInt32LE(12 + 8 + jb.length, 8)
    const chunk = Buffer.alloc(8)
    chunk.writeUInt32LE(jb.length, 0)
    chunk.write('JSON', 4, 'ascii')
    const summary = await lib.validateGltfBytes(Buffer.concat([header, chunk, jb]), { throwOnErrors: false })
    expect(summary.errors).toBeGreaterThan(0)
  })
})
