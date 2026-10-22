import { describe, expect, it } from 'vitest'
import { Texture, type WebGLRenderTarget, type WebGLRenderer } from 'three'
import { LOBBY_ENV_FILE, LOBBY_MAX_Y, loadLobbyEnvironment, lobbyEnvForCamera, lobbyEnvWanted, lobbyProbe } from './lobbyProbe'
import { SKY_HORIZON_DAY, SKY_ZENITH_DAY, skyUniforms } from './skyUniforms'

const gl = {} as WebGLRenderer

describe('the lobby probe', () => {
  it('is a file under assets/building and is never wanted before it has loaded or without ?building=model (node: procedural)', () => {
    expect(LOBBY_ENV_FILE).toBe('assets/building/env_lobby.hdr')
    lobbyProbe.ready = true
    // in node the page flag is procedural, so even a loaded probe is not bound
    expect(lobbyEnvWanted(-50, 1.6, 0)).toBe(false)
    expect(lobbyEnvForCamera({ position: { x: -50, y: 1.6, z: 0 } })).toBe(false)
    lobbyProbe.ready = false
    expect(LOBBY_MAX_Y).toBeLessThan(4.2) // level 2 is drawn 4.2 m up
  })

  it('a missing or corrupt file resolves null (silent fallback to today environments)', async () => {
    const urls: string[] = []
    const r = await loadLobbyEnvironment(gl, '/base/', {
      load: (url) => {
        urls.push(url)
        return Promise.reject(new Error('404'))
      },
      pmrem: () => {
        throw new Error('not reached')
      },
    })
    expect(r).toBeNull()
    expect(urls).toEqual(['/base/assets/building/env_lobby.hdr'])
  })

  it('a loaded file is PMREM-ed once, mapped as an equirect, and its source texture is released', async () => {
    const source = new Texture()
    let disposed = false
    source.addEventListener('dispose', () => (disposed = true))
    const target = { texture: new Texture() } as unknown as WebGLRenderTarget
    let pmremCalls = 0
    const r = await loadLobbyEnvironment(gl, '/', {
      load: () => Promise.resolve(source),
      pmrem: (s) => {
        pmremCalls++
        expect(s.mapping).toBe(303) // EquirectangularReflectionMapping
        return target
      },
    })
    expect(r).toBe(target)
    expect(pmremCalls).toBe(1)
    expect(disposed).toBe(true)
  })

  it('a failure inside the PMREM also resolves null', async () => {
    const r = await loadLobbyEnvironment(gl, '/', {
      load: () => Promise.resolve(new Texture()),
      pmrem: () => {
        throw new Error('no float render targets')
      },
    })
    expect(r).toBeNull()
  })
})

describe('the sky dome uniforms', () => {
  it('start as the flat day sky, indoor blend 0 (the dome is not drawn in the overview)', () => {
    expect(skyUniforms.uBlend.value).toBe(0)
    expect(skyUniforms.uDay.value).toBe(1)
    expect(skyUniforms.uZenith.value.b).toBeCloseTo(SKY_ZENITH_DAY[2], 9)
    expect(skyUniforms.uHorizon.value.b).toBeCloseTo(SKY_HORIZON_DAY[2], 9)
  })
  it('the day gradient is bluer overhead than at the horizon and brighter at the horizon (a hazy daylight sky)', () => {
    const lum = (c: readonly [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    expect(lum(SKY_HORIZON_DAY)).toBeGreaterThan(lum(SKY_ZENITH_DAY))
    // blue share: the zenith is the bluer
    const share = (c: readonly [number, number, number]) => c[2] / (c[0] + c[1] + c[2])
    expect(share(SKY_ZENITH_DAY)).toBeGreaterThan(share(SKY_HORIZON_DAY))
    // and the horizon stays about at the bloom threshold, so the sky through a window does not glow
    expect(lum(SKY_HORIZON_DAY)).toBeLessThan(1.35)
  })
})
