/**
 * R3 "Real screens": the probe as the room shows it (smoothed by the rig), in the patient's frame, for the ultrasound screen to image. The
 * rig writes it every frame it animates the probe; the screen reads it when it asks the worker for a picture, so the picture shows exactly
 * what is under the probe you see. A plain shared object (no React, no allocation).
 */
import { newProbeFrame } from '../phantom/usViews'

export const probeLive = {
  /** The smoothed probe frame (LPS mm, unit beam and array axes, contact 0..1). */
  frame: newProbeFrame(),
  /** The exam it belongs to (null: parked, or no exam). */
  examId: null as string | null,
  /** True while the probe is in the sonographer's hand. */
  active: false,
  /** Bumped on every write (a screen can tell a stale pose). */
  version: 0,
}
