import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearWarmGates, warmGateNames, warmGatesPending } from '@/scene/warmup/registry'
import { VolumeBaker, bakeLightVolume } from './bake'
import { buildVolumeInput } from './input'
import { SLICE_MS, ensureLightVolume, lightVolume, resetLightVolume, runSliced, type BakeClock } from './texture'
import { NEUTRAL_TEXEL, lvUniforms, volumeTexture } from './uniforms'

/** A clock where every read costs `tick` ms and a frame costs 16 ms, with no real waiting. */
function fakeClock(tick = 0.05): BakeClock & { frames: number; time: number } {
  const c = {
    time: 0,
    frames: 0,
    now: () => (c.time += tick),
    frame: async () => {
      c.frames++
      c.time += 16
    },
  }
  return c
}

describe('baking behind the loading screen', () => {
  beforeEach(() => {
    clearWarmGates()
    resetLightVolume()
  })
  afterEach(() => {
    clearWarmGates()
    resetLightVolume()
  })

  it('works in slices of about 8 ms with a frame between, and finishes', async () => {
    expect(SLICE_MS).toBe(8)
    const clock = fakeClock()
    const baker = new VolumeBaker(buildVolumeInput())
    const r = await runSliced(baker, SLICE_MS, clock)
    expect(baker.done).toBe(true)
    expect(r.slices).toBeGreaterThan(3)
    // a frame between every pair of slices, none after the last
    expect(clock.frames).toBe(r.slices - 1)
    // one clock read per 16 columns: a slice can overshoot its budget by one block, never more
    expect(r.longestMs).toBeLessThanOrEqual(SLICE_MS + 0.2)
    expect(Buffer.compare(Buffer.from(baker.data), Buffer.from(bakeLightVolume(buildVolumeInput())))).toBe(0)
  })

  it('starts the bake once, holds the warm-up behind a gate until it lands, then fills the texture and flags it for upload', async () => {
    const versionBefore = volumeTexture.version
    const bytes = volumeTexture.image.data as Uint8Array
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([...NEUTRAL_TEXEL]) // neutral until the bake lands
    expect(lvUniforms.uLvTex.value).toBe(volumeTexture)

    const clock = fakeClock()
    const done = ensureLightVolume(clock)
    expect(warmGateNames()).toContain('light-volume')
    expect(warmGatesPending()).toBe(1)
    expect(ensureLightVolume(clock)).toBe(done) // a second mount (StrictMode) starts nothing new
    await done
    expect(warmGatesPending()).toBe(0)
    expect(lightVolume.baked).toBe(true)
    expect(lightVolume.failed).toBe(false)
    expect(lightVolume.slices).toBeGreaterThan(3)
    expect(volumeTexture.version).toBeGreaterThan(versionBefore)
    expect(Buffer.compare(Buffer.from(volumeTexture.image.data as Uint8Array), Buffer.from(bakeLightVolume(buildVolumeInput())))).toBe(0)
    // the very same texture object the shared uniform holds: no material is touched
    expect(lvUniforms.uLvTex.value).toBe(volumeTexture)
  })

  it('has a texture of the right shape and filtering', () => {
    expect(volumeTexture.image.width).toBe(204)
    expect(volumeTexture.image.height).toBe(88)
    expect(volumeTexture.image.depth).toBe(6)
    expect(volumeTexture.generateMipmaps).toBe(false)
    expect(volumeTexture.name).toBe('light-volume')
  })
})
