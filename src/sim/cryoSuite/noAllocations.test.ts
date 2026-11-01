/**
 * R5 wave 3: the cryo suite's per-tick paths allocate nothing: no `new`, no array or object literal, no spread, no closure and no array method inside
 * the functions the suite runs every tick (a GC pause is a hitch in the middle of a walk). This reads the source, like
 * src/sim/procedure/noAllocations.test.ts: the CT targets and foci, the room's derive (the needle clock, the held breath's windows, the ice, the tips),
 * the team's work points, headings and dress, a hop's walk, a stretcher's drive along its lane (fix round 3: the lane's pose, the drive's step, its look-ahead for
 * another body, the slow turn on the spot, and the case's checks of the stretcher's way), and the suite's published view. (A step change may allocate once: `fillView`'s `enterStep`, a
 * log line; `place` and `caseScriptFor` run once per step or per case. `scriptWant` is not on the list either, but it is not once per step: `assign` runs
 * it for each person on every assignment pass, 4 Hz, and each call makes the step's overlay object, the run key and the spot, as the OR team's does.
 * That is a few small objects four times a second a person, not per tick.)
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
  const header = new RegExp(`(?:function\\s+${name}|^[ \\t]+(?:private |public |override )*${name})\\s*(?:<[^>]*>)?\\(`, 'm')
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
  'src/sim/procedure/cryoPlaces.ts': ['at', 'tableShift', 'fieldInto', 'entryInto', 'cryoTargetInto', 'cryoFocusInto', 'cryoAnchorSlots', 'cryoAnchorSpot'],
  'src/sim/cryoSuite/derive.ts': ['aimSplit', 'needleClockInto', 'needleInAt', 'iceAt', 'tipAt', 'clamp01', 'smooth', 'grow', 'applyRoom', 'scanEdge', 'pushHoldInto', 'scanHoldInto', 'holdsBreathAt', 'apnoeaCap'],
  // (the stretcher's way and the arrival's gate: the checks made every tick; its events, a task begun, a drive armed, are methods of their own)
  'src/sim/cryoSuite/case.ts': ['transferHeld', 'transferStarted', 'summonAt', 'stepBack', 'slow', 'holdLaneAt', 'parkKey', 'wantsPorter'],
  'src/sim/cryoSuite/team.ts': ['workPointInto', 'updatePoints', 'dress', 'scriptHeading', 'wrapPi', 'nearLane'],
  // (a lane's pose, a drive's step along it, its look-ahead for another body, the slow turn on the spot)
  'src/sim/cryoSuite/lane.ts': ['poseAt', 'advance'],
  'src/sim/cryoSuite/index.ts': ['deriveProcedure', 'unpose'],
  // (a hop's route is made once, when the walk begins: `goTo`; the walk itself is these)
  'src/sim/cryoSuite/hop.ts': ['distToSegment', 'inScanRoom', 'step', 'bodyOnRoute', 'stepLane', 'stepTurn', 'laneBlocked', 'wrapPi'],
  // (the query a hop makes of the crowd before it begins)
  'src/sim/nav/crowd.ts': ['bodyNear'],
}
describe('the per-tick paths of the cryo suite allocate nothing', () => {
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

  it('the scan itself catches an allocation, in a function and in a method', () => {
    const bad = code('function f(a) {\n  const x = new Foo()\n  return [a, x]\n}\nclass C {\n  private g(a) {\n    return { a: 1 }\n  }\n}')
    expect(FLAGGED.some(([re]) => bodyOf(bad, 'f').split('\n').some((l) => re.test(l)))).toBe(true)
    expect(FLAGGED.some(([re]) => bodyOf(bad, 'g').split('\n').some((l) => re.test(l)))).toBe(true)
  })
})
