// Template from Waltz City (src/scene/camera/frameOrder.ts). Proven in production there; adjust the imports and names to your project.
/**
 * The order of one frame, written down. `PowerLoop` calls R3F's `advance()` once per drawn frame; R3F runs every `useFrame`
 * callback in ascending priority (callbacks of equal priority run in the order they mounted, a child's before its parent's), then
 * draws. A priority ABOVE zero takes the drawing over (postprocessing's EffectComposer does, at 1), so every number here that is
 * ours stays at or below zero.
 *
 *   -100  SimLoop             entities (people, cars) interpolated to this frame                  src/sim/SimLoop.ts
 *    -99  L1 ward layers      MealBots, trays, backrests, bedside screens, door tiles (sim + 1)   src/scene/meals
 *    -98  daylight driver     sun colour/intensity, sky, glass, night lights at 1 Hz (sim + 2)    src/scene/daylight
 *    -97  environment swap    the walk look's hospital environment or the overview's room (W3)    src/scene/Lighting.tsx
 *    -96  grade               the LUT and vignette strengths, written only on change (W3)       src/scene/Effects.tsx
 *    -11  doors               walk and pharmacist doors sense people and you, step their openings, src/scene/building/render/walk,
 *                             publish their leaves as blockers (W3: before you move)            src/scene/pharmacy/PharmacistDoors.tsx
 *    -10  Player             you move, the avatar is placed, then THE CHASE CAMERA (W1 walk-in)   src/scene/player/index.tsx
 *   -9.5  levels              R2: which level is shown (your level, the overview switch), set     src/scene/levels
 *                             once you have moved and before anything draws or picks by level
 *     -9  tour director       scripted camera shots; the room-focus flights (tickFlight)         src/scene/tour/index.tsx
 *     -8  interaction         pick what you face, the E prompt, the objective, the seated pose    src/scene/interact/index.tsx
 *     -5  celebration         closing-day effects                                                src/scene/celebration/index.tsx
 *     -1  CameraControls      the overview camera rig (RigControls.update; a no-op in walk)       drei, fixed at -1
 *   -0.5  label anchors       name tag lift and visibility, speech bubble positions (THIS FILE)   NameTag.tsx, SpeechBubbles.tsx
 *   -0.3  imaging images      live scan canvases (4 Hz in the focused room, 1 Hz elsewhere)        src/scene/imaging/index.tsx
 *  -0.28  surgery robot       R2: patient cart, boom and the four arms from robot state; lights   src/scene/surgery
 *  -0.27  surgery screens     R2: the theatre atlas and the shared endoscope live texture         src/scene/surgery
 * -0.268  cryo rig            R4 cryo suite: CT table/rotor, robot arm, needles                   src/scene/cryoSuite
 * -0.265  cryo screens        R4 cryo screens: CT/planning/console atlas                          src/scene/cryoSuite
 *  -0.26  patient monitors    R3: the display clock and the sweeping monitor faces (quads only)   src/scene/monitors
 *  -0.25  imaging machines    MRI table, CT rotor, X-ray tube, ultrasound probe from scanner state src/scene/imaging/machines
 *  -0.24  health kiosks       W4: height arm, cuff, LEDs, paper slip from kiosk state            src/scene/kiosks
 *  -0.23  draw centre         W4: robot heads, needles, tourniquets, prep gripper, live strip     src/scene/drawCentre
 *  -0.22  lab                 W4: pneumatic flights, pucks and tubes on the track, centrifuges    src/scene/lab
 *  -0.21  W4 status screens   repaint changed tiles (4 Hz check, 2 Hz upload)                    src/scene/w4kit
 *   -0.2  beds wall           the command wall's Beds panel (checks at 2 Hz, repaints on change) src/scene/building/render
 *   -0.1  walk building       door leaves, walk-only walls/ceilings/signs shown by mode (W1)       src/scene/building/render/walk
 *      0  everything else     drei <Html> labels project here (their own useFrame), and so do
 *                             the instanced effects that read the camera
 *      1  EffectComposer      the draw
 *
 * The rule the numbers keep: every camera write comes BEFORE every label projection, and every label anchor is written before its
 * label projects. When a label projects with last frame's camera (or last frame's anchor) it trails the world by one frame and
 * keeps sliding for a frame or two after the camera stops. Before this file the name tag and the bubbles wrote their anchors at
 * priority 0 from the PARENT component of their <Html>, so the <Html> (the child, mounted first) projected first and the anchor
 * moved after it: the text was one frame behind the picture it was drawn over. The anchors now run at `labelAnchors`, ahead of
 * every <Html>.
 */
export const FRAME_PRIORITY = {
  /** DevProbe (?probe=1): reads the previous whole frame's renderer totals before anything renders. */
  probe: -1000,
  sim: -100,
  /** W3: doors open and publish their leaves (src/scene/blockers.ts) before the player moves against them. */
  doors: -11,
  player: -10,
  /** R2: the shown level (docs/R2-SURGERY.md), after you move and before anything is drawn or picked by level. */
  levels: -9.5,
  tour: -9,
  interact: -8,
  celebration: -5,
  cameraRig: -1,
  labelAnchors: -0.5,
  imagingImages: -0.3,
  /** R2 robotic surgery on level 2. */
  surgeryRig: -0.28,
  surgeryScreens: -0.27,
  /** R4 the CT-guided cryoablation suite on level 2. */
  cryoRig: -0.268,
  cryoScreens: -0.265,
  /** R3 live patient monitors: the sweep moves its quads (the pump paints outside the frame). */
  patientMonitors: -0.26,
  imagingMachines: -0.25,
  /** W4 smart diagnostics (docs/W4-DIAGNOSTICS.md). */
  kiosks: -0.24,
  drawCentre: -0.23,
  lab: -0.22,
  w4Screens: -0.21,
  bedsWall: -0.2,
  /** Realism step 2: the soft contact shadows follow their sources after every layer above has moved them (src/scene/lighting/contact). */
  contactShadows: -0.05,
  labels: 0,
} as const

/** The callbacks that write the camera, by name. */
export const CAMERA_WRITERS = ['player', 'tour', 'cameraRig'] as const

/** The priority of the last camera write of a frame. */
export function lastCameraWrite(): number {
  return Math.max(...CAMERA_WRITERS.map((n) => FRAME_PRIORITY[n]))
}
