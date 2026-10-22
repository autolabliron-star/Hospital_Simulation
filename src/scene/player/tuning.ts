/**
 * Every feel number of the walk mode in one place. The contract numbers (speeds, body radius, the camera boom, pivot,
 * shoulder offset and lens) come from `CONFIG.player` in `src/sim/config.ts`; everything else is this module's own tuning.
 * Adapted from the Waltz City player (`src/scene/player/tuning.ts`), trimmed to what a walking doctor needs.
 *
 * Conventions (the same as every heading in the sim): metres, radians, x east, z south. A `yaw` is the compass direction a
 * thing FACES, atan2(dx, dz): 0 faces +z, pi / 2 faces +x. A camera `pitch` is how far the camera sits ABOVE the pivot, in
 * radians: positive looks down on you, negative looks up at you. The config's `pitchDeg` is the usual look angle
 * (negative = looking down), so the default camera elevation is `-pitchDeg` degrees above the pivot.
 */
import { CONFIG } from '@/sim/config'

const P = CONFIG.player
const C = P.camera
const DEG = Math.PI / 180

export const BODY = {
  /** The circle that slides along walls and furniture. */
  radius: P.bodyRadius,
  /** Your eyes above your feet, for first person. */
  eyeHeight: C.eyeHeight,
} as const

export const MOVE = {
  walkSpeed: P.walkSpeed,
  hurrySpeed: P.hurrySpeed,
  /** Time constant of the body turning to face where it goes, seconds, and the fastest turn, rad/s. */
  turnSeconds: P.turnSeconds,
  maxTurnRate: 20,
  /** Below this ground speed (m/s) the body keeps its facing instead of following a drifting velocity. */
  facingSpeed: 0.2,
  /** In first person the body faces where you look, a little quicker than it turns to face its walk. */
  firstPersonTurnSeconds: 0.05,
} as const

