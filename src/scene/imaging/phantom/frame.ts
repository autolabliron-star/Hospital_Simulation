/**
 * R3 "Real screens": where the synthetic body lies in the hospital. The patient on the ultrasound couch lies on their back with the head
 * toward +z (south) and their right side toward +x (the sonographer's side), hips on the couch's seat point; so a patient point (LPS mm,
 * body.ts) maps to the world (metres) as
 *
 *     x = couch.x - L / 1000        y = mattress + (pBack - P) / 1000        z = couch.z + (S + sOffset) / 1000
 *
 * `COUCH_FIT` is the one calibration between the synthetic body and the avatar lying there (tuned in the browser so the probe meets the
 * avatar's skin). Pure; allocation-free (results go into `out`).
 */
import { IMAGING } from '@/sim/places'

const US = IMAGING.us

export const COUCH_FIT = {
  /** Height of the mattress the back rests on (m). */
  mattress: US.table.height,
  /** The back's P (mm) at the mattress: the posterior skin of the trunk's outline. */
  pBack: 104,
  /** Head-foot offset between the synthetic hips and the couch's seat point (mm). */
  sOffset: 0,
} as const

export interface Xyz {
  x: number
  y: number
  z: number
}

/** A patient point (LPS mm) on the ultrasound couch, in world metres. */
export function couchToWorld(l: number, p: number, s: number, out: Xyz): Xyz {
  out.x = US.table.out.x - l / 1000
  out.y = COUCH_FIT.mattress + (COUCH_FIT.pBack - p) / 1000
  out.z = US.table.out.z + (s + COUCH_FIT.sOffset) / 1000
  return out
}

/** A world point (metres) near the couch, in patient millimetres. */
export function worldToCouch(x: number, y: number, z: number, out: Xyz): Xyz {
  out.x = (US.table.out.x - x) * 1000
  out.y = COUCH_FIT.pBack - (y - COUCH_FIT.mattress) * 1000
  out.z = (z - US.table.out.z) * 1000 - COUCH_FIT.sOffset
  return out
}

/** A patient direction as a world direction (no translation, no scaling: both frames are orthonormal). */
export function couchDirToWorld(dl: number, dp: number, ds: number, out: Xyz): Xyz {
  out.x = -dl
  out.y = -dp
  out.z = ds
  return out
}
