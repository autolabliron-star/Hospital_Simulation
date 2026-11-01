/**
 * R5 wave 2 (agent H): where the ports are on the body, for the marks: the case's layout (places.ts `SURGERY.ports`) and the 12 mm assistant port (the procedure engine's own
 * `resolveTarget`, so the marks and the hands agree). Sites are BODY-frame (d, x): `d` from the pelvis centre of the position the layout is made for (the transverse line
 * of the pelvic cases for a patient in lithotomy, the oblique one of the gallbladder for a supine patient), so a mark rides the body when the patient is moved (the
 * wake-up lowers the legs: the dressings go back with the pelvis).
 */
import { PELVIS_ON_TABLE } from '@/sim/procedure/body'
import { SURGERY, type PortLayout } from '@/sim/places'
import { newTargetCtx, resolveTarget, setTable } from '@/sim/procedure'
import type { PatientPosition, Vec3 } from '@/sim/types'

/** The position each layout is laid out for (places.ts: the transverse ports sit for a patient slid 0.3 m down the table in lithotomy). */
export const LAYOUT_POSITION: Record<PortLayout, PatientPosition> = { oblique: 'supine', transverse: 'lithotomy' }

const ctx = newTargetCtx('oblique')
const tmp: Vec3 = { x: 0, y: 0, z: 0 }

/** Write the five sites (body-frame d, then x) into `out` (10 numbers): four robot ports then the assistant's. */
export function portSitesInto(layout: PortLayout, out: Float64Array): void {
  const ports = SURGERY.ports[layout]
  const t = SURGERY.table
  const pelvis = PELVIS_ON_TABLE[LAYOUT_POSITION[layout]]
  for (let i = 0; i < 4; i++) {
    out[i * 2] = ports[i].z - t.at.z - pelvis
    out[i * 2 + 1] = ports[i].x - t.at.x
  }
  ctx.layout = layout
  setTable(ctx, 0, 0, LAYOUT_POSITION[layout])
  resolveTarget('assistantPort', ctx, tmp)
  out[8] = tmp.z - t.at.z - pelvis
  out[9] = tmp.x - t.at.x
}
