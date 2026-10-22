/** F-44: a restored WebGL context bumps the epoch and tells the owners of GPU-only state (the environments, the shadow map, the pose texture). */
import { describe, expect, it } from 'vitest'
import { glContext, watchContextRestore } from './glContext'

describe('watchContextRestore', () => {
  it('bumps the epoch and calls back on every restore, and stops after the unsubscribe', () => {
    const target = new EventTarget()
    let calls = 0
    const before = glContext.epoch
    const off = watchContextRestore(target, () => calls++)
    target.dispatchEvent(new Event('webglcontextlost'))
    expect(calls).toBe(0)
    expect(glContext.epoch).toBe(before)
    target.dispatchEvent(new Event('webglcontextrestored'))
    target.dispatchEvent(new Event('webglcontextrestored'))
    expect(calls).toBe(2)
    expect(glContext.epoch).toBe(before + 2)
    off()
    target.dispatchEvent(new Event('webglcontextrestored'))
    expect(calls).toBe(2)
  })

  it('Lighting.tsx rebuilds the environments and asks for the shadow map again on a restore', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(`${process.cwd()}/src/scene/Lighting.tsx`, 'utf8')
    expect(src).toContain('watchContextRestore(gl.domElement')
    expect(src).toContain('requestShadow?.()')
    expect(src).toMatch(/\}, \[gl, scene, restores\]\)/) // the PMREM environments
    expect(src).toMatch(/\}, \[gl, restores\]\)/) // the lobby probe
  })
})
