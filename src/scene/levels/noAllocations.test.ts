/**
 * R2: what runs every frame to put two storeys on the screen allocates nothing: no `new`, no array or object literals, no spreads, no closures. Reads the
 * source like src/scene/player/noAllocations.test.ts (and src/scene/frameAllocations.test.ts, which guards every `useFrame` body, the levels frame's included):
 * the levels frame's rule and its groups, the crowd's per-person mapping and skip, the emote icons' anchor and the head anchor.
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

const FLAGGED: [RegExp, string][] = [
  [/\bnew\s+[A-Za-z]/, 'new'],
  [/(^|[=(,:?&|]|\breturn)\s*\[/m, 'array literal'],
  [/(^|[=(,?&|]|\breturn)\s*\{\s*[a-zA-Z_]+\s*:/m, 'object literal'],
  [/\.\.\./, 'spread'],
  [/=>/, 'closure'],
  [/\.(map|filter|reduce|slice|concat)\(/, 'array method'],
  [/\bfunction\b/, 'inner function'],
]

const PATHS: Record<string, string[]> = {
  'levels/levelRule.ts': ['updateLevelView'],
  'levels/levelGroups.ts': ['levelGroupVisible', 'applyLevelGroups'],
  'levels/levelView.ts': ['shownAt'],
  'actors/crowd/model.ts': ['visit', 'matchRiders', 'tick', 'fillInput', 'trackMotion', 'takeDriven', 'staleBody', 'capsule', 'blobs', 'setBlob'],
  'fx/emoteState.ts': ['update'],
  'fx/headAnchor.ts': ['headAnchor', 'headPose', 'isSurgerySeat'],
  'fx/bubblePlacement.ts': ['placeBubble'],
}

describe('the per-frame paths of the levels allocate nothing', () => {
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

  it('the levels frame callback itself is a plain statement list (the whole-source guard also reads it)', () => {
    const src = code(readFileSync(join(ROOT, 'levels/LevelsFrame.tsx'), 'utf8'))
    const call = src.slice(src.indexOf('useFrame('))
    expect(call).toContain('updateLevelView(sim.player')
    expect(call).toContain('applyLevelGroups()')
    expect(/new\s+[A-Za-z]/.test(call)).toBe(false)
  })
})
