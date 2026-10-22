/**
 * F-10: n8ao's transparency auto-detect (always true here: the glass material is transparent) re-rendered the whole scene twice more per frame.
 * The ref callback of Effects.tsx runs `disableAoTransparency`; this proves, on a REAL n8ao pass, that afterwards a scene with a transparent
 * material no longer switches the mode on. (Setting `transparencyAware = false` alone is not enough: n8ao only stops auto-detecting when the
 * value changes, and it starts at false.)
 */
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene } from 'three'
// @ts-ignore n8ao ships no type declarations
import { N8AOPostPass } from 'n8ao'
import { describe, expect, it } from 'vitest'
import { disableAoTransparency, type AoPass } from './Effects'

function sceneWithGlass(): Scene {
  const scene = new Scene()
  scene.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ transparent: true, opacity: 0.4 })))
  return scene
}

describe('Effects: the AO pass is not transparency aware', () => {
  it('without the fix, a transparent material turns the mode on (the control)', () => {
    const pass = new N8AOPostPass(sceneWithGlass(), new PerspectiveCamera(), 64, 64)
    pass.detectTransparency()
    expect(pass.configuration.transparencyAware).toBe(true)
  })

  it('after disableAoTransparency, transparencyAware is false and stays false through detection', () => {
    const pass = new N8AOPostPass(sceneWithGlass(), new PerspectiveCamera(), 64, 64)
    disableAoTransparency(pass as unknown as AoPass)
    expect(pass.configuration.transparencyAware).toBe(false)
    pass.detectTransparency()
    pass.detectTransparency()
    expect(pass.configuration.transparencyAware).toBe(false)
  })

  it('Effects.tsx applies it in the AO ref callback, before the first frame', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(`${process.cwd()}/src/scene/Effects.tsx`, 'utf8')
    const ref = src.slice(src.indexOf('const aoRef = useCallback('), src.indexOf('useEffect(() => {\n    apply()'))
    expect(ref).toContain('disableAoTransparency(pass)')
  })
})
