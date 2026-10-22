/**
 * assets-lib.mjs: the primitives of the asset validation gate of The Ideal Hospital.
 *
 * Binding policy: docs/ASSETS-POLICY.md. Ported from the Waltz City gate (the Waltz Game reference), then narrowed: this
 * project downloads two kinds of art and the gate knows exactly two sources and nothing else: the Microsoft Rocketbox avatars
 * (W3 wave B, raw.githubusercontent.com at one pinned commit) and the CC0 PBR textures and HDRIs of Poly Haven (Wave 3
 * look work, dl.polyhaven.org, `file/ph-assets/Textures|HDRIs/<format>/<1k|2k>/...` only). The other Waltz sources (three.js
 * examples, Kenney and so on), the zip reader and the metadata API reads (api.polyhaven.com is never contacted) are not
 * ported: a source that is not coded here cannot be contacted. This module is plain ESM
 * (so `node tools/fetch-assets.mjs` runs with no loader) and has these rules of its own:
 *   - it never executes downloaded content: no child_process, no eval, no dynamic import of data;
 *   - it never trusts a size, an offset or a name that came from a downloaded file;
 *   - every refusal is a GateError with a stable `code` so tests and the CLI can tell them apart.
 */
import { createHash } from 'node:crypto'
import { validateBytes, version as gltfValidatorVersion } from 'gltf-validator'

// ---------------------------------------------------------------------------------------------
// Errors and policy constants
// ---------------------------------------------------------------------------------------------

export class GateError extends Error {
  /**
   * @param {string} code stable machine-readable reason, e.g. ORIGIN_NOT_ALLOWED
   * @param {string} message human-readable explanation
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'GateError'
    this.code = code
    this.details = details
  }
}

export const MB = 1024 * 1024

/** The numbers and lists from docs/ASSETS-POLICY.md, in one place so a policy change is one edit. */
export const POLICY = Object.freeze({
  maxFileBytes: 50 * MB,
  /** Bytes that ship (public/assets). The converted people are a few MB; this stops a wrong file filling the served folder. */
  maxTotalBytes: 200 * MB,
  /**
   * Source-only originals (dest "source": the Rocketbox FBX and TGA files): they land in assets-src/, which is never
   * served or bundled, and have their own budget. Only the converted, much smaller files go to public/assets.
   */
  maxSourceBytes: 1024 * MB,
  maxRedirects: 4,
  /** Per request, body included (the biggest file is a 16 MB TGA). */
  timeoutMs: 180_000,
  /**
   * Microsoft Rocketbox avatars (MIT since 12/2020, LICENSE.md read at this commit, see docs/ASSETS-POLICY.md).
   * Allow-listed on raw.githubusercontent.com for ONE repository, ONE commit and ONE folder, and only for the avatar FBX
   * and its TGA textures. The files are plain git blobs at this commit (no Git LFS pointers), so the LFS media host
   * (media.githubusercontent.com) is NOT needed and NOT allow-listed.
   */
  rocketbox: Object.freeze({
    repo: 'microsoft/Microsoft-Rocketbox',
    commit: '0943055db6ec570bcef9f2c8b41c9e5467c808f9',
    pathPrefix: 'Assets/Avatars/',
    extensions: Object.freeze(['.fbx', '.tga']),
  }),
  /**
   * Poly Haven (every asset CC0, https://polyhaven.com/license). Allow-listed on dl.polyhaven.org for the file store path
   * `/file/ph-assets/Textures/<format>/<res>/<id>/<file>` (texture maps) and `/file/ph-assets/HDRIs/<format>/<res>/<file>`
   * (sky maps) only, at 1k and 2k, and only the image formats below. There is no commit to pin and no git blob id: the pin
   * of a Poly Haven file is its exact byte count plus its sha256, recorded at the first fetch.
   */
  polyhaven: Object.freeze({
    host: 'dl.polyhaven.org',
    pathPrefix: ['file', 'ph-assets'],
    resolutions: Object.freeze(['1k', '2k']),
    textureFormats: Object.freeze(['jpg', 'png']),
    hdriFormats: Object.freeze(['hdr', 'exr']),
  }),
})

/**
 * Destination folders (the manifest `kind`): assets-src/<kind> for the originals. `people` are the Rocketbox originals,
 * `textures` the Poly Haven PBR maps (assets-src/textures/<asset id>/<file>), `hdri` the Poly Haven sky maps.
 */
export const KINDS = Object.freeze(['people', 'textures', 'hdri'])

/** File types the manifest may declare. All are binary and have a magic-bytes rule below. */
export const TYPES = Object.freeze(['fbx', 'tga', 'jpg', 'png', 'hdr', 'exr'])

/** The types each kind may hold. */
export const KIND_TYPES = Object.freeze({
  people: Object.freeze(['fbx', 'tga']),
  textures: Object.freeze(['jpg', 'png']),
  hdri: Object.freeze(['hdr', 'exr']),
})

/** Types that are only ever conversion inputs: they must be installed with dest "source" (assets-src/, never served). */
export const SOURCE_ONLY_TYPES = Object.freeze(['fbx', 'tga', 'jpg', 'png', 'hdr', 'exr'])

export const USER_AGENT = 'IdealHospital-asset-gate/1.0 (build tooling)'

const SHA40 = /^[0-9a-f]{40}$/
const SHA256 = /^[0-9a-f]{64}$/

const printable = (s) => String(s).replace(/[^\x20-\x7e]/g, '?').slice(0, 120)

// ---------------------------------------------------------------------------------------------
// Origin policy
// ---------------------------------------------------------------------------------------------

/**
 * Hosts we may DOWNLOAD from, each with a path rule. Exact host match only: no wildcard subdomains, no `www.` guessing.
 * If a legitimate redirect needs another host, the answer is a line added to docs/ASSETS-POLICY.md first, then here.
 * There is no metadata host: the gate reads no API, only the manifest's own pinned URLs.
 */
const DOWNLOAD_RULES = new Map([
  ['raw.githubusercontent.com', { check: (url) => checkRocketboxPath(url.pathname.split('/'), url) }],
  [POLICY.polyhaven.host, { check: (url) => checkPolyHavenPath(url.pathname.split('/'), url) }],
])

/** One path segment of the Rocketbox folder: letters, digits, underscore, dot and dash; no leading dot; no escapes. */
const RB_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,100}$/

