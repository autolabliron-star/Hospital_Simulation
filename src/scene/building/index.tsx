import { lazy, Suspense, useEffect, useSyncExternalStore } from 'react'
import { useThree } from '@react-three/fiber'
import { registerWarmGate } from '@/scene/warmup/registry'
import { bindCellsUnder } from './model/cells'
import { BUILDING_MODEL_ON } from './model/flags'
import { BuildingModel } from './model/PilotModel'
import { getBuildingSource, getManifest, startBuildingSource, subscribeBuildingSource } from './model/source'
import { ZonesModel } from './model/ZonesModel'
import { SPLAT_ZONE } from './splat/flags'
import { BuildingMeshes } from './render/BuildingMeshes'
import { Level2Building } from './render/Level2Building'
import { RoofCap } from './render/RoofCapLayer'
import { WalkBuilding } from './render/walk/WalkBuilding'

// the authored building (the default; `?building=procedural` opts out): decide at once between the zone manifest and the pilot
if (BUILDING_MODEL_ON) void startBuildingSource(import.meta.env.BASE_URL)

// the splat pilot (./splat, paused) is off by default: Spark (about 2.6 MB) loads only when `?splat=` asks for it, behind the warm-up
const splatModule = SPLAT_ZONE === null ? null : import('./splat/SplatZone')
if (splatModule !== null) registerWarmGate('splat-module', splatModule)
const SplatZone = lazy(() => (splatModule ?? import('./splat/SplatZone')).then((m) => ({ default: m.SplatZone })))

/** Finds the procedural building's per-zone cell meshes (`|cell=<id>`) once they are in the scene (an effect after its earlier siblings'). */
function CellBinder() {
  const scene = useThree((s) => s.scene)
  useEffect(() => bindCellsUnder(scene), [scene])
  return null
}

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
 *
 * The authored building (./model): the source is decided first (./model/source.ts: the zone manifest, else the pilot lobby), because it picks
 * which procedural prims go into per-zone cell meshes (./model/region.ts) before the procedural building compiles; the procedural building
 * mounts once that is known (one small fetch, behind the loading screen). Each cell is drawn until its zone's model is, so a zone that is
 * still streaming or failed keeps its procedural region and nothing is ever rebuilt (F-45, per zone).
 */
export function Building() {
  const source = useSyncExternalStore(subscribeBuildingSource, getBuildingSource)
  if (source === 'pending') return <RoofCap />
  const manifest = source === 'zones' ? getManifest() : null
  return (
    <>
      <BuildingMeshes />
      <WalkBuilding />
      <Level2Building />
      <RoofCap />
      {source !== 'procedural' && <CellBinder />}
      {source === 'pilot' && <BuildingModel />}
      {manifest && <ZonesModel manifest={manifest} />}
      {manifest && SPLAT_ZONE !== null && (
        <Suspense fallback={null}>
          <SplatZone zone={SPLAT_ZONE} />
        </Suspense>
      )}
    </>
  )
}
