/**
 * What the Pharmacy Core draws, as a budget: one line per mesh with the real geometry and instance counts the
 * components use. The budget test sums this with the robots' and the drawers' manifests.
 */
import { BoxGeometry, PlaneGeometry } from 'three'
import { budgetLine, type BudgetLine } from '@/scene/robots/budget'
import { buildCoreStatic, type CorePartKey } from './coreParts'
import { flapGeometry, portGlowGeometry, rankGlowGeometry } from './dockParts'
import { BARS_PER_LEAF, DESKS, DOCKS, OPENINGS, PORTALS, RANK_SLOTS, WARDS } from './layout'
import { binGeometry, binInstances, GANTRY_INSTANCES, packGeometry, packInstances } from './medvendParts'

/** Static parts that cast into the baked shadow map (rendered once, not per frame). */
export const CORE_SHADOW_CASTERS: CorePartKey[] = ['frame', 'white', 'wood', 'metal']

export function pharmacyBudget(): BudgetLine[] {
  const lines: BudgetLine[] = []
  const core = buildCoreStatic()
  for (const [key, g] of Object.entries(core.geometries)) {
    lines.push(budgetLine(`core.${key}`, g))
    g.dispose()
  }
  const unit = new BoxGeometry(1, 1, 1)
  const leaf = new PlaneGeometry(1, 1)
  const bin = binGeometry()
  const pack = packGeometry()
  const portGlow = portGlowGeometry()
  const rankGlow = rankGlowGeometry()
  const flap = flapGeometry()
  lines.push(budgetLine('medvend.bins', bin, binInstances().length))
  lines.push(budgetLine('medvend.packs', pack, packInstances().length))
  // the pickers' parts and the four transfer-tray plates share one mesh
  lines.push(budgetLine('medvend.gantry', unit, GANTRY_INSTANCES))
  lines.push(budgetLine('medvend.carriageLights', unit, WARDS.length))
  lines.push(budgetLine('docks.portLights', portGlow, DOCKS.length))
  lines.push(budgetLine('rank.contactGlow', rankGlow, RANK_SLOTS.length * 2))
  lines.push(budgetLine('portals.flaps', flap, PORTALS.length * 2))
  lines.push(budgetLine('doors.glass', leaf, OPENINGS.length * 2))
  lines.push(budgetLine('doors.bars', unit, OPENINGS.length * 2 * BARS_PER_LEAF))
  lines.push(budgetLine('desks.displays', unit, DESKS.length))
  for (const g of [unit, leaf, bin, pack, portGlow, rankGlow, flap]) g.dispose()
  return lines
}