export const CHASE = {
  fov: C.fovDeg,
  firstPersonFov: C.fovFirstDeg,
  /** The camera orbits a point this high above your feet (just above your head) ... */
  pivotHeight: C.pivotHeight,
  /** ... and this far to the right of it (GTA over-the-shoulder): the pivot sits over your right shoulder. */
  shoulder: C.shoulder,
  /** The boom you start with, metres, and the wheel's range. Pulling in past `firstPersonBelow` goes to first person. */
  boom: C.boom,
  /** The closest the wheel brings the boom; one more notch in goes to first person. */
  minDistance: C.firstPersonBelow,
  maxDistance: C.boomMax,
  firstPersonBelow: C.firstPersonBelow,
  /** The camera's default elevation above the pivot, radians (the config's `pitchDeg` is a look angle, so the sign flips). */
  pitch: -C.pitchDeg * DEG,
  /** Camera elevation limits (radians). Negative: the camera sits below the pivot and looks up. */
  minPitch: -15 * DEG,
  maxPitch: 55 * DEG,
  /** First person looks up and down this far (radians). */
  firstPersonPitch: 80 * DEG,
  /** Mouse look, radians per pixel (a pointer-locked mouse reports raw pixels). */
  yawPerPixel: 0.0032,
  pitchPerPixel: 0.0028,
  /**
   * The look-at point sits this far ahead of the pivot along the camera's facing (so there is a hall in front of you) and this
   * much above it (negative: below the pivot). Aiming a little under head height lifts you up the picture: at the default boom
   * your head is just above the middle and your feet clear of the bottom edge, with the ceiling still in the top third.
   */
  lookAhead: 1.0,
  lookRaise: -0.2,
  /** Smoothing times, seconds (critically damped, so the view is at rest a short while after the mouse stops, and then EXACTLY at rest). */
  yawSeconds: 0.05,
  pitchSeconds: 0.07,
  zoomSeconds: 0.08,
  /** The follow point trails your head by this much, and never by more than `maxFollowLag` metres. */
  lagSeconds: 0.08,
  maxFollowLag: 0.5,
  /**
   * A camera-sized ball is swept along the boom (a wall box grown by `probeRadius`); it stops `wallMargin` short. The ball plus
   * the margin is wider than the near plane's corner (0.16 m at near 0.1 and a 16:9 window), so a wall is never sliced open at
   * the edge of the picture. The boom may get as short as `minBoom`: standing with your back to a wall you are seen from just
   * behind your head (the avatar fades out), never through the wall.
   */
  probeRadius: 0.2,
  wallMargin: 0.03,
  minBoom: 0.1,
  /**
   * The shoulder offset is swept sideways first, with the camera's own ball: the pivot is a place the camera could stand, so with
   * a wall at your right shoulder the pivot slides in over your head until the ball clears it (you may walk 0.3 m from a wall).
   */
  shoulderProbeRadius: 0.2,
  /**
   * The shoulder swap (GTA's trick for a wall at your side). Both sides of your head are swept every frame, each as a share of `shoulder`.
   * The side you ride is GIVEN UP when its free room falls below `swapGiveUpBelow` and the other side has at least `swapOtherAtLeast` of
   * the shoulder free (and `swapGainMin` metres more than this one): the pivot then glides across, settling in about `swapGlideSeconds`.
   * A side is held for at least `swapHoldSeconds`. After a swap you only go BACK to the preferred shoulder (the Q key's choice) once it
   * has had `swapBackAtLeast` of the shoulder free for `swapBackSeconds` in a row, so a door opening in the wall you are hugging does not
   * flip the camera. Never in first person.
   */
  swapGiveUpBelow: 0.6,
  swapOtherAtLeast: 0.85,
  swapGainMin: 0.12,
  swapBackAtLeast: 0.9,
  swapBackSeconds: 1.5,
  swapHoldSeconds: 1.2,
  swapGlideSeconds: 0.35,
  /**
   * Near-wall softening: when the nearest wall is within `nearWall` metres of the lens (swept sideways, behind and diagonally behind),
   * the camera rises (up to `nearWallPitch` radians more elevation) and comes in (up to `nearWallBoomCut` of the boom, never below
   * `nearWallMinBoom` unless it was already shorter) instead of hugging the wall; full at `nearWallFull` metres or closer. It engages in
   * `softenSeconds` and lets go over `softenReleaseSeconds` (the boom's own rule: in fast, out slow). The wall sweeps are then redone
   * along the softened boom, so it can never be taken through anything.
   */
  nearWall: 0.5,
  nearWallFull: 0.3,
  nearWallPitch: 10 * DEG,
  nearWallBoomCut: 0.2,
  nearWallMinBoom: 1.6,
  softenSeconds: 0.2,
  softenReleaseSeconds: 0.6,
  /** The boom shortens at once and grows back slowly, so a wall never clips and the camera never pumps. */
  shortenSeconds: 0.03,
  lengthenSeconds: 0.5,
  /** ...but it does arrive: the regrowth never goes slower than `lengthenFinish * sqrt(share still to grow)` of the wanted length per second. */
  lengthenFinish: 1.6,
  /**
   * W3 (a smooth walk): TWO radii. The soft one is `probeRadius + wallMargin`: the room the camera would like to keep from a wall, and
   * what the boom's spring aims at. The hard one, `nearRadius`, is about the corner of the near plane (0.1 m near plane, 60 degrees,
   * 16:9: 0.155 m; the ball is a touch smaller on purpose): the camera is NEVER closer than that to a wall, in the same frame the wall
   * is there, whatever the spring is doing. The boom therefore glides in at a bounded speed (`boomInSeconds`, at most `boomInMax` m/s)
   * and the clamp is only the safety net. It lets out more slowly (`lengthenSeconds`, at most `boomOutMax` m/s).
   *
   * Hanging signs are only ever tested at `signRadius` (never more than the radius asked for), so the camera passes under them: a sign's
   * lower edge is 2.18 m, the camera rests at 2.04 m (1.62 m + 3 m of boom at 8 degrees: the follow lag lengthens the boom along the
   * floor, not up) and bobs up to 2.05 m, and a 0.2 m ball would reach 2.24 m. The hard radius 0.13 would leave 1.2 cm of air at rest
   * and none at all as soon as the camera is a centimetre higher (a wall beside it lifts it by up to 0.2 m, a mouse tilt by more), so
   * it would dip under the signs again. The near plane's own top edge is only 0.058 m above the camera, so 0.09 m (3 cm of air over
   * it) is the ball that still means "the lens does not touch it": 5 cm of height to spare under a sign.
   */
  nearRadius: 0.13,
  signRadius: 0.09,
  hardMargin: 0.004,
  boomInSeconds: 0.08,
  boomInMax: 2.6,
  boomOutMax: 2.4,
  /** Lengthening never goes slower than `boomOutFinish * sqrt(share still to grow)` of the wanted length per second (`lengthenFinish`'s job, for the spring). */
  boomOutFinish: 1.6,
  /** The shoulder room (how far out over your shoulder the pivot may go) moves the same way, in metres per second. */
  shoulderInSeconds: 0.08,
  shoulderInMax: 1.4,
  shoulderOutMax: 1.2,
  /** Running widens the lens by up to `runFovWiden` degrees (a critically damped spring, `runFovSeconds`); first person keeps its own lens. */
  runFovWiden: 4,
  runFovSeconds: 0.4,
  /**
   * The footfall bob: the camera rises and falls with your steps (two bounces per gait cycle, lowest on a heel strike). Metres of
   * amplitude walking and running; the amplitude is smoothed (`bobSeconds`) so starting and stopping fade it, and it is 0 in first
   * person (the view there IS your head).
   */
  bobWalk: 0.008,
  bobRun: 0.015,
  bobSeconds: 0.15,
  /** Never closer than this to the floor or the ceiling. */
  floorClearance: 0.25,
  ceilingClearance: 0.25,
  /** Wall pull-in: how quickly the wanted length follows when it gets shorter, and how far ahead (s) a second sweep looks along the camera's own motion. */
  pullInSeconds: 0.07,
  anticipateSeconds: 0.16,
  anticipateFloor: 0.004,
  anticipateRamp: 0.03,
  /** Look-ahead eases over this long. */
  lookAheadSmoothSeconds: 0.25,
  lookAheadSeconds: 0.12,
  lookAheadMax: 0.4,
  /** Seconds to blend into and out of first person. */
  firstPersonBlend: 0.3,
  /** Under `hideAvatarBelow` of boom the avatar is gone; it fades back in over `avatarFadeRange` metres more. */
  hideAvatarBelow: C.hideAvatarBelow,
  avatarFadeRange: 0.35,
  /** Along the boom, the ceiling is checked this often (metres). */
  ceilingStep: 0.25,
} as const

