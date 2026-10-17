/**
 * Warm the walk-mode building before the first Tab (W1): every walk-only shader program and texture is made ready at load, a few
 * frames in, behind the first frames, so the first Tab, the first door and the first sign never stutter.
 *
 * `renderer.compile(scene, camera)` walks the WHOLE scene tree (hidden objects too) and builds the program of every material as it
 * would be drawn. The composer draws the scene into a floating-point render target, and a program's key includes the target's colour
 * space, so the compile runs against a stand-in target of the same kind (otherwise it would warm the programs of the canvas, which
 * are not the ones used). Textures are uploaded with `initTexture`. Geometry buffers are small (a few hundred KB) and upload on the
 * first frame they are drawn.
 *
 * Best effort: any failure leaves the programs to compile on first use, which is only a hitch.
 */
import { HalfFloatType, WebGLRenderTarget, type Camera, type Object3D, type Texture, type WebGLRenderer } from 'three'

export function warmWalk(gl: WebGLRenderer, scene: Object3D, camera: Camera, textures: readonly Texture[]): boolean {
  const standIn = new WebGLRenderTarget(4, 4, { type: HalfFloatType })
  const previous = gl.getRenderTarget()
  try {
    gl.setRenderTarget(standIn)
    gl.compile(scene, camera)
    for (const t of textures) gl.initTexture(t)
    return true
  } catch {
    return false
  } finally {
    gl.setRenderTarget(previous)
    standIn.dispose()
  }
}

/** Frames to wait after mount before warming: the lights, the environment and the other layers are all in the scene by then. */
export const WARM_AFTER_FRAMES = 8
