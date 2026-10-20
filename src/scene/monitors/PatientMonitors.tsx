/**
 * R3: the live patient monitors (src/scene/monitors). 19 faces: the OR's anaesthesia monitor, the three recovery bays and the PACU's central
 * station, four pre-op bays, six ER bays and four triage bays, with sweeping traces and live numbers. Synthetic and display-only; they never alarm.
 *
 *   mount        the atlas is uploaded once (`initTexture`) and the standby faces painted, behind the loading screen; both levels' meshes are in the
 *                scene from the start (hidden ones too), so the warm-up sees their material: the live strip's program, nothing new
 *   the pump     every 500 ms (`setInterval`, never a frame callback): occupancy, numbers, and painting within 1.5 ms (hub.ts)
 *   each frame   at FRAME_PRIORITY.patientMonitors: the display clock moves on (not while paused), the shown level's mesh moves its quads with
 *                the sweep (mesh.ts), the other level's is hidden. Allocation-free.
 *
 * Level 2's mesh sits in a group at the level-2 offset, since the anchors are in sim coordinates.
 */
import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Box2, Texture, Vector2 } from 'three'
import { probeEnabled } from '@/app/DevProbe'
import { getLayout } from '@/scene/building/layout'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import { useFocus } from '@/scene/camera/focus.store'
import { levelView } from '@/scene/levels/levelView'
import { KIT_SCREENS } from '@/scene/surgery/dims'
import { loop, sim, simGeneration } from '@/sim'
import { LEVEL2_DX, LEVEL_Y } from '@/sim/levels'
import { hashString, mixSeed, Rng } from '@/sim/rng'
import { profileFor } from '@/sim/vitals/model'
import type { Ctx2D } from '@/scene/imaging/images/ctx'
import { monitorDefs } from './anchors'
import { MonitorHub, PUMP_MS, SHEET_H, SHEET_W, type HubEnv, type Uploader } from './hub'
import { createAtlasTexture, createMonitorMaterial, LevelMonitors } from './mesh'
import type { ErView } from './occupancy'
import { createMonitorProbe, installMonitorProbe } from './probe'
import { baselineFrom } from './vitals'

/** The running hospital as the hub reads it. */
function liveEnv(): HubEnv {
  let rngGen = -1
  let rng = new Rng(1)
  const you = { x: 0, z: 0 }
  return {
    occupancy: {
      surgery: () => sim.surgery.state,
      er: (): ErView => sim.world.er,
    },
    baseline(id, name, reason) {
      if (rngGen !== simGeneration) {
        rng = new Rng(mixSeed(sim.seed, hashString('patient-monitors')))
        rngGen = simGeneration
      }
      const p = sim.vitals.profileIfDrawn(id) ?? profileFor(id, name, reason ? { reason } : {}, rng)
      return baselineFrom(p, hashString(id))
    },
    simT: () => sim.t,
    generation: () => simGeneration,
    walker() {
      const p = sim.player
      if (!p || (p.mode !== 'walk' && p.mode !== 'toWalk')) return null
      you.x = p.x
      you.z = p.z
      return you
    },
    focus: () => useFocus.getState().area,
    nowMs: () => performance.now(),
  }
}

/** The staging sheet: a CPU-backed canvas (it is read by every copy). */
function createSheet(): { canvas: HTMLCanvasElement; ctx: Ctx2D } {
  const canvas = document.createElement('canvas')
  canvas.width = SHEET_W
  canvas.height = SHEET_H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('patient monitors: no 2D canvas')
  return { canvas, ctx }
}

function createResources() {
  const defs = monitorDefs(getLayout().bedMonitors, KIT_SCREENS.anaesthesia)
  const sheet = createSheet()
  const hub = new MonitorHub(defs, liveEnv(), { sheet: sheet.ctx })
  const atlas = createAtlasTexture(hub.plan)
  const material = createMonitorMaterial(atlas)
  const l1 = new LevelMonitors(1, hub, material)
  const l2 = new LevelMonitors(2, hub, material)
  l1.mesh.visible = false
  l2.mesh.visible = false
  // the sheet as a texture three never uploads itself: copyTextureToTexture reads the canvas straight into the atlas
  const source = new Texture(sheet.canvas)
  return { hub, atlas, material, l1, l2, sheet, source }
}

export function PatientMonitors() {
  const gl = useThree((s) => s.gl)
  const res = useMemo(createResources, [])

  useEffect(() => {
    const { hub, atlas, source } = res
    gl.initTexture(atlas)
    const box = new Box2()
    const to = new Vector2()
    const up: Uploader = {
      copy(sx, sy, w, h, dx, dy, mips) {
        box.min.set(sx, sy)
        box.max.set(sx + w, sy + h)
        to.set(dx, dy)
        atlas.generateMipmaps = mips
        gl.copyTextureToTexture(source, atlas, box, to, 0, 0)
      },
    }
    hub.attach(up)
    hub.warm()
    hub.pump(Infinity)
    const timer = window.setInterval(() => hub.pump(), PUMP_MS)
    const offProbe = probeEnabled ? installMonitorProbe(window, createMonitorProbe(hub)) : null
    return () => {
      window.clearInterval(timer)
      offProbe?.()
      res.l1.dispose()
      res.l2.dispose()
      res.material.dispose()
      atlas.dispose()
    }
  }, [gl, res])

  useFrame((_, dt) => {
    const t = res.hub.clock.advance(dt, loop.paused)
    const shown = levelView.shown
    res.l1.mesh.visible = shown === 1
    res.l2.mesh.visible = shown === 2
    if (shown === 1) res.l1.write(t, res.hub.plan)
    else res.l2.write(t, res.hub.plan)
  }, FRAME_PRIORITY.patientMonitors)

  return (
    <group name="patient-monitors">
      <primitive object={res.l1.mesh} />
      <group name="patient-monitors-level-2" position={[-LEVEL2_DX, LEVEL_Y[2], 0]}>
        <primitive object={res.l2.mesh} />
      </group>
    </group>
  )
}
