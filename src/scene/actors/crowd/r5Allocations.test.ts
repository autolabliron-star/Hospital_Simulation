/**
 * R5: the per-frame paths the procedure poses, instruments and attire added to the crowd allocate nothing: no `new`, no array or object literals, no
 * spreads, no closures, no array methods. Reads the source like src/scene/levels/noAllocations.test.ts (which still guards the model's per-person passes,
 * fillInput included) and src/scene/frameAllocations.test.ts (every `useFrame` body and the crowd's driveCrowd).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(process.cwd(), 'src/scene/actors/crowd')

const FLAGGED: [RegExp, string][] = [
  [/\bnew\s+[A-Za-z]/, 'new'],
  [/(^|[=(,:?&|]|\breturn)\s*\[/m, 'array literal'],
  [/(^|[=(,?&|]|\breturn)\s*\{\s*[a-zA-Z_]+\s*:/m, 'object literal'],
  [/\.\.\./, 'spread'],
  [/=>/, 'closure'],
  [/\.(map|filter|reduce|slice|concat)\(/, 'array method'],
  [/\bfunction\b/, 'inner function'],
]

/** Code with comments and string contents blanked, keeping line numbers. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (m) => m.replace(/[^\n]/g, ' '))
}

/** The body of the function or method called `name` (parameter list skipped by paren matching, then the braces matched). */
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

/** Every function R5 added to a frame of the crowd (the rig's solve, the action poses, the model's lists, the attire written on a change). */
const PATHS: Record<string, string[]> = {
  'surgicalPoses.ts': ['evalHand', 'evalAction', 'evalActionMode'],
  'rig.ts': ['solveRig', 'actWeight', 'actContext', 'springTo', 'updateInstruments', 'gripPoint', 'aimPoint', 'aimArm', 'aimHand', 'reachError', 'instrumentFrame', 'tubeFrame', 'handMiddle', 'armReach', 'armReachAt', 'tuckArms', 'solveArmReach'],
  // R5 wave 2: the patient on the OR table (the followers, the table's transform in the root frame, the legs and the foot, the pick capsule)
  'tablePatient.ts': ['settleAt', 'stepTableBody', 'tableRootInto', 'uprightOfLying', 'footToShin', 'tableMovePoint'],
  'model.ts': ['instruments', 'fillInput', 'bindAvatar', 'tick', 'capsule', 'visit'],
  'attire.ts': ['writeAttire', 'putSlot'],
  'blend.ts': ['modeFor'],
  'crowdRig.ts': ['driveCrowd'],
}

describe('the R5 per-frame paths of the crowd allocate nothing', () => {
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

  it('flags what it is meant to (negative control)', () => {
    for (const bad of ['const v = new Float32Array(3)', 'const a = [1, 2]', 'f({ x: 1 })', 'g(...xs)', 'xs.forEach((x) => x)', 'xs.map(f)']) expect(FLAGGED.some(([re]) => re.test(bad)), bad).toBe(true)
    for (const fine of ['out[0] = x', 'S[iW + 3] = G3[0]', 'const k = clamp(a, 0, 1)']) expect(FLAGGED.some(([re]) => re.test(fine)), fine).toBe(false)
  })
})
