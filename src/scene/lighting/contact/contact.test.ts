/**
 * Realism step 2: the soft contact shadows (./material.ts, ./registry.ts, ./footprints.ts, ./ContactShadows.tsx): the buffer writes what the
 * shader reads, the sources are asked once a frame, hidden things cast nothing, footprints find what stands on the floor, and nothing on the
 * per-frame path allocates.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BoxGeometry, Group, Matrix4, Quaternion, Scene, ShaderChunk, Vector3, type BufferAttribute } from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import { floorFootprints } from './footprints'
import { CONTACT_FRAGMENT_MAIN, CONTACT_PROGRAM_KEY, contactProfile, createContactShadowMaterial, patchContactShader } from './material'
import { CONTACT_LIFT, ContactBuffer, clearContactSources, contactSourceNames, registerContactSource, shownInScene, writeContacts } from './registry'
import { createContactLayer } from './ContactShadows'
import { layoutShadows, writeStaticShadows } from './layoutShadows'
import { getLayout } from '@/scene/building/layout'
import { LEVEL2_DX, LEVEL_Y } from '@/sim/levels'

afterEach(() => clearContactSources())

describe('ContactBuffer', () => {
  it('writes a quad of the footprint plus its penumbra, turned to the heading, lifted off the floor, and the shape in metres', () => {
    const b = new ContactBuffer(4)
    expect(b.add(2, 0, 3, Math.PI / 2, 0.5, 0.3, 0.1, 0.25, 0.6)).toBe(true)
    const m = new Matrix4().fromArray(b.matrix, 0)
    const p = new Vector3()
    const q = new Quaternion()
    const s = new Vector3()
    m.decompose(p, q, s)
    expect(p.toArray()).toEqual([2, Math.fround(CONTACT_LIFT), 3])
    expect(s.x).toBeCloseTo(2 * (0.5 + 0.25), 6)
    expect(s.z).toBeCloseTo(2 * (0.3 + 0.25), 6)
    // heading 90 degrees: the quad's own x runs along world -z (three's rotation about y)
    expect(new Vector3(1, 0, 0).applyMatrix4(m).sub(p).normalize().toArray().map((v) => Math.round(v))).toEqual([0, 0, -1])
    expect(Array.from(b.shape.slice(0, 4))).toEqual([0.5, 0.3, 0.1, 0.25].map(Math.fround))
    expect(b.fade[0]).toBeCloseTo(0.6, 6)
  })

  it('clamps the corner radius to the footprint, ignores empty shadows and stops when full', () => {
    const b = new ContactBuffer(2)
    b.add(0, 0, 0, 0, 0.2, 0.1, 5, 0.3, 0.5)
    expect(b.shape[2]).toBeCloseTo(0.1, 6)
    expect(b.add(0, 0, 0, 0, 0.2, 0.1, 0, 0.3, 0)).toBe(false)
    expect(b.add(0, 0, 0, 0, 0, 0.1, 0, 0.3, 0.5)).toBe(false)
    expect(b.add(0, 0, 0, 0, 0.2, 0.1, 0, 0.3, 0.5)).toBe(true)
    expect(b.add(0, 0, 0, 0, 0.2, 0.1, 0, 0.3, 0.5)).toBe(false)
    expect(b.count).toBe(2)
  })
})

describe('the registry', () => {
  it('asks every source once a frame (a source of the same name replaces the old one), skips one that throws, and forgets a removed one', () => {
    const buf = new ContactBuffer(8)
    const one = registerContactSource({ name: 'a', write: (b) => void b.add(0, 0, 0, 0, 0.2, 0.2, 0.1, 0.2, 0.5) })
    registerContactSource({ name: 'boom', write: () => { throw new Error('x') } })
    registerContactSource({ name: 'b', write: (b) => void b.add(1, 0, 0, 0, 0.2, 0.2, 0.1, 0.2, 0.5) })
    registerContactSource({ name: 'b', write: (b) => { b.add(1, 0, 0, 0, 0.2, 0.2, 0.1, 0.2, 0.5); b.add(2, 0, 0, 0, 0.2, 0.2, 0.1, 0.2, 0.5) } })
    expect(contactSourceNames()).toEqual(['a', 'boom', 'b'])
    expect(writeContacts(buf)).toBe(3)
    one()
    expect(writeContacts(buf)).toBe(2)
  })

  it('shownInScene: attached to a scene and visible all the way up', () => {
    const scene = new Scene()
    const level = new Group()
    const thing = new Group()
    level.add(thing)
    expect(shownInScene(thing)).toBe(false) // not in a scene
    scene.add(level)
    expect(shownInScene(thing)).toBe(true)
    level.visible = false // the overview showing the other storey
    expect(shownInScene(thing)).toBe(false)
    expect(shownInScene(null)).toBe(false)
  })
})

describe('the layer', () => {
  it('draws exactly what the sources wrote, uploading only those rows, with the one shared program', () => {
    const layer = createContactLayer(16)
    expect(layer.mesh.count).toBe(0)
    registerContactSource({ name: 's', write: (b) => { for (let i = 0; i < 3; i++) b.add(i, 0, 0, 0, 0.3, 0.3, 0.1, 0.2, 0.5) } })
    expect(layer.step()).toBe(3)
    expect(layer.mesh.count).toBe(3)
    expect(layer.mesh.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 48 }])
    expect((layer.mesh.geometry.getAttribute('aShape') as BufferAttribute).updateRanges).toEqual([{ start: 0, count: 12 }])
    expect((layer.mesh.material as { customProgramCacheKey(): string }).customProgramCacheKey()).toBe(CONTACT_PROGRAM_KEY)
    clearContactSources()
    expect(layer.step()).toBe(0)
    expect(layer.mesh.count).toBe(0)
    layer.dispose()
  })
})

describe('the material', () => {
  it('patches the stock basic shader once at its anchors, shares one program and keeps its darkness per material', () => {
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: ShaderChunk.meshbasic_vert, fragmentShader: ShaderChunk.meshbasic_frag }
    const dark = { value: 0.6 }
    patchContactShader(shader as never, dark)
    expect(shader.vertexShader).toContain('attribute vec4 aShape;')
    expect(shader.fragmentShader).toContain(CONTACT_FRAGMENT_MAIN.trim())
    expect(shader.fragmentShader.indexOf(CONTACT_FRAGMENT_MAIN.trim())).toBeGreaterThan(shader.fragmentShader.indexOf('#include <color_fragment>'))
    expect(shader.uniforms.uContactDark).toBe(dark)
    const a = createContactShadowMaterial(0.6)
    const b = createContactShadowMaterial(1)
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey())
    expect(a.transparent && !a.depthWrite).toBe(true)
  })

  it('the profile: full under the footprint, a soft tail, nothing one penumbra out', () => {
    expect(contactProfile(-0.2, 0.3)).toBe(1)
    expect(contactProfile(0, 0.3)).toBeGreaterThan(0.5)
    expect(contactProfile(0.15, 0.3)).toBeLessThan(contactProfile(0.05, 0.3))
    expect(contactProfile(0.3, 0.3)).toBe(0)
  })
})

describe('floorFootprints', () => {
  const box = (w: number, h: number, d: number, x: number, y: number, z: number): { pos: Float32Array; index: Uint16Array | Uint32Array } => {
    const g = new BoxGeometry(w, h, d).translate(x, y + h / 2, z)
    return { pos: g.attributes.position.array as Float32Array, index: g.index!.array as Uint16Array }
  }
  const merge = (...parts: { pos: Float32Array; index: ArrayLike<number> }[]): { pos: Float32Array; index: Uint32Array } => {
    const pos: number[] = []
    const index: number[] = []
    for (const p of parts) {
      const base = pos.length / 3
      pos.push(...p.pos)
      for (const i of Array.from(p.index)) index.push(i + base)
    }
    return { pos: Float32Array.from(pos), index: Uint32Array.from(index) }
  }

  it('a block on the floor is one footprint of its own size', () => {
    const b = box(1, 0.8, 0.6, 2, 0, 3)
    const [f, ...rest] = floorFootprints(b.pos, b.index, null)
    expect(rest).toEqual([])
    expect(f.cx).toBeCloseTo(2, 1)
    expect(f.cz).toBeCloseTo(3, 1)
    expect(f.halfX).toBeGreaterThan(0.45)
    expect(f.halfX).toBeLessThan(0.6)
    expect(f.halfZ).toBeGreaterThan(0.25)
    expect(f.halfZ).toBeLessThan(0.4)
    expect(f.y).toBeCloseTo(0, 6)
  })

  it('a table: four legs on the floor, not the top; a matrix moves it; what floats above the band casts nothing', () => {
    const legs = [-0.6, 0.6].flatMap((x) => [-0.3, 0.3].map((z) => box(0.06, 0.72, 0.06, x, 0, z)))
    const t = merge(...legs, box(1.4, 0.04, 0.8, 0, 0.72, 0))
    const fps = floorFootprints(t.pos, t.index, new Matrix4().makeTranslation(10, 0, 0).elements, { band: 0.3 })
    expect(fps.length).toBe(4)
    for (const f of fps) {
      expect(Math.abs(Math.abs(f.cx - 10) - 0.6)).toBeLessThan(0.1)
      expect(f.halfX).toBeLessThan(0.15)
    }
    const shelf = box(1, 0.3, 0.3, 0, 1.2, 0)
    expect(floorFootprints(shelf.pos, shelf.index, null, { floorY: 0 })).toEqual([])
  })
})

describe('device shadows from the layout footprints (kiosks, draw centre, lab, theatre)', () => {
  const fps = getLayout().footprints
  const style = { darkness: 0.5, pen: 0.22 }

  it('every device id the layers ask for exists, level 2 is moved over the building, overhead ones never cast', () => {
    expect(layoutShadows(fps, (id) => /^lobby:kiosk\d+$/.test(id), style).length).toBe(2)
    expect(layoutShadows(fps, (id) => /^draw:(robot\d+|prep|checkin|send)$/.test(id), style).length).toBe(6)
    expect(layoutShadows(fps, (id) => id.startsWith('lab:'), style).length).toBeGreaterThanOrEqual(10)
    const or = layoutShadows(fps, (id) => /^l2:or:(table|console:surgeon|console:teach|vision|anaesthesia)$/.test(id), style)
    expect(or.length).toBe(5)
    for (const s of or) {
      expect(s.y).toBe(LEVEL_Y[2])
      expect(s.x).toBeLessThan(-30) // drawn over the west block, not on the sim's strip
    }
    const src = fps.find((f) => f.id === 'l2:or:vision')!
    expect(or.find((s) => Math.abs(s.x - (src.x - LEVEL2_DX)) < 1e-9)?.heading).toBe(src.rotationY)
    expect(layoutShadows([{ id: 'x', kind: 'rect', x: 0, z: 0, hw: 1, hd: 1, rotationY: 0, overhead: true }], () => true, style)).toEqual([])
    const [c] = layoutShadows([{ id: 'c', kind: 'circle', x: 0, z: 0, hw: 0.3, hd: 0.3, rotationY: 0 }], () => true, style)
    expect([c.halfX, c.halfZ, c.radius]).toEqual([0.3, 0.3, 0.3])
  })

  it('writes them only while the layer is drawn', () => {
    const list = layoutShadows(fps, (id) => /^lobby:kiosk\d+$/.test(id), style)
    const root = new Group()
    const buf = new ContactBuffer(8)
    writeStaticShadows(root, list, buf)
    expect(buf.count).toBe(0)
    new Scene().add(root)
    writeStaticShadows(root, list, buf)
    expect(buf.count).toBe(2)
  })
})

// ----------------------------------------------------------------------------------------------------------------------------------------
// nothing on the per-frame path allocates (reads the source, as src/scene/building/model/noAllocations.test.ts does)
// ----------------------------------------------------------------------------------------------------------------------------------------

const ROOT = join(process.cwd(), 'src/scene')

function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (m) => m.replace(/[^\n]/g, ' '))
}

function bodyOf(src: string, name: string): string {
  const header = new RegExp(`(?:function\\s+${name}\\s*\\(|(?:const|let)\\s+${name}\\s*(?::[^=]+)?=\\s*\\(|^[ \\t]*(?:(?:private|public|protected|readonly|static|get|set)\\s+)*${name}\\s*\\()`, 'm')
  const m = header.exec(src)
  if (!m) throw new Error(`no function ${name}`)
  let i = m.index + m[0].length
  let depth = 1
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')') depth--
  }
  const open = src.indexOf('{', i)
  let braces = 0
  let end = open
  for (; end < src.length; end++) {
    if (src[end] === '{') braces++
    else if (src[end] === '}' && --braces === 0) break
  }
  return src.slice(open, end + 1)
}

const FLAGGED: [RegExp, string][] = [
  [/\bnew\s+[A-Za-z]/, 'new'],
  [/(^|[=(,:?&|]|\breturn)\s*\[/m, 'array literal'],
  [/(^|[=(,?&|]|\breturn)\s*\{\s*[a-zA-Z_]+\s*:/m, 'object literal'],
  [/\.\.\./, 'spread'],
  [/=>/, 'closure'],
  [/\.(map|filter|reduce|slice|concat|some|every|find|findIndex)\(/, 'array method'],
  [/\bfunction\b/, 'inner function'],
]

const PATHS: Record<string, string[]> = {
  'lighting/contact/registry.ts': ['add', 'writeContacts', 'shownInScene'],
  'lighting/contact/ContactShadows.tsx': ['uploadFirst', 'step'],
  'building/model/zoneLoader.ts': ['writeKitShadows'],
  'imaging/machines/index.tsx': ['writeMachineShadows'],
  'lighting/contact/layoutShadows.ts': ['writeStaticShadows'],
  'surgery/SurgeryLayer.tsx': ['writeCartShadow'],
}

describe('the contact shadows allocate nothing per frame', () => {
  for (const [file, names] of Object.entries(PATHS)) {
    const src = code(readFileSync(join(ROOT, file), 'utf8'))
    for (const name of names) {
      it(`${file} ${name}`, () => {
        const body = bodyOf(src, name)
        const found = FLAGGED.filter(([re]) => re.test(body)).map(([, what]) => what)
        expect(found, body).toEqual([])
      })
    }
  }
})
