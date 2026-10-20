// R3: a test kit, not shipped (only tests and dev previews import it). Grey pictures of the synthetic body's tissues on a plane, written as
// PNG files, so whoever builds anatomy can LOOK at it (open the file) before any renderer exists.
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { labelAt, type Phantom, type V3 } from './body'
import { TABLE } from './tissues'

function crc32(buf: Uint8Array): number {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

/** Write an 8-bit greyscale picture as a PNG file. */
export function writePng(path: string, grey: Uint8Array, w: number, h: number): void {
  const raw = Buffer.alloc((w + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0
    for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = grey[y * w + x]
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]))
}

/**
 * The tissues on a plane through `centre`, spanned by unit `u` (picture right) and `v` (picture down), `fov` mm across, as CT-like greys
 * (window `level` +- `width`/2 over each tissue's plain HU). Bone white, air black, fat dark grey, soft tissue mid grey.
 */
export function tissueSlice(ph: Phantom, centre: V3, u: V3, v: V3, fov: number, size: number, level = 40, width = 400): Uint8Array {
  const out = new Uint8Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = ((x + 0.5) / size - 0.5) * fov
      const b = ((y + 0.5) / size - 0.5) * fov
      const px = centre[0] + u[0] * a + v[0] * b
      const py = centre[1] + u[1] * a + v[1] * b
      const pz = centre[2] + u[2] * a + v[2] * b
      const i = labelAt(ph, px, py, pz, 0)
      const hu = i < 0 ? -1000 : TABLE.hu[ph.partTissue[i]]
      const g = (hu - (level - width / 2)) / width
      out[y * size + x] = Math.max(0, Math.min(255, Math.round(g * 255)))
    }
  }
  return out
}

/**
 * The three standard planes as (u, v) pairs in radiological display: axial seen from the feet (the patient's right on the picture's left,
 * the front at the top), coronal seen from the front (head up), sagittal with the front on the left (head up).
 */
export const PLANES: Record<'axial' | 'coronal' | 'sagittal', [V3, V3]> = {
  axial: [
    [1, 0, 0],
    [0, 1, 0],
  ],
  coronal: [
    [1, 0, 0],
    [0, 0, -1],
  ],
  sagittal: [
    [0, 1, 0],
    [0, 0, -1],
  ],
}
