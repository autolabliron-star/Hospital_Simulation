/**
 * The control-room and booth monitors. `getLayout().consoleScreens` says where each screen face is (centre, height, heading of its
 * normal, picture size); the room draws the desk and no monitor, so this adds a bezel and a stand (static, merged into the machine's
 * static mesh) and a textured plane per anchor (one mesh per modality, merged, sharing the modality's live canvas texture).
 *
 * The live canvases are square, the screens are wide: the whole picture is shown square at the screen's height with black bars each
 * side (never squashed, never cropped; see `screenPlane`). The monitor material therefore needs `vertexColors: true`.
 */
import { type BufferGeometry, Float32BufferAttribute, PlaneGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { ConsoleScreen } from '@/scene/building/layout'
import { COL, rbox } from './geometry'

/** The console desks' top surface (see `consoleDesk` in src/scene/rooms/imaging.ts). */
export const DESK_TOP_Y = 0.74

/** Bezel and stand parts for some screens (baked and painted, ready to merge into a static mesh). */
export function consoleFurniture(screens: readonly ConsoleScreen[]): BufferGeometry[] {
  const parts: BufferGeometry[] = []
  for (const s of screens) {
    const nx = Math.sin(s.ry)
    const nz = Math.cos(s.ry)
    const at = (back: number, y: number) => ({ x: s.x - nx * back, y, z: s.z - nz * back, ry: s.ry })
    // bezel: its front sits 3 mm behind the picture
    parts.push(rbox(s.w + 0.04, s.h + 0.04, 0.035, 0.01, COL.bezel, at(0.003 + 0.0175, s.y)))
    // neck from the desk up behind the bezel, and a flat foot
    const bottom = s.y - s.h / 2
    const neck = bottom - DESK_TOP_Y
    parts.push(rbox(0.07, neck, 0.04, 0.012, COL.dark, at(0.06, DESK_TOP_Y + neck / 2)))
    parts.push(rbox(0.24, 0.016, 0.17, 0.006, COL.dark, at(0.04, DESK_TOP_Y + 0.008)))
  }
  return parts
}

/** One textured plane per screen, rotated to its heading, merged. The picture is square (the live canvases are): see `screenPlane`. */
export function monitorPlanes(screens: readonly ConsoleScreen[]): BufferGeometry {
  const planes: BufferGeometry[] = []
  for (const s of screens) planes.push(screenPlane(s.w, s.h, { x: s.x, y: s.y, z: s.z, ry: s.ry }))
  return mergePlanes(planes)
}

function mergePlanes(planes: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(planes, false)
  if (!g) throw new Error('monitor planes failed to merge')
  for (const p of planes) p.dispose()
  g.computeBoundingBox()
  g.computeBoundingSphere()
  return g
}

/** A quad of `w` x `h` centred at (cx, 0) in the XY plane facing +z, all UVs 0..1 or squeezed into the texture's corner, one vertex colour. */
function quad(w: number, h: number, cx: number, shade: number, picture: boolean): BufferGeometry {
  const g = new PlaneGeometry(w, h)
  g.translate(cx, 0, 0)
  const uv = g.getAttribute('uv')
  if (!picture) for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5, 0.5)
  const n = g.getAttribute('position').count
  const c = new Float32Array(n * 3).fill(shade)
  g.setAttribute('color', new Float32BufferAttribute(c, 3))
  return g
}

/**
 * A `w` x `h` screen facing heading `ry` (normal = (sin ry, 0, cos ry)) centred at `at`. The live canvases are SQUARE: the whole
 * picture is shown at the screen's height, centred, with black bars each side where the screen is wider (the quads of the bars
 * carry a black vertex colour, the picture's quad a white one; the monitor material multiplies the texture by it).
 */
export function screenPlane(w: number, h: number, at: { x: number; y: number; z: number; ry: number }): BufferGeometry {
  const side = Math.min(w, h)
  const parts: BufferGeometry[] = [quad(side, side, 0, 1, true)]
  if (w > side + 1e-6) {
    const bar = (w - side) / 2
    parts.push(quad(bar, h, -(side + bar) / 2, 0, false), quad(bar, h, (side + bar) / 2, 0, false))
  } else if (h > side + 1e-6) {
    // taller than wide: bars above and below (rare; the same black vertex colour)
    const bar = (h - side) / 2
    const top = quad(w, bar, 0, 0, false)
    top.translate(0, (side + bar) / 2, 0)
    const bottom = quad(w, bar, 0, 0, false)
    bottom.translate(0, -(side + bar) / 2, 0)
    parts.push(top, bottom)
  }
  const g = mergePlanes(parts)
  g.rotateY(at.ry)
  g.translate(at.x, at.y, at.z)
  g.computeBoundingBox()
  g.computeBoundingSphere()
  return g
}

/** The ultrasound cart's monitor head: a rounded box facing heading `ry`, centred at (x, y, z). */
export function monitorHead(x: number, y: number, z: number, ry: number, w: number, h: number): BufferGeometry {
  return rbox(w + 0.04, h + 0.04, 0.05, 0.012, COL.bezel, { x, y, z, ry })
}