/**
 * The "easy" scheme, the default (ported from Waltz City's `EASY`): W and S walk along the way you FACE (S backs up, slower), A and D turn
 * you, and the camera follows behind by itself, so the view turns when you do. The mouse adds a look offset around you that swings back
 * behind you by itself once you have moved on. `?controls=classic` brings back the camera-relative scheme (see `scheme.ts`).
 */
export const EASY = {
  /** How fast A and D turn you, degrees per second; faster while running, so a run can still take a corner. */
  turnDegPerSecond: 140,
  sprintTurnDegPerSecond: 200,
  /** (W3) The turn rate follows these as a first-order lag with no kick: scheme.ts TURN_RISE_SECONDS / TURN_RELEASE_SECONDS. */
  /** S backs up at this share of the walking speed (and never runs). */
  backSpeedFactor: 0.5,
  /** The camera's yaw follows your heading with this smoothing time (a steady turn leaves it about `rate * followSeconds` behind)... */
  followSeconds: 0.22,
  /** ...and never lags by more than this angle, radians. */
  maxYawLag: (40 * Math.PI) / 180,
  /** In first person the view is glued to your heading, with this smoothing time. */
  firstPersonFollowSeconds: 0.06,
  /** A mouse look swings back behind you after this long without any mouse input, while you move or turn... */
  recenterDelay: 1.0,
  /** ...with this smoothing time. */
  recenterSeconds: 0.4,
  /** Ground speed above which you count as moving (m/s), for the swing back. */
  movingSpeed: 0.6,
  /** First person: the mouse turns the BODY. The look offset moves into your heading with this smoothing time (`ChaseCamera.absorbLook`). */
  firstPersonLookSeconds: 0.05,
} as const

/** The walk <-> overview flights. */
export const FLIGHT = {
  seconds: C.modeFlightSeconds,
  /** The overview's lens: the camera rig's (App.tsx `FOV`). */
  overviewFov: 35,
  overviewNear: 1,
  walkNear: C.near,
  /** A frame hitch longer than this does not skip the flight forward. */
  maxFrameDt: 0.05,
  /** How far the camera pulls back mid-flight per metre travelled, so long hops swoop instead of slide (as the room focus does). */
  bulgePerMetre: 0.16,
  bulgeMax: 22,
} as const

/**
 * Presentation mode (src/ui/present): the architectural walkthrough. First person at a calm eye height, a narrower lens, the game's walk and run, and a
 * heavy look damping so the picture glides. `blendSeconds` is how long the camera takes to move between the game's numbers and these (both ways, so
 * leaving restores the originals exactly).
 */
export const PRESENT = {
  eyeHeight: 1.6,
  /** Vertical lens, degrees. */
  fov: 55,
  /** Walk speed share (1 = the game's walk, with Shift to run: the owner wants full speed while presenting). */
  speedScale: 1,
  /** Critically damped time of the look: yaw and pitch, and the heading's follow, seconds. */
  lookSeconds: 0.25,
  blendSeconds: 0.6,
} as const

/** The slow copy for the UI (`useWalk`) is published at most this often. */
export const HUD_RATES = { viewHz: 10 } as const
