/**
 * R2: `<LevelGroup level={1}>` wraps the rigs that exist on one level only, so they hide while the screen shows the other one (levelGroups.ts has the
 * rule). A plain identity group: nothing inside moves, nothing is rebuilt, and a hidden group costs no draw call and compiles no new program (the
 * warm-up has seen everything visible once). Level 1's static building and the landscape are NOT wrapped: they are needed outside level 2's windows.
 */
import { useEffect, useRef, type ReactNode } from 'react'
import type { Group } from 'three'
import type { LevelId } from '@/sim/levels'
import { registerLevelGroup } from './levelGroups'

export function LevelGroup({ level, name, children }: { level: LevelId; name?: string; children: ReactNode }) {
  const ref = useRef<Group>(null)
  useEffect(() => {
    const g = ref.current
    return g ? registerLevelGroup(level, g) : undefined
  }, [level])
  return (
    <group ref={ref} name={name ?? `level-${level}-rigs`}>
      {children}
    </group>
  )
}
