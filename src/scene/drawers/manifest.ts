/** What the drawers draw, as a budget (see pharmacy/manifest.ts). */
import { BoxGeometry } from 'three'
import { budgetLine, type BudgetLine } from '@/scene/robots/budget'
import { ROOMS } from '@/sim/places'
import { buildCabinets, drawerGeometry, shellWithClosedHatches, SLOTS_PER_DRAWER } from './cabinet'
import { buildChuteGlass, buildChuteHardware, funnelGeometry } from './chute'
import { PACK_POOL } from './packFlight'

/** Static parts that cast into the baked shadow map. */
export const DRAWER_SHADOW_CASTERS = ['drawers.shell', 'drawers.cap']

/**
 * The W2 chutes and funnels on their own: the glass tubes, the white hardware (plates, clamps, hinge arms) and the 16 funnel
 * trays. The chute glow strips and the packs in flight are extra instances of the light and pack meshes below, so they add
 * no draw call. Budget (docs/W2-CEILING-RAIL.md): at most 3 draw calls and 12 k triangles.
 */
export function chutesBudget(): BudgetLine[] {
  const glass = buildChuteGlass()
  const hardware = buildChuteHardware()
  const funnel = funnelGeometry()
  const lines = [budgetLine('chutes.glass', glass), budgetLine('chutes.hardware', hardware), budgetLine('chutes.funnels', funnel, ROOMS.length)]
  for (const g of [glass, hardware, funnel]) g.dispose()
  return lines
}

export function drawersBudget(): BudgetLine[] {
  const cabinets = buildCabinets()
  const drawer = drawerGeometry()
  const unit = new BoxGeometry(1, 1, 1)
  const n = ROOMS.length
  const shell = shellWithClosedHatches(cabinets.shell)
  const lines = [
    budgetLine('drawers.shell', shell),
    budgetLine('drawers.cap', cabinets.cap),
    budgetLine('drawers.slots', cabinets.slots),
    ...chutesBudget(),
    budgetLine('drawers.drawers', drawer, n),
    // the tray packs plus the pool of packs in flight down the chutes
    budgetLine('drawers.packs', unit, n * SLOTS_PER_DRAWER + PACK_POOL),
    // two status lights per cabinet plus one chute glow strip per room
    budgetLine('drawers.lights', unit, n * 3),
  ]
  for (const g of [shell, cabinets.cap, cabinets.slots, drawer, unit]) g.dispose()
  return lines
}
