/**
 * R5: the watch camera's per-frame paths allocate nothing: no `new`, no array or object literals, no spreads, no closures and no array methods inside the
 * functions that run every frame while you watch (a GC pause is a stutter in the middle of a dolly). This reads the source, like
 * src/scene/surgery/noAllocations.test.ts: the director's frame and everything it calls each frame (the anchors, the shot pose, the hold's drift, the
 * dolly, the limits). The UI is told of a change through separate methods that run only on that change (`cue`, `setStatus`, `startMove` ...).
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

/** The body of the function or method called `name` (brace matching; the parameter list is skipped by paren matching). */
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
  // (a forEach with a callback bound once, `.forEach(this.visitPerson)`, allocates nothing)
  [/\.(map|filter|reduce|slice|concat|splice)\(|\.forEach\((?!this\.\w+\))/, 'array method'],
  [/\bfunction\b/, 'inner function'],
]

const PATHS: Record<string, string[]> = {
  'director.ts': ['update', 'stepLive', 'collectPeople', 'visit', 'trackCase', 'pickShot', 'stepFree', 'snapTo', 'write', 'stepLeaving'],
  'dolly.ts': ['tick', 'poseInto', 'start', 'dollySeconds'],
  'shots.ts': ['shotPoseInto', 'holdDriftInto', 'cueAt', 'floorOf', 'shotPlanFor', 'isOverridePlan', 'bedsideLead', 'candidateInto', 'poseClear', 'pickAltInto', 'inFrustum'],
  'anchors.ts': ['anchorInto', 'syncAnchorCtx', 'roleFloorInto', 'fieldInto'],
  'limits.ts': ['clampEyeInto', 'addPerson', 'insideRect', 'insideObstacle', 'moveObstacle', 'segmentClearOfPeople'],
}

describe('the per-frame paths of the watch camera allocate nothing', () => {
  for (const [file, names] of Object.entries(PATHS)) {
    it(`${file}: ${names.join(', ')}`, () => {
      const src = code(readFileSync(join(ROOT, 'src/scene/watch', file), 'utf8'))
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

  it('the scan catches each pattern (negative control)', () => {
    const bad = ['const v = new Vector3()', 'const a = [1, 2]', 'const o = { x: 1 }', 'f(...xs)', 'xs.forEach((x) => x)', 'xs.forEach(f)', 'xs.map(f)', 'function inner() {}']
    for (const line of bad) expect(FLAGGED.some(([re]) => re.test(line)), line).toBe(true)
    expect(FLAGGED.some(([re]) => re.test('sim.entities.forEach(this.visitPerson)'))).toBe(false)
  })
})
