/**
 * The console card's picture: a 384 x 240 canvas repainted at 12 Hz, ONLY while the card is open. It shows the same stylised endoscope view as the OR's screens
 * (src/scene/surgery/endoscope.ts: a soft warm field, metal instrument tips with jaws that open and close with `tipMotion`, a round vignette: no blood, no
 * incisions) while the camera is live, and the dim standby screen before that (painted once per robot phase). The class only touches the canvas API through the
 * imaging suite's `Ctx2D`, so it runs against a recording context in node.
 */
import { SURGERY_COPY } from '@/content/surgery'
import { SURGERY_UI } from '@/content/surgeryUi'
import type { Ctx2D } from '@/scene/imaging/images/ctx'
import { paintEndoscope, paintStandby, type EndoView } from '@/scene/surgery/endoscope'
import { cameraLive } from '@/scene/surgery/liveEndoscope'
import { motionGain } from '@/scene/surgery/robotPose'
import type { RobotState } from '@/sim/types'

export const CARD_W = 384
export const CARD_H = 240
/** The picture repaints this often (ms) while the card is open: a 12 Hz timer drives it (a tick a hair early still paints, so timer jitter never halves the rate). */
export const CARD_MS = 1000 / 12

export class ConsoleCanvas {
  /** Paints so far (for the tests). */
  paints = 0
  private lastDraw = -1e9
  private lastT = Number.NaN
  private lastKey = ''
  private lastLive = false
  private readonly view: EndoView = { seed: 0, t: 0, gain: 0 }

  constructor(private readonly ctx: Ctx2D) {}

  /**
   * Call on a 12 Hz timer or every frame: it paints when due. A live picture repaints when the sim clock moved (a paused demo holds the frame); the standby
   * screen only when the robot's phase changed. Returns whether it painted.
   */
  update(robot: Readonly<RobotState>, simT: number, nowMs: number): boolean {
    if (cameraLive(robot)) {
      if (this.lastLive && (nowMs - this.lastDraw < CARD_MS * 0.8 || simT === this.lastT)) return false
      this.view.seed = robot.motionSeed
      this.view.t = simT
      this.view.gain = motionGain(robot, simT)
      paintEndoscope(this.ctx, CARD_W, CARD_H, this.view)
      this.lastDraw = nowMs
      this.lastT = simT
      this.lastLive = true
      this.lastKey = ''
      this.paints++
      return true
    }
    if (!this.lastLive && this.lastKey === robot.phase) return false
    paintStandby(this.ctx, CARD_W, CARD_H, SURGERY_UI.console.endoscope, SURGERY_COPY.robotPhases[robot.phase])
    this.lastKey = robot.phase
    this.lastLive = false
    this.paints++
    return true
  }
}
