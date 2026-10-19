/**
 * The whole building as plain data. `buildLayout()` is pure and deterministic: no randomness, no three.js, no DOM.
 * The renderer (../render) turns the result into a few merged meshes per material and a handful of instanced meshes.
 */
import { ROOMS } from '@/sim/places'
import { levelOf } from '@/sim/levels'
import { buildAtrium } from '@/scene/landscape/atrium'
import { buildExterior } from '@/scene/landscape/exterior'
import { buildCommand } from '@/scene/rooms/command'
import { buildHub } from '@/scene/rooms/hub'
import { buildImaging } from '@/scene/rooms/imaging'
import { buildLobby } from '@/scene/rooms/lobby'
import { buildDrawCentre } from '@/scene/rooms/bloodDraw'
import { buildHealthKiosks } from '@/scene/rooms/healthKiosks'
import { buildLab } from '@/scene/rooms/lab'
import { buildPneumatic } from '@/scene/rooms/pneumatic'
import { buildPatientRoom } from '@/scene/rooms/patientRoom'
import { buildServiceRooms } from '@/scene/rooms/serviceRooms'
import { buildSurgerySuite } from '@/scene/rooms/surgery'
import { buildTriageEr } from '@/scene/rooms/triageEr'
import { buildLabels } from '@/scene/wayfinding/labels'
import { buildWayfinding } from '@/scene/wayfinding/lines'
import { LayoutBuilder } from './builder'
import { buildFloors, buildWalls } from './shell'
import type { BuildingLayout } from './types'

export interface BuildOptions {
  /** Leave the imaging suite out (the tests measure what it adds to the draw-call and triangle budget). Default: build it. */
  imaging?: boolean
  /** R2: leave level 2 (the robotic surgery suite) out, to measure level 1 on its own. Default: build it. */
  level2?: boolean
}

export function buildLayout(opts: BuildOptions = {}): BuildingLayout {
  const b = new LayoutBuilder()
  buildFloors(b)
  buildWalls(b)
  for (const room of ROOMS) buildPatientRoom(b, room)
  buildHub(b, 'A')
  buildHub(b, 'B')
  buildCommand(b)
  buildLobby(b)
  buildTriageEr(b)
  if (opts.imaging !== false) buildImaging(b)
  buildServiceRooms(b)
  // W4 smart diagnostics (docs/W4-DIAGNOSTICS.md)
  buildHealthKiosks(b)
  if (opts.imaging !== false) buildDrawCentre(b)
  buildLab(b)
  buildPneumatic(b)
  // R2: level 2, the robotic surgery suite (docs/R2-SURGERY.md), in its own strip of sim coordinates
  if (opts.level2 !== false) {
    buildSurgerySuite(b)
    // level 2 never casts into the baked sun shadow (it is drawn in its own group, 4.2 m up, after the shadow map was rendered once)
    for (const p of b.prims) if (levelOf(p.position[0]) === 2) p.castShadow = false
  }
  buildAtrium(b)
  buildExterior(b)
  buildWayfinding(b)
  buildLabels(b)
  return b.finish()
}

let cached: BuildingLayout | null = null

/** The layout, built once per page load. */
export function getLayout(): BuildingLayout {
  cached ??= buildLayout()
  return cached
}

export type { BuildingLayout, ConsoleScreen, Footprint, Prim } from './types'
