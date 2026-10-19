import { BuildingMeshes } from './render/BuildingMeshes'
import { Level2Building } from './render/Level2Building'
import { RoofCap } from './render/RoofCapLayer'
import { WalkBuilding } from './render/walk/WalkBuilding'

/**
 * The building: floors, walls at the section cut, glazing, smart patient rooms, nurse hubs, command center, atrium,
 * lobby, triage and ER, diagnostics, side rooms, the landscape plinth, wayfinding lines and floor labels.
 * All of it is static, procedural and built once (see ./layout for the pure, node-tested data and ./render for the meshes).
 *
 * W1 walk-in: `WalkBuilding` adds what closes around you at eye level (upper walls, ceilings, door leaves that open, hanging signs
 * and door plates). It is built once too, hidden in the overview, and shown by `visible` alone whenever you are not in the overview.
 *
 * R2 level 2: `Level2Building` is the robotic surgery storey (its cut shell and its own walk building) in one group 4.2 m up, hidden unless the
 * screen shows level 2 (`levelView`); `RoofCap` is the roof that closes the open-topped hospital below it while you walk on level 2.
 */
export function Building() {
  return (
    <>
      <BuildingMeshes />
      <WalkBuilding />
      <Level2Building />
      <RoofCap />
    </>
  )
}
