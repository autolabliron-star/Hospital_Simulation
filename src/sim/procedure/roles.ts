/**
 * R5: the step-by-step engine, part 5: who does what. The published view carries one `ProcRoleView` per role of the machine, in a fixed
 * order (`ROLES_BY_MACHINE`); the rooms' teams read them to decide where each person stands and what they do (a role with `anchor: null` has
 * no line in this unit, so the room's own routine takes over).
 */
import { ROLES_BY_MACHINE } from '@/content/procedures'
import type { ProcMachine, ProcRole, ProcRoleView } from '../types'
import type { CompiledRole, CompiledScript } from './script'

/** The role views of a machine, idle and unplaced, one per role in the machine's order (allocates: call once per view). */
export function newRoleViews(machine: ProcMachine): ProcRoleView[] {
  return ROLES_BY_MACHINE[machine].map((role) => ({ role, entityId: null, action: 'idle', left: 'none', right: 'none', anchor: null }))
}

/** The line of role number `r` (its index in `cs.roles`) at script step `step`, or null when it has none in the step's unit. */
export function roleLine(cs: CompiledScript, step: number, r: number): CompiledRole | null {
  return cs.roleAt[step][r]
}

/** The line of `role` at script step `step`, or null. (A lookup by name: for tests and the UI, not for the frame loop.) */
export function roleLineOf(cs: CompiledScript, step: number, role: ProcRole): CompiledRole | null {
  const r = cs.roles.indexOf(role)
  return r < 0 ? null : cs.roleAt[step][r]
}

/** Write script step `step`'s lines into `views` (same length and order as `cs.roles`). Allocation-free. */
export function applyRoleViews(views: ProcRoleView[], cs: CompiledScript, step: number): void {
  for (let r = 0; r < views.length; r++) {
    const v = views[r]
    const line = cs.roleAt[step][r]
    if (line === null) {
      v.action = 'idle'
      v.left = 'none'
      v.right = 'none'
      v.anchor = null
    } else {
      v.action = line.action
      v.left = line.left
      v.right = line.right
      v.anchor = line.anchor
    }
  }
}
