/**
 * The da Vinci endoscope picture (R3): a facade over src/scene/surgery/endo/, which paints it. ONE painter serves every screen that shows the camera: the
 * shared 384 x 216 live texture (the vision cart's monitor, the wall monitor and the two console viewers: liveEndoscope.ts) and the 768 x 432 canvas of the
 * console card (src/ui/walk/consoleCard.canvas.ts).
 *
 * The picture is full-frame 16:9 and photo-like but clean: a lit tissue plate per procedure (baked at load behind the loading screen: endo/plates.ts), real
 * instruments for whatever each arm holds (endo/looks.ts, endo/sprites.ts), the camera's pan and zoom from arm 2's tip motion and the breathing, wet
 * highlights that slide, tissue tenting under closed graspers, the lamp's falloff, and the console's HUD in the image (endo/hud.ts). Never blood, never a
 * cut: every plate pixel goes through `safeTissue` (endo/noBlood.ts). It is a pure function of the view (endo/view.ts): the same view paints the same
 * picture, and the tools move with `tipMotion` (robotPose.ts), the same small seeded moves the 3D arms make.
 */
export { EndoPainter, paintEndoscope, paintStandby, painterFor } from './endo/paint'
export { newTip, RIG, tipOnScreen, TOOL, type TipOnScreen } from './endo/frame'
export { fillEndoView, INSTRUMENT_ARMS, newEndoView, setProcedureLooks, withdrawOf, type EndoView } from './endo/view'
export { bakeEndoPlatesNow, endoPlates, ensureEndoPlates } from './endo/plates'
