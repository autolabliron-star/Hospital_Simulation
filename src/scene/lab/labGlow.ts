/**
 * W4 lab: the lab's light as ONE vertex-coloured RGBA geometry (drawn with MACHINE_GLOW, one draw call): a status LED on every module, the
 * camera arch's flash strip, a ring round the pipe at each launch point and at the receive hood, and the glow trails of up to two tubes in flight.
 * A light's brightness and colour are a rewrite of its region's vertex colours (`setRegionRGB`, only when its state changes); a trail is a
 * strip of crossed ribbons whose vertices are rewritten each frame while a tube flies. Pure three.js, no DOM.
 */
import { type BufferAttribute, type BufferGeometry } from 'three'
import { bx, GlowBuilder, type GlowGeometry, plane, torus } from '@/scene/imaging/machines/geometry'
import { PNEUMATIC } from '@/sim/places'
import { CAMERA_ARCH, housingOf, RECEIVE } from './labDims'

/** One status LED per module (and the camera and the receive station). */
export const LED_IDS = ['camera', 'cfg0', 'cfg1', 'decap', 'haem', 'chem', 'immuno', 'coag', 'recap', 'archive', 'receive'] as const
export type LedId = (typeof LED_IDS)[number]

/** The ring flashes: the four launch points (robots 0..2, the manual send station) and the receive hood. */
export const RING_COUNT = PNEUMATIC.sources.length + 1
export const RING_RECEIVE = PNEUMATIC.sources.length

export const TRAIL = { flights: 2, points: 12, spacing: 0.14, width: 0.045 } as const
/** Vertices of one trail: points - 1 segments, two crossed ribbons, a front and a back quad each (6 vertices a quad). */
export const TRAIL_VERTS = (TRAIL.points - 1) * 2 * 2 * 6

function ledGeometry(id: LedId): BufferGeometry {
  switch (id) {
    case 'camera': {
      const cx = (CAMERA_ARCH.xLeft + CAMERA_ARCH.xRight) / 2
      const cz = (CAMERA_ARCH.z0 + CAMERA_ARCH.z1) / 2
      return bx(cx - 0.07, cx + 0.07, CAMERA_ARCH.beamY1 + 0.025, CAMERA_ARCH.beamY1 + 0.031, cz - 0.03, cz + 0.03, '#ffffff')
    }
    case 'cfg0':
    case 'cfg1': {
      const h = housingOf(id)
      const cz = (h.z0 + h.z1) / 2
      return bx(h.x1 - 0.075, h.x1 - 0.04, h.h, h.h + 0.006, cz - 0.1, cz + 0.1, '#ffffff')
    }
    case 'decap': {
      const h = housingOf(id)
      const cz = (h.z0 + h.z1) / 2
      return bx(h.x1 - 0.12, h.x1 - 0.06, h.h, h.h + 0.006, cz - 0.1, cz + 0.1, '#ffffff')
    }
    case 'haem':
    case 'chem':
    case 'immuno': {
      const h = housingOf(id)
      const cx = (h.x0 + h.x1) / 2
      return bx(cx - 0.15, cx + 0.15, h.h, h.h + 0.006, h.z0 + 0.06, h.z0 + 0.09, '#ffffff')
    }
    case 'coag':
    case 'recap':
    case 'archive': {
      const h = housingOf(id)
      const cz = (h.z0 + h.z1) / 2
      return bx(h.x0 + 0.06, h.x0 + 0.09, h.h, h.h + 0.006, cz - (id === 'archive' ? 0.2 : 0.1), cz + (id === 'archive' ? 0.2 : 0.1), '#ffffff')
    }
    case 'receive': {
      const cx = (RECEIVE.x0 + RECEIVE.x1) / 2
      return bx(cx - 0.3, cx + 0.3, RECEIVE.h, RECEIVE.h + 0.006, RECEIVE.z1 - 0.08, RECEIVE.z1 - 0.04, '#ffffff')
    }
  }
}

/** Where each ring sits (round the pipe, a little above the launch point; the last one near the receive hood's mouth). */
export function ringAt(i: number): { x: number; y: number; z: number } {
  if (i < PNEUMATIC.sources.length) {
    const s = PNEUMATIC.sources[i]
    return { x: s.x, y: s.y + 0.16, z: s.z }
  }
  const t = PNEUMATIC.trunk[PNEUMATIC.trunk.length - 1]
  return { x: t.x, y: t.y + 0.28, z: t.z }
}

export interface LabGlow extends GlowGeometry {
  /** The first vertex of each trail (every trail is `TRAIL_VERTS` long). */
  trailStart: number[]
}

