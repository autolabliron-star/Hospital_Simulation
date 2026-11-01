/**
 * R5 wave 3 (agent J): the sheet's lattice, as numbers (sheet.ts builds on it; window.ts places the window on it): cross-sections every 4 cm along the table, columns every 2.5 cm across
 * (NC of them either side of the middle) and a hang of HANG_N more at each side.
 */
export const SHEET_STEP = 0.04
export const COL_STEP = 0.025
/** Lattice columns either side of the middle (x up to NC * COL_STEP) and the hang's. */
export const NC = 17
export const HANG_N = 5
export const SHEET_COLS = 2 * NC + 1 + 2 * HANG_N
