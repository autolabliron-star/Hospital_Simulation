// Adopted from Waltz City (src/scene/frameAllocations.test.ts).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A guard against the commonest source of frame hitches: building vectors, colours, sets and arrays inside a `useFrame`
 * callback, which runs 60 times a second and fills the garbage collector with short-lived objects. Hoist them to the
 * module (`const _v = new Vector3()`) or to a `useMemo`/`useRef`. This reads the source, so it only sees the callback's
 * own body, not the helpers it calls: it catches the pattern, it does not prove a frame allocates nothing.
 */
const FLAGGED = /new (Vector[234]|Color|Quaternion|Euler|Matrix[34]|Object3D|Box3|Sphere|Raycaster|Set|Map|Float32Array|Array)\b|\[\.\.\./

/**
 * (WP-6) The patterns that build a fresh array or string every call: `.map(`, `.filter(` (a new array each), a template literal and `toFixed`
 * (a new string each). They are flagged in the `useFrame` bodies AND in the named step functions those bodies call. A line that must
 * keep one (a rare branch, behind a change check) says so with `// alloc-ok: <why>` at its end.
 */
const FLAGGED_BUILDERS = /\.map\(|\.filter\(|`|\.toFixed\(/

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) sources(p, out)
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(p)
  }
  return out
}

/** The text of every `useFrame(...)` call in `src`, with the line its body starts on. */
function frameBodies(src: string): { line: number; text: string }[] {
  const found: { line: number; text: string }[] = []
  const re = /useFrame\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const open = src.indexOf('(', m.index)
    let depth = 0
    let end = open
    for (; end < src.length; end++) {
      if (src[end] === '(') depth++
      else if (src[end] === ')' && --depth === 0) break
    }
    found.push({ line: src.slice(0, open).split('\n').length, text: src.slice(open, end) })
  }
  return found
}

describe('frame callbacks', () => {
  it('do not build vectors, colours, sets or arrays on every frame', () => {
    const offenders: string[] = []
    let callbacks = 0
    for (const file of sources(join(process.cwd(), 'src'))) {
      for (const body of frameBodies(readFileSync(file, 'utf8'))) {
        callbacks++
        body.text.split('\n').forEach((line, i) => {
          if (!/^\s*\/\//.test(line) && FLAGGED.test(line)) offenders.push(`${file.replace(process.cwd() + '/', '')}:${body.line + i}: ${line.trim()}`)
        })
      }
    }
    expect(callbacks).toBeGreaterThan(0) // the scan found the frame callbacks it is meant to guard
    expect(offenders).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------------
// (WP-6) the same rule for array and string builders, in the `useFrame` bodies and in the named step functions they call
// ---------------------------------------------------------------------------------------------------------------------------------------

/** The index just past the `close` that matches the `open` at `from` (strings and comments are not understood: the count is of brackets only). */
function matching(src: string, from: number, open: string, close: string): number {
  let depth = 0
  for (let i = from; i < src.length; i++) {
    if (src[i] === open) depth++
    else if (src[i] === close && --depth === 0) return i + 1
  }
  return src.length
}

/** The body text of the top-level-ish function `name` in `src` (`function name(` or `const name = (...) =>`), and the line it starts on. */
function functionBody(src: string, name: string): { line: number; text: string } | null {
  const decl = new RegExp(`(?:function\\s+${name}\\s*(?:<[^>]*>)?\\(|(?:const|let)\\s+${name}\\s*(?::[^=]+)?=\\s*(?:async\\s*)?(?:function\\s*)?\\()`).exec(src)
  if (!decl) return null
  const paramsOpen = src.indexOf('(', decl.index + decl[0].length - 1)
  const paramsEnd = matching(src, paramsOpen, '(', ')')
  const rest = src.slice(paramsEnd, paramsEnd + 400)
  const arrow = rest.indexOf('=>')
  const brace = rest.indexOf('{')
  let start: number
  let end: number
  if (arrow >= 0 && (brace < 0 || arrow < brace) && !/^\s*\{/.test(rest.slice(arrow + 2))) {
    // an expression body: to the end of its line
    start = paramsEnd
    end = src.indexOf('\n', paramsEnd + arrow)
  } else {
    if (brace < 0) return null
    const open = arrow >= 0 && brace > arrow ? paramsEnd + rest.indexOf('{', arrow) : paramsEnd + brace
    start = open
    end = matching(src, open, '{', '}')
  }
  return { line: src.slice(0, start).split('\n').length, text: src.slice(start, end) }
}

/** Names of functions of the same file that a body calls directly (`name(`), without method calls (`.name(`). */
function calledNames(text: string): string[] {
  const names = new Set<string>()
  for (const m of text.matchAll(/(?<![.\w])([A-Za-z_$][\w$]*)\(/g)) names.add(m[1])
  return [...names]
}

/** Step functions that are called from another file's `useFrame` (the scan cannot follow an import), named by hand. */
const EXTRA_STEPS: Record<string, string[]> = {
  'src/scene/actors/crowd/crowdRig.ts': ['driveCrowd', 'poseRows', 'uploadFirst', 'setAvatarInstances', 'setInstances'],
  // the authored building's zones (ZonesModel.tsx calls them through the runtime; src/scene/building/model/noAllocations.test.ts is stricter)
  'src/scene/building/model/culling.ts': ['frustumOf', 'levelAllows', 'cameraZoneIndex', 'cullZones'],
  'src/scene/building/model/clip.ts': ['updateModelClips'],
  'src/scene/lighting/env/lobbyProbe.ts': ['selectZoneProbe', 'lobbyEnvWanted'],
}

/**
 * Step functions that build arrays only behind an early-return change check, so a frame that changes nothing allocates nothing. Each entry
 * names the guard. (The preferred form is `// alloc-ok: why` on the line, in the file itself.)
 */
const GUARDED_STEPS = new Set(['src/scene/drawers/DrawersLayer.tsx#refreshView']) // returns at once unless a Jump or a roster change happened

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'useFrame', 'super'])

function builderOffenders(): { offenders: string[]; scanned: number; steps: string[] } {
  const offenders: string[] = []
  const steps: string[] = []
  let scanned = 0
  const scan = (file: string, label: string, line0: number, text: string): void => {
    if (GUARDED_STEPS.has(`${file}#${label}`)) return
    scanned++
    text.split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, (c) => (/alloc-ok/.test(c) ? '\u0000' : ''))
      if (code.includes('\u0000') || /^\s*(\*|\/\*)/.test(line)) return
      if (FLAGGED_BUILDERS.test(code)) offenders.push(`${file}:${line0 + i}: [${label}] ${line.trim()}`)
    })
  }
  for (const path of sources(join(process.cwd(), 'src'))) {
    const file = path.replace(process.cwd() + '/', '')
    const src = readFileSync(path, 'utf8')
    const bodies = frameBodies(src)
    const seen = new Set<string>()
    for (const body of bodies) {
      scan(file, 'useFrame', body.line, body.text)
      for (const name of calledNames(body.text)) {
        if (KEYWORDS.has(name) || seen.has(name)) continue
        const fn = functionBody(src, name)
        if (!fn) continue
        seen.add(name)
        steps.push(`${file}#${name}`)
        scan(file, name, fn.line, fn.text)
      }
    }
    for (const name of EXTRA_STEPS[file] ?? []) {
      if (seen.has(name)) continue
      const fn = functionBody(src, name)
      if (!fn) {
        offenders.push(`${file}: step function ${name} not found (EXTRA_STEPS is out of date)`)
        continue
      }
      steps.push(`${file}#${name}`)
      scan(file, name, fn.line, fn.text)
    }
  }
  return { offenders, scanned, steps }
}

describe('frame callbacks and their step functions (builders)', () => {
  it('build no arrays or strings with .map, .filter, template literals or toFixed on every frame', () => {
    const { offenders, scanned, steps } = builderOffenders()
    expect(scanned).toBeGreaterThan(20)
    expect(steps).toContain('src/scene/actors/crowd/crowdRig.ts#driveCrowd')
    expect(offenders).toEqual([])
  })

  it('flags each of the four patterns (negative control)', () => {
    for (const bad of ['xs.map((x) => x)', 'xs.filter(Boolean)', 'const s = `a${b}`', 'n.toFixed(1)']) expect(FLAGGED_BUILDERS.test(bad)).toBe(true)
    for (const fine of ['xs.forEach(f)', 'a.set(b)', "const s = 'a' + b", 'const n = Math.round(x)']) expect(FLAGGED_BUILDERS.test(fine)).toBe(false)
  })

  it('finds a function body and the functions a body calls', () => {
    const src = 'function step(a) {\n  return a.map((x) => x)\n}\nconst other = (b: number) => b.toFixed(1)\nuseFrame(() => { step(1); other(2); x.method(3) })'
    expect(functionBody(src, 'step')?.text).toContain('a.map')
    expect(functionBody(src, 'other')?.text).toContain('toFixed')
    expect(calledNames('step(1); other(2); x.method(3)')).toEqual(['step', 'other'])
    const fake = frameBodies(src)[0].text
    expect(fake).toContain('step(1)')
  })
})