function assertPinned(ref, url) {
  if (!SHA40.test(ref ?? '')) {
    throw new GateError(
      'GITHUB_UNPINNED',
      `GitHub URLs must be pinned to a full 40-character lowercase commit SHA, never a branch, tag or short SHA (got "${printable(ref ?? '')}" in ${printable(url.pathname)})`,
      { url: url.href, ref },
    )
  }
}

/** /microsoft/Microsoft-Rocketbox/<the pinned commit>/Assets/Avatars/<...>.fbx|.tga and nothing else. */
export function checkRocketboxPath(seg, url) {
  const rb = POLICY.rocketbox
  if (`${seg[1]}/${seg[2]}` !== rb.repo) {
    throw new GateError('ORIGIN_NOT_ALLOWED', `only github.com/${rb.repo} is allow-listed on raw.githubusercontent.com (got ${printable(url.pathname)})`, { url: url.href })
  }
  assertPinned(seg[3], url)
  if (seg[3] !== rb.commit) throw new GateError('ORIGIN_NOT_ALLOWED', `${rb.repo} is allow-listed at commit ${rb.commit} only (got ${seg[3]})`, { url: url.href })
  const rest = seg.slice(4)
  const relative = rest.join('/')
  if (!relative.startsWith(rb.pathPrefix) || rest.length < 4 || rest.some((s) => !RB_SEGMENT.test(s))) {
    throw new GateError('ORIGIN_NOT_ALLOWED', `${rb.repo} is allow-listed for ${rb.pathPrefix}** only, plain names, no "..", no empty segments (got ${printable(relative)})`, { url: url.href })
  }
  if (!rb.extensions.includes(extOf(relative))) {
    throw new GateError('ORIGIN_NOT_ALLOWED', `${rb.repo}: only ${rb.extensions.join(' ')} files are allow-listed (got ${printable(relative)})`, { url: url.href })
  }
}

/** A Poly Haven asset id: lowercase letters, digits, underscore and dash (the ids are snake_case; "horn-koppe_spring" has a dash). */
const PH_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
/** A Poly Haven file name: letters, digits, underscore, dot and dash; no leading dot; no escapes. */
const PH_FILE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/

/**
 * Parses an allow-listed Poly Haven path into its parts, or throws ORIGIN_NOT_ALLOWED. Accepts exactly
 *   /file/ph-assets/Textures/<jpg|png>/<1k|2k>/<id>/<id>_<map>_<res>.<format>
 *   /file/ph-assets/HDRIs/<hdr|exr>/<1k|2k>/<name>_<res>.<format>
 * and nothing else (no /blend/, /gltf/ or /mtlx/ formats, no 4k and above, no other store folder).
 * @returns {{ category: 'Textures'|'HDRIs', format: string, res: string, id: string|null, file: string }}
 */
