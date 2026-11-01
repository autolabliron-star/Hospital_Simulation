/**
 * R5 wave 3: the CT pictures of the cryo suite's three targets. The kidney's is the abdomen at the kidneys (ctPaint.ts paints it, unchanged). The lung's
 * and the liver's patients lie PRONE, so their pictures are a chest and an upper-abdomen slice turned half a turn, as a scanner shows a prone patient
 * (the table at the bottom of the picture): the back at the TOP, the spine under the top edge, the patient's right on the picture's RIGHT (it is the
 * supine slice with both axes reversed; `PRONE_FLIP` is the transform that does it).
 *
 *   lung   `chestAxial` at the lower chest: both lungs dark, the heart on the picture's left (the patient's left), the spine and the ribs, the tumour in
 *          the right lung, in the posterior chest
 *   liver  `abdomenAxial` at the liver, without the bowel (the upper abdomen has the liver, the stomach, the spleen and the kidneys' tops) and with the
 *          ribs round it and the lungs' lowest edge behind: the liver is the big organ on the picture's right, the tumour in its posterior part
 *
 * Both rest on the table's pad. Needle paths and the ice come from the sim relative to the tumour (mm, the picture's own axes: +x right, +y down, so
 * a needle's skin entry is up and to the right: through the back, from the robot's side), so `tumour` below is where the painters put its centre.
 * Everything here is pure and schematic: no blood, no red.
 */
import { abdomenAxial, chestAxial } from '@/scene/imaging/images/torso'
import { ell, line, type Prim, type SliceModel } from '@/scene/imaging/images/shapes'
import type { CtWindow } from '@/scene/imaging/images/tones'
import type { CryoTarget } from '@/sim/types'

/** Slice positions in the anatomy functions (chest: 0 apex .. 1 diaphragm; abdomen: 0 liver dome .. 1 bladder). */
export const LUNG_Z = 0.6
export const LIVER_Z = 0.18

/** The window of the lung picture: the lungs black, the vessels and the heart bright, fat and muscle apart, bone white. */
export const CHEST_WINDOW: CtWindow = { width: 1000, level: -200 }

export interface SliceSpec {
  /** The picture is the slice turned half a turn (the patient lies face down). */
  prone: boolean
  /** The tumour's centre in the picture's -1..1 square (x right, y down), AS SHOWN. */
  tumour: { x: number; y: number }
}

/**
 * Where the tumour is in each picture. The kidney's is the lateral lip of the left kidney (CRYO_IMAGE.tumour in ctPaint.ts, which this repeats so a
 * painter can look any target up). The lung's: in the right lung (the picture's right), 90 mm from the spine and 105 mm under the back's skin; the liver's: in
 * the posterior part of the right lobe, 90 mm lateral to the spine and 100 mm under the skin (CRYO_SUITE.targets in src/sim/places.ts).
 */
export const CRYO_SLICES: Readonly<Record<CryoTarget, SliceSpec>> = {
  kidney: { prone: false, tumour: { x: 0.52, y: 0.16 } },
  lung: { prone: true, tumour: { x: 0.5, y: -0.02 } },
  liver: { prone: true, tumour: { x: 0.5, y: -0.04 } },
}

/** The transform's linear part for a prone picture (a half turn of the supine slice): x -> -x, y -> -y about the square's centre. */
export const PRONE_FLIP = -1

/**
 * The table pad under the patient, touching the front of the body at supine `y` (in the supine slice's coordinates the anterior side is up, so the pad is
 * above the body there: turned, it is below), and the table's edge at the square's bottom.
 */
function pad(y: number): Prim[] {
  return [ell('cushion', 0, y, 0.62, 0.07, 0, 0.9), line('cushion', [-0.95, -0.97, 0.95, -0.97], 0.05, 0.7)]
}

/** The ribs round the upper abdomen's wall (a ring of small bones, the front and the spine's place left clear), as chestAxial's, on the abdomen's outline. */
function lowerRibs(): Prim[] {
  const out: Prim[] = []
  const n = 18
  for (let k = 0; k < n; k++) {
    const a = ((k + 0.5) / n) * Math.PI * 2
    // the front (a near 3/2 pi: y negative is anterior) and the back's middle (the spine's place) are clear
    if (Math.abs(Math.sin(a)) < 0.2 && Math.cos(a) < 0) continue
    if (Math.abs(Math.cos(a)) < 0.2 && Math.sin(a) > 0) continue
    const rx = 0.79
    const ry = 0.5
    const x = rx * Math.cos(a)
    const y = 0.03 + ry * Math.sin(a)
    const rot = Math.atan2(ry * Math.cos(a), -rx * Math.sin(a))
    out.push(ell('bone', x, y, 0.05, 0.026, rot, 1), ell('marrow', x, y, 0.034, 0.013, rot, 1))
  }
  return out
}

/** The chest slice of the lung case (supine coordinates; the painter turns it). */
export function lungSliceModel(seed: number): SliceModel {
  const m = chestAxial(seed, LUNG_Z)
  return { prims: [...m.prims, ...pad(-0.79)], marker: m.marker }
}

/** The upper-abdomen slice of the liver case (supine coordinates; the painter turns it). */
export function liverSliceModel(seed: number): SliceModel {
  const m = abdomenAxial(seed, LIVER_Z)
  // the flank colon and its gas are not at this level (the liver's dome is under the ribs)
  const kept = m.prims.filter((p) => p.t !== 'bowel' && !(p.t === 'air' && p.k === 'e' && Math.abs(p.cx) > 0.6))
  // the lungs' lowest edge lies behind the liver and the spleen: drawn before the first organ so the organs cover what overlaps
  const firstLiver = kept.findIndex((p) => p.t === 'liver')
  const at = firstLiver < 0 ? kept.length : firstLiver
  // (beside the spine, behind the organs and clear of the needles' way in from the back: the picture's upper right)
  const lungs: Prim[] = [ell('lung', -0.45, 0.4, 0.11, 0.15, 0.3), ell('lung', 0.45, 0.4, 0.11, 0.15, -0.3)]
  const prims = [...kept.slice(0, at), ...lungs, ...kept.slice(at), ...lowerRibs(), ...pad(-0.7)]
  return { prims, marker: m.marker }
}

/** The model of a prone target's slice (the lung's or the liver's). */
export function proneSliceModel(target: Exclude<CryoTarget, 'kidney'>, seed: number): SliceModel {
  return target === 'lung' ? lungSliceModel(seed) : liverSliceModel(seed)
}
