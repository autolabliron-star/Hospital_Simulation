/**
 * R5 wave 2 (agent H): the anaesthetic screen. The sheet's neck edge (sheet.ts, the first cross-section) rises vertically on a drape bar, so the anaesthetist's head end is
 * separated from the field. Two layers back to back (seen from both sides), a gentle billow toward the head, the bar across the top and an upright either side.
 */
import { COLOUR } from './colors'
import { HANG_BOTTOM } from './frame'
import { addBox, addGrid, addVert, setColour, type StageMesh } from './mesh'
import { HEAD_H, HEAD_X, SHEET_B0, SHEET_COLS } from './sheet'

/** How far the screen rises over the sheet's neck edge at full height (metres), and the bar's section. */
export const SCREEN_RISE = 0.45
const BAR = 0.011
/** Rows up the screen. */
const ROWS = 6
/** The screen spans the sheet's top columns, x -0.4..0.4: columns 6..32 of the cross-section (sheet.ts: six hang columns first). */
const C0 = 6
const C1 = SHEET_COLS - 6
const BILLOW = 0.02

/** The screen rises by `rise01` of its full height (0: nothing is added). Call right after `buildSheet` wrote the neck cross-section. */
export function buildScreen(m: StageMesh, pelvisD: number, rise01: number): void {
  if (rise01 < 0.02) return
  const dHead = SHEET_B0 + pelvisD
  const mid = (C0 + C1 - 1) >> 1
  const hTop = HEAD_H[mid] + SCREEN_RISE * rise01
  const cols = C1 - C0
  for (let layer = 0; layer < 2; layer++) {
    setColour(m, COLOUR.screen)
    const v0 = m.nv
    for (let r = 0; r < ROWS; r++) {
      const t = r / (ROWS - 1)
      const bow = BILLOW * Math.sin(Math.PI * t * rise01)
      for (let c = C0; c < C1; c++) {
        const x = HEAD_X[c]
        const s = x / 0.4
        const h = HEAD_H[c] + (hTop - HEAD_H[c]) * t
        addVert(m, dHead - bow * (1 - s * s), x, h)
      }
    }
    // rows run up and columns across: the default front looks toward the head (-d); the second layer faces the field
    addGrid(m, v0, ROWS, cols, layer === 1, null)
  }
  // the bar and its uprights, outside the sheet's hang
  setColour(m, COLOUR.bar)
  const dBar = dHead - 0.012
  addBox(m, dBar - BAR, dBar + BAR, -0.47, 0.47, hTop, hTop + 2 * BAR)
  addBox(m, dBar - BAR, dBar + BAR, 0.47 - BAR, 0.47 + BAR, HANG_BOTTOM + 0.25, hTop)
  addBox(m, dBar - BAR, dBar + BAR, -0.47 - BAR, -0.47 + BAR, HANG_BOTTOM + 0.25, hTop)
}