export function parsePolyHavenPath(seg, url) {
  const ph = POLICY.polyhaven
  const refuse = (why) => new GateError('ORIGIN_NOT_ALLOWED', `${ph.host}: ${why} (got ${printable(url.pathname)})`, { url: url.href })
  const [empty, a, b, category, format, res, ...rest] = seg
  if (empty !== '' || a !== ph.pathPrefix[0] || b !== ph.pathPrefix[1]) throw refuse(`only /${ph.pathPrefix.join('/')}/Textures/... and /${ph.pathPrefix.join('/')}/HDRIs/... are allow-listed`)
  if (category !== 'Textures' && category !== 'HDRIs') throw refuse('only the Textures and HDRIs folders are allow-listed')
  const formats = category === 'Textures' ? ph.textureFormats : ph.hdriFormats
  if (!formats.includes(format)) throw refuse(`${category} files are allow-listed as ${formats.join(' or ')} only`)
  if (!ph.resolutions.includes(res)) throw refuse(`only ${ph.resolutions.join(' and ')} resolutions are allow-listed`)
  const wantParts = category === 'Textures' ? 2 : 1
  if (rest.length !== wantParts) throw refuse(category === 'Textures' ? 'expected Textures/<format>/<res>/<id>/<file>' : 'expected HDRIs/<format>/<res>/<file>')
  const id = category === 'Textures' ? rest[0] : null
  const file = rest[rest.length - 1]
  if (id !== null && !PH_ID.test(id)) throw refuse('the asset id must be plain lowercase snake_case')
  if (!PH_FILE.test(file)) throw refuse('the file name must be a plain name')
  if (extOf(file) !== `.${format}`) throw refuse(`the file must end in .${format}`)
  if (!file.endsWith(`_${res}.${format}`)) throw refuse(`the file name must end in _${res}.${format}`)
  if (id !== null && !file.startsWith(`${id}_`)) throw refuse('the file name must start with the asset id')
  return { category, format, res, id, file }
}

export function checkPolyHavenPath(seg, url) {
  parsePolyHavenPath(seg, url)
}

function parseHttpsUrl(input, what) {
  const text = String(input ?? '')
  if (/[\u0000- \u007f]/.test(text) || text.includes('\\')) throw new GateError('BAD_URL', `${what} contains whitespace, a control character or a backslash`, { url: printable(text) })
  let url
  try {
    url = new URL(text)
  } catch {
    throw new GateError('BAD_URL', `${what} is not a valid URL: ${printable(text)}`, { url: printable(text) })
  }
  if (url.protocol !== 'https:') throw new GateError('ORIGIN_NOT_ALLOWED', `${what} must be https:// (got ${url.protocol}//${url.host})`, { url: printable(text) })
  if (url.username || url.password) throw new GateError('ORIGIN_NOT_ALLOWED', `${what} must not carry credentials`, { url: url.origin })
  if (url.port) throw new GateError('ORIGIN_NOT_ALLOWED', `${what} must use the default https port (got :${url.port})`, { url: url.origin })
  if (/[?#]/.test(text)) throw new GateError('ORIGIN_NOT_ALLOWED', `${what} must not carry a query string or a fragment`, { url: url.origin + url.pathname })
  if (/%2f|%5c|%00/i.test(url.pathname)) throw new GateError('BAD_URL', `${what} has an encoded slash, backslash or NUL in its path`, { url: printable(text) })
  return url
}

/**
 * The origin gate for downloads. Throws GateError (ORIGIN_NOT_ALLOWED, GITHUB_UNPINNED, BAD_URL).
 * Called for the manifest URL and again for every redirect hop.
 * @param {string} input
 * @returns {URL}
 */
export function checkDownloadUrl(input) {
  const url = parseHttpsUrl(input, 'download URL')
  const rule = DOWNLOAD_RULES.get(url.hostname)
  if (!rule) {
    throw new GateError(
      'ORIGIN_NOT_ALLOWED',
      `${printable(url.hostname)} is not on the docs/ASSETS-POLICY.md allow-list (${[...DOWNLOAD_RULES.keys()].join(', ')}); add a line to the policy first`,
      { url: url.origin + url.pathname, host: url.hostname },
    )
  }
  rule.check(url)
  return url
}

// ---------------------------------------------------------------------------------------------
// Network (every hop passes the origin gate; nothing is trusted from headers)
// ---------------------------------------------------------------------------------------------

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])

const errorText = (err) => String(err?.message ?? err).slice(0, 200)

/**
 * fetch() with manual redirect handling: each Location is re-checked against the allow-list, so
 * an allow-listed host can never bounce us to a host that is not.
 * @param {string} input
 * @param {{ fetchImpl?: typeof fetch, method?: string, headers?: Record<string,string>, timeoutMs?: number, maxRedirects?: number }} [opts]
 */
