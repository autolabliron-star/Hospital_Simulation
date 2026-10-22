/**
 * The body's per-frame paths allocate nothing: no `new`, no array or object literals, no spreads and no closures inside the functions that run
 * every frame (a GC pause is a hitch in the middle of a walk). This reads the source, like src/scene/frameAllocations.test.ts, but follows the
 * helpers: the whole chain from the player system's frame to the last sweep is listed here.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DIR = join(process.cwd(), 'src/scene/player')

/** Code with comments and string contents blanked, keeping line numbers. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (m) => m.replace(/[^\n]/g, ' '))
}

/** The text of the function or method called `name` (its body, by brace matching; the parameter list is skipped by paren matching, so a parameter typed `{ x: number }` is not mistaken for the body). */
function bodyOf(src: string, name: string): string {
  const header = new RegExp(`(?:function\\s+${name}\\s*\\(|^[ \\t]*(?:(?:private|public|protected|readonly|static|get|set)\\s+)*${name}\\s*\\(|^[ \\t]*(?:(?:private|public|protected|readonly|static)\\s+)*${name}\\s*=\\s*\\()`, 'm')
  const m = header.exec(src)
  if (!m) throw new Error(`no function ${name}`)
  // the parameter list
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
  [/\.(map|filter|reduce|slice|concat)\(/, 'array method'], // (forEach with a prebound callback allocates nothing; a closure would be flagged below)
  [/\bfunction\b/, 'inner function'],
]

const PATHS: Record<string, string[]> = {
  'body.ts': ['step', 'glide', 'halt', 'stand', 'cruise', 'place', 'motionDir', 'copyBodyState'],
  'collision.ts': ['inPlaza', 'inRegion', 'inFloor', 'staticOverlap', 'walkableAt', 'firstHit', 'slidePiece', 'pushOutOfDynamics', 'moveBody', 'sweepToStop', 'clear', 'addCircle', 'addBox', 'addBlockers'],
  'sweep.ts': ['rectEntry', 'circleEntry', 'sweepCircleBox', 'sweepCircleCircle', 'overlapCircleBox', 'overlapCircleCircle'],
  'motion.ts': ['retarget', 'stepSpring', 'restDistance', 'angleBetween', 'turnDirection', 'turnTowards', 'facingFromVelocity', 'speedOf'],
  'scheme.ts': ['stepTurn', 'maxTurnRate', 'turnedHeading'],
  'solids.ts': ['queryStatic'], // (staticSolids builds the set once, on first use)
  // (R2: `present`, `syncLevel` and `publishSimCamera` run every frame of the chase camera, a flight and the overview: the level mapping of the camera)
  'system.ts': ['stepWalk', 'stepGlide', 'collectShapes', 'visitPerson', 'visitBot', 'standStill', 'publishBody', 'finishBody', 'syncSim', 'present', 'syncLevel', 'publishSimCamera'],
}

describe('the per-frame paths of the body allocate nothing', () => {
  for (const [file, names] of Object.entries(PATHS)) {
    it(`${file}: ${names.join(', ')}`, () => {
      const src = code(readFileSync(join(DIR, file), 'utf8'))
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
})

describe('the scan itself', () => {
  it('catches the allocations it is meant to catch, and lets plain arithmetic through', () => {
    const bad = bodyOf(code('function bad(x: number) {\n  const v = new Vector3()\n  const a = [x, 1]\n  const f = () => x\n  return { x: 1 }\n}'), 'bad')
    const hits = FLAGGED.filter(([re]) => bad.split('\n').some((l) => re.test(l))).map(([, what]) => what)
    expect(hits).toEqual(expect.arrayContaining(['new', 'array literal', 'closure', 'object literal']))
    const fine = bodyOf(code('function fine(x: number, o: { a: number }) {\n  o.a = x * 2 + o.a\n  const y = o.a > 1 ? x : -x\n  return y\n}'), 'fine')
    expect(FLAGGED.filter(([re]) => fine.split('\n').some((l) => re.test(l)))).toEqual([])
  })
})
