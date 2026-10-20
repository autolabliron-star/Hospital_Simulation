/**
 * The shared endoscope live texture in node (a recording environment stands in for the canvas): one 384 x 216 (16:9) canvas, standby before the camera is live
 * and once per robot phase, 2 Hz normally and 10 Hz while somebody is in the OR, the procedure's plate and instruments from the theatre, the presence rule,
 * and the live screens' material and 16:9 geometry.
 */
import { LinearFilter, MeshBasicMaterial, SRGBColorSpace } from 'three'
import { describe, expect, it } from 'vitest'
import { SURGERY_COPY } from '@/content/surgery'
import { SURGERY_UI } from '@/content/surgeryUi'
import type { Env, Surface } from '@/scene/imaging/images/ctx'
import { createRecorder, mockSurface } from '@/scene/imaging/images/mockCanvas'
import { areaById } from '@/sim/places'
import { LIVE_ASPECT, LIVE_SCREENS } from './dims'
import { cameraLive, COOL_MS, createLiveResources, HOT_MS, inOr, LIVE_H, LIVE_W, LiveEndoscope, playerInOr } from './liveEndoscope'
import { liveScreensGeometry, screenQuad } from './liveScreens'
import { caseView, dockedRobot, stowedRobot, surgeryState, theatre } from './testkit'
import type { RobotState, SurgeryProcedure, SurgeryState } from '@/sim/types'

/** The theatre around a robot: a case of `procedure` in the console phase. */
const st = (robot: RobotState, procedure: SurgeryProcedure = 'cholecystectomy'): SurgeryState =>
  surgeryState({ theatre: theatre('console', { cases: [caseView('c1', { procedure, consoleStart: 0 })] }), robot })

/** A recording environment that keeps every string drawn. */
function logEnv(): { env: Env; texts: string[]; sizes: [number, number][]; rec: ReturnType<typeof createRecorder> } {
  const rec = createRecorder()
  const texts: string[] = []
  const sizes: [number, number][] = []
  const env: Env = {
    supportsFilter: true,
    createSurface: (w, h): Surface => {
      sizes.push([w, h])
      const s = mockSurface(w, h, rec)
      const ctx = s.ctx as unknown as Record<string, unknown>
      ctx.fillText = (t: string) => {
        texts.push(t)
        rec.calls.set('fillText', (rec.calls.get('fillText') ?? 0) + 1)
      }
      return s
    },
  }
  return { env, texts, sizes, rec }
}

describe('when the camera is live', () => {
  it('is live from the moment the endoscope arm is docked far enough in, until the arms are off: not before, not when stowed', () => {
    expect(cameraLive(stowedRobot())).toBe(false)
    const docking = dockedRobot('transverse', { phase: 'docking' })
    docking.arms[1].engage = 0.3
    expect(cameraLive(docking)).toBe(false)
    docking.arms[1].engage = 0.7
    expect(cameraLive(docking)).toBe(true)
    for (const phase of ['targeting', 'docked', 'undocking'] as const) expect(cameraLive(dockedRobot('transverse', { phase })), phase).toBe(true)
    expect(cameraLive(dockedRobot('transverse', { phase: 'returning' }))).toBe(false)
    expect(cameraLive(dockedRobot('transverse', { phase: 'driving' }))).toBe(false)
  })
})

describe('the live canvas', () => {
  it('is one 384 x 216 (16:9) canvas, painted at construction with the standby picture', () => {
    const { env, texts, sizes } = logEnv()
    const live = new LiveEndoscope(env)
    expect(sizes).toEqual([[LIVE_W, LIVE_H]])
    expect([LIVE_W, LIVE_H]).toEqual([384, 216])
    expect(live.paints).toBe(1)
    expect(texts).toEqual([SURGERY_UI.console.endoscope, SURGERY_COPY.robotPhases.stowed])
  })

  it('paints the standby picture once per robot phase and never again until the phase changes', () => {
    const { env, texts } = logEnv()
    const live = new LiveEndoscope(env)
    let flagged = 0
    live.onDraw = () => flagged++
    const r = stowedRobot('stowed')
    for (let i = 0; i < 100; i++) expect(live.update(st(r), i, i * 16, false)).toBe(false)
    expect(live.paints).toBe(1)
    const d = st(stowedRobot('draping', 0.5))
    expect(live.update(d, 100, 1700, false)).toBe(true)
    expect(live.update(d, 101, 1716, false)).toBe(false)
    expect(texts.slice(-2)).toEqual([SURGERY_UI.console.endoscope, SURGERY_COPY.robotPhases.draping])
    expect(flagged).toBe(1)
  })

  it('repaints the live picture every 500 ms when nobody is in the OR and every 100 ms when somebody is', () => {
    const { env } = logEnv()
    const live = new LiveEndoscope(env)
    const r = st(dockedRobot('transverse'))
    const count = (hot: boolean): number => {
      const start = live.paints
      // 10 seconds of frames at 60 Hz
      for (let f = 0; f < 600; f++) live.update(r, 100 + f / 60, 100_000 + (f * 1000) / 60, hot)
      return live.paints - start
    }
    const cool = count(false)
    expect(cool).toBeGreaterThanOrEqual(10000 / COOL_MS - 2)
    expect(cool).toBeLessThanOrEqual(10000 / COOL_MS + 2)
    // (the second pass runs later on the page clock: shift it)
    const start = live.paints
    for (let f = 0; f < 600; f++) live.update(r, 120 + f / 60, 200_000 + (f * 1000) / 60, true)
    const hot = live.paints - start
    expect(hot).toBeGreaterThanOrEqual(10000 / HOT_MS - 3)
    expect(hot).toBeLessThanOrEqual(10000 / HOT_MS + 3)
    expect(HOT_MS).toBe(100)
    expect(COOL_MS).toBe(500)
  })

  it('paints the current case\'s procedure with the arms\' own instruments, through one painter of its own size, allocation-free view', () => {
    const { env, texts } = logEnv()
    const live = new LiveEndoscope(env)
    const r = dockedRobot('transverse', { arms: dockedRobot('transverse').arms.map((a, i) => ({ ...a, instrument: SURGERY_COPY.procedures.prostatectomy.instruments[i] })) })
    expect(live.update(st(r, 'prostatectomy'), 100, 1000, true)).toBe(true)
    expect(live.view.proc).toBe(2)
    expect(live.painter.w).toBe(LIVE_W)
    expect(live.painter.h).toBe(LIVE_H)
    expect(texts).toEqual(expect.arrayContaining(['Prograsp', 'Bipolar', 'Needle drv', '30°', 'Simulated']))
  })

  it('goes back to standby when the arms come off, once', () => {
    const { env, texts } = logEnv()
    const live = new LiveEndoscope(env)
    live.update(st(dockedRobot('transverse')), 100, 1000, true)
    const back = st(stowedRobot('cleaning', 0.5))
    expect(live.update(back, 3000, 90_000, true)).toBe(true)
    expect(live.update(back, 3001, 90_100, true)).toBe(false)
    expect(texts.slice(-1)).toEqual([SURGERY_COPY.robotPhases.cleaning])
  })
})