export function buildLabGlow(): LabGlow {
  const gb = new GlowBuilder()
  for (const id of LED_IDS) gb.region(`led:${id}`, '#ffffff', [ledGeometry(id)])
  const cz = (CAMERA_ARCH.z0 + CAMERA_ARCH.z1) / 2
  gb.region('flash', '#ffffff', [bx(CAMERA_ARCH.xLeft + 0.01, CAMERA_ARCH.xRight - 0.01, CAMERA_ARCH.beamY0 - 0.007, CAMERA_ARCH.beamY0 - 0.002, cz - 0.07, cz + 0.07, '#ffffff')])
  for (let i = 0; i < RING_COUNT; i++) {
    const p = ringAt(i)
    gb.region(`ring:${i}`, '#bff3ee', [torus('y', 0.075, 0.005, '#ffffff', p, 14)])
  }
  for (let t = 0; t < TRAIL.flights; t++) {
    const quads: BufferGeometry[] = []
    for (let q = 0; q < (TRAIL.points - 1) * 4; q++) quads.push(plane(1, 1, '#ffffff'))
    gb.region(`trail:${t}`, '#ffffff', quads)
  }
  const built = gb.build()
  const trailStart = Array.from({ length: TRAIL.flights }, (_, t) => built.regions[`trail:${t}`].start)
  return { ...built, trailStart }
}

/**
 * Write the glow trail of one tube into `glow`: `pts` holds `TRAIL.points` points (x, y, z) from the head backwards, `r, g, b` is the colour
 * (above 1 blooms) and `alpha` the head's opacity; the tail fades to nothing. Each segment is two crossed ribbons (a front and a back quad each),
 * so it reads from any side. Positions only change here; colours are written in the same pass. Allocation-free.
 */
export function writeTrail(glow: LabGlow, flight: number, pts: ArrayLike<number>, r: number, g: number, b: number, alpha: number): void {
  const geo = glow.geometry
  const pos = (geo.getAttribute('position') as BufferAttribute).array as Float32Array
  const col = (geo.getAttribute('color') as BufferAttribute).array as Float32Array
  let v = glow.trailStart[flight]
  const K = TRAIL.points
  for (let j = 0; j + 1 < K; j++) {
    const a = j * 3
    const c = (j + 1) * 3
    // the segment's direction
    let tx = pts[a] - pts[c]
    let ty = pts[a + 1] - pts[c + 1]
    let tz = pts[a + 2] - pts[c + 2]
    const tl = Math.hypot(tx, ty, tz)
    const live = tl > 1e-6
    if (live) {
      tx /= tl
      ty /= tl
      tz /= tl
    } else {
      tx = 1
      ty = 0
      tz = 0
    }
    // two axes perpendicular to the direction: side = t x up (or x when the pipe is vertical), up2 = t x side
    let sx = tz
    let sy = 0
    let sz = -tx
    let sl = Math.hypot(sx, sz)
    if (sl < 0.2) {
      sx = 1
      sy = 0
      sz = 0
      sl = 1
    }
    sx /= sl
    sy /= sl
    sz /= sl
    const ux = ty * sz - tz * sy
    const uy = tz * sx - tx * sz
    const uz = tx * sy - ty * sx
    const w0 = (TRAIL.width * (1 - j / K)) / 2
    const w1 = (TRAIL.width * (1 - (j + 1) / K)) / 2
    const a0 = live ? alpha * (1 - j / (K - 1)) : 0
    const a1 = live ? alpha * (1 - (j + 1) / (K - 1)) : 0
    for (let ribbon = 0; ribbon < 2; ribbon++) {
      const ax = ribbon === 0 ? sx : ux
      const ay = ribbon === 0 ? sy : uy
      const az = ribbon === 0 ? sz : uz
      // corners: head-left, head-right, tail-right, tail-left
      const p0x = pts[a] - ax * w0
      const p0y = pts[a + 1] - ay * w0
      const p0z = pts[a + 2] - az * w0
      const p1x = pts[a] + ax * w0
      const p1y = pts[a + 1] + ay * w0
      const p1z = pts[a + 2] + az * w0
      const p2x = pts[c] + ax * w1
      const p2y = pts[c + 1] + ay * w1
      const p2z = pts[c + 2] + az * w1
      const p3x = pts[c] - ax * w1
      const p3y = pts[c + 1] - ay * w1
      const p3z = pts[c + 2] - az * w1
      for (let side = 0; side < 2; side++) {
        // front: (0, 1, 2) (0, 2, 3); back: the same triangles reversed
        const order = side === 0 ? ORDER_FRONT : ORDER_BACK
        for (let n = 0; n < 6; n++) {
          const k = order[n]
          const o = v * 3
          pos[o] = k === 0 ? p0x : k === 1 ? p1x : k === 2 ? p2x : p3x
          pos[o + 1] = k === 0 ? p0y : k === 1 ? p1y : k === 2 ? p2y : p3y
          pos[o + 2] = k === 0 ? p0z : k === 1 ? p1z : k === 2 ? p2z : p3z
          const ca = k < 2 ? a0 : a1
          const q = v * 4
          col[q] = r
          col[q + 1] = g
          col[q + 2] = b
          col[q + 3] = ca
          v++
        }
      }
    }
  }
}
const ORDER_FRONT = [0, 1, 2, 0, 2, 3] as const
const ORDER_BACK = [0, 2, 1, 0, 3, 2] as const

/** Hide a trail (every vertex transparent). */
export function clearTrail(glow: LabGlow, flight: number): void {
  const col = (glow.geometry.getAttribute('color') as BufferAttribute).array as Float32Array
  const start = glow.trailStart[flight]
  for (let v = start; v < start + TRAIL_VERTS; v++) col[v * 4 + 3] = 0
}