export async function safeFetch(input, opts = {}) {
  const { fetchImpl = globalThis.fetch, method = 'GET', headers = {}, timeoutMs = POLICY.timeoutMs, maxRedirects = POLICY.maxRedirects } = opts
  let current = input
  const chain = []
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = checkDownloadUrl(current) // throws before any request is made
    chain.push(url.href)
    let res
    try {
      res = await fetchImpl(url.href, {
        method,
        redirect: 'manual',
        // identity: we want the exact bytes the publisher hashed, not a transport-compressed copy
        headers: { 'user-agent': USER_AGENT, 'accept-encoding': 'identity', ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      throw new GateError('NETWORK_ERROR', `${method} ${url.href} failed: ${errorText(err)}`, { url: url.href })
    }
    const location = res.headers.get('location')
    if (REDIRECT_STATUS.has(res.status) && location) {
      await res.body?.cancel?.()
      try {
        current = new URL(location, url.href).href
      } catch {
        throw new GateError('BAD_URL', `${url.href} redirected to an unparsable Location "${printable(location)}"`, { url: url.href })
      }
      continue
    }
    return { res, finalUrl: url.href, chain }
  }
  throw new GateError('TOO_MANY_REDIRECTS', `more than ${maxRedirects} redirects starting at ${input}`, { chain })
}

/**
 * HEAD size check against maxBytes. Servers that refuse HEAD are tolerated (the streaming cap in
 * downloadBytes still applies); a declared size over the cap or different from `expectedBytes` fails.
 */
export async function headCheck(url, { maxBytes, expectedBytes, fetchImpl } = {}) {
  const { res, finalUrl } = await safeFetch(url, { method: 'HEAD', fetchImpl })
  if (res.status === 405 || res.status === 403 || res.status === 501) return { size: null, finalUrl, note: `HEAD answered ${res.status}; relying on the streaming cap` }
  if (res.status !== 200) throw new GateError('HTTP_STATUS', `HEAD ${finalUrl} answered ${res.status}`, { status: res.status, url: finalUrl })
  const raw = res.headers.get('content-length')
  const size = raw === null ? null : Number(raw)
  if (size !== null && Number.isFinite(size)) {
    if (size > maxBytes) throw new GateError('SIZE_LIMIT', `${finalUrl} declares ${size} bytes, over the manifest cap of ${maxBytes}`, { size, maxBytes })
    const encoding = res.headers.get('content-encoding')
    const transportCompressed = Boolean(encoding) && encoding !== 'identity'
    if (expectedBytes && !transportCompressed && size !== expectedBytes) throw new GateError('SIZE_MISMATCH', `${finalUrl} declares ${size} bytes, manifest expects ${expectedBytes}`, { size, expectedBytes })
  }
  return { size, finalUrl, note: size === null ? 'no content-length' : '' }
}

/** Streams the body into memory, aborting the moment it passes maxBytes. */
export async function downloadBytes(url, { maxBytes, fetchImpl } = {}) {
  const { res, finalUrl } = await safeFetch(url, { fetchImpl })
  if (res.status !== 200) throw new GateError('HTTP_STATUS', `GET ${finalUrl} answered ${res.status}`, { status: res.status, url: finalUrl })
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel?.()
    throw new GateError('SIZE_LIMIT', `${finalUrl} declares ${declared} bytes, over the manifest cap of ${maxBytes}`, { size: declared, maxBytes })
  }
  if (!res.body) throw new GateError('HTTP_STATUS', `GET ${finalUrl} returned no body`, { url: finalUrl })
  const reader = res.body.getReader()
  const chunks = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new GateError('SIZE_LIMIT', `${finalUrl} streamed past the manifest cap of ${maxBytes} bytes`, { maxBytes })
      }
      chunks.push(value)
    }
  } catch (err) {
    if (err instanceof GateError) throw err
    throw new GateError('NETWORK_ERROR', `GET ${finalUrl} broke while streaming: ${errorText(err)}`, { url: finalUrl })
  }
  return { bytes: Buffer.concat(chunks, total), finalUrl, contentType: res.headers.get('content-type') ?? '' }
}

// ---------------------------------------------------------------------------------------------
// Hashes
// ---------------------------------------------------------------------------------------------

export const toBuffer = (bytes) => (Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
export const sha256Hex = (bytes) => createHash('sha256').update(toBuffer(bytes)).digest('hex')
/** The git blob id of a file, which GitHub's contents API reports: an independent check against the repository at the pinned commit. */
export const gitBlobSha1Hex = (bytes) => {
  const buf = toBuffer(bytes)
  return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex')
}

// ---------------------------------------------------------------------------------------------
// Magic bytes
// ---------------------------------------------------------------------------------------------

const latin1 = (buf, start, end) => buf.subarray(start, end).toString('latin1')
const hex = (buf, n = 12) => [...buf.subarray(0, n)].map((b) => b.toString(16).padStart(2, '0')).join(' ')

export const extOf = (name) => {
  const base = String(name).split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot).toLowerCase()
}

