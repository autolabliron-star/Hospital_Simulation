/**
 * The console card's picture: a 768 x 432 (16:9, hi-DPI) canvas repainted at 12 Hz, ONLY while the card is open. It shows the same endoscope picture as the
 * OR's screens (src/scene/surgery/endoscope.ts over endo/: the procedure's lit tissue, the arms' real instruments moving with `tipMotion`, the in-image HUD;
 * clean, no blood, no cuts) while the camera is live, and the dim standby screen before that (painted once per robot phase). The class only touches the canvas
 * API through the imaging suite's `Ctx2D`, so it runs against a recording context in node.
 */
import { SURGERY_COPY } from '@/content/surgery'
import { SURGERY_UI } from '@/content/surgeryUi'
import type { Ctx2D } from '@/scene/imaging/images/ctx'
import { EndoPainter, fillEndoView, newEndoView, paintStandby, type EndoView } from '@/scene/surgery/endoscope'
import { cameraLive } from '@/scene/surgery/liveEndoscope'
import type { SurgeryState } from '@/sim/types'

export const CARD_W = 768
export const CARD_H = 432
/** The picture repaints this often (ms) while the card is open: a 12 Hz timer drives it (a tick a hair early still paints, so timer jitter never halves the rate). */
export const CARD_MS = 1000 / 12

export class ConsoleCanvas {
  /** Paints so far (for the tests). */
  paints = 0
  private lastDraw = -1e9
  private lastT = Number.NaN
  private lastKey = ''
  private lastLive = false
  private readonly view: EndoView = newEndoView()
  private readonly painter = new EndoPainter(CARD_W, CARD_H)

  constructor(private readonly ctx: Ctx2D) {}

  /**
   * Call on a 12 Hz timer or every frame: it paints when due. A live picture repaints when the sim clock moved (a paused demo holds the frame); the standby
   * screen only when the robot's phase changed. Returns whether it painted.
   */
  update(s: Readonly<SurgeryState>, simT: number, nowMs: number): boolean {
    const robot = s.robot
    if (cameraLive(robot)) {
      if (this.lastLive && (nowMs - this.lastDraw < CARD_MS * 0.8 || simT === this.lastT)) return false
      fillEndoView(s, simT, this.view)
      this.painter.paint(this.ctx, this.view)
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
