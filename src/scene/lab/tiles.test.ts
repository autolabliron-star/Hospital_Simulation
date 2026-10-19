/**
 * The lab's four status tiles in node: where they register, that their version changes exactly when what they show changes, and that the painters
 * draw the right words from the lab state (against a recording canvas context). The atlas rig that repaints them is in w4kit/statusRig.test.ts.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { LAB_UI } from '@/content/labUi'
import { newLabState } from '@/sim/lab'
import type { LabState } from '@/sim/types'
import { createStatusRig } from '@/scene/w4kit/statusRig'
import { w4Tiles, W4_TILE, W4_TILE_PX } from '@/scene/w4kit/tiles'
import { SCREENS } from './labDims'
import { archiveVersion, ARCHIVE_PLACES, centrifugeVersion, labStatusVersion, paintArchive, paintCentrifuges, paintLabStatus, paintReceive, receiveVersion, registerLabTiles, versionOf } from './tiles'

function recorder() {
  const texts: string[] = []
  const target: Record<string, unknown> = {
    measureText: (s: string) => ({ width: s.length * 8 }),
    fillText: (s: string) => void texts.push(s),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  }
  const ctx = new Proxy(target, { get: (t, k: string) => (k in t ? t[k] : () => {}), set: (t, k: string, v) => ((t[k] = v), true) }) as unknown as CanvasRenderingContext2D
  return { ctx, texts }
}
const paint = (fn: (c: CanvasRenderingContext2D, w: number, h: number, s: LabState) => void, s: LabState): string[] => {
  const r = recorder()
  fn(r.ctx, W4_TILE_PX.w, W4_TILE_PX.h, s)
  return r.texts
}

const cleanup: (() => void)[] = []
afterEach(() => {
  while (cleanup.length) cleanup.pop()!()
})

describe('registering the lab tiles', () => {
  it('registers the four tiles at the contract indexes with the screens\' anchors, and removes them again', () => {
    const state = newLabState()
    const off = registerLabTiles(() => state)
    cleanup.push(off)
    const reg = w4Tiles()
    for (const [name, index] of [
      ['labStatus', W4_TILE.labStatus],
      ['centrifuge', W4_TILE.centrifuge],
      ['labReceive', W4_TILE.labReceive],
      ['archive', W4_TILE.archive],
    ] as const) {
      const t = reg.get(index)!
      expect(t, name).toBeDefined()
      expect(t.anchor).toBe(SCREENS[name])
      expect(typeof t.version()).toBe('number')
    }
    off()
    for (const index of [10, 11, 12, 13]) expect(reg.has(index)).toBe(false)
    cleanup.length = 0
  })

  it('shows up in the atlas rig: four quads placed, painted once, quiet until the lab changes', () => {
    const state = newLabState()
    cleanup.push(registerLabTiles(() => state))
    const painted: number[] = []
    const rig = createStatusRig({ atlas: { texture: { needsUpdate: false, dispose() {} }, paint: (i) => void painted.push(i) } })
    rig.step({ generation: 0, now: 0 })
    expect(rig.shown()).toEqual([10, 11, 12, 13])
    expect(painted.sort()).toEqual([10, 11, 12, 13])
    for (let f = 1; f < 120; f++) rig.step({ generation: 0, now: f / 60 })
    expect(painted.length).toBe(4)
    state.archived = 7
    for (let f = 120; f < 140; f++) rig.step({ generation: 0, now: f / 60 })
    expect(painted.length).toBe(6) // the archive screen and the totem (both show the archive count)
    rig.dispose()
  })
})

describe('the tiles\' versions', () => {
  it('change exactly when what the screen shows changes', () => {
    const s = newLabState()
    const v0 = [labStatusVersion(s), centrifugeVersion(s), receiveVersion(s), archiveVersion(s)]
    expect([labStatusVersion(s), centrifugeVersion(s), receiveVersion(s), archiveVersion(s)]).toEqual(v0)
    s.kpis.samplesToday = 3
    expect(labStatusVersion(s)).not.toBe(v0[0])
    expect(centrifugeVersion(s)).toBe(v0[1])
    expect(receiveVersion(s)).toBe(v0[2])
    const v1 = labStatusVersion(s)
    s.pneumatic.inFlight = 'S1'
    expect(labStatusVersion(s)).not.toBe(v1)
    expect(receiveVersion(s)).not.toBe(v0[2])
    s.centrifuges[1].phase = 'spinning'
    s.centrifuges[1].timeLeft = 300
    const c1 = centrifugeVersion(s)
    expect(c1).not.toBe(v0[1])
    s.centrifuges[1].timeLeft = 299.4 // still "300 s left" on the screen: no change
    expect(centrifugeVersion(s)).toBe(c1)
    s.centrifuges[1].timeLeft = 298.6
    expect(centrifugeVersion(s)).not.toBe(c1)
    s.archived = 9
    expect(archiveVersion(s)).not.toBe(v0[3])
    expect(versionOf(1, 2)).not.toBe(versionOf(2, 1))
  })
})

describe('the painters', () => {
  it('paint the totem: the day\'s numbers, the turnaround, the review queue and a "Simulated" line', () => {
    const s = newLabState()
    s.kpis = { samplesToday: 31, onTrack: 5, medianTatMin: 27.2, autoVerifiedPct: 85 }
    s.reviewQueue = 2
    const t = paint(paintLabStatus, s)
    expect(t).toContain(LAB_UI.tiles.labStatus.title)
    expect(t).toContain('31')
    expect(t).toContain('5')
    expect(t).toContain('27 min')
    expect(t).toContain('2')
    expect(t).toContain(LAB_UI.simulated)
    expect(t).not.toContain(LAB_UI.tiles.labStatus.flight)
    s.pneumatic.inFlight = 'S9'
    expect(paint(paintLabStatus, s)).toContain(LAB_UI.tiles.labStatus.flight)
    s.kpis.medianTatMin = null
    expect(paint(paintLabStatus, s)).toContain('–')
  })

  it('paint both centrifuges with their phase, load and time left', () => {
    const s = newLabState()
    s.centrifuges[0] = { ...s.centrifuges[0], phase: 'spinning', load: 18, capacity: 24, rpm01: 0.8, timeLeft: 185, program: 'routine' }
    s.centrifuges[1] = { ...s.centrifuges[1], phase: 'loading', load: 4, capacity: 24, program: 'stat' }
    const t = paint(paintCentrifuges, s)
    expect(t).toContain(LAB_UI.tiles.centrifuge.title)
    expect(t).toContain('C1')
    expect(t).toContain('C2')
    expect(t).toContain(LAB_UI.tiles.centrifuge.spinning)
    expect(t).toContain(LAB_UI.tiles.centrifuge.loading)
    expect(t).toContain('18 of 24 tubes')
    expect(t).toContain('3:05 left')
    expect(t).toContain(LAB_UI.tiles.centrifuge.program.stat)
  })

  it('paint the receive station: the queue, an arriving tube, the sends today', () => {
    const s = newLabState()
    expect(paint(paintReceive, s)).toContain(LAB_UI.tiles.labReceive.none)
    s.pneumatic = { inFlight: 'S1', queued: 3, sentToday: 14 }
    const t = paint(paintReceive, s)
    expect(t).toContain('3 tubes waiting')
    expect(t).toContain(LAB_UI.tiles.labReceive.incoming)
    expect(t).toContain('14 sends today')
  })

  it('paint the archive: temperature, the count and the places used', () => {
    const s = newLabState()
    s.archived = 123
    const t = paint(paintArchive, s)
    expect(t).toContain(LAB_UI.tiles.archive.temp)
    expect(t).toContain('123 tubes')
    expect(t).toContain(`123 of ${ARCHIVE_PLACES} places used`)
  })

  it('keep every text short enough for a 320 px tile (the measuring context says 8 px a character)', () => {
    const s = newLabState()
    s.kpis = { samplesToday: 9999, onTrack: 64, medianTatMin: 123, autoVerifiedPct: 90 }
    s.centrifuges[0].phase = 'spinning'
    s.pneumatic = { inFlight: 'S1', queued: 12, sentToday: 1234 }
    s.archived = 960
    for (const fn of [paintLabStatus, paintCentrifuges, paintReceive, paintArchive]) for (const text of paint(fn, s)) expect(text.length * 8, text).toBeLessThan(W4_TILE_PX.w - 20)
  })
})
