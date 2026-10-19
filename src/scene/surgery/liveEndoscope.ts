/**
 * R2 (agent O): the shared endoscope live texture. ONE 256 x 160 canvas shown on the vision cart's monitor, the wall monitor and both console viewers (four
 * quads, one material, one draw call). It repaints at 2 Hz normally and at 10 Hz while somebody is looking: you standing in the OR (level 2 shown, inside its
 * walls) or the OR focused in the overview. Before the endoscope arm is docked (and whenever the camera is not live) it shows a dim standby picture, painted
 * once per robot phase and never again until the phase changes.
 *
 * The material copies the imaging monitors' and the draw-centre strip's settings (a map, `toneMapped: false`, vertex colours), so it shares their shader program and
 * the warm-up has nothing new to compile. The painter is endoscope.ts's; the canvas API goes through the imaging suite's `Env`, so node tests inject a recorder.
 */
import { CanvasTexture, LinearFilter, MeshBasicMaterial, SRGBColorSpace } from 'three'
import { SURGERY_COPY } from '@/content/surgery'
import { SURGERY_UI } from '@/content/surgeryUi'
import type { Env, Surface } from '@/scene/imaging/images/ctx'
import { areaById, type AreaId } from '@/sim/places'
import type { RobotState } from '@/sim/types'
import { paintEndoscope, paintStandby, type EndoView } from './endoscope'
import { motionGain } from './robotPose'

export const LIVE_W = 256
export const LIVE_H = 160
/** Redraw periods (ms): somebody is looking, and nobody is. */
export const HOT_MS = 100
export const COOL_MS = 500

// ---------------------------------------------------------------------------------------------
// Presence
// ---------------------------------------------------------------------------------------------

const OR_RECT = areaById('l2Or').rect

/** The part of the player the check reads. */
export interface Here {
  x: number
  z: number
}

/** Is the player standing inside the OR's walls? */
export function playerInOr(p: Here | null): boolean {
  return p !== null && p.x > OR_RECT.x0 && p.x < OR_RECT.x1 && p.z > OR_RECT.z0 && p.z < OR_RECT.z1
}

/** Is somebody in the OR: you on level 2 inside it, or the presenter's focus on it (the overview's room panel)? `shown` is `levelView.shown`. */
export function inOr(focus: AreaId | null, player: Here | null, shown: 1 | 2): boolean {
  return focus === 'l2Or' || (shown === 2 && playerInOr(player))
}

/** Is the endoscope camera live: the endoscope arm (index 1) is docked far enough in, from docking through the end of the console phase. */
export function cameraLive(r: Readonly<RobotState>): boolean {
  const arm = r.arms[1]
  if (arm.engage < 0.6) return false
  return r.phase === 'docking' || r.phase === 'targeting' || r.phase === 'docked' || r.phase === 'undocking'
}

// ---------------------------------------------------------------------------------------------
// The canvas
// ---------------------------------------------------------------------------------------------

export class LiveEndoscope {
  readonly surface: Surface
  readonly canvas: Surface['canvas']
  /** Called after any redraw: the 3D texture flags itself for upload here. */
  onDraw: (() => void) | null = null
  /** Redraws so far (for the tests and the probe). */
  paints = 0

  private lastDraw = -1e9
  private lastKey = ''
  private lastLive = false
  /** The painter's input, one object reused (a frame allocates nothing). */
  private readonly view: EndoView = { seed: 0, t: 0, gain: 0 }

  constructor(env: Env) {
    this.surface = env.createSurface(LIVE_W, LIVE_H)
    this.canvas = this.surface.canvas
    this.standby('stowed')
  }

  private standby(phase: RobotState['phase']): void {
    paintStandby(this.surface.ctx, LIVE_W, LIVE_H, SURGERY_UI.console.endoscope, SURGERY_COPY.robotPhases[phase])
    this.lastKey = phase
    this.lastLive = false
    this.paints++
  }

  /**
   * Call every frame. Repaints when due (see the file's header) and returns whether it did. `simT` is the sim clock in seconds, `nowMs` the page clock, `hot`
   * whether somebody is in the OR.
   */
  update(robot: Readonly<RobotState>, simT: number, nowMs: number, hot: boolean): boolean {
    if (cameraLive(robot)) {
      const every = hot ? HOT_MS : COOL_MS
      if (this.lastLive && nowMs - this.lastDraw < every) return false
      this.view.seed = robot.motionSeed
      this.view.t = simT
      this.view.gain = motionGain(robot, simT)
      paintEndoscope(this.surface.ctx, LIVE_W, LIVE_H, this.view)
      this.lastDraw = nowMs
      this.lastLive = true
      this.lastKey = ''
      this.paints++
      this.onDraw?.()
      return true
    }
    if (!this.lastLive && this.lastKey === robot.phase) return false
    this.standby(robot.phase)
    this.onDraw?.()
    return true
  }
}

// ---------------------------------------------------------------------------------------------
// The texture and the material (browser only: made at mount, `document` does not exist in node)
// ---------------------------------------------------------------------------------------------

export interface LiveScreenResources {
  live: LiveEndoscope
  texture: CanvasTexture
  material: MeshBasicMaterial
  dispose(): void
}

/** Build the canvas, its texture and the screens' material. The texture is sRGB, linear filtering, no mipmaps; the canvas flags it for upload after every redraw. */
export function createLiveResources(env: Env): LiveScreenResources {
  const live = new LiveEndoscope(env)
  const texture = new CanvasTexture(live.canvas as HTMLCanvasElement)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = false
  live.onDraw = () => {
    texture.needsUpdate = true
  }
  texture.needsUpdate = true
  // single sided: the back of a monitor stays dark; `vertexColors` like the imaging monitors (the quads carry white)
  const material = new MeshBasicMaterial({ map: texture, toneMapped: false, vertexColors: true })
  return {
    live,
    texture,
    material,
    dispose() {
      texture.dispose()
      material.dispose()
    },
  }
}
