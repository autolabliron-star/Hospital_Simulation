/**
 * The roof cap (R2): a real roof over the open-topped model of level 1, so the hospital under you looks finished from the windows of level 2. Two meshes
 * (the deck, skirt and parapet in the building's own `wallCap` grey, and the atrium's glass skylight), built once at mount and hidden, shown only while
 * you walk on level 2 (render/levelVisibility.ts `roofCapVisible`), never casting into the baked sun shadow and never asking for a re-bake. They use palette
 * materials in the shadow flags the building already has (the grey receives, the glass does not), so the warm-up has nothing new to compile.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Mesh, type Group } from 'three'
import { levelView } from '@/scene/levels/levelView'
import { MAT } from '@/scene/materials'
import { sim } from '@/sim'
import { BUILDING_VISIBILITY_PRIORITY, roofCapVisible } from './levelVisibility'
import { compileRoofCap, disposeCap } from './roofCap'
import { isWalkMode } from './walk/modeSwitch'

function capMesh(geometry: NonNullable<ReturnType<typeof compileRoofCap>['body']>, material: Mesh['material'], name: string, receive: boolean): Mesh {
  const m = new Mesh(geometry, material)
  m.name = name
  m.castShadow = false
  m.receiveShadow = receive
  m.matrixAutoUpdate = false
  m.updateMatrix()
  return m
}

export function RoofCap() {
  const built = useMemo(() => {
    const compiled = compileRoofCap()
    const meshes: Mesh[] = []
    if (compiled.body) meshes.push(capMesh(compiled.body, MAT.wallCap, 'roof-cap', true))
    if (compiled.glass) {
      const glass = capMesh(compiled.glass, MAT.glass, 'roof-skylight', false)
      glass.renderOrder = 3
      meshes.push(glass)
    }
    return { compiled, meshes }
  }, [])
  const group = useRef<Group | null>(null)
  useEffect(() => () => disposeCap(built.compiled), [built])
  useFrame(() => {
    if (group.current) group.current.visible = roofCapVisible(isWalkMode(sim.player?.mode), levelView.shown)
  }, BUILDING_VISIBILITY_PRIORITY)
  return (
    <group name="roof-cap" ref={group} visible={false}>
      {built.meshes.map((m) => (
        <primitive key={m.name} object={m} />
      ))}
    </group>
  )
}
