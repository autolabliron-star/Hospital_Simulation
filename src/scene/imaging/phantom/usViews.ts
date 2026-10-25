/**
 * R3 "Real screens": where the sonographer puts the probe for each ultrasound view, on THIS patient (params.ts), so the picture shows what is
 * really under it. A view aims the beam from a window on the skin at an organ, with the transducer's long axis along a chosen line:
 *
 *   view         window                                 image left                 sweep (the beam fans about the long axis)
 *   liver        right subcostal, beam up under the ribs patient's right            caudal (gallbladder, kidney) to cranial (dome, hepatic veins)
 *   gallbladder  right subcostal, along the gallbladder  the neck (head end)        across the gallbladder
 *   kidneyR      right flank, mid-axillary, long axis    the head end (upper pole)  through the kidney, front to back
 *   kidneyL      left flank, posterior axillary          the head end               through the kidney
 *   spleen       left intercostal                        the head end               across the spleen
 *   bladder      suprapubic, transverse                  patient's right            head to foot through the bladder
 *   pancreas     epigastric, transverse, tipped up       patient's right            tilting from the head of the gland to its tail
 *   breast       left breast, upper outer, radial plane    patient's right            none: held still (the cryoablation, a linear probe)
 *
 * A probe frame is the face centre on the skin (LPS mm), the beam direction (into the body) and the array axis (image +x), all unit
 * vectors, plus skin contact 0..1. Between views the probe glides over the skin to the next window (in contact when it is near, lifted
 * when it is far). Pure; the frame functions write into `out` and allocate nothing.
 */
import type { V3 } from './body'
import type { PatientParams } from './params'
import { outlineAt } from './regions/abdomen'

export type UsViewId = 'liver' | 'gallbladder' | 'kidneyR' | 'kidneyL' | 'spleen' | 'bladder' | 'pancreas' | 'breast'

export interface ProbeFrame {
  ox: number
  oy: number
  oz: number
  bx: number
  by: number
  bz: number
  ax: number
  ay: number
  az: number
  contact: number
}

export const newProbeFrame = (): ProbeFrame => ({ ox: 0, oy: 0, oz: 0, bx: 0, by: 1, bz: 0, ax: 1, ay: 0, az: 0, contact: 0 })

export interface ViewSpec {
  /** What the beam aims at (LPS mm). */
  target: V3
  /** The beam's direction at the middle of the sweep (unit, into the body). */
  beam: V3
  /** The direction the image's +x should point (made perpendicular to the beam). */
  array: V3
  /** The sweep: the beam turns about the array axis from fan[0] to fan[1] degrees as `detail` runs 0 -> 1. */
  fan: [number, number]
  /** Imaging depth (mm). */
  depth: number
}

