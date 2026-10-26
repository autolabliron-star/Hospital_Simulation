/**
 * R4: the cryo suite's per-frame paths allocate nothing: no `new`, no array or object literals, no spreads, no closures and no array methods inside
 * the functions that run every frame (the scan of src/scene/surgery/noAllocations.test.ts): the rig's step and the pose solver it calls, the screens'
 * repaint gate (a repaint itself is at most 4 Hz and may build strings), and the layer's two frame callbacks, at negative priorities.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(process.cwd(), 'src/scene/cryoSuite')

/** Code with comments and string contents blanked, keeping line numbers. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (m) => m.replace(/[^\n]/g, ' '))
}

/** The body of the function or method called `name`: the first declaration whose parameter list is followed by `{` on its line (an interface's signature is skipped). */
function bodyOf(src: string, name: string): string {
  const header = new RegExp(`(?:function\\s+${name}\\s*\\(|^[ \\t]*(?:(?:private|public|protected|readonly|static|get|set)\\s+)*${name}\\s*\\()`, 'gm')
  for (let m = header.exec(src); m; m = header.exec(src)) {
    let i = m.index + m[0].length
    let depth = 1
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '(') depth++
      else if (src[i] === ')') depth--
    }
    const eol = src.indexOf('\n', i)
    const open = src.indexOf('{', i)
    if (open < 0 || (eol >= 0 && open > eol)) continue
    let braces = 0
    let end = open
    for (; end < src.length; end++) {
      if (src[end] === '{') braces++
      else if (src[end] === '}' && --braces === 0) break
    }
    return src.slice(open, end + 1)
  }
  throw new Error(`no function ${name}`)
}

const FLAGGED: [RegExp, string][] = [
  [/\bnew\s+[A-Za-z]/, 'new'],
  [/(^|[=(,:?&|]|\breturn)\s*\[/m, 'array literal'],
  [/(^|[=(,?&|]|\breturn)\s*\{\s*[a-zA-Z_]+\s*:/m, 'object literal'],
  [/\.\.\./, 'spread'],
  [/=>/, 'closure'],
  [/\.(map|filter|reduce|slice|concat|splice|forEach)\(/, 'array method'],
  [/\bfunction\b/, 'inner function'],
]

const PATHS: Record<string, string[]> = {
  'rig.ts': ['step', 'writeArm', 'writeNeedle', 'bandCode', 'scanning'],
  'pose.ts': ['cryoTableX', 'pathGuideInto', 'forwardArm', 'setP', 'wrap', 'solveArm', 'stowGuideInto', 'standbyGuideInto', 'normalize', 'blendGuide', 'robotNeedle', 'armTargetInto', 'easeGuide', 'needlePoseInto'],
  'screens.ts': ['update', 'shouldRepaint', 'screenKeyInto'],
  'presence.ts': ['playerInSuite', 'lookingAtSuite'],
  '../surgery/matrices.ts': ['hideInstance', 'put', 'putSegment'],
}

describe('the per-frame paths of the cryo suite allocate nothing', () => {
  for (const [file, names] of Object.entries(PATHS)) {
    it(`${file}: ${names.join(', ')}`, () => {
      const src = code(readFileSync(join(ROOT, file), 'utf8'))
      const offenders: string[] = []
      for (const name of names) {
        const body = bodyOf(src, name)
        expect(body.length, `${file} ${name}`).toBeGreaterThan(10)
        body.split('\n').forEach((line, i) => {
          for (const [re, what] of FLAGGED) if (re.test(line)) offenders.push(`${file} ${name}+${i}: ${what}: ${line.trim()}`)
        })
      }
      expect(offenders).toEqual([])
    })
  }

  it('CryoSuiteLayer\'s two frame callbacks allocate nothing and run at the frame order\'s negative cryo priorities', () => {
    const raw = readFileSync(join(ROOT, 'CryoSuiteLayer.tsx'), 'utf8')
    const src = code(raw)
    let from = 0
    let found = 0
    for (;;) {
      const start = src.indexOf('useFrame(', from)
      if (start < 0) break
      const open = src.indexOf('(', start)
      let depth = 0
      let end = open
      for (; end < src.length; end++) {
        if (src[end] === '(') depth++
        else if (src[end] === ')' && --depth === 0) break
      }
      const call = src.slice(open, end)
      const body = call.slice(call.indexOf('=>') + 2)
      const offenders: string[] = []
      body.split('\n').forEach((line, i) => {
        for (const [re, what] of FLAGGED) if (re.test(line)) offenders.push(`useFrame #${found}+${i}: ${what}: ${line.trim()}`)
      })
      expect(offenders).toEqual([])
      found++
      from = end
    }
    expect(found).toBe(2)
    expect(raw).toContain('FRAME_PRIORITY.cryoRig')
    expect(raw).toContain('FRAME_PRIORITY.cryoScreens')
    // nothing while level 2 is hidden
    expect(raw.match(/levelView\.shown !== 2\) return/g)).toHaveLength(2)
  })
})
