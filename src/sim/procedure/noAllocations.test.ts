/**
 * The step-by-step engine's per-frame paths allocate nothing: no `new`, no array or object literal, no spread, no closure and no array method
 * inside the functions a room runs every tick (a GC pause is a hitch in the middle of a walk). This reads the source, like
 * src/scene/surgery/noAllocations.test.ts: the chain from `stepAt` to the published view is listed here. (A step change may allocate once, in
 * `enterStep`: it is not on the list.) The compile and the case set-up (`compileScript`, `caseSteps`, `scriptedExchanges`, `newRoleViews`)
 * run once per case and are not either.
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

/** The body of the function called `name` (brace matching; the parameter list is skipped by paren matching). */
function bodyOf(src: string, name: string): string {
  const header = new RegExp(`function\\s+${name}\\s*\\(`, 'm')
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
  [/\.(map|filter|reduce|slice|concat|splice|forEach)\(/, 'array method'],
  [/\bfunction\b/, 'inner function'],
]

const PATHS: Record<string, string[]> = {
  'timing.ts': ['lerpExact', 'davinciSlot', 'stepAt'],
  'patient.ts': ['smooth01', 'copyPose', 'patientStart', 'patientAt'],
  'arms.ts': ['withdrawAt', 'startOffset', 'armsAt'],
  'roles.ts': ['roleLine', 'applyRoleViews'],
  'targets.ts': ['anchorSpot', 'setTable', 'tiltPointInto', 'onPatient', 'resolveTarget', 'portInto', 'focusPointInto'],
  // R5 geometry: the planning slice seen through the patient's roll (the needle entries every frame: the people's hands, the arm, the drapes) and the nominal body it is checked against
  'ctSlice.ts': ['ctTableShift', 'ctTumourInto', 'ctSliceInto', 'ctSliceDirInto', 'ctRoomToSliceInto', 'ctPivotInto', 'ctBodyOffsetOf', 'ellipseSignedDistance'],
  'cryoPlaces.ts': ['tableShift', 'tumourOf', 'fieldInto', 'entryInto', 'cryoTargetInto', 'cryoFocusInto'],
  'view.ts': ['fillView'],
  'actions.ts': ['animOf'],
}

describe('the per-frame paths of the procedure engine allocate nothing', () => {
  for (const [file, names] of Object.entries(PATHS)) {
    it(`${file}: ${names.join(', ')}`, () => {
      const src = code(readFileSync(join(ROOT, 'src/sim/procedure', file), 'utf8'))
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

  it('the scan itself catches an allocation', () => {
    const bad = code('function f(a) {\n  const x = new Foo()\n  return [a, x]\n}')
    const body = bodyOf(bad, 'f')
    expect(FLAGGED.some(([re]) => body.split('\n').some((l) => re.test(l)))).toBe(true)
  })

  it('the Staffer overlay (R5) allocates nothing per tick', () => {
    const src = code(readFileSync(join(ROOT, 'src/sim/surgery/actors.ts'), 'utf8'))
    const body = src.slice(src.indexOf('private overlay()'), src.indexOf('private overlay()') + 1500)
    const end = body.indexOf('\n  }\n}')
    const text = body.slice(0, end > 0 ? end : body.length)
    for (const [re, what] of FLAGGED) {
      for (const line of text.split('\n')) expect(re.test(line), `overlay: ${what}: ${line.trim()}`).toBe(false)
    }
  })
})