const unit = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** The view's aim on this patient. */
export function viewSpec(view: UsViewId, p: PatientParams): ViewSpec {
  switch (view) {
    case 'kidneyR':
      // from below the ribs, angled up toward the upper pole
      return { target: p.kidneyR.c, beam: unit([1, 0.42, 0.3]), array: [-p.kidneyR.axis[0], -p.kidneyR.axis[1], -p.kidneyR.axis[2]], fan: [-16, 16], depth: 140 }
    case 'kidneyL':
      return { target: p.kidneyL.c, beam: unit([-1, 0.55, 0.48]), array: [-p.kidneyL.axis[0], -p.kidneyL.axis[1], -p.kidneyL.axis[2]], fan: [-16, 16], depth: 140 }
    case 'liver':
      // right subcostal, a long-axis (sagittal-oblique) plane through the right lobe, the beam tipped up under the costal margin: the plane
      // runs between the ribs instead of along one (tuned over many patients for the most liver and the least rib in the fan)
      return { target: [p.liver.c[0] + 10, p.liver.c[1] - 6, p.liver.c[2] - 15], beam: unit([0.2, 0.9, 0.3]), array: [0.3, 0, 1], fan: [-14, 8], depth: 160 }
    case 'gallbladder': {
      const g = p.gallbladder
      return { target: g.c, beam: unit([0.25, 0.78, 0.55]), array: g.axis, fan: [-12, 12], depth: 140 }
    }
    case 'spleen':
      // left flank at the posterior axillary line, a coronal-oblique long axis, the beam angled forward and up toward the hilum under the
      // lung base; 11-12 cm deep (tuned over many patients for the most spleen and the least rib and lung in the fan)
      return { target: [p.spleen.c[0], p.spleen.c[1] - 6, p.spleen.c[2] - 40], beam: unit([-1, -0.45, 0.55]), array: [0, 0.4, 1], fan: [-10, 10], depth: 115 }
    case 'pancreas': {
      // the epigastrium, a transverse plane with the beam going back and tipped up toward the head, so it passes under the stomach's air and
      // through the left lobe of the liver; the fan tilts it along the gland (the same body as phantom/regions/abdomen.ts: neck to tail)
      return { target: [14 * p.width, -14 * p.depth, 267 * p.height], beam: unit([0, 1, 0.35]), array: [1, 0, 0], fan: [-16, 6], depth: 130 }
    }
    case 'breast':
      // the left breast over the chest wall (the trunk outline at the level of the nipple line), the beam straight back, 5 cm deep; the
      // picture itself is the vector one (images/ultrasound.ts), this only puts the probe where it belongs
      return { target: [75 * p.width, -96 * p.depth, 470 * p.height], beam: [0, 1, 0], array: [1, 0, 0.35], fan: [0, 0], depth: 50 }
    case 'bladder': {
      const f = Math.cbrt(p.bladderFill)
      return { target: [0, (-36 + 6 * (1 - f)) * p.depth, (28 + 20 * f) * p.height], beam: unit([0, 0.86, -0.5]), array: [1, 0, 0], fan: [-15, 15], depth: 140 }
    }
  }
}

/** Is a patient point inside the trunk's outline (the analytic outline the body's skin is built from)? */
function insideOutline(p: PatientParams, l: number, pp: number, s: number): boolean {
  const [a, b] = outlineAt(p, s)
  return (l / a) * (l / a) + (pp / b) * (pp / b) <= 1
}