describe('who is in the OR', () => {
  const r = areaById('l2Or').rect
  it('is you inside its walls, or the OR focused in the overview', () => {
    const inside = { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 }
    expect(playerInOr(inside)).toBe(true)
    expect(playerInOr({ x: r.x0 - 1, z: inside.z })).toBe(false)
    expect(playerInOr(null)).toBe(false)
    expect(inOr(null, inside, 2)).toBe(true)
    // on level 1 (the sim keeps your level-2 position only while you are on level 2) you are not "in" it
    expect(inOr(null, inside, 1)).toBe(false)
    expect(inOr('l2Or', null, 1)).toBe(true)
    expect(inOr('l2Pacu', null, 2)).toBe(false)
  })
})

describe('the live screens', () => {
  it('are four 16:9 quads (the vision cart, the wall monitor, the two viewers) in ONE geometry with white vertex colours', () => {
    expect(LIVE_SCREENS).toHaveLength(4)
    for (const a of LIVE_SCREENS) expect(a.w / a.h).toBeCloseTo(LIVE_ASPECT, 9)
    expect(LIVE_W / LIVE_H).toBeCloseTo(LIVE_ASPECT, 9)
    const g = liveScreensGeometry()
    expect(g.getAttribute('position').count).toBe(16)
    expect(g.index!.count / 3).toBe(8)
    const color = g.getAttribute('color')
    expect(color.itemSize).toBe(3)
    for (let i = 0; i < color.count; i++) expect([color.getX(i), color.getY(i), color.getZ(i)]).toEqual([1, 1, 1])
    // the uvs cover the whole texture on every quad
    const uv = g.getAttribute('uv')
    expect(uv.count).toBe(16)
    g.dispose()
  })

  it('put each quad at its anchor, facing its heading', () => {
    for (const a of LIVE_SCREENS) {
      const g = screenQuad(a)
      const p = g.getAttribute('position')
      let cx = 0
      let cy = 0
      let cz = 0
      for (let i = 0; i < p.count; i++) {
        cx += p.getX(i) / p.count
        cy += p.getY(i) / p.count
        cz += p.getZ(i) / p.count
      }
      expect(cx).toBeCloseTo(a.at.x, 5)
      expect(cy).toBeCloseTo(a.at.y, 5)
      expect(cz).toBeCloseTo(a.at.z, 5)
      // the face's normal (from the first triangle) points along the heading, tilted up by the lean
      const n = g.getAttribute('normal')
      expect(n.getX(0)).toBeCloseTo(Math.sin(a.heading) * Math.cos(a.tilt ?? 0), 5)
      expect(n.getZ(0)).toBeCloseTo(Math.cos(a.heading) * Math.cos(a.tilt ?? 0), 5)
      expect(n.getY(0)).toBeCloseTo(Math.sin(a.tilt ?? 0), 5)
      g.dispose()
    }
  })

  it('the shared material copies the imaging monitors\' settings (a map, toneMapped false, vertex colours, no custom shader code), so it shares their shader program', () => {
    const { env } = logEnv()
    const res = createLiveResources(env)
    expect(res.material).toBeInstanceOf(MeshBasicMaterial)
    expect(res.material.map).toBe(res.texture)
    expect(res.material.toneMapped).toBe(false)
    expect(res.material.vertexColors).toBe(true)
    expect(res.material.transparent).toBe(false)
    expect(res.material.customProgramCacheKey()).toBe(new MeshBasicMaterial().customProgramCacheKey())
    expect(res.material.onBeforeCompile.toString()).toBe(new MeshBasicMaterial().onBeforeCompile.toString())
    expect(res.texture.colorSpace).toBe(SRGBColorSpace)
    expect(res.texture.generateMipmaps).toBe(false)
    expect(res.texture.minFilter).toBe(LinearFilter)
    // a redraw flags the texture for upload
    const v0 = res.texture.version
    res.live.update(st(dockedRobot('transverse')), 100, 1000, true)
    expect(res.texture.version).toBeGreaterThan(v0)
    res.dispose()
  })
})
