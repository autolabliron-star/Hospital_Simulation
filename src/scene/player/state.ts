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
  /** Where the camera is right now. */
  camera: { x: 0, y: 0, z: 0 },
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
