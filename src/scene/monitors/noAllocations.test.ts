/**
 * The monitors' per-frame path allocates nothing: the frame callback in PatientMonitors.tsx and every helper it reaches (the clock, the sweep, the
 * mesh's quad writer). Read from the source like src/scene/surgery/noAllocations.test.ts. (The pump allocates a little, twice a second, outside the
 * frame: it is not on this list.)
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
  [/\.(map|filter|reduce|slice|concat|splice|forEach|some|find)\(/, 'array method'],
  [/\bfunction\b/, 'inner function'],
]

const PATHS: Record<string, string[]> = {
  'clock.ts': ['advance'],
  'sweep.ts': ['sweepAt', 'entryOf', 'bandQuads'],
  'mesh.ts': ['write', 'band', 'idleBand', 'put'],
}

function offendersIn(body: string, where: string): string[] {
  const out: string[] = []
  body.split('\n').forEach((line, i) => {
    for (const [re, what] of FLAGGED) if (re.test(line)) out.push(`${where}+${i}: ${what}: ${line.trim()}`)
  })
  return out
}

describe('the monitors\' per-frame path allocates nothing', () => {
  for (const [file, names] of Object.entries(PATHS)) {
    it(`${file}: ${names.join(', ')}`, () => {
      const src = code(readFileSync(join(ROOT, 'src/scene/monitors', file), 'utf8'))
      const offenders: string[] = []
      for (const name of names) {
        const body = bodyOf(src, name)
        expect(body.length, `${file} ${name}: the scan found its body`).toBeGreaterThan(10)
        offenders.push(...offendersIn(body, `${file} ${name}`))
      }
      expect(offenders).toEqual([])
    })
  }

  it('PatientMonitors\' one frame callback allocates nothing, at its own negative priority', () => {
    const raw = readFileSync(join(ROOT, 'src/scene/monitors/PatientMonitors.tsx'), 'utf8')
    expect(raw).toContain('FRAME_PRIORITY.patientMonitors')
    const src = code(raw)
    const start = src.indexOf('useFrame(')
    expect(start).toBeGreaterThan(0)
    expect(src.indexOf('useFrame(', start + 1)).toBe(-1)
    const open = src.indexOf('(', start)
    let depth = 0
    let end = open
    for (; end < src.length; end++) {
      if (src[end] === '(') depth++
      else if (src[end] === ')' && --depth === 0) break
    }
    const call = src.slice(open, end)
    expect(offendersIn(call.slice(call.indexOf('=>') + 2), 'useFrame')).toEqual([])
  })

  it('the frame priority sits between the surgery screens and the imaging machines', async () => {
    const { FRAME_PRIORITY } = await import('@/scene/camera/frameOrder')
    expect(FRAME_PRIORITY.patientMonitors).toBe(-0.26)
    expect(FRAME_PRIORITY.patientMonitors).toBeGreaterThan(FRAME_PRIORITY.surgeryScreens)
    expect(FRAME_PRIORITY.patientMonitors).toBeLessThan(FRAME_PRIORITY.imagingMachines)
  })

  it('the scan catches what it is meant to catch', () => {
    const bad = bodyOf(code('function bad(x: number) {\n  const v = new Vector3()\n  const a = [x, 1]\n  const f = () => x\n  return { x: 1 }\n}'), 'bad')
    expect(offendersIn(bad, 'bad').length).toBeGreaterThanOrEqual(4)
  })
})