/**
 * Checks that the leading bytes match the declared type. Returns {ok:true} or {ok:false, reason}.
 * @param {Uint8Array} input
 * @param {string} type one of TYPES
 */
export function checkMagic(input, type) {
  const buf = toBuffer(input)
  const fail = (reason) => ({ ok: false, reason: `${reason}; first bytes: ${hex(buf)} "${latin1(buf, 0, 12).replace(/[^\x20-\x7e]/g, '.')}"` })
  if (buf.length < 12) return fail(`file is only ${buf.length} bytes`)
  const head = latin1(buf, 0, 64).trimStart().toLowerCase()
  const looksLikeHtml = head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')
  switch (type) {
    case 'fbx': {
      // binary FBX only: "Kaydara FBX Binary  " NUL 0x1A NUL, then a uint32 version (7.x is 7000..7999)
      if (latin1(buf, 0, 20) !== 'Kaydara FBX Binary  ' || buf[20] !== 0 || buf[21] !== 0x1a || buf[22] !== 0) {
        return fail(looksLikeHtml ? 'got an HTML page instead of an FBX (404 or login wall?)' : 'not a binary FBX (expected "Kaydara FBX Binary")')
      }
      const version = buf.readUInt32LE(23)
      if (version < 7000 || version > 7999) return fail(`FBX version ${version} (expected 7000 to 7999)`)
      return { ok: true, version }
    }
    case 'tga':
      return checkTga(buf, fail, looksLikeHtml)
    case 'png':
      // the full 8-byte PNG signature: 89 "PNG" CR LF 1A LF
      if (!buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return fail(looksLikeHtml ? 'got an HTML page instead of a PNG (404 or login wall?)' : 'not a PNG (expected 89 50 4E 47 0D 0A 1A 0A)')
      return { ok: true }
    case 'jpg':
      // SOI then the first marker: FF D8 FF
      if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return fail(looksLikeHtml ? 'got an HTML page instead of a JPEG (404 or login wall?)' : 'not a JPEG (expected FF D8 FF)')
      return { ok: true }
    case 'hdr':
      // Radiance RGBE: "#?RADIANCE" or "#?RGBE"
      if (!(latin1(buf, 0, 10) === '#?RADIANCE' || latin1(buf, 0, 6) === '#?RGBE')) return fail(looksLikeHtml ? 'got an HTML page instead of a Radiance HDR (404 or login wall?)' : 'not a Radiance HDR (expected "#?RADIANCE" or "#?RGBE")')
      return { ok: true }
    case 'exr':
      // OpenEXR magic number 20000630 as a little-endian uint32: 76 2F 31 01
      if (buf[0] !== 0x76 || buf[1] !== 0x2f || buf[2] !== 0x31 || buf[3] !== 0x01) return fail(looksLikeHtml ? 'got an HTML page instead of an OpenEXR (404 or login wall?)' : 'not an OpenEXR (expected 76 2F 31 01)')
      return { ok: true }
    default:
      return { ok: false, reason: `no magic-bytes rule for type "${type}"` }
  }
}

/**
 * Truevision TGA has no leading magic, so the header is checked field by field: a plain (uncompressed or RLE) true-colour
 * or grey image of 1..8192 px, 24 or 32 bit (8 for grey), whose pixel data fits the file; an uncompressed image must have
 * exactly the bytes its header promises (plus the optional TGA 2.0 footer "TRUEVISION-XFILE.\0").
 */
function checkTga(buf, fail, looksLikeHtml) {
  if (looksLikeHtml) return fail('got an HTML page instead of a TGA (404 or login wall?)')
  if (buf.length < 18) return fail('TGA shorter than its 18-byte header')
  const idLength = buf[0]
  const colorMapType = buf[1]
  const imageType = buf[2]
  const width = buf.readUInt16LE(12)
  const height = buf.readUInt16LE(14)
  const depth = buf[16]
  if (colorMapType !== 0) return fail('TGA with a colour map (only true-colour and grey images are accepted)')
  if (![2, 3, 10, 11].includes(imageType)) return fail(`TGA image type ${imageType} (expected 2, 3, 10 or 11)`)
  const grey = imageType === 3 || imageType === 11
  if (grey ? depth !== 8 : depth !== 24 && depth !== 32) return fail(`TGA pixel depth ${depth} does not fit image type ${imageType}`)
  if (!(width >= 1 && height >= 1 && width <= 8192 && height <= 8192)) return fail(`implausible TGA size ${width}x${height}`)
  const footer = buf.length >= 26 && latin1(buf, buf.length - 18, buf.length) === 'TRUEVISION-XFILE.\0'
  const pixels = width * height * (depth / 8)
  const body = buf.length - 18 - idLength - (footer ? 26 : 0)
  if (imageType === 2 || imageType === 3) {
    if (body !== pixels) return fail(`uncompressed TGA ${width}x${height}x${depth} needs ${pixels} pixel bytes, file has ${body}`)
  } else if (body <= 0 || body > pixels * 2) return fail('RLE TGA size does not fit its header')
  return { ok: true, width, height, depth, footer }
}

/** Throws BAD_MAGIC unless the bytes match the declared type. */
export function assertMagic(bytes, type, label) {
  const r = checkMagic(bytes, type)
  if (!r.ok) throw new GateError('BAD_MAGIC', `${label}: ${r.reason}`, { type })
  return r
}

// ---------------------------------------------------------------------------------------------
// glTF validation (Khronos validator). The converter validates the glbs it WRITES with this; downloaded files are never glTF.
// ---------------------------------------------------------------------------------------------

/**
 * @param {Uint8Array} input
 * @param {{ type?: 'glb'|'gltf', uri?: string, resolveExternal?: (uri: string) => Promise<Uint8Array>, throwOnErrors?: boolean }} [opts]
 */
export async function validateGltfBytes(input, opts = {}) {
  const { type = 'glb', uri = 'asset', resolveExternal, throwOnErrors = true } = opts
  const buf = toBuffer(input)
  const options = { uri, format: type === 'gltf' ? 'gltf' : 'glb', maxIssues: 2000, writeTimestamp: false }
  if (resolveExternal) options.externalResourceFunction = resolveExternal
  let report
  try {
    report = await validateBytes(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), options)
  } catch (err) {
    throw new GateError('VALIDATOR_CRASH', `gltf-validator could not read ${uri}: ${String(err).slice(0, 300)}`)
  }
  const issues = report.issues
  const pick = (severity, n) =>
    issues.messages
      .filter((m) => m.severity === severity)
      .slice(0, n)
      .map((m) => `${m.code} ${m.pointer ?? ''}: ${m.message}`.trim())
  const summary = {
    validator: gltfValidatorVersion(),
    errors: issues.numErrors,
    /** true when the validator stopped listing at maxIssues, so the counts are lower bounds */
    truncated: Boolean(issues.truncated),
    warnings: issues.numWarnings,
    infos: issues.numInfos,
    hints: issues.numHints,
    errorMessages: pick(0, 8),
    warningMessages: pick(1, 8),
    info: report.info
      ? {
          animations: report.info.animationCount,
          materials: report.info.materialCount,
          drawCalls: report.info.drawCallCount,
          vertices: report.info.totalVertexCount,
          triangles: report.info.totalTriangleCount,
          hasSkins: report.info.hasSkins,
          maxInfluences: report.info.maxInfluences,
          extensionsUsed: report.info.extensionsUsed ?? [],
        }
      : null,
  }
  if (throwOnErrors && summary.errors > 0) {
    throw new GateError('VALIDATOR_ERRORS', `gltf-validator reported ${summary.truncated ? 'at least ' : ''}${summary.errors} error(s) in ${uri}: ${summary.errorMessages.join(' | ')}`, { summary })
  }
  return summary
}