/** Distance from `from` back along `-dir` to the skin (mm): a march then a bisection on the analytic outline. */
export function distanceToSkin(p: PatientParams, from: V3, dir: V3): number {
  let t = 0
  const step = 4
  while (t < 600 && insideOutline(p, from[0] - dir[0] * t, from[1] - dir[1] * t, from[2] - dir[2] * t)) t += step
  let lo = Math.max(0, t - step)
  let hi = t
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2
    if (insideOutline(p, from[0] - dir[0] * mid, from[1] - dir[1] * mid, from[2] - dir[2] * mid)) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** How far the face is pressed into the skin when in contact (mm). */
export const PRESS_MM = 3

/**
 * The probe's frame for a view at sweep position `detail` (0..1), with an extra out-of-plane rock (degrees) and skin contact. The face stays on
 * its window; the beam fans about the array axis.
 */
export function viewFrame(spec: ViewSpec, p: PatientParams, detail: number, rockDeg: number, contact: number, out: ProbeFrame): ProbeFrame {
  // the array axis, perpendicular to the beam
  const b0 = spec.beam
  const hint = spec.array
  const hb = hint[0] * b0[0] + hint[1] * b0[1] + hint[2] * b0[2]
  let ax = hint[0] - hb * b0[0]
  let ay = hint[1] - hb * b0[1]
  let az = hint[2] - hb * b0[2]
  const al = Math.sqrt(ax * ax + ay * ay + az * az) || 1
  ax /= al
  ay /= al
  az /= al
  // the window: back from the target along the middle beam to the skin
  const t = distanceToSkin(p, spec.target, b0)
  const press = PRESS_MM * contact
  out.ox = spec.target[0] - b0[0] * (t - press)
  out.oy = spec.target[1] - b0[1] * (t - press)
  out.oz = spec.target[2] - b0[2] * (t - press)
  // fan about the array axis: b = b0 cos f + (a x b0) sin f
  const d = detail < 0 ? 0 : detail > 1 ? 1 : detail
  const f = ((spec.fan[0] + (spec.fan[1] - spec.fan[0]) * d + rockDeg) * Math.PI) / 180
  const cf = Math.cos(f)
  const sf = Math.sin(f)
  const cx = ay * b0[2] - az * b0[1]
  const cy = az * b0[0] - ax * b0[2]
  const cz = ax * b0[1] - ay * b0[0]
  out.bx = b0[0] * cf + cx * sf
  out.by = b0[1] * cf + cy * sf
  out.bz = b0[2] * cf + cz * sf
  out.ax = ax
  out.ay = ay
  out.az = az
  out.contact = contact
  return out
}

/** The point of the outline's surface in the direction (l, pp) from the body's axis at height s. */
function onSkin(p: PatientParams, l: number, pp: number, s: number, out: ProbeFrame): void {
  const r = Math.hypot(l, pp) || 1
  const rl = l / r
  const rp = pp / r
  const [a, b] = outlineAt(p, s)
  const k = 1 / Math.sqrt((rl / a) * (rl / a) + (rp / b) * (rp / b))
  out.ox = rl * k
  out.oy = rp * k
  out.oz = s
}

/** Windows closer than this (mm) are reached by gliding in contact; farther ones by lifting the probe. */
export const GLIDE_MM = 140

/**
 * The probe between two views: `g` 0..1 from the end frame of one view to the start frame of the next. The face slides over the skin (the
 * straight line between the windows pushed out onto the outline), the beam and array turn smoothly (blended, then made orthonormal again),
 * and contact holds when the windows are near or lifts in the middle of a far move.
 */
export function blendFrames(a: ProbeFrame, b: ProbeFrame, g: number, p: PatientParams, out: ProbeFrame): ProbeFrame {
  const k = g < 0 ? 0 : g > 1 ? 1 : g
  const e = k * k * (3 - 2 * k)
  // round the trunk by the angle about its axis (0 over the belly, +/- pi/2 at the flanks), so a move from one flank to the other goes
  // over the front of a patient lying on their back, never under them
  const fa = Math.atan2(a.ox, -a.oy)
  const fb = Math.atan2(b.ox, -b.oy)
  const phi = fa + (fb - fa) * e
  const s = a.oz + (b.oz - a.oz) * e
  const dist = Math.hypot(b.ox - a.ox, b.oy - a.oy, b.oz - a.oz)
  onSkin(p, Math.sin(phi), -Math.cos(phi), s, out)
  const far = dist > GLIDE_MM
  const lift = far ? Math.sin(Math.PI * k) : 0
  out.contact = Math.min(a.contact, b.contact) * (1 - lift)
  // lift the face off the skin along the outward normal while hovering
  const r = Math.hypot(out.ox, out.oy) || 1
  out.ox += (out.ox / r) * 40 * lift
  out.oy += (out.oy / r) * 40 * lift
  // beam and array: blend, normalise, then make the array perpendicular to the beam
  let bx = a.bx + (b.bx - a.bx) * e
  let by = a.by + (b.by - a.by) * e
  let bz = a.bz + (b.bz - a.bz) * e
  const bl = Math.sqrt(bx * bx + by * by + bz * bz) || 1
  bx /= bl
  by /= bl
  bz /= bl
  let ax = a.ax + (b.ax - a.ax) * e
  let ay = a.ay + (b.ay - a.ay) * e
  let az = a.az + (b.az - a.az) * e
  const ab = ax * bx + ay * by + az * bz
  ax -= ab * bx
  ay -= ab * by
  az -= ab * bz
  const al = Math.sqrt(ax * ax + ay * ay + az * az) || 1
  out.bx = bx
  out.by = by
  out.bz = bz
  out.ax = ax / al
  out.ay = ay / al
  out.az = az / al
  return out
}
