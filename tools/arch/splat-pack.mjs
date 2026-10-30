// The splat pilot's packer (docs/research/real-simulation-engines.md, option A): a trained Gaussian-splat .ply (Brush, from tools/arch/splat_views.py)
// to the shipped .spz (Spark's transcodeSpz, Niantic SPZ v3: about a tenth of the .ply). It keeps only the splats inside the zone's boxes (drops
// the floaters the views never pinned down, and anything reaching into the neighbours, which stay baked models) and drops near-transparent splats.
//
// The .spz stays in Blender's z-up frame and the runtime turns it (SplatZone.tsx). Spark 2.3.1's transcodeSpz `transform` turns the centres
// right but composes each splat's own rotation in the wrong order (q_splat * q_turn), so every flat splat ends up on edge: the pilot's first
// packs read as fog and streaks. Do not bake the turn here.
//
// The centres are stored relative to an origin, written next to the .spz as <out>.json ({ origin: [x, y, z] }, game frame), where the runtime
// puts the mesh. Spark keeps each centre as a 16-bit float on the GPU: at the lobby's x of -40 to -62 that is a 3 cm step, coarser than the oak
// slats, so splats far from the world origin smear (round 2 of the pilot). Within 11 m of the zone's middle the step is under 1 cm.
//
//   node tools/arch/splat-pack.mjs <in.ply> <out.spz> [--box x0,x1,y0,y1,z0,z1]... [--origin x,y,z] [--max-sh 3] [--min-opacity 0.02]
//
// Each --box is in the game frame (plan metres: x east, y up, z south); a splat is kept when its centre is in any of them. Give the boxes room
// above and below the room (the lobby: y -4..7): a glossy floor's reflections are trained as splats under it, and the ceiling uses a band above
// its surface; a box tight to the room punches holes in both. --origin is in the game frame too; it defaults to the middle of the boxes, to
// the half metre. Prints the counts and sizes.
import { readFileSync, writeFileSync, statSync } from 'node:fs'
import { transcodeSpz } from '@sparkjsdev/spark'

const SIZE = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 }

/** A binary little-endian .ply's header: vertex count, stride, property offsets and where the body starts. */
function plyLayout(bytes) {
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 16384)))
  const end = head.indexOf('end_header\n')
  if (!head.startsWith('ply') || end < 0 || !head.includes('binary_little_endian')) throw new Error('splat-pack: expects a binary little-endian .ply')
  const lines = head.slice(0, end).split('\n')
  const count = Number(lines.find((l) => l.startsWith('element vertex')).split(' ')[2])
  let stride = 0
  const at = {}
  for (const l of lines.filter((l) => l.startsWith('property '))) {
    const [, type, name] = l.split(' ')
    if (!(type in SIZE)) throw new Error(`splat-pack: unsupported property ${l}`)
    if ('xyz'.includes(name) && SIZE[type] !== 4) throw new Error(`splat-pack: expects float centres, got ${l}`)
    at[name] = stride
    stride += SIZE[type]
  }
  return { head: head.slice(0, end), count, stride, at, body: end + 'end_header\n'.length }
}

/**
 * The .ply's vertices whose centre (Blender frame) lies in one of `boxes` (game frame; every vertex when there are none), as a new .ply with
 * the centres moved by -`origin` (game frame).
 */
function keepAndCentre(bytes, boxes, origin) {
  const { head, count, stride, at, body } = plyLayout(bytes)
  const view = new DataView(bytes.buffer, bytes.byteOffset + body, count * stride)
  const out = new Uint8Array(count * stride)
  const put = new DataView(out.buffer)
  // Blender (x, y, z) is game (x, z, -y)
  const [ox, oy, oz] = [origin[0], -origin[2], origin[1]]
  let kept = 0
  for (let i = 0; i < count; i++) {
    const o = i * stride
    const bx = view.getFloat32(o + at.x, true)
    const by = view.getFloat32(o + at.y, true)
    const bz = view.getFloat32(o + at.z, true)
    if (boxes.length > 0 && !boxes.some((b) => bx >= b[0] && bx <= b[1] && bz >= b[2] && bz <= b[3] && -by >= b[4] && -by <= b[5])) continue
    const k = kept * stride
    out.set(bytes.subarray(body + o, body + o + stride), k)
    put.setFloat32(k + at.x, bx - ox, true)
    put.setFloat32(k + at.y, by - oy, true)
    put.setFloat32(k + at.z, bz - oz, true)
    kept++
  }
  const header = new TextEncoder().encode(head.replace(/element vertex \d+/, `element vertex ${kept}`) + 'end_header\n')
  const ply = new Uint8Array(header.length + kept * stride)
  ply.set(header)
  ply.set(out.subarray(0, kept * stride), header.length)
  return { ply, count, kept }
}

/** The middle of the boxes' union, to the half metre (the world origin when there are none). */
function middleOf(boxes) {
  if (boxes.length === 0) return [0, 0, 0]
  const lo = (k) => Math.min(...boxes.map((b) => b[k]))
  const hi = (k) => Math.max(...boxes.map((b) => b[k]))
  return [0, 2, 4].map((k) => Math.round(lo(k) + hi(k + 1)) / 2)
}

const [input, output, ...rest] = process.argv.slice(2)
if (!input || !output?.endsWith('.spz')) {
  console.error('usage: node tools/arch/splat-pack.mjs <in.ply> <out.spz> [--box x0,x1,y0,y1,z0,z1]... [--origin x,y,z] [--max-sh 3] [--min-opacity 0.02]')
  process.exit(2)
}
const opt = (name, fallback) => {
  const i = rest.indexOf(name)
  return i >= 0 ? rest[i + 1] : fallback
}
const boxes = rest.flatMap((a, i) => (a === '--box' ? [rest[i + 1].split(',').map(Number)] : []))
if (boxes.some((b) => b.length !== 6 || b.some((v) => !Number.isFinite(v)))) throw new Error('splat-pack: --box takes x0,x1,y0,y1,z0,z1')
const origin = opt('--origin', null)?.split(',').map(Number) ?? middleOf(boxes)
if (origin.length !== 3 || origin.some((v) => !Number.isFinite(v))) throw new Error('splat-pack: --origin takes x,y,z')
const maxSh = Number(opt('--max-sh', '3'))
const opacityThreshold = Number(opt('--min-opacity', '0.02'))

const raw = new Uint8Array(readFileSync(input))
const { ply, count, kept } = keepAndCentre(raw, boxes, origin)
const { fileBytes } = await transcodeSpz({
  inputs: [{ fileBytes: ply, fileType: 'ply', pathOrUrl: input }],
  maxSh,
  opacityThreshold,
  version: 3,
})
writeFileSync(output, fileBytes)
const meta = output.replace(/\.spz$/, '.json')
writeFileSync(meta, `${JSON.stringify({ origin })}\n`)
const mb = (n) => (n / 1048576).toFixed(1)
console.log(`splat-pack: ${input} (${mb(statSync(input).size)} MB) -> ${output} (${mb(fileBytes.length)} MB) + ${meta}, kept ${kept} of ${count}, origin ${origin.join(', ')}, max SH ${maxSh}`)
