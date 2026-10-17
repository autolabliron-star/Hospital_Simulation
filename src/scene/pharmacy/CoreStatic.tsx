/**
 * The static scenery of the glass Pharmacy Core: polished floor (plain: no lane paint, pads or plates, the pods ride the
 * ceiling rail), four glass walls with their frames, the pharmacist door openings and the four rail portals near the top
 * of the corridor walls, the white MedVend casing with oak ends, the gantry rails, the top dock ports with their tray
 * cradles, the charging contacts on the overhead rank and the pharmacist desks. Eight merged meshes, one per palette
 * material, built once. The shadow map is baked once and re-rendered after this mounts (glass and the floor do not cast;
 * frames and casings do).
 */
import { useEffect, useMemo } from 'react'
import { invalidateShadows } from '@/scene/Lighting'
import { MAT } from '@/scene/materials'
import { buildCoreStatic } from './coreParts'

export function CoreStatic() {
  const core = useMemo(buildCoreStatic, [])
  useEffect(() => {
    invalidateShadows()
    return () => {
      for (const g of Object.values(core.geometries)) g.dispose()
    }
  }, [core])
  const g = core.geometries
  return (
    <group name="core-static">
      <mesh geometry={g.floor} material={MAT.floorCore} receiveShadow />
      <mesh geometry={g.frame} material={MAT.frame} castShadow receiveShadow />
      <mesh geometry={g.white} material={MAT.whitePlastic} castShadow receiveShadow />
      <mesh geometry={g.wood} material={MAT.woodOak} castShadow receiveShadow />
      <mesh geometry={g.metal} material={MAT.metalDark} castShadow />
      <mesh geometry={g.screen} material={MAT.screen} />
      <mesh geometry={g.glow} material={MAT.glowTeal} />
      <mesh geometry={g.glass} material={MAT.glass} renderOrder={3} />
    </group>
  )
}
