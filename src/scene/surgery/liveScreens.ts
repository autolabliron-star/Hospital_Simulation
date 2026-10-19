/**
 * R2 (agent O): the quads of the endoscope live texture, merged into ONE static geometry (the vision cart's monitor, the wall monitor and the two console
 * viewers: dims.ts LIVE_SCREENS), each showing the whole texture, with white vertex colours (the imaging monitors' material wants them). One mesh, one draw
 * call, built once at mount: nothing here runs per frame.
 */
import { BufferGeometry, Euler, Float32BufferAttribute, Matrix4, Mesh, PlaneGeometry, Quaternion, Vector3, type Material } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { LIVE_SCREENS, type ScreenAnchor } from './dims'

/** A quad at an anchor (centre, heading about y, lean back about x), facing the anchor's heading, with white vertex colours. */
export function screenQuad(a: ScreenAnchor): BufferGeometry {
  const g = new PlaneGeometry(a.w, a.h)
  const q = new Quaternion().setFromEuler(new Euler(-(a.tilt ?? 0), a.heading, 0, 'YXZ'))
  g.applyMatrix4(new Matrix4().compose(new Vector3(a.at.x, a.at.y, a.at.z), q, new Vector3(1, 1, 1)))
  const n = g.getAttribute('position').count
  g.setAttribute('color', new Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3))
  return g
}

/** All the live screens as one geometry. */
export function liveScreensGeometry(anchors: readonly ScreenAnchor[] = LIVE_SCREENS): BufferGeometry {
  const parts = anchors.map(screenQuad)
  const merged = mergeGeometries(parts, false)
  for (const p of parts) p.dispose()
  if (!merged) throw new Error('surgery: could not merge the live screens')
  return merged
}

/** The mesh of the live screens on `material` (the live texture's). */
export function createLiveScreens(material: Material): Mesh {
  const mesh = new Mesh(liveScreensGeometry(), material)
  mesh.name = 'surgery-live-screens'
  mesh.frustumCulled = false
  mesh.matrixAutoUpdate = false
  mesh.updateMatrix()
  return mesh
}
