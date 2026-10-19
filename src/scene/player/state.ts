/**
 * W1 walk-in: shared player state (contract glue, owned by the orchestrator; the player & camera builder fills it in).
 *
 *   `sim.player` (src/sim/types.ts PlayerView) is the truth the SIM needs: where you are, your mode and view. Read it
 *   through the live `sim` binding every frame (a Jump swaps `sim` and carries you over), never cache the object.
 *   `walkCam` below is the camera-only state the scene needs per frame (no React): yaw, pitch, boom, pointer lock.
 *   `useWalk` is the slow copy for React UI (the HUD, the prompt, the minimap), published at about 10 Hz.
 */
import { create } from 'zustand'
import type { PlayerMode, PlayerViewKind } from '@/sim/types'

export const walkCam = {
  /** Camera orbit around you (radians; yaw 0 = behind you looking the way you face). */
  yaw: 0,
  pitch: 0,
  /** Current boom length after wall pull-in (metres). */
  boom: 3,
  pointerLocked: false,
  /** True while an overlay (prescribe tablet, scan viewer, dialogue) owns the keyboard and mouse: you stand still. */
  inputBlocked: false,
  // --- added by the player & camera builder (the per-frame camera state, written by the player system at priority -10) ---
  /**
   * Where the camera faces on the ground, ABSOLUTE compass radians (atan2(dx, dz): 0 faces +z, pi / 2 faces +x). `yaw` above is
   * this relative to the way you face: `yaw = wrapAngle(facing - heading)`, so 0 means "the camera looks the way you face".
   * `pitch` above is the camera's elevation above its pivot (positive: the camera looks down on you; first person: looks down).
   */
  facing: 0,
  /** How far into first person the camera is, 0 (behind your shoulder) to 1 (through your eyes). */
  firstPerson: 0,
  /** 0..1: how visible your avatar is (it fades out as the camera comes close, and in first person). */
  avatarFade: 1,
  /**
   * Where the camera is right now, in SIM coordinates (R2: level 2 lives in its own strip of the flat sim, sim x = drawn x + 150, y floor-relative). The three.js
   * camera is where it is DRAWN: the player system adds your level's offset to it once a frame (`present`, system.ts). Written every frame, in a flight and in
   * the overview too (taken back from the drawn camera), for the sight tests of the speech bubbles and emotes, which run against the sim's walls.
   */
  camera: { x: 0, y: 0, z: 0 },
}

/**
 * W3: your body this frame, never reallocated. Written by the player system at FRAME_PRIORITY.player (after it moves you); read in the same
 * frame by the crowd (your legs plan from it), and in the next frame by the doors (FRAME_PRIORITY.doors, before you move) and the quality
 * ladder. Velocities are m/s on the floor plane, the rest point is metres.
 */
export const walkBody = {
  /** The player system has written at least once since the page loaded. */
  live: false,
  x: 0,
  z: 0,
  /** The velocity actually achieved this frame, after walls, furniture, doors and people. */
  vx: 0,
  vz: 0,
  /** What your keys ask for (m/s); 0 with no move key held. */
  wishX: 0,
  wishZ: 0,
  /** The acceleration of the speed spring (smooth, m/s^2): the body leans into it. */
  ax: 0,
  az: 0,
  /** How fast your heading turns (rad/s, positive = counter-clockwise seen from above, the sense of `atan2(dx, dz)` growing). */
  turnRate: 0,
  /** No move key is held and you are still coasting to a stop. */
  stopping: false,
  /** Where you will come to rest if you let go now (swept through the solids). Equals x, z while standing. */
  restX: 0,
  restZ: 0,
  /** Seconds since your speed last exceeded 0.05 m/s. */
  stillFor: 0,
}

/**
 * W3: your legs, as the crowd's footfall planner sees them (written by the crowd model for the player's slot, priority 0, after the camera; so
 * the camera reads last frame's, one frame late, which a bob does not show). Read by the chase camera (the footfall bob) and the ambience
 * (a footstep sound on each heel strike). Never reallocated.
 */
export const walkStride = {
  /** Heel strikes since the page loaded: a reader plays one step per increment. */
  steps: 0,
  /** Which foot struck last: 0 left, 1 right. */
  foot: 0,
  /** Seconds since the last heel strike. */
  sinceStrike: 0,
  /** The gait cycle, 0..1, 0 at a left heel strike and 0.5 at a right one (holds still while standing). */
  phase: 0,
  /** The body's speed at the last strike (m/s): louder and longer steps when running. */
  strikeSpeed: 0,
  /** 0 walking .. 1 running (the run blend the legs are using). */
  run: 0,
}

export interface WalkState {
  mode: PlayerMode
  view: PlayerViewKind
  pointerLocked: boolean
  /** The interact prompt ("E · Prescribe for Grace Adeyemi"), or null. Written by the interaction builder. */
  prompt: string | null
  /** The one objective line in walk mode ("Pod A1 is bringing your order to A3: about 2 min"), or null. */
  objective: string | null
  set(patch: Partial<Omit<WalkState, 'set'>>): void
}

export const useWalk = create<WalkState>((set) => ({
  mode: 'walk',
  view: 'third',
  pointerLocked: false,
  prompt: null,
  objective: null,
  set: (patch) => set(patch),
}))
