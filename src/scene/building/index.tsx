import { BuildingMeshes } from './render/BuildingMeshes'
import { WalkBuilding } from './render/walk/WalkBuilding'

/**
 * The building: floors, walls at the section cut, glazing, smart patient rooms, nurse hubs, command center, atrium,
 * lobby, triage and ER, diagnostics, side rooms, the landscape plinth, wayfinding lines and floor labels.
 * All of it is static, procedural and built once (see ./layout for the pure, node-tested data and ./render for the meshes).
 *
 * W1 walk-in: `WalkBuilding` adds what closes around you at eye level (upper walls, ceilings, door leaves that open, hanging signs
 * and door plates). It is built once too, hidden in the overview, and shown by `visible` alone whenever you are not in the overview.
 */
export function Building() {
  return (
    <>
      <BuildingMeshes />
      <WalkBuilding />
    </>
  )
}