// ---------------------------------------------------------------------------------------------
// Manifest entries
// ---------------------------------------------------------------------------------------------

const ENTRY_KEYS = new Set([
  'id', 'kind', 'type', 'dest', 'group', 'file', 'url', 'localFile', 'sourcePage', 'sourceCommit', 'sha256', 'gitBlobSha1', 'bytes', 'maxBytes',
  'licence', 'licenceUrl', 'author', 'notes',
])

/** localFile: 1 to 3 plain segments below assets-src/_import (no leading dot, so never "." or ".."). */
const LOCAL_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}(\/[A-Za-z0-9][A-Za-z0-9._-]{0,80}){0,2}$/

/**
 * Validates one declarative manifest entry (shape, enums, sizes, safe file names, URL/type match).
 * Every entry names its pinned upstream `url` (what is downloaded, or, for a `localFile` import, the provenance of the
 * staged copy) and the exact `bytes`. A GitHub-sourced entry (raw.githubusercontent.com) also needs the `gitBlobSha1` of the
 * file at the pinned commit; a Poly Haven entry has no commit, so its pin is `bytes` plus `sha256` (recorded at the first
 * fetch, mandatory under --strict) and it must NOT carry a gitBlobSha1. A `localFile` import is never downloaded, so it
 * must carry its sha256 pin already. A textures entry may name the Poly Haven asset in `group`, its install sub-folder.
 * Throws GateError BAD_MANIFEST. Returns the entry with defaults applied (`file`, `sha256: null` when unpinned).
 */
