/**
 * The kiosks' per-frame paths allocate nothing: no `new`, no array or object literals, no spreads and no closures inside the functions that run every frame
 * (a GC pause is a hitch in the middle of a walk). This reads the source, like src/scene/player/noAllocations.test.ts (the pattern is copied from it): the
 * whole chain from the layer's frame to the last colour write, your session's controller, and the kiosk memory.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

/** Code with comments and string contents blanked, keeping line numbers. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (m) => m.replace(/[^\n]/g, ' '))
}

/** The text of the function or method called `name` (its body, by brace matching; the parameter list is skipped by paren matching). */
function bodyOf(src: string, name: string): string {
  const header = new RegExp(`(?:function\\s+${name}\\s*\\(|^[ \\t]*(?:(?:private|public|protected|readonly|static|get|set)\\s+)*${name}\\s*\\()`, 'm')
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
  [/\.(map|filter|reduce|slice|concat)\(/, 'array method'],
  [/\bfunction\b/, 'inner function'],
  [/`/, 'template string'],
]

const PATHS: Record<string, string[]> = {
  'src/scene/kiosks/motion.ts': ['qrFlicker', 'pingLevel', 'digitsLit', 'digitValue', 'levelsInto', 'slipAlpha'],
  'src/scene/kiosks/rig.ts': ['digitSegmentsInto', 'writeDigits', 'updateKiosk', 'updateRig'],
  'src/scene/interact/healthCheck.ts': ['onPlatform', 'standingAnim', 'tick', 'session', 'sit', 'tooFar', 'startGlide', 'stepGlide', 'pose', 'liftOnPlatform', 'watchCard'],
  'src/ui/kioskView.ts': ['trackKiosk'],
}

describe('the kiosks\' per-frame paths allocate nothing', () => {
  for (const [file, names] of Object.entries(PATHS)) {
    it(`${file}: ${names.join(', ')}`, () => {
      const src = code(readFileSync(join(ROOT, file), 'utf8'))
      const offenders: string[] = []
      for (const name of names) {
        const body = bodyOf(src, name)
        expect(body.length, `${file} ${name}: the scan found its body`).toBeGreaterThan(10)
        body.split('\n').forEach((line, i) => {
          for (const [re, what] of FLAGGED) if (re.test(line)) offenders.push(`${file} ${name}+${i}: ${what}: ${line.trim()}`)
        })
      }
      expect(offenders).toEqual([])
    })
  }

  it('the scan itself catches the allocations it is meant to catch, and lets plain arithmetic through', () => {
    const bad = bodyOf(code('function bad(x: number) {\n  const v = new Vector3()\n  const a = [x, 1]\n  const f = () => x\n  return { x: 1 }\n}'), 'bad')
    const hits = FLAGGED.filter(([re]) => bad.split('\n').some((l) => re.test(l))).map(([, what]) => what)
    expect(hits).toEqual(expect.arrayContaining(['new', 'array literal', 'closure', 'object literal']))
    const fine = bodyOf(code('function fine(x: number, o: { a: number }) {\n  o.a = x * 2 + o.a\n  const y = o.a > 1 ? x : -x\n  return y\n}'), 'fine')
    expect(FLAGGED.filter(([re]) => fine.split('\n').some((l) => re.test(l)))).toEqual([])
  })
})
