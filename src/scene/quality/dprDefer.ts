/**
 * Deferring a pixel-ratio change while you walk (W3), as a pure state machine (no React, no three.js, no clock of its own: every call is
 * handed `now`), so every rule is proven under vitest in node.
 *
 * Why: changing the pixel ratio resizes the canvas and the composer's buffers, which is a hitch, and the picture changes sharpness in one
 * frame, which is a pop. In the overview nobody sees either; while you walk it is exactly the smoothness the walk work is for. So while
 * the player is walking and moving the change WAITS, and is applied the moment it cannot be seen as a hitch:
 *
 *   you stop            `stillFor` (seconds since your speed last exceeded 0.05 m/s, walkBody in src/scene/player/state.ts) reaches STILL_SECONDS;
 *   you leave walk mode the mode is anything but 'walk' (the overview, or the Tab flight: the camera is moving anyway);
 *   it has waited MAX_DEFER_MS  a ladder that needs the cheaper picture must get it even if you never stop (a run through the whole hospital).
 *
 * Until the player system has written `walkBody` at all (`live` false: the body is not there yet) you count as still. AO and fx changes are not
 * deferred: they are a uniform or an `enabled` flag, no buffer changes.
 */

import { presentActive } from '@/ui/present/presentation.store'

/** Still means this long without moving (seconds). */
export const STILL_SECONDS = 0.4
/** The longest a change waits (ms). */
export const MAX_DEFER_MS = 6000

export interface DprContext {
  /** The player's mode (`sim.player?.mode`): only 'walk' defers. */
  mode: string | undefined
  /** `walkBody.live`. */
  live: boolean
  /** `walkBody.stillFor`. */
  stillFor: number
}

export type DprDecision = 'none' | 'apply' | 'wait'

export class DprDeferral {
  /** When the current wait began (ms), or -1 when nothing waits. */
  private since = -1

  constructor(
    private readonly stillSeconds = STILL_SECONDS,
    private readonly maxDeferMs = MAX_DEFER_MS,
    /** Presentation mode counts as moving (F-41): its camera glides, and a canvas resize in a shot is a hitch the audience sees. */
    private readonly presenting: () => boolean = presentActive,
  ) {}

  get waiting(): boolean {
    return this.since >= 0
  }

  /** Is the player walking and moving, or presenting? (A body that is not live yet is not moving.) */
  moving(ctx: DprContext): boolean {
    if (this.presenting()) return true
    return ctx.mode === 'walk' && ctx.live && ctx.stillFor < this.stillSeconds
  }

  /**
   * `current` is the pixel ratio the renderer has, `want` the one the rung asks for. 'none': they agree. 'apply': change it now. 'wait': keep
   * the current one and ask again later (a poll of about 100 ms is plenty). Allocation-free.
   */
  decide(current: number, want: number, ctx: DprContext, now: number): DprDecision {
    if (current === want) {
      this.since = -1
      return 'none'
    }
    if (!this.moving(ctx)) {
      this.since = -1
      return 'apply'
    }
    if (this.since < 0) this.since = now
    if (now - this.since >= this.maxDeferMs) {
      this.since = -1
      return 'apply'
    }
    return 'wait'
  }

  /** Forget a wait (a new page, a test). */
  reset(): void {
    this.since = -1
  }
}