export function validateManifestEntry(entry) {
  const bad = (why) => new GateError('BAD_MANIFEST', `manifest entry "${printable(entry?.id ?? '?')}": ${why}`)
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw bad('not an object')
  for (const k of Object.keys(entry)) if (!ENTRY_KEYS.has(k)) throw bad(`unknown key "${printable(k)}"`)
  if (typeof entry.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(entry.id)) throw bad('id must match ^[a-z0-9][a-z0-9_-]{0,63}$')
  if (!KINDS.includes(entry.kind)) throw bad(`kind must be one of ${KINDS.join(', ')}`)
  if (!TYPES.includes(entry.type)) throw bad(`type must be one of ${TYPES.join(', ')}`)
  if (!KIND_TYPES[entry.kind].includes(entry.type)) throw bad(`kind ${entry.kind} holds ${KIND_TYPES[entry.kind].join(' or ')} files, not .${entry.type}`)
  if (entry.group !== undefined) {
    if (entry.kind !== 'textures') throw bad('group (the install sub-folder) is only for textures')
    if (typeof entry.group !== 'string' || !PH_ID.test(entry.group)) throw bad('group must be a plain lowercase snake_case name')
  }
  if (SOURCE_ONLY_TYPES.includes(entry.type) && entry.dest !== 'source') throw bad(`.${entry.type} files are conversion inputs only: they need dest "source" (assets-src/, never served)`)
  if (!Number.isInteger(entry.maxBytes) || entry.maxBytes < 1 || entry.maxBytes > POLICY.maxFileBytes) throw bad(`maxBytes must be an integer between 1 and ${POLICY.maxFileBytes}`)
  if (!Number.isInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > entry.maxBytes) throw bad('bytes (the exact size at the pinned commit) is required and must be an integer no larger than maxBytes')
  if (entry.maxBytes > Math.ceil(entry.bytes * 1.05) + 4096) throw bad('maxBytes may be at most 5 % (plus 4 KB) above the exact byte count')
  const sha256 = entry.sha256 ?? null
  if (sha256 !== null && !(typeof sha256 === 'string' && SHA256.test(sha256))) throw bad('sha256 must be null (first fetch) or 64 lowercase hex characters')
  let host = ''
  try {
    host = new URL(String(entry.url)).hostname
  } catch {
    // reported below, with the rest of the url rules
  }
  if (host === POLICY.polyhaven.host) {
    if (entry.gitBlobSha1 !== undefined) throw bad('a Poly Haven file has no git blob id: its pin is bytes + sha256 (remove gitBlobSha1)')
  } else if (typeof entry.gitBlobSha1 !== 'string' || !SHA40.test(entry.gitBlobSha1)) {
    throw bad('gitBlobSha1 (the blob id the GitHub contents API lists at the pinned commit) is required for GitHub-sourced entries: 40 lowercase hex characters')
  }
  if (entry.sourceCommit !== undefined && !(typeof entry.sourceCommit === 'string' && SHA40.test(entry.sourceCommit))) throw bad('sourceCommit must be 40 lowercase hex characters')
  for (const k of ['licenceUrl', 'author', 'notes']) {
    if (entry[k] !== undefined && (typeof entry[k] !== 'string' || entry[k].length > 2000)) throw bad(`${k} must be a string of at most 2000 characters`)
  }
  if (typeof entry.licence !== 'string' || !entry.licence.trim()) throw bad('licence is required')
  try {
    parseHttpsUrl(entry.sourcePage, 'sourcePage')
    if (entry.licenceUrl !== undefined) parseHttpsUrl(entry.licenceUrl, 'licenceUrl')
  } catch (err) {
    throw bad(err.message)
  }
  if (entry.localFile !== undefined) {
    if (typeof entry.localFile !== 'string' || !LOCAL_FILE.test(entry.localFile)) throw bad('localFile must be 1 to 3 plain path segments inside assets-src/_import (no "..", no leading dot, no absolute path)')
    if (extOf(entry.localFile) !== `.${entry.type}`) throw bad(`localFile extension must be .${entry.type}`)
    if (sha256 === null) throw bad('a localFile import is never downloaded, so its sha256 must already be pinned')
  }
  if (typeof entry.url !== 'string') throw bad('url is required (the pinned upstream address; for a localFile import it is the provenance)')
  let url
  try {
    url = new URL(entry.url)
  } catch {
    throw bad('url is not a URL')
  }
  if (extOf(url.pathname) !== `.${entry.type}`) throw bad(`url ends in "${extOf(url.pathname) || '(none)'}" but type is ${entry.type}`)
  const file = entry.file ?? `${entry.id}.${entry.type}`
  if (!/^[a-z0-9][a-z0-9._-]{0,100}$/i.test(file) || file.includes('..')) throw bad('file must be a plain file name')
  if (extOf(file) !== `.${entry.type}`) throw bad(`file must end in .${entry.type}`)
  return { ...entry, sha256, file }
}

