/**
 * Which zones of the authored building are drawn this frame (the Quest 3 budget: < 200 draws in view). Run once a frame after the camera moved
 * (BUILDING_VISIBILITY_PRIORITY), allocation-free: the frustum, its matrix and every zone's box are made once.
 *
 *   level        a zone of the shown level is a candidate; while the OVERVIEW shows level 2, level-1 zones stay drawn around the storey, except
 *                the ones wholly under its slab (lobby, ER), as levelView's `shownAt` does for people. Walking on level 2 shows level 2 only
 *                (the roof cap closes the hospital below).
 *   portals      walking INSIDE a zone that has a potential-visibility set (`visibleFrom` in the manifest), only that set (and the zone itself)
 *                is a candidate. No set: every zone of the level stays a candidate (start simple; measure, then let the pipeline add sets).
 *   frustum      the zone's world box (the manifest's bounds, padded by CULL_PAD) must intersect the view frustum. Overview included.
 *   detail       (LOD) a drawn zone shows its FULL model when the camera is near it, else its OVERVIEW PROXY (one draw: ./farModel.ts).
 *                Walking: near = within LOD_WALK_FULL_M of the zone's own rects, in plan (the zone you stand in, and the ones you can
 *                nearly touch). Any other view (the overview, room shots, tours): within LOD_VIEW_FULL_M of the zone's box, in 3D, so the default
 *                overview (the whole building from ~115 m up) draws proxies only, and a room shot (9-40 m from its target at 52 degrees)
 *                brings the zone under it in full while its neighbours stay proxies. LOD_HYSTERESIS_M
 *                keeps a zone from flickering on the line. Whichever representation is wanted but not ready, the other one is drawn.
 *
 * In XR the camera is the stereo rig's (`gl.xr.getCamera()`, whose frustum covers both eyes); its matrices are a frame old when this runs,
 * which CULL_PAD absorbs.
 */
import { Box3, Frustum, Matrix4, Vector3, type Camera } from 'three'
import type { LevelId } from '@/sim/levels'
import type { Bounds } from './manifest'
import { zoneContainsDrawn, zoneDistance, zoneUnderLevel2, type ZoneDef } from './zones'

/** Metres added around every zone's box (a frame of XR latency, the box's own rounding). */
export const CULL_PAD = 0.5
/** Walking: a zone within this many metres (plan distance to its rects) draws its full model. */
export const LOD_WALK_FULL_M = 9
/** Any other view: a zone whose box is within this many metres of the camera (3D) draws its full model. */
export const LOD_VIEW_FULL_M = 24
/** A zone drawn in full stays full until it is this much further away than the threshold. */
export const LOD_HYSTERESIS_M = 2

export interface CullEntry {
  id: string
  def: ZoneDef
  level: LevelId
  /** A level-1 zone wholly under the level-2 slab. */
  underL2: boolean
  /** World box, padded. */
  box: Box3
  /** Walking inside this zone, the zones (by index) that can be seen from it; null = all. */
  pvs: Uint8Array | null
  /** The zone's model is loaded and uploaded (written by the runtime). */
  ready: boolean
  /** The zone's overview proxy is loaded (written by the runtime). */
  farReady: boolean
  /** LOD state: the camera is near enough for the full model (kept across frames for the hysteresis). */
  full: boolean
  /** Output: draw it this frame (either representation). */
  visible: boolean
  /** Output: draw the full model. */
  drawFull: boolean
  /** Output: draw the overview proxy. */
  drawFar: boolean
}

export interface CullView {
  walking: boolean
  shown: LevelId
  overview: boolean
  /** The camera, drawn (world) coordinates. */
  x: number
  y: number
  z: number
}

/** A cull entry for a zone (made once, at load). */
export function cullEntry(def: ZoneDef, bounds: Bounds): CullEntry {
  const box = new Box3(new Vector3(bounds.x0, bounds.y0, bounds.z0), new Vector3(bounds.x1, bounds.y1, bounds.z1)).expandByScalar(CULL_PAD)
  return { id: def.id, def, level: def.level, underL2: zoneUnderLevel2(def), box, pvs: null, ready: false, farReady: false, full: false, visible: false, drawFull: false, drawFar: false }
}

/** Fill every entry's potential-visibility set from the manifest's `visibleFrom` lists (by zone id). */
export function setVisibilitySets(entries: CullEntry[], visibleFrom: (id: string) => readonly string[] | null): void {
  for (const e of entries) {
    const list = visibleFrom(e.id)
    if (!list) {
      e.pvs = null
      continue
    }
    e.pvs = new Uint8Array(entries.length)
    entries.forEach((o, i) => {
      if (o.id === e.id || list.includes(o.id)) e.pvs![i] = 1
    })
  }
}

const _m = new Matrix4()
const frustum = new Frustum()

/** The view frustum of a camera (its world matrices must be current). The one shared Frustum is returned. */
export function frustumOf(camera: Camera): Frustum {
  _m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  frustum.setFromProjectionMatrix(_m)
  return frustum
}

/** May a zone of this level be drawn in this view (before the frustum)? */
export function levelAllows(e: CullEntry, view: CullView): boolean {
  if (e.level === view.shown) return true
  return view.overview && view.shown === 2 && e.level === 1 && !e.underL2
}

/** Walking: the zone the camera stands in on the shown level (by the zones' own rects), or -1. Overview: -1. */
export function cameraZoneIndex(entries: readonly CullEntry[], view: CullView): number {
  if (!view.walking) return -1
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (e.level === view.shown && zoneContainsDrawn(e.def, view.x, view.z)) return i
  }
  return -1
}

const _eye = new Vector3()

/** The camera's distance to a zone for the LOD: walking, in plan to the zone's own rects; otherwise in 3D to its (padded) box. */
export function zoneLodDistance(e: CullEntry, view: CullView): number {
  if (view.walking) return zoneDistance(e.def, view.x, view.z)
  _eye.set(view.x, view.y, view.z)
  return e.box.distanceToPoint(_eye)
}

/** Is the camera near enough for the zone's full model (with hysteresis on `e.full`)? */
export function wantsFull(e: CullEntry, view: CullView): boolean {
  const near = (view.walking ? LOD_WALK_FULL_M : LOD_VIEW_FULL_M) + (e.full ? LOD_HYSTERESIS_M : 0)
  return zoneLodDistance(e, view) < near
}

/**
 * Decide every entry's `visible`, and which representation (`drawFull` / `drawFar`); returns how many zones are drawn. `frustum` null skips
 * the frustum test (tests, or no camera yet).
 */
export function cullZones(entries: readonly CullEntry[], view: CullView, fr: Frustum | null): number {
  const inside = cameraZoneIndex(entries, view)
  const pvs = inside >= 0 ? entries[inside].pvs : null
  let n = 0
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    let v = (e.ready || e.farReady) && levelAllows(e, view)
    if (v && pvs !== null && pvs[i] === 0) v = false
    if (v && fr !== null && !fr.intersectsBox(e.box)) v = false
    e.visible = v
    e.full = wantsFull(e, view)
    e.drawFull = v && e.ready && (e.full || !e.farReady)
    e.drawFar = v && e.farReady && !e.drawFull
    if (v) n++
  }
  return n
}
