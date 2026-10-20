/**
 * The monitors' three.js side: the material is built exactly like the live strip's (so the renderer reuses that shader program: no new program),
 * the atlas is a fixed DataTexture with flipY false, and each level's ONE mesh tiles every face of that level: the quads lie in the face planes,
 * cover each face exactly, and read the regions the hub painted (or the standby face while a row is empty).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Float32BufferAttribute, InstancedMesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Texture } from 'three'
import { stripComments } from '@/scene/warmup/manifest'
import { faceNormal } from './anchors'
import { MonitorHub } from './hub'
import { createAtlasTexture, createMonitorMaterial, LevelMonitors, quadsOf } from './mesh'
import { erCase, fakeWorld, realDefs, recCtx, recUploader } from './testkit'

const ROOT = process.cwd()

function hubWithPatient() {
  const w = fakeWorld()
  const hub = new MonitorHub(realDefs(), w.env, { sheet: recCtx().ctx })
  hub.attach(recUploader())
  w.er.bays[3].caseId = 'm1'
  w.er.cases.set('m1', erCase('m1', 3))
  hub.clock.advance(0.1, false)
  hub.pump(Infinity)
  return { hub, w }
}

describe('the monitor material shares the live strip\'s program', () => {
  it('has the live strip\'s settings: a map, toneMapped false, vertex colours, opaque, front side, no custom compile', () => {
    const atlas = createAtlasTexture({ width: 64, height: 64 })
    const m = createMonitorMaterial(atlas)
    // the live strip, the endoscope screens and the imaging monitors all build theirs as `new MeshBasicMaterial({ map, toneMapped: false, vertexColors: true })`
    const strip = new MeshBasicMaterial({ map: new Texture(), toneMapped: false, vertexColors: true })
    const programKeys = ['type', 'vertexColors', 'toneMapped', 'transparent', 'side', 'alphaTest', 'alphaHash', 'alphaToCoverage', 'fog', 'blending', 'premultipliedAlpha', 'dithering', 'wireframe', 'forceSinglePass'] as const
    for (const k of programKeys) expect(m[k], k).toEqual(strip[k])
    expect(m.map).toBe(atlas)
    for (const k of ['envMap', 'aoMap', 'lightMap', 'specularMap', 'alphaMap'] as const) expect(m[k], k).toBeNull()
    expect(m.defines ?? {}).toEqual(strip.defines ?? {})
    expect(m.onBeforeCompile.toString()).toBe(strip.onBeforeCompile.toString())
    expect(m.customProgramCacheKey()).toBe(strip.customProgramCacheKey())
    expect(Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile')).toBe(false)
  })

  it('the strip still builds its material that way (if it changes, this file must follow)', () => {
    const pattern = /new MeshBasicMaterial\(\{ map(?:: [^,]+)?, toneMapped: false, vertexColors: true \}\)/
    const strip = stripComments(readFileSync(join(ROOT, 'src/scene/drawCentre/liveTexture.ts'), 'utf8'))
    const mine = stripComments(readFileSync(join(ROOT, 'src/scene/monitors/mesh.ts'), 'utf8'))
    expect(strip).toMatch(pattern)
    expect(mine).toMatch(pattern)
    expect(mine.match(/new \w*Material\(/g)).toHaveLength(1)
    expect(mine).not.toMatch(/onBeforeCompile|ShaderMaterial|customProgramCacheKey/)
  })

  it('the atlas is a fixed sRGB DataTexture, flipY false, mipmapped', () => {
    const t = createAtlasTexture({ width: 2048, height: 1800 })
    expect(t.isDataTexture).toBe(true)
    expect(t.flipY).toBe(false)
    expect(t.colorSpace).toBe(SRGBColorSpace)
    expect(t.generateMipmaps).toBe(true)
    expect(t.image.width).toBe(2048)
    expect(t.image.height).toBe(1800)
    expect((t.image.data as Uint8Array).length).toBe(2048 * 1800 * 4)
  })
})

describe('the level meshes', () => {
  it('are one plain mesh per level (one draw call), with the live strip quads\' attributes: position, normal, uv and a colour of item size 3', () => {
    const { hub } = hubWithPatient()
    const mat = createMonitorMaterial(createAtlasTexture(hub.plan))
    for (const level of [1, 2] as const) {
      const lm = new LevelMonitors(level, hub, mat)
      expect(lm.mesh).not.toBeInstanceOf(InstancedMesh)
      expect(lm.mesh.isMesh).toBe(true)
      // the strip's screens are PlaneGeometry plus a white colour attribute: the same attribute set (three keys the program on the normals' presence)
      const strip = new PlaneGeometry(1, 1)
      strip.setAttribute('color', new Float32BufferAttribute(new Float32Array(4 * 3).fill(1), 3))
      expect(Object.keys(lm.geometry.attributes).sort()).toEqual(Object.keys(strip.attributes).sort())
      expect(Object.keys(lm.geometry.attributes).sort()).toEqual(['color', 'normal', 'position', 'uv'])
      expect(lm.geometry.attributes.normal.itemSize).toBe(3)
      expect(lm.geometry.attributes.color.itemSize).toBe(3)
      expect(Object.keys(lm.geometry.morphAttributes)).toEqual([])
      expect(lm.geometry.groups).toEqual([])
      expect(lm.quads).toBe(lm.monitors.reduce((n, m) => n + quadsOf(m), 0))
      expect(lm.geometry.index!.count).toBe(lm.quads * 6)
      expect(lm.mesh.castShadow).toBe(false)
      expect(lm.monitors.every((m) => m.def.level === level)).toBe(true)
    }
    expect(new LevelMonitors(1, hub, mat).monitors).toHaveLength(10)
    expect(new LevelMonitors(2, hub, mat).monitors).toHaveLength(9)
  })

  it('tile every face exactly, in its plane, at any moment of the sweep', () => {
    const { hub } = hubWithPatient()
    const mat = createMonitorMaterial(createAtlasTexture(hub.plan))
    for (const level of [1, 2] as const) {
      const lm = new LevelMonitors(level, hub, mat)
      for (const t of [0.3, 2.9, 7.7, 31.4]) {
        lm.write(t, hub.plan)
        const pos = lm.geometry.attributes.position.array as Float32Array
        let q = 0
        for (const m of lm.monitors) {
          const a = m.def.anchor
          const n = faceNormal(a)
          let area = 0
          for (let k = 0; k < quadsOf(m); k++, q++) {
            const p = (i: number) => ({ x: pos[q * 12 + i * 3], y: pos[q * 12 + i * 3 + 1], z: pos[q * 12 + i * 3 + 2] })
            const [tl, bl, br] = [p(0), p(1), p(2)]
            for (const v of [p(0), p(1), p(2), p(3)]) expect((v.x - a.x) * n.x + (v.y - a.y) * n.y + (v.z - a.z) * n.z).toBeCloseTo(0, 4)
            area += Math.hypot(br.x - bl.x, br.y - bl.y, br.z - bl.z) * Math.hypot(tl.x - bl.x, tl.y - bl.y, tl.z - bl.z)
          }
          expect(area, m.def.id).toBeCloseTo(a.w * a.h, 4)
          const nrm = lm.geometry.attributes.normal.array as Float32Array
          const v0 = (q - 1) * 4
          expect(nrm[v0 * 3] * n.x + nrm[v0 * 3 + 1] * n.y + nrm[v0 * 3 + 2] * n.z, m.def.id).toBeCloseTo(1, 5)
        }
      }
    }
  })

  it('read the standby face for empty rows and the painted regions for a live one, inside the atlas', () => {
    const { hub } = hubWithPatient()
    const mat = createMonitorMaterial(createAtlasTexture(hub.plan))
    const lm = new LevelMonitors(1, hub, mat)
    lm.write(5, hub.plan)
    const uv = lm.geometry.attributes.uv.array as Float32Array
    let q = 0
    for (const m of lm.monitors) {
      const idle = hub.plan.idle[m.layout.id]
      const live = m.rows[0].live
      for (let k = 0; k < quadsOf(m); k++, q++) {
        for (let i = 0; i < 4; i++) {
          const u = uv[q * 8 + i * 2] * hub.plan.width
          const v = uv[q * 8 + i * 2 + 1] * hub.plan.height
          expect(u).toBeGreaterThanOrEqual(-1e-3)
          expect(u).toBeLessThanOrEqual(hub.plan.width + 1e-3)
          if (!live) {
            expect(u, m.def.id).toBeGreaterThanOrEqual(idle.x - 1e-3)
            expect(u, m.def.id).toBeLessThanOrEqual(idle.x + idle.w + 1e-3)
            expect(v, m.def.id).toBeGreaterThanOrEqual(idle.y - 1e-3)
            expect(v, m.def.id).toBeLessThanOrEqual(idle.y + idle.h + 1e-3)
          }
        }
        // the top-left corner reads a smaller atlas row than the bottom-left (flipY false: the picture's top row is its first row)
        expect(uv[q * 8 + 1]).toBeLessThanOrEqual(uv[q * 8 + 3])
      }
    }
    expect(hub.monitors.find((m) => m.def.id === 'er:3')!.rows[0].live).toBe(true)
    expect(lm.monitors.filter((m) => m.rows[0].live).map((m) => m.def.id)).toEqual(['er:3'])
  })
})