/**
 * Checks that a manifest entry's kind, type, install names and url describe the same file, on top of the origin gate:
 *   - `people` entries come from the Rocketbox GitHub host, `textures` and `hdri` entries from Poly Haven, never crossed;
 *   - a Poly Haven texture: category Textures, url format = type, `group` = the asset id in the path, `file` = the file name
 *     in the path; a Poly Haven HDRI: category HDRIs, url format = type, `file` = the file name in the path, no `group`.
 * `entry` is an entry already returned by validateManifestEntry; `url` is checkDownloadUrl's result. Throws ORIGIN_NOT_ALLOWED.
 */
export function assertEntryMatchesSource(entry, url) {
  const refuse = (why) => new GateError('ORIGIN_NOT_ALLOWED', `${printable(entry.id)}: ${why}`, { url: url.href })
  const onPolyHaven = url.hostname === POLICY.polyhaven.host
  if (entry.kind === 'people') {
    if (onPolyHaven) throw refuse('a people entry must come from the Rocketbox GitHub source, not Poly Haven')
    return
  }
  if (!onPolyHaven) throw refuse(`a ${entry.kind} entry must come from ${POLICY.polyhaven.host}`)
  const ph = parsePolyHavenPath(url.pathname.split('/'), url)
  if (ph.category !== (entry.kind === 'textures' ? 'Textures' : 'HDRIs')) throw refuse(`a ${entry.kind} entry must point into the ${entry.kind === 'textures' ? 'Textures' : 'HDRIs'} folder`)
  if (ph.format !== entry.type) throw refuse(`url format ${ph.format} does not match type ${entry.type}`)
  if (entry.file !== ph.file) throw refuse(`file must be the url's file name "${ph.file}" (got "${printable(entry.file)}")`)
  if (entry.kind === 'textures' && entry.group !== ph.id) throw refuse(`group must be the Poly Haven asset id "${ph.id}" (got "${printable(entry.group ?? '')}")`)
  if (entry.kind === 'hdri' && entry.group !== undefined) throw refuse('an hdri entry has no group')
}

// ---------------------------------------------------------------------------------------------
// docs/CREDITS.md generated block
// ---------------------------------------------------------------------------------------------

export const CREDITS_BEGIN = '<!-- BEGIN GENERATED ASSETS: written by tools/fetch-assets.mjs and tools/convert-people.mjs; edit the notes around it, not inside it -->'
export const CREDITS_END = '<!-- END GENERATED ASSETS -->'

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()

/**
 * @param {{ assets: Record<string, any> }} installed contents of public/assets/manifest.json
 * @returns {string} the markdown table, including the BEGIN/END markers
 */
export function renderCreditsBlock(installed) {
  const rows = Object.entries(installed.assets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, a]) => {
      const files = a.files.map((f) => `\`${f.root === 'source' ? 'assets-src/' : ''}${f.path}\``).join('<br>')
      const source = a.source?.page ? `[source](${a.source.page})` : ''
      const lic = a.licenceUrl ? `[${cell(a.licence)}](${a.licenceUrl})` : cell(a.licence)
      return `| \`${id}\` | ${a.kind} | ${files} | ${lic} | ${cell(a.author)} | ${source} | \`${a.sha256.slice(0, 12)}\` |`
    })
  return [
    CREDITS_BEGIN,
    '',
    '| Asset | Kind | Files (`public/assets`, or `assets-src` for conversion inputs) | Licence | Author / provenance | Source | SHA-256 (first 12) |',
    '|---|---|---|---|---|---|---|',
    ...rows,
    '',
    CREDITS_END,
  ].join('\n')
}

/** Replaces the generated block in `text`, or appends it. Hand-written text is never touched. */
export function applyCreditsBlock(text, block) {
  const start = text.indexOf(CREDITS_BEGIN)
  const end = text.indexOf(CREDITS_END)
  if (start >= 0 && end > start) return text.slice(0, start) + block + text.slice(end + CREDITS_END.length)
  return `${text.replace(/\s*$/, '')}\n\n${block}\n`
}
