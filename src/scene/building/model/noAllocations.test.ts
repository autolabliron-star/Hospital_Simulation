/**
 * What runs every frame for the authored building allocates nothing: no `new`, no array or object literals, no spreads, no closures, no array
 * methods (reads the source, as src/scene/levels/noAllocations.test.ts does): the zone culling, the clip planes, the runtime's per-frame calls,
 * the probe selection and the reflection box. (src/scene/frameAllocations.test.ts guards the `useFrame` bodies themselves, ZonesModel's included.)
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(process.cwd(), 'src/scene')

/** Code with comments and string contents blanked, keeping line numbers. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (m) => m.replace(/[^\n]/g, ' '))
}

/** The body of the function, arrow constant or method called `name`. */
function bodyOf(src: string, name: string): string {
  const header = new RegExp(
    `(?:function\\s+${name}\\s*\\(|(?:const|let)\\s+${name}\\s*(?::[^=]+)?=\\s*\\(|^[ \\t]*(?:(?:private|public|protected|readonly|static|get|set)\\s+)*${name}\\s*\\()`,
    'm',
  )
  const m = header.exec(src)
  if (!m) throw new Error(`no function ${name}`)
  let i = m.index + m[0].length
  let depth = 1
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')') depth--
  }
  const rest = src.slice(i, i + 200)
  const arrow = /^\s*(?::[^=]*)?=>\s*(?!\{)/.exec(rest)
  if (arrow) return src.slice(i + arrow[0].length, src.indexOf('\n', i + arrow[0].length))
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
  [/\.(map|filter|reduce|slice|concat|some|every|find)\(/, 'array method'],
  [/\bfunction\b/, 'inner function'],
]

const PATHS: Record<string, string[]> = {
  'building/model/culling.ts': ['frustumOf', 'levelAllows', 'cameraZoneIndex', 'zoneLodDistance', 'wantsFull', 'cullZones'],
  'building/model/zones.ts': ['zoneContainsDrawn', 'zoneDistance'],
  'building/model/clip.ts': ['updateModelClips', 'modelClipHeight'],
  'building/model/runtime.ts': ['setView', 'cull', 'uploadStep'],
  // what a zone's drawn state does to the procedural parts (the core floor, the atrium trees, the cells) when it is READ; the flip itself is
  // event-driven (setCellReplaced, once, in the call that mounts the zone)
  'building/model/cells.ts': ['cellReplaced', 'apply'],
  'building/model/reflections.ts': ['setReflectionBox', 'updateModelReflections'],
  'lighting/env/lobbyProbe.ts': ['selectZoneProbe', 'storeyAt', 'usable', 'lobbyEnvWanted', 'lobbyEnvForCamera'],
}

describe('the authored building allocates nothing per frame', () => {
  for (const [file, names] of Object.entries(PATHS)) {
    const src = code(readFileSync(join(ROOT, file), 'utf8'))
    for (const name of names) {
      it(`${file} ${name}`, () => {
        // a closure's arrow in a const header is the function itself, not one built per call
        const body = bodyOf(src, name)
        const found = FLAGGED.filter(([re]) => re.test(body)).map(([, what]) => what)
        expect(found, body).toEqual([])
      })
    }
  }

  it('the atrium trees and the core floor follow the zone by its cell flag alone: no frame callback, no polling', () => {
    for (const file of ['pharmacy/CoreStatic.tsx', 'pharmacy/coreFloor.ts', 'building/model/cells.ts', 'landscape/atrium.ts', 'building/render/compile.ts'])
      expect(code(readFileSync(join(ROOT, file), 'utf8')), file).not.toMatch(/useFrame|requestAnimationFrame|setInterval/)
    // the tree meshes are bound once by name (`|cell=<id>`), like every cell mesh; the hook is the compile-time `treeCell`
    expect(readFileSync(join(ROOT, 'building/render/BuildingMeshes.tsx'), 'utf8')).toMatch(/BUILDING_MODEL_ON \? treeCell : undefined/)
  })

  it('the checker flags what it should (negative control)', () => {
    for (const bad of ['{ const v = new Vector3() }', '{ return [a, b] }', '{ const o = { a: 1 } }', '{ f(...xs) }', '{ xs.forEach((x) => x) }', '{ xs.map(f) }'])
      expect(FLAGGED.some(([re]) => re.test(bad)), bad).toBe(true)
    expect(FLAGGED.some(([re]) => re.test('{ for (let i = 0; i < n; i++) e.visible = v }'))).toBe(false)
  })
})
