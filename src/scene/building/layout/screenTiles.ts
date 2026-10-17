/**
 * The shared screen atlas, as data: which tile is which. The pictures are drawn once into ONE canvas (render/screens.ts)
 * and every screen in the building (bedside, desks, kiosks, monitors) is a quad that shows one tile.
 */
export const TILE = {
  bedside: 0, // patient room: today's plan, soft teal
  vitals: 1, // bedside / trolley monitor: trace + numbers
  chart: 2, // nurse and doctor workstation
  kiosk: 3, // self check-in
  reception: 4, // reception display
  lab: 5, // analyser / lab bench screen
  list: 6, // coordinator desk: order list
  map: 7, // coordinator desk: mini map
  console: 8, // scanner console
  menu: 9, // café menu board
  directory: 10, // lobby directory
  idle: 11, // dark, almost off
} as const

export type TileName = keyof typeof TILE
export const TILE_COUNT = 12
export const ATLAS_COLS = 4
export const ATLAS_ROWS = 3
