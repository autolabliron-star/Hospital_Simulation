/**
 * R5 wave 3: the pose overlay of a person in the ultrasound room's ProSense case (the same fields the theatre's `Staffer` writes, src/sim/surgery/
 * actors.ts): `Entity.act` (the action, what is in each hand, the world point the hands work at, the stroke progress) and `Entity.lookAt` (the
 * eyes follow a point, but only when it is free or ours, so a glance at the player, reactions.ts, wins). One overlay per person for life: the
 * `StaffAct` and the gaze point are its own two objects, so showing and clearing allocate nothing.
 */
import type { Entity, ProcAction, StaffAct, ToolKind, Vec3 } from '../types'

export class ActOverlay {
  private readonly act: StaffAct = { action: 'idle', progress: 0, left: 'none', right: 'none', work: null }
  private readonly gaze: Vec3 = { x: 0, y: 0, z: 0 }

  /** The person does `action` now: tools in hand, hands at `work` (null: no point), eyes at `look` (null: free), strokes at `progress` 0..1. */
  show(e: Entity, action: ProcAction, left: ToolKind, right: ToolKind, progress: number, work: Vec3 | null, look: Vec3 | null): void {
    const a = this.act
    a.action = action
    a.progress = progress < 0 ? 0 : progress > 1 ? 1 : progress
    a.left = left
    a.right = right
    a.work = work
    e.act = a
    if (look !== null) {
      if (e.lookAt == null || e.lookAt === this.gaze) {
        this.gaze.x = look.x
        this.gaze.y = look.y
        this.gaze.z = look.z
        e.lookAt = this.gaze
      }
    } else if (e.lookAt === this.gaze) e.lookAt = null
  }

  /** Back to nothing (walking, between cases). Leaves an act or a gaze somebody else set alone. */
  clear(e: Entity): void {
    if (e.act === this.act) e.act = null
    if (e.lookAt === this.gaze) e.lookAt = null
  }

  /** Is this overlay's act on the entity now? (for tests) */
  shown(e: Entity): boolean {
    return e.act === this.act
  }
}
