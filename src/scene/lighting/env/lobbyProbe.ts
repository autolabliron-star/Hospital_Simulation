/**
 * The lobby's reflection probe (`?building=model` only): a Blender-rendered equirectangular HDR of the authored lobby
 * (`public/assets/building/env_lobby.hdr`, Radiance RGBE, made by the building pipeline). It is loaded with three's HDRLoader, turned into a PMREM
 * once (the same 256 cube-UV layout as the room and hospital environments, so binding it recompiles nothing), and bound as `scene.environment`
 * while the camera is inside the pilot region on level 1 (Lighting.tsx swaps it, the daylight driver writes its intensity: look.ts LOBBY_ENV_MATCH).
 *
 * The load is a warm gate (registerWarmGate): the loading screen waits for it, so the first frame in the lobby already reflects the lobby. A missing
 * file, a dev server answering with its index page, a corrupt HDR: the load resolves null and everything stays as it was (today's environments),
 * with no message: the model works without its probe.
 *
 * Not done (a stretch goal): box-projected (parallax-corrected) reflections for the lobby's bounds. It needs `onBeforeCompile` patches on the
 * model's own materials, which the building pipeline owns (src/scene/building/model), so it is left to a change there; a plain probe is correct
 * at the middle of the room and slides a little near the glass.
 */
import { PMREMGenerator, type Texture, type WebGLRenderTarget, type WebGLRenderer, EquirectangularReflectionMapping } from 'three'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { BUILDING_MODEL_ON } from '@/scene/building/model/flags'
import { inPilotRegion } from '@/scene/building/model/region'

export const LOBBY_ENV_FILE = 'assets/building/env_lobby.hdr'

/** The lobby's storey: the camera is under this height (drawn metres) on level 1; level 2 is drawn 4.2 m higher. */
export const LOBBY_MAX_Y = 3.6

/** Set by Lighting.tsx while the probe is built; read by the daylight driver's caller. */
export const lobbyProbe: { ready: boolean } = { ready: false }

/** Should the lobby's probe be bound for a camera at (x, y, z) in drawn coordinates? (Needs `?building=model`, the probe loaded, and the camera in the lobby's region on level 1.) */
export function lobbyEnvWanted(x: number, y: number, z: number): boolean {
  return lobbyProbe.ready && BUILDING_MODEL_ON && y < LOBBY_MAX_Y && inPilotRegion(x, z)
}

/** `lobbyEnvWanted` for a camera (anything with a position: the daylight driver's caller passes the scene's). */
export function lobbyEnvForCamera(camera: { position: { x: number; y: number; z: number } }): boolean {
  const p = camera.position
  return lobbyEnvWanted(p.x, p.y, p.z)
}

/** The parts of three the loader needs, as a function of the renderer (a seam for tests). */
export interface LobbyEnvDeps {
  load(url: string): Promise<Texture>
  pmrem(source: Texture): WebGLRenderTarget
}

/** Load the HDR and PMREM it. Resolves null on any failure (no file, not an HDR). The caller owns the render target. */
export async function loadLobbyEnvironment(gl: WebGLRenderer, base: string, deps?: LobbyEnvDeps): Promise<WebGLRenderTarget | null> {
  try {
    const url = `${base}${LOBBY_ENV_FILE}`
    const source = await (deps ? deps.load(url) : new HDRLoader().loadAsync(url))
    source.mapping = EquirectangularReflectionMapping
    let target: WebGLRenderTarget
    if (deps) target = deps.pmrem(source)
    else {
      const pmrem = new PMREMGenerator(gl)
      target = pmrem.fromEquirectangular(source)
      pmrem.dispose()
    }
    source.dispose()
    return target
  } catch {
    return null
  }
}
