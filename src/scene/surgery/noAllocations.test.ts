/**
 * The surgery scene's per-frame paths allocate nothing: no `new`, no array or object literals, no spreads, no closures and no array methods inside the functions
 * that run every frame (a GC pause is a hitch in the middle of a walk). This reads the source, like src/scene/drawCentre/noAllocations.test.ts, and follows the
 * helpers: the chain from the layer's two frame callbacks to the last matrix is listed here. (The canvas painters run at most 10-12 Hz and build strings; they are not
 * on this list, and the V8 sampling profiler in rig.test.ts measures the rig's frame itself.)
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
  [/\.(map|filter|reduce|slice|concat|splice|forEach)\(/, 'array method'],
  [/\bfunction\b/, 'inner function'],
]

const PATHS: Record<string, string[]> = {
  'rig.ts': ['writeCart', 'writeArm', 'ledModeOf', 'writeRings', 'writeLaser', 'writeDrape', 'writeLights', 'step'],
  'robotPose.ts': ['poseRobot', 'elbowUp', 'solveTilt', 'tiltDistance', 'tipMotion', 'motionGain', 'angleDelta', 'smooth01', 'clamp01', 'lerp', 'h01'],
  'matrices.ts': ['hideInstance', 'put', 'putYawed', 'putSegment', 'putSegmentPart'],
  'endoscope.ts': ['tipOnScreen'],
  'liveEndoscope.ts': ['playerInOr', 'inOr', 'cameraLive', 'update'],
  '../interact/surgery/teaching.ts': ['tick', 'end'],
}

describe('the per-frame paths of the surgery scene allocate nothing', () => {
  for (const [file, names] of Object.entries(PATHS)) {
    it(`${file}: ${names.join(', ')}`, () => {
      const src = code(readFileSync(join(ROOT, 'src/scene/surgery', file), 'utf8'))
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

  it('SurgeryLayer\'s two frame callbacks allocate nothing', () => {
    const src = code(readFileSync(join(ROOT, 'src/scene/surgery/SurgeryLayer.tsx'), 'utf8'))
    let from = 0
    let found = 0
    for (;;) {
      const start = src.indexOf('useFrame(', from)
      if (start < 0) break
      // the text of the call: from its opening parenthesis to the matching one
      const open = src.indexOf('(', start)
      let depth = 0
      let end = open
      for (; end < src.length; end++) {
        if (src[end] === '(') depth++
        else if (src[end] === ')' && --depth === 0) break
      }
      const call = src.slice(open, end)
      // the callback itself is the one closure; everything inside its body is flagged
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
  })

  it('uses negative frame priorities from the shared frame order (positive ones take over rendering in R3F)', () => {
    const src = readFileSync(join(ROOT, 'src/scene/surgery/SurgeryLayer.tsx'), 'utf8')
    expect(src).toContain('FRAME_PRIORITY.surgeryRig')
    expect(src).toContain('FRAME_PRIORITY.surgeryScreens')
  })

  it('the scan itself catches the allocations it is meant to catch, and lets plain arithmetic through', () => {
    const bad = bodyOf(code('function bad(x: number) {\n  const v = new Vector3()\n  const a = [x, 1]\n  const f = () => x\n  return { x: 1 }\n}'), 'bad')
    const hits = FLAGGED.filter(([re]) => bad.split('\n').some((l) => re.test(l))).map(([, what]) => what)
    expect(hits).toEqual(expect.arrayContaining(['new', 'array literal', 'closure', 'object literal']))
    const fine = bodyOf(code('function fine(x: number, o: { a: number }) {\n  o.a = x * 2 + o.a\n  const y = o.a > 1 ? x : -x\n  return y\n}'), 'fine')
    expect(FLAGGED.filter(([re]) => fine.split('\n').some((l) => re.test(l)))).toEqual([])
  })
})
