#!/usr/bin/env node
/**
 * fetch-assets.mjs: the asset gate of The Ideal Hospital. Implements docs/ASSETS-POLICY.md.
 *
 *   node tools/fetch-assets.mjs [--only id,id] [--dry-run] [--force] [--strict]
 *   node tools/fetch-assets.mjs --verify [--require-all]    (offline: re-hash everything installed)
 *
 * The whole manifest (tools/assets.manifest.json) is validated and origin-checked first, before any request. Then, for each
 * entry in order, stopping that entry at the first refusal:
 *   1. the ORIGIN gate (https only; raw.githubusercontent.com: one repository, one pinned commit, one folder, .fbx/.tga;
 *      dl.polyhaven.org: file/ph-assets/Textures|HDRIs/<jpg,png|hdr,exr>/<1k|2k>/... only; the entry's kind, type, group
 *      and file name must match its url)
 *   2. a `localFile` entry is NOT downloaded: its bytes are read from assets-src/_import (a regular file, no symbolic link,
 *      real path inside that folder). Every other entry: HEAD size check against the exact byte count, then a download with
 *      a hard streaming cap into public/assets/_downloads (quarantine); redirects are followed by hand and every hop
 *      passes the origin gate again
 *   3. magic bytes for the declared type (binary FBX 7.x; TGA header field by field)
 *   4. the exact byte count, then sha256 against the manifest (pinned on first fetch, written back; a localFile import must
 *      already carry it), then, for GitHub-sourced entries, the git blob id of the bytes against the id GitHub lists for
 *      that commit (a Poly Haven file has no commit: its pin is bytes + sha256)
 *   5. only then: write into assets-src/<kind>/[<group>/] (dest "source": never public/, so Vite never serves it), record in
 *      public/assets/manifest.json and regenerate the generated block of docs/CREDITS.md
 * The write phase holds the shared lock tools/.fetch.lock (also taken by the converter). Downloaded content is only ever
 * read as bytes. Nothing is executed, imported or spawned.
 */
import { promises as fs, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  GateError,
  POLICY,
  applyCreditsBlock,
  assertEntryMatchesSource,
  assertMagic,
  checkDownloadUrl,
  downloadBytes,
  gitBlobSha1Hex,
  headCheck,
  renderCreditsBlock,
  sha256Hex,
  validateManifestEntry,
} from './assets-lib.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
export const PROJECT_ROOT = path.resolve(here, '..')

export const paths = (root = PROJECT_ROOT) => ({
  manifest: path.join(root, 'tools', 'assets.manifest.json'),
  assets: path.join(root, 'public', 'assets'),
  installed: path.join(root, 'public', 'assets', 'manifest.json'),
  quarantine: path.join(root, 'public', 'assets', '_downloads'),
  /** Conversion inputs (manifest dest "source", the Rocketbox FBX/TGA): never served, never bundled. */
  source: path.join(root, 'assets-src'),
  /** Staging folder for `localFile` imports (verified copies of files that were already checked elsewhere). Never served. */
  importDir: path.join(root, 'assets-src', '_import'),
  credits: path.join(root, 'docs', 'CREDITS.md'),
  /** Shared by this gate and the converter: whoever holds it rewrites public/assets/manifest.json and docs/CREDITS.md. */
  lock: path.join(root, 'tools', '.fetch.lock'),
})

const posix = (p) => p.split(path.sep).join('/')

// ---------------------------------------------------------------------------------------------
// JSON files (atomic writes)
// ---------------------------------------------------------------------------------------------

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback
    throw err
  }
}

async function writeJsonAtomic(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`)
  await fs.rename(tmp, file)
}

export const emptyInstalled = () => ({ version: 1, generatedBy: 'tools/fetch-assets.mjs and tools/convert-people.mjs', totalBytes: 0, assets: {} })

export async function readInstalled(root = PROJECT_ROOT) {
  const data = await readJson(paths(root).installed, emptyInstalled())
  if (data.version !== 1 || typeof data.assets !== 'object' || data.assets === null) throw new GateError('BAD_MANIFEST', 'public/assets/manifest.json has an unknown shape')
  return data
}

export async function writeInstalled(installed, root = PROJECT_ROOT) {
  installed.totalBytes = installedTotalBytes(installed)
  await writeJsonAtomic(paths(root).installed, installed)
}

/** Bytes that ship (public/assets). Source-only originals (root "source", in assets-src/) have their own budget. */
export const installedTotalBytes = (installed) =>
  Object.values(installed.assets).reduce((sum, a) => sum + a.files.reduce((s, f) => s + (f.root === 'source' ? 0 : f.bytes), 0), 0)

/** Bytes of the source-only originals in assets-src/ (POLICY.maxSourceBytes). */
export const installedSourceBytes = (installed) =>
  Object.values(installed.assets).reduce((sum, a) => sum + a.files.reduce((s, f) => s + (f.root === 'source' ? f.bytes : 0), 0), 0)

/** Where a recorded file lives: public/assets/<path>, or assets-src/<path> for source-only originals. Null if the path escapes. */
const fileAbs = (f, root) => {
  const base = f.root === 'source' ? paths(root).source : paths(root).assets
  const abs = path.join(base, String(f.path))
  return path.relative(base, abs).startsWith('..') || path.isAbsolute(String(f.path)) ? null : abs
}

/** Re-hashes every file recorded for an asset. Returns problems; empty means intact. */
export async function verifyInstalledAsset(record, root = PROJECT_ROOT, { originalsOnly = false } = {}) {
  const problems = []
  for (const f of record.files) {
    if (originalsOnly && f.role !== 'original') continue
    const abs = fileAbs(f, root)
    if (!abs) {
      problems.push(`${f.path}: unsafe recorded path`)
      continue
    }
    let bytes
    try {
      bytes = await fs.readFile(abs)
    } catch {
      problems.push(`${f.path}: missing`)
      continue
    }
    const actual = sha256Hex(bytes)
    if (actual !== f.sha256) problems.push(`${f.path}: sha256 ${actual.slice(0, 12)}... does not match the recorded ${f.sha256.slice(0, 12)}...${f.role === 'derived' ? ' (derived file: re-run the converter)' : ''}`)
  }
  return problems
}

// ---------------------------------------------------------------------------------------------
// The shared lock (an empty directory, so the converter can take and drop it with mkdir/rmdir alone)
// ---------------------------------------------------------------------------------------------

/**
 * Takes tools/.fetch.lock (mkdir is atomic) and returns the function that drops it. A lock that stays taken is never broken
 * automatically: after the wait the gate stops and says how to remove it by hand.
 */
export async function acquireLock(root = PROJECT_ROOT, { pollMs = 30_000, maxWaitMs = 20 * 60_000, log = () => {} } = {}) {
  const lock = paths(root).lock
  await fs.mkdir(path.dirname(lock), { recursive: true })
  const started = Date.now()
  for (;;) {
    try {
      await fs.mkdir(lock)
      break
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
      if (Date.now() - started >= maxWaitMs) {
        throw new GateError('LOCK_TIMEOUT', `tools/.fetch.lock stayed taken for ${Math.round(maxWaitMs / 60_000)} minutes; if no other tools/*.mjs run is active, remove it with: rmdir tools/.fetch.lock`)
      }
      log('  waiting for tools/.fetch.lock ...')
      await new Promise((resolve) => setTimeout(resolve, pollMs))
    }
  }
  return async () => {
    await fs.rmdir(lock).catch(() => {})
  }
}

// ---------------------------------------------------------------------------------------------
// One entry through the gate
// ---------------------------------------------------------------------------------------------

/**
 * Reads a `localFile` import from assets-src/_import: a regular file (not a symbolic link, not a directory) whose real path
 * is inside the real staging folder and that is not larger than the manifest cap. Returns the bytes; those exact bytes are
 * what is hashed and what is installed.
 */
async function readStagedFile(entry, p) {
  const rel = entry.localFile
  const staging = await fs.realpath(p.importDir).catch(() => null)
  if (!staging) throw new GateError('LOCAL_FILE_MISSING', `${entry.id}: the staging folder assets-src/_import does not exist; put the verified original at assets-src/_import/${rel} first`)
  const abs = path.join(p.importDir, ...rel.split('/'))
  const lst = await fs.lstat(abs).catch(() => null)
  if (!lst) throw new GateError('LOCAL_FILE_MISSING', `${entry.id}: put the verified original at assets-src/_import/${rel} first`)
  if (lst.isSymbolicLink() || !lst.isFile()) throw new GateError('LOCAL_FILE_UNSAFE', `${entry.id}: assets-src/_import/${rel} must be a regular file, not a symbolic link or a directory`)
  const real = await fs.realpath(abs)
  if (!real.startsWith(staging + path.sep)) throw new GateError('LOCAL_FILE_UNSAFE', `${entry.id}: assets-src/_import/${rel} resolves outside the staging folder`)
  if (lst.size > entry.maxBytes) throw new GateError('SIZE_LIMIT', `${entry.id}: ${rel} is ${lst.size} bytes, over the manifest cap of ${entry.maxBytes}`)
  return fs.readFile(real)
}

/** Magic bytes, exact size, sha256 pin and, for GitHub-sourced entries, the git blob id. Returns the sha256 of the bytes. Throws GateError on any mismatch. */
function vetBytes(entry, bytes) {
  assertMagic(bytes, entry.type, entry.id)
  if (bytes.length !== entry.bytes) throw new GateError('SIZE_MISMATCH', `${entry.id}: got ${bytes.length} bytes, manifest expects ${entry.bytes}`)
  const sha256 = sha256Hex(bytes)
  if (entry.sha256 && sha256 !== entry.sha256) {
    throw new GateError('SHA_MISMATCH', `${entry.id}: sha256 mismatch. manifest ${entry.sha256}, got ${sha256}. The file changed or was swapped; nothing was installed`, { expected: entry.sha256, actual: sha256 })
  }
  if (entry.gitBlobSha1 !== undefined && gitBlobSha1Hex(bytes) !== entry.gitBlobSha1) throw new GateError('HASH_MISMATCH', `${entry.id}: git blob id does not match the one the repository lists at the pinned commit; nothing was installed`)
  return sha256
}

/**
 * Runs one manifest entry through the whole gate and installs it. Throws GateError on any refusal,
 * leaving nothing behind in quarantine or in assets-src.
 *
 * @param {object} rawEntry a tools/assets.manifest.json entry
 * @param {{ root: string, installed: object, fetchImpl?: typeof fetch, log?: (m: string) => void, flags?: {dryRun?: boolean, force?: boolean, strict?: boolean}, now?: () => Date }} ctx
 * @returns {Promise<{ id: string, status: string, sha256?: string, firstFetch?: boolean, files?: string[], metadataUpdated?: boolean }>}
 */
export async function processEntry(rawEntry, ctx) {
  const entry = validateManifestEntry(rawEntry)
  const { root, installed, fetchImpl, log = () => {}, flags = {}, now = () => new Date() } = ctx
  const p = paths(root)
  const isLocal = typeof entry.localFile === 'string'

  // 1. origin gate, before a single byte moves (a localFile entry's url is provenance, but it must be on the list too)
  const url = checkDownloadUrl(entry.url)
  assertEntryMatchesSource(entry, url)
  if (flags.strict && entry.sha256 === null) throw new GateError('UNPINNED_HASH', `${entry.id}: sha256 is null and --strict is on; fetch once on a trusted machine and commit the pinned hash`)

  // up to date? (offline re-hash of what is on disk; a mismatch is loud, never silently re-downloaded)
  const prev = installed.assets[entry.id]
  if (!flags.force && prev && entry.sha256 && prev.sha256 === entry.sha256) {
    const problems = await verifyInstalledAsset(prev, root, { originalsOnly: true })
    const missingOnly = problems.length > 0 && problems.every((m) => m.endsWith(': missing'))
    if (missingOnly) log(`  installed file(s) missing (${problems.join('; ')}); fetching again`)
    if (problems.length === 0) {
      // files are intact: only refresh the descriptive fields (licence, author, notes, source) from the manifest
      const fresh = {
        licence: entry.licence,
        licenceUrl: entry.licenceUrl ?? null,
        author: entry.author ?? null,
        notes: entry.notes ?? null,
        source: { url: entry.url, page: entry.sourcePage, commit: entry.sourceCommit ?? null, local: entry.localFile ?? null },
      }
      const pick = (r) => JSON.stringify([r.licence, r.licenceUrl, r.author, r.notes, r.source])
      const metadataUpdated = pick(prev) !== pick(fresh)
      if (metadataUpdated) Object.assign(prev, fresh)
      return { id: entry.id, status: 'up-to-date', sha256: prev.sha256, metadataUpdated }
    }
    if (!missingOnly) {
      throw new GateError('INSTALLED_MISMATCH', `${entry.id}: installed files no longer match the recorded hashes: ${problems.join('; ')} (use --force to re-download)`, { problems })
    }
  }

  // 2. size check (a localFile import makes no request at all, not even this one)
  if (!isLocal) {
    const head = await headCheck(url.href, { maxBytes: entry.maxBytes, expectedBytes: entry.bytes, fetchImpl })
    log(`  HEAD ${head.size ?? '?'} bytes${head.note ? ` (${head.note})` : ''} <- ${head.finalUrl}`)
    if (flags.dryRun) return { id: entry.id, status: 'dry-run-ok' }
  }

  // 3. get the bytes: from the staging folder, or from the network into quarantine
  let qfile = null
  try {
    let bytes
    if (isLocal) {
      bytes = await readStagedFile(entry, p)
      log(`  LOCAL ${bytes.length} bytes <- assets-src/_import/${entry.localFile}`)
    } else {
      await fs.mkdir(p.quarantine, { recursive: true })
      qfile = path.join(p.quarantine, `${entry.id}.${entry.type}`)
      await fs.rm(qfile, { force: true })
      const dl = await downloadBytes(url.href, { maxBytes: entry.maxBytes, fetchImpl })
      await fs.writeFile(qfile, dl.bytes, { mode: 0o600, flag: 'wx' })
      log(`  GET  ${dl.bytes.length} bytes -> quarantine (${dl.contentType || 'no content-type'})`)
      bytes = await fs.readFile(qfile) // verify what is actually on disk
    }

    // 4. magic bytes, size and hashes
    const sha256 = vetBytes(entry, bytes)
    const firstFetch = entry.sha256 === null
    if (flags.dryRun) return { id: entry.id, status: 'dry-run-ok', sha256 }

    // 5. install: budget, collisions, then move into place
    const kindRoot = path.join(p.source, entry.kind)
    const destRoot = entry.group ? path.join(kindRoot, entry.group) : kindRoot
    const relPath = posix(path.join(entry.kind, ...(entry.group ? [entry.group] : []), entry.file))
    const abs = path.join(destRoot, entry.file)
    if (path.relative(kindRoot, abs).startsWith('..')) throw new GateError('BAD_MANIFEST', `${entry.id}: destination "${entry.file}" escapes assets-src/${entry.kind}`)
    const existing = await fs.readFile(abs).catch(() => null)
    const recorded = prev?.files.some((r) => r.path === relPath)
    if (existing && !recorded && sha256Hex(existing) !== sha256 && !flags.force) {
      throw new GateError('DEST_EXISTS', `assets-src/${relPath} exists and is not recorded in public/assets/manifest.json; refusing to overwrite (use --force)`)
    }
    const keptDerived = prev && prev.sha256 === sha256 ? prev.files.filter((f) => f.role !== 'original') : []
    const record = {
      kind: entry.kind,
      type: entry.type,
      source: { url: entry.url, page: entry.sourcePage, commit: entry.sourceCommit ?? null, local: entry.localFile ?? null },
      licence: entry.licence,
      licenceUrl: entry.licenceUrl ?? null,
      author: entry.author ?? null,
      notes: entry.notes ?? null,
      sha256,
      gitBlobSha1: entry.gitBlobSha1 ?? null,
      bytes: bytes.length,
      files: [{ path: relPath, sha256, bytes: bytes.length, role: 'original', root: 'source' }, ...keptDerived],
      validator: null,
      fetchedAt: now().toISOString(),
    }
    const projected = { ...installed, assets: { ...installed.assets, [entry.id]: record } }
    if (installedTotalBytes(projected) > POLICY.maxTotalBytes) throw new GateError('TOTAL_SIZE_LIMIT', `${entry.id}: installing it would take public/assets past ${POLICY.maxTotalBytes} bytes`)
    if (installedSourceBytes(projected) > POLICY.maxSourceBytes) throw new GateError('TOTAL_SIZE_LIMIT', `${entry.id}: installing it would take assets-src past ${POLICY.maxSourceBytes} bytes`)

    await fs.mkdir(destRoot, { recursive: true })
    const tmp = `${abs}.part-${process.pid}`
    await fs.writeFile(tmp, bytes, { mode: 0o644 })
    await fs.rename(tmp, abs)
    installed.assets[entry.id] = record
    return { id: entry.id, status: 'installed', sha256, firstFetch, files: [`assets-src/${relPath}`] }
  } finally {
    // A download never lingers. A staged file is only read, never moved or deleted.
    if (qfile) {
      await fs.rm(qfile, { force: true })
      const left = await fs.readdir(p.quarantine).catch(() => [])
      if (left.length === 0) await fs.rmdir(p.quarantine).catch(() => {})
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The whole manifest
// ---------------------------------------------------------------------------------------------

/**
 * Processes manifest entries, writes new sha256 values back, saves public/assets/manifest.json and
 * regenerates the docs/CREDITS.md block. The whole manifest is validated and origin-checked before the first request.
 * One refusal does not stop the others; failures are returned. A real run (not --dry-run) holds tools/.fetch.lock.
 */
export async function runGate({ root = PROJECT_ROOT, only, fetchImpl, log = console.log, flags = {}, now, lockOptions } = {}) {
  const p = paths(root)
  const manifest = await readJson(p.manifest)
  if (manifest.version !== 1 || !Array.isArray(manifest.assets)) throw new GateError('BAD_MANIFEST', 'tools/assets.manifest.json must be { version: 1, assets: [...] }')
  const ids = new Set()
  for (const e of manifest.assets) {
    const checked = validateManifestEntry(e)
    assertEntryMatchesSource(checked, checkDownloadUrl(checked.url))
    if (ids.has(checked.id)) throw new GateError('BAD_MANIFEST', `duplicate manifest id "${checked.id}"`)
    ids.add(checked.id)
  }
  const release = flags.dryRun ? null : await acquireLock(root, { log, ...lockOptions })
  try {
    const installed = await readInstalled(root)
    const results = []
    const failures = []
    let manifestChanged = false
    let dirty = false
    for (const id of only ?? []) {
      if (!ids.has(id)) {
        failures.push({ id, code: 'UNKNOWN_ID', message: `--only names "${id}", which is not in tools/assets.manifest.json` })
        log(`${id}\n  REFUSED [UNKNOWN_ID] not in tools/assets.manifest.json`)
      }
    }
    for (const entry of manifest.assets) {
      if (only && !only.includes(entry.id)) continue
      log(`${entry.id}`)
      try {
        const r = await processEntry(entry, { root, installed, fetchImpl, log, flags, now })
        results.push(r)
        if (r.status === 'installed') {
          dirty = true
          if (r.firstFetch) {
            entry.sha256 = r.sha256
            manifestChanged = true
            log(`  FIRST FETCH: recorded sha256 ${r.sha256} in tools/assets.manifest.json (commit it; later fetches must match)`)
          }
          // checkpoint after every install, so an interrupted run loses nothing and never leaves files unrecorded
          if (manifestChanged) await writeJsonAtomic(p.manifest, manifest)
          manifestChanged = false
          await writeInstalled(installed, root)
        }
        if (r.metadataUpdated) dirty = true
        log(`  ${r.status.toUpperCase()}${r.files ? ` -> ${r.files.join(', ')}` : ''}`)
      } catch (err) {
        if (!(err instanceof GateError)) throw err
        failures.push({ id: entry.id, code: err.code, message: err.message })
        log(`  REFUSED [${err.code}] ${err.message}`)
      }
    }
    if (dirty) {
      await writeInstalled(installed, root)
      await writeCredits(installed, root)
    }
    return { results, failures }
  } finally {
    await release?.()
  }
}

export async function writeCredits(installed, root = PROJECT_ROOT) {
  const file = paths(root).credits
  const existing = await fs.readFile(file, 'utf8').catch(() => '# Credits\n')
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, applyCreditsBlock(existing, renderCreditsBlock(installed)))
}

/**
 * Offline audit: every installed file against its recorded sha256, every original against the manifest pins (the sha256, the
 * byte count and, for GitHub-sourced entries, independently of the sha256, the git blob id of the file at the pinned commit).
 * `requireAll` also fails for manifest entries that are not installed; `strict` also fails for a manifest entry whose sha256 is
 * still null (a Poly Haven file is pinned by bytes + sha256 alone, so an unpinned one is not verifiable). Returns the number
 * of problems.
 */
export async function verifyAll({ root = PROJECT_ROOT, log = console.log, requireAll = false, strict = false } = {}) {
  const installed = await readInstalled(root)
  const manifest = await readJson(paths(root).manifest)
  const pins = new Map(manifest.assets.map((e) => [e.id, e]))
  let bad = 0
  for (const [id, record] of Object.entries(installed.assets)) {
    const problems = await verifyInstalledAsset(record, root)
    const pin = pins.get(id)
    if (pin?.sha256 && pin.sha256 !== record.sha256) problems.push('recorded sha256 differs from the manifest pin')
    if (strict && pin && !pin.sha256) problems.push('manifest sha256 is null and --strict is on')
    if (pin?.gitBlobSha1 || pin?.bytes) {
      for (const f of record.files.filter((x) => x.role === 'original')) {
        const abs = fileAbs(f, root)
        const bytes = abs ? await fs.readFile(abs).catch(() => null) : null
        if (!bytes) continue // already reported as missing above
        if (pin.gitBlobSha1 && gitBlobSha1Hex(bytes) !== pin.gitBlobSha1) problems.push(`${f.path}: git blob id does not match the manifest (the file is not the one at the pinned commit)`)
        if (pin.bytes && bytes.length !== pin.bytes) problems.push(`${f.path}: ${bytes.length} bytes, manifest says ${pin.bytes}`)
      }
    }
    if (problems.length) {
      bad++
      log(`FAIL ${id}: ${problems.join('; ')}`)
    } else {
      log(`ok   ${id} (${record.files.length} file${record.files.length === 1 ? '' : 's'})`)
    }
  }
  const notInstalled = manifest.assets.filter((e) => !installed.assets[e.id]).map((e) => e.id)
  for (const id of notInstalled) {
    log(`${requireAll ? 'FAIL' : 'skip'} ${id}: not installed`)
    if (requireAll) bad++
  }
  if (strict) {
    for (const e of manifest.assets.filter((x) => !x.sha256 && !installed.assets[x.id])) {
      log(`FAIL ${e.id}: manifest sha256 is null and --strict is on`)
      bad++
    }
  }
  const total = installedTotalBytes(installed)
  log(`${Object.keys(installed.assets).length} asset(s), ${(total / 1048576).toFixed(2)} MB of ${POLICY.maxTotalBytes / 1048576} MB served, ${(installedSourceBytes(installed) / 1048576).toFixed(2)} MB of ${POLICY.maxSourceBytes / 1048576} MB source-only`)
  return bad
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

export function parseArgs(argv) {
  const out = { flags: {}, only: undefined, verify: false, requireAll: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') out.flags.dryRun = true
    else if (a === '--force') out.flags.force = true
    else if (a === '--strict') out.flags.strict = true
    else if (a === '--verify') out.verify = true
    else if (a === '--require-all') out.requireAll = true
    else if (a === '--help' || a === '-h') out.help = true
    else if (a === '--only') out.only = String(argv[++i] ?? '').split(',').filter(Boolean)
    else throw new GateError('USAGE', `unknown argument "${String(a).slice(0, 60)}" (try --help)`)
  }
  return out
}

const HELP = `Ideal Hospital asset gate (docs/ASSETS-POLICY.md)
  node tools/fetch-assets.mjs                run every entry of tools/assets.manifest.json through the gate
  --only a,b                                 only these ids
  --dry-run                                  origin + HEAD size checks for downloads, full checks for localFile imports; installs nothing
  --force                                    re-fetch even if installed and hash-verified
  --strict                                   refuse entries whose sha256 is still null
  --verify [--require-all] [--strict]        offline: re-hash every installed file (--require-all: also fail for entries not installed;
                                             --strict: also fail for manifest entries whose sha256 is still null)`

export async function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv)
    if (args.help) return void console.log(HELP)
    if (args.verify) {
      const bad = await verifyAll({ requireAll: args.requireAll, strict: Boolean(args.flags.strict) })
      if (bad) process.exitCode = 1
      return
    }
    const { failures } = await runGate({ only: args.only, flags: args.flags })
    if (failures.length) {
      console.error(`\n${failures.length} entr${failures.length === 1 ? 'y' : 'ies'} refused: ${failures.map((f) => `${f.id} [${f.code}]`).join(', ')}`)
      process.exitCode = 1
    }
  } catch (err) {
    console.error(err instanceof GateError ? `[${err.code}] ${err.message}` : err)
    process.exitCode = err instanceof GateError && err.code === 'USAGE' ? 2 : 1
  }
}

const invoked = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : ''
if (invoked === import.meta.url) await main()
